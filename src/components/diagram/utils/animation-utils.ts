/* eslint-disable -- Migrated file */
import type {
  Step,
  PathId,
  Path,
  FrameState,
  NodeModel,
  EdgeModel,
  Camera,
  Vec2,
  PathFollowAction,
  PositionTweenAction,
  TransformTweenAction,
  VisibilityAction,
  PathAnimateAction,
  EdgeTweenAction,
  ContainerTransformAction,
  PhantomNode,
  StepAction,
  AnimatedSprite,
  TransitionType,
  Easing,
} from '../types';
import { clamp, lerp } from './math-utils';
import { lerpColor } from './color-utils';
import { pointAndTangentAt, applyEasing } from './geometry-utils';
import { edgeToPath, getNodeFlowPath, getMultiEdgePaths } from './edge-utils';
import { normalizeNodeColors, normalizeEdgeColors, normalizeBarColors, normalizeSeriesColors, normalizePointColors } from './algo-utils';
import {
  NUMERIC_NODE_PROPS,
  COLOR_NODE_PROPS,
  NUMERIC_EDGE_PROPS,
  COLOR_EDGE_PROPS,
  getCoveredProps,
} from './implicit-transition-plan';

// mesh3d full 3x3 linear map entries with their identity value (diagonal 1, else 0).
const _MESH_M3_KEYS: ReadonlyArray<readonly [string, number]> = [
  ['tm11', 1], ['tm12', 0], ['tm13', 0],
  ['tm21', 0], ['tm22', 1], ['tm23', 0],
  ['tm31', 0], ['tm32', 0], ['tm33', 1],
];

// NOTE: Steps are normalized to full snapshots on load (see normalizeStepsToFullSnapshots).
// No delta resolution is needed here - steps already contain complete node/edge data.

/**
 * Calculate iteration progress for repeated animations
 * @param elapsed Time elapsed since action start
 * @param actionDuration Total duration for all iterations
 * @param iterations Number of iterations (default 1)
 * @param isCumulative If true (e.g. rotation), accumulate across iterations; if false (e.g. scale/position), oscillate
 * @returns Object with { t: progress 0-1, multiplier: for cumulative effects }
 */
function calculateIterationProgress(
  elapsed: number,
  actionDuration: number,
  iterations: number = 1,
  isCumulative: boolean = false
): { t: number; multiplier: number } {
  if (iterations <= 1) {
    // No iterations, standard 0-1 progress
    return { t: clamp(elapsed / actionDuration, 0, 1), multiplier: 1 };
  }

  const singleIterationDuration = actionDuration / iterations;
  const iterationIndex = Math.floor(elapsed / singleIterationDuration);
  const iterationProgress = (elapsed % singleIterationDuration) / singleIterationDuration;

  if (isCumulative) {
    // Cumulative (e.g., rotation): each iteration adds to the total
    // Multiplier accumulates with each completed iteration
    const completedIterations = Math.min(iterationIndex, iterations - 1);
    const currentProgress = clamp(iterationProgress, 0, 1);
    const multiplier = completedIterations + currentProgress;
    return { t: currentProgress, multiplier };
  } else {
    // Oscillating (e.g., scale, position, fade): 
    // iterations=N means the animation plays N times forward, always ending at target
    // Pattern: forward, backward, forward, backward, ..., forward (always ends with forward)
    // Total half-cycles = 2*N - 1
    const totalHalfCycles = 2 * iterations - 1;
    const halfCycleDuration = actionDuration / totalHalfCycles;
    const halfCycleIndex = Math.floor(elapsed / halfCycleDuration);
    const halfCycleProgress = (elapsed % halfCycleDuration) / halfCycleDuration;

    // Even indices (0, 2, 4, ...) = forward (0→1)
    // Odd indices (1, 3, 5, ...) = backward (1→0)
    const isBackward = halfCycleIndex % 2 === 1;
    const t = clamp(halfCycleProgress, 0, 1);

    return { t: isBackward ? 1 - t : t, multiplier: 1 };
  }
}

/**
 * Calculate position and tangent along a path defined by points and cumulative lengths
 */
function pointAndTangentAtEdgePath(
  points: Vec2[],
  cum: number[],
  length: number,
  t: number
): { pos: Vec2; tan: Vec2 } {
  if (points.length < 2 || length === 0) {
    return { pos: points[0] || { x: 0, y: 0 }, tan: { x: 1, y: 0 } };
  }

  const targetLen = clamp(t, 0, 1) * length;

  // Find the segment containing this position
  for (let i = 1; i < points.length; i++) {
    if (cum[i] >= targetLen) {
      const segStart = cum[i - 1];
      const segEnd = cum[i];
      const segLen = segEnd - segStart;
      const segT = segLen > 0 ? (targetLen - segStart) / segLen : 0;

      const p0 = points[i - 1];
      const p1 = points[i];

      const pos = {
        x: lerp(p0.x, p1.x, segT),
        y: lerp(p0.y, p1.y, segT),
      };

      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      const tan = { x: dx / mag, y: dy / mag };

      return { pos, tan };
    }
  }

  // Fallback: return last point
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
  return { pos: last, tan: { x: dx / mag, y: dy / mag } };
}

/**
 * Calculate phantom nodes for edge flow animations (global, not step-based)
 * This runs continuously based on total elapsed time, similar to flow/ball animations
 * Node flow is COMPLETELY STEP-INDEPENDENT - uses only live edges/nodes
 * @param baseEdges - Live edges to use for node flow (step-independent)
 * @param baseNodes - Live nodes for path calculation when no cached path
 */
function calculateEdgeFlowPhantoms(
  tMs: number,
  _stepEdges: EdgeModel[], // Used to check if edge exists in current step
  _stepNodes: NodeModel[], // Used for path calculation if no cached path
  _routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>, // Used for path calculation
  baseEdges?: EdgeModel[]
): PhantomNode[] {
  const phantoms: PhantomNode[] = [];

  // PRIMARY SOURCE OF TRUTH: baseEdges (Live Edges)
  // If provided, we iterate these to ensure config (speed/spacing) never changes between steps.
  // If not provided (fallback), we use _stepEdges.
  const sourceEdges = baseEdges || _stepEdges;

  // Map of current step edges for quick lookup (to check existence/visibility and get GEOMETRY)
  const currentEdgeMap = new Map(_stepEdges.map(e => [e.id, e]));

  // Find all edges with node flow enabled (using config source)
  const edgesWithNodeFlow = sourceEdges.filter(
    (e) => e.nodeFlow?.enabled && e.nodeFlow.nodeTemplateIds?.length > 0
  );

  for (const sourceEdge of edgesWithNodeFlow) {
    // sourceEdge: Has the nodeFlow CONFIG (speed, spacing, cachedPath) - from live/base edges
    // currentStepEdge: Has the current GEOMETRY (position, waypoints) - from step edges
    const currentStepEdge = baseEdges ? currentEdgeMap.get(sourceEdge.id) : sourceEdge;

    // If edge is deleted/hidden in this step, don't show flow
    if (!currentStepEdge) continue;

    const flow = sourceEdge.nodeFlow!;
    const speed = flow.speed || 1000;
    const count = clamp(flow.count || 1, 1, 20);
    const spacing = flow.spacing || 200;
    const loop = flow.loop ?? true;
    const scale = flow.scale ?? 0.5;
    const baseOpacity = flow.opacity ?? 0.8;
    const fadeOut = flow.fadeOut ?? true;
    const offsetMs = flow.offsetMs ?? 0;

    // Apply offset - animation doesn't start until offsetMs has passed
    const adjustedTime = tMs - offsetMs;
    if (adjustedTime < 0) continue;

    const snapshots = flow.nodeSnapshots || [];
    const isMultiEdge = flow.edgeSequence && flow.edgeSequence.length > 1;

    if (isMultiEdge) {
      // MULTI-EDGE MODE: Node travels each edge separately with fade transitions
      const edgePaths = getMultiEdgePaths(
        flow.edgeSequence!,
        _stepEdges,
        _stepNodes,
        _routeModeRef
      );
      if (!edgePaths || edgePaths.length === 0) continue;

      const numEdges = edgePaths.length;
      // Get per-edge speeds (fallback to default speed for each edge)
      const edgeSpeeds = flow.edgeSpeeds || edgePaths.map(() => speed);
      // Calculate cumulative durations for each edge
      const cumDurations = [0];
      for (let e = 0; e < numEdges; e++) {
        cumDurations.push(cumDurations[e] + (edgeSpeeds[e] || speed));
      }
      const totalDuration = cumDurations[numEdges];
      const waveDuration = (count - 1) * spacing + totalDuration;

      for (const snapshot of snapshots) {
        // For loop mode: continuous time (clones wrap around)
        // For one-shot mode: waves repeat (fountain effect) using modulo
        const waveTime = loop ? adjustedTime : adjustedTime % waveDuration;

        for (let i = 0; i < count; i++) {
          const spawnTime = i * spacing;
          const cloneElapsed = waveTime - spawnTime;
          if (cloneElapsed < 0) continue;

          if (loop) {
            // In loop mode, wrap around total duration
            // But cap at the end to prevent restart glitch on final frame
            let wrappedTime = cloneElapsed % totalDuration;
            if (wrappedTime < 1 && cloneElapsed >= totalDuration) {
              wrappedTime = totalDuration - 1;
            }
            // Find which edge we're on based on cumulative durations
            let currentEdgeIndex = 0;
            for (let e = 0; e < numEdges; e++) {
              if (wrappedTime < cumDurations[e + 1]) {
                currentEdgeIndex = e;
                break;
              }
            }
            // Calculate progress within this edge (0 to 1)
            const edgeStartTime = cumDurations[currentEdgeIndex];
            const edgeDuration = edgeSpeeds[currentEdgeIndex] || speed;
            const edgeProgress = (wrappedTime - edgeStartTime) / edgeDuration;

            if (currentEdgeIndex >= numEdges) continue;

            const currentPath = edgePaths[currentEdgeIndex];
            const { pos, tan } = pointAndTangentAtEdgePath(
              currentPath.points, currentPath.cum, currentPath.length, edgeProgress
            );

            let opacity = baseOpacity;
            const fadeZone = 0.15;
            if (fadeOut) {
              if (edgeProgress < fadeZone) {
                opacity = baseOpacity * (edgeProgress / fadeZone);
              } else if (edgeProgress > 1 - fadeZone) {
                opacity = baseOpacity * ((1 - edgeProgress) / fadeZone);
              }
            }

            const rotation = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

            phantoms.push({
              id: `phantom-${sourceEdge.id}-${snapshot.id}-${i}-e${currentEdgeIndex}`,
              templateId: snapshot.id,
              x: pos.x - (snapshot.w * scale) / 2,
              y: pos.y - (snapshot.h * scale) / 2,
              w: snapshot.w * scale,
              h: snapshot.h * scale,
              opacity,
              scale,
              rotation,
              fill: snapshot.fill,
              stroke: snapshot.stroke,
              strokeWidth: snapshot.strokeWidth,
              kind: snapshot.kind,
              label: snapshot.label,
              text: snapshot.text,
              imageData: snapshot.imageData,
              lottieData: snapshot.lottieData,
              svgPaths: snapshot.svgPaths,
              svgViewBox: snapshot.svgViewBox,
            });
          } else {
            // Non-loop mode: travel all edges once (one-shot fountain effect)
            if (cloneElapsed > totalDuration) continue;

            // Find which edge we're on based on cumulative durations
            let currentEdgeIndex = numEdges - 1;
            for (let e = 0; e < numEdges; e++) {
              if (cloneElapsed < cumDurations[e + 1]) {
                currentEdgeIndex = e;
                break;
              }
            }
            // Calculate progress within this edge (0 to 1)
            const edgeStartTime = cumDurations[currentEdgeIndex];
            const edgeDuration = edgeSpeeds[currentEdgeIndex] || speed;
            const edgeProgress = (cloneElapsed - edgeStartTime) / edgeDuration;
            if (edgeProgress > 1) continue;

            const currentPath = edgePaths[currentEdgeIndex];
            const { pos, tan } = pointAndTangentAtEdgePath(
              currentPath.points, currentPath.cum, currentPath.length, edgeProgress
            );

            let opacity = baseOpacity;
            const fadeZone = 0.15;
            if (fadeOut) {
              if (edgeProgress < fadeZone) {
                opacity = baseOpacity * (edgeProgress / fadeZone);
              } else if (edgeProgress > 1 - fadeZone) {
                opacity = baseOpacity * ((1 - edgeProgress) / fadeZone);
              }
            }

            const rotation = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

            phantoms.push({
              id: `phantom-${sourceEdge.id}-${snapshot.id}-${i}-e${currentEdgeIndex}`,
              templateId: snapshot.id,
              x: pos.x - (snapshot.w * scale) / 2,
              y: pos.y - (snapshot.h * scale) / 2,
              w: snapshot.w * scale,
              h: snapshot.h * scale,
              opacity,
              scale,
              rotation,
              fill: snapshot.fill,
              stroke: snapshot.stroke,
              strokeWidth: snapshot.strokeWidth,
              kind: snapshot.kind,
              label: snapshot.label,
              text: snapshot.text,
              imageData: snapshot.imageData,
              lottieData: snapshot.lottieData,
              svgPaths: snapshot.svgPaths,
              svgViewBox: snapshot.svgViewBox,
            });
          }
        }
      }
      continue; // Skip single-edge processing
    }

    // SINGLE-EDGE MODE: Original behavior
    const pathData = getNodeFlowPath(sourceEdge, currentStepEdge, _stepNodes, _routeModeRef);
    if (!pathData) continue;

    let { points, length, cum } = pathData;

    const arrowOffset = currentStepEdge.arrowOffset ?? 2;
    const arrow = currentStepEdge.arrow || 'end';

    if ((arrow === 'end' || arrow === 'both') && arrowOffset > 0 && points.length >= 2) {
      const lastPt = points[points.length - 1];
      const secondLastPt = points[points.length - 2];
      const dx = lastPt.x - secondLastPt.x;
      const dy = lastPt.y - secondLastPt.y;
      const len = Math.hypot(dx, dy) || 1;
      const extendedEnd = {
        x: lastPt.x + (dx / len) * arrowOffset,
        y: lastPt.y + (dy / len) * arrowOffset,
      };
      points = [...points, extendedEnd];
      length += arrowOffset;
      cum = [0];
      for (let k = 1; k < points.length; k++) {
        const p0 = points[k - 1];
        const p1 = points[k];
        cum.push(cum[k - 1] + Math.hypot(p1.x - p0.x, p1.y - p0.y));
      }
    }

    const waveDuration = (count - 1) * spacing + speed;

    for (const snapshot of snapshots) {
      // For loop mode: continuous time (clones wrap around)
      // For one-shot mode: waves repeat (fountain effect) using modulo
      const waveTime = loop ? adjustedTime : adjustedTime % waveDuration;

      for (let i = 0; i < count; i++) {
        const spawnTime = i * spacing;
        const cloneElapsed = waveTime - spawnTime;
        if (cloneElapsed < 0) continue;

        let progress = cloneElapsed / speed;
        if (loop) {
          const modProgress = progress % 1;
          // Cap at end to prevent restart glitch on final frame
          if (modProgress < 0.01 && progress >= 1) {
            progress = 0.999;
          } else {
            progress = modProgress;
          }
        } else if (progress > 1) {
          continue;
        }

        const { pos, tan } = pointAndTangentAtEdgePath(points, cum, length, progress);

        let opacity = baseOpacity;
        if (fadeOut) {
          if (loop && progress < 0.15) {
            opacity = baseOpacity * (progress / 0.15);
          } else if (progress > 0.85) {
            opacity = baseOpacity * ((1 - progress) / 0.15);
            opacity = baseOpacity * (1 - (progress - 0.85) / 0.15);
          }
        }

        // Clamp opacity to valid range
        opacity = Math.max(0, Math.min(baseOpacity, opacity));

        // Calculate rotation to match edge tangent
        const rotation = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

        // Create phantom node from snapshot
        const phantom: PhantomNode = {
          id: `phantom-${sourceEdge.id}-${snapshot.id}-${i}`,
          templateId: snapshot.id,
          x: pos.x - (snapshot.w * scale) / 2,
          y: pos.y - (snapshot.h * scale) / 2,
          w: snapshot.w * scale,
          h: snapshot.h * scale,
          opacity,
          scale,
          rotation,
          fill: snapshot.fill,
          stroke: snapshot.stroke,
          strokeWidth: snapshot.strokeWidth,
          kind: snapshot.kind,
          label: snapshot.label,
          text: snapshot.text,
          imageData: snapshot.imageData,
          lottieData: snapshot.lottieData,
          svgPaths: snapshot.svgPaths,
          svgViewBox: snapshot.svgViewBox,
        };

        phantoms.push(phantom);
      }
    }
  }

  return phantoms;
}

/**
 * Calculate phantom nodes for PathAnimateAction (timeline-controlled edge flow)
 * 
 * Unlike calculateEdgeFlowPhantoms (continuous, step-independent), this:
 * - Uses GLOBAL time for smooth step transitions
 * - Has finite duration (not infinite loop)
 * - Integrates with timeline (draggable, precise timing)
 * 
 * @param globalTimeMs - Total elapsed time from animation start (never resets)
 * @param steps - All steps for calculating step start times
 * @param currentStepIndex - Which step we're in
 * @param stepEdges - Edges in the current step (for path geometry)
 * @param stepNodes - Nodes in the current step (for path calculation)
 * @param routeModeRef - Edge routing mode
 */
export function calculatePathAnimatePhantoms(
  globalTimeMs: number,
  steps: readonly Step[],
  stepEdges: EdgeModel[],
  stepNodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): PhantomNode[] {
  const phantoms: PhantomNode[] = [];

  // Calculate step start times
  const stepStartTimes: number[] = [0];
  for (let i = 1; i < steps.length; i++) {
    stepStartTimes.push(stepStartTimes[i - 1] + (steps[i - 1].durationMs || 900));
  }

  // Find all PathAnimateActions across all steps
  steps.forEach((step, stepIndex) => {
    const stepStartTime = stepStartTimes[stepIndex];
    const stepDuration = step.durationMs || 900;
    const stepEndTime = stepStartTime + stepDuration;

    step.actions?.forEach((action) => {
      if (action.type !== 'pathAnimate') return;
      // Skip disabled actions
      if ((action as any).disabled) return;

      const pathAction = action as PathAnimateAction;
      const edge = stepEdges.find((e) => e.id === pathAction.target.id);
      if (!edge) return;

      // Skip path animation for invisible edges (opacity 0 or very low)
      if (edge.opacity !== undefined && edge.opacity < 0.01) return;

      // Calculate global start/end times for this action
      const actionStartGlobal = stepStartTime + (pathAction.offsetMs || 0);
      const actionEndGlobal = actionStartGlobal + (pathAction.durationMs || stepDuration);

      // Skip if action hasn't started or has ended
      if (globalTimeMs < actionStartGlobal) return;
      if (globalTimeMs > actionEndGlobal) return;

      // Calculate progress (0 to 1) with easing
      const rawProgress = (globalTimeMs - actionStartGlobal) / (pathAction.durationMs || stepDuration);
      let progress = applyEasing(clamp(rawProgress, 0, 1), pathAction.ease || 'ease', (pathAction as any).easeIntensity);

      // Reverse direction if specified
      if (pathAction.reverse) {
        progress = 1 - progress;
      }

      // Get the edge path
      const pathData = edgeToPath(edge, stepNodes, routeModeRef);
      if (!pathData) return;

      const { points, length, cum } = pathData;
      if (points.length < 2) return;

      // Get position and tangent on the path
      const { pos, tan } = pointAndTangentAtEdgePath(points, cum, length, progress);

      // Get snapshot
      const snapshot = pathAction.nodeSnapshot;
      if (!snapshot) return;

      // Calculate appearance
      const scale = pathAction.scale ?? 0.5;
      let opacity = pathAction.opacity ?? 0.8;

      // Fade in/out zones (15% at each end)
      const fadeZone = 0.15;
      if (pathAction.fadeIn !== false && progress < fadeZone) {
        opacity = opacity * (progress / fadeZone);
      }
      if (pathAction.fadeOut !== false && progress > 1 - fadeZone) {
        opacity = opacity * ((1 - progress) / fadeZone);
      }
      opacity = clamp(opacity, 0, 1);

      // Rotation
      const rotation = (pathAction.rotateWithPath !== false)
        ? Math.atan2(tan.y, tan.x) * (180 / Math.PI)
        : 0;

      // Create phantom node — inherit edge zIndex so it renders above containers
      phantoms.push({
        id: `path-animate-${pathAction.id}-${stepIndex}`,
        templateId: snapshot.id,
        x: pos.x - (snapshot.w * scale) / 2,
        y: pos.y - (snapshot.h * scale) / 2,
        w: snapshot.w * scale,
        h: snapshot.h * scale,
        opacity,
        scale,
        rotation,
        fill: snapshot.fill,
        stroke: snapshot.stroke,
        strokeWidth: snapshot.strokeWidth,
        kind: snapshot.kind,
        label: snapshot.label,
        text: snapshot.text,
        imageData: snapshot.imageData,
        svgPaths: snapshot.svgPaths,
        svgViewBox: snapshot.svgViewBox,
        lottieData: snapshot.lottieData,
        zIndex: edge.zIndex ?? 5,
      });
    });
  });

  return phantoms;
}

/**
 * Get the end state of a node at a specific step, after applying all actions
 * This is used to compute the "from" state for the next step's actions
 * 
 * Uses resolved step data to support delta format.
 */
function getNodeEndState(
  nodeId: string,
  stepIndex: number,
  steps: readonly Step[]
): Partial<NodeModel> | null {
  if (stepIndex < 0 || stepIndex >= steps.length) return null;

  const step = steps[stepIndex];
  // Steps are already full snapshots (normalized on load)
  const stepNodes = (step.nodes || []) as NodeModel[];
  const node = stepNodes.find((n) => n.id === nodeId);
  if (!node) return null;

  // Start with the snapshot state, but ensure all animatable properties have defaults
  // This is critical: without defaults, the "from" value for interpolation would be undefined,
  // causing the animation to fail (e.g., rotationZ: undefined → 45 doesn't animate)
  // NOTE: Only set defaults for properties that are always present (transforms).
  // Don't set defaults for strokeWidth/strokeTrim as they may be intentionally undefined.
  let result: Partial<NodeModel> = {
    ...node,
    // Ensure transform properties have explicit defaults (these are always used)
    scaleX: node.scaleX ?? 1,
    scaleY: node.scaleY ?? 1,
    rotationX: node.rotationX ?? 0,
    rotationY: node.rotationY ?? 0,
    rotationZ: node.rotationZ ?? 0,
    opacity: node.opacity ?? 1,
    // Don't set defaults for strokeTrimStart, strokeTrimEnd, strokeWidth
    // These should remain undefined if not explicitly set in the snapshot
  };

  // Apply any transform actions from this step (to get final state) - skip disabled
  const actions = step.actions?.filter(
    (a) => a.type === 'transformTween' && a.target.kind === 'node' && a.target.id === nodeId && !(a as any).disabled
  ) as TransformTweenAction[] | undefined;

  if (actions) {
    for (const action of actions) {
      // Guard against malformed actions with missing 'to' property
      if (!action.to) continue;

      // Apply the "to" values (final state of the action)
      // For relative actions, the end position IS the snapshot (dx/dy defines where it came FROM, not where it goes TO)
      if (action.isRelative && action.dx !== undefined && action.dy !== undefined) {
        result.x = node.x ?? 0;
        result.y = node.y ?? 0;
      } else {
        if (action.to.x !== undefined) result.x = action.to.x;
        if (action.to.y !== undefined) result.y = action.to.y;
      }
      if (action.to.scaleX !== undefined) result.scaleX = action.to.scaleX;
      if (action.to.scaleY !== undefined) result.scaleY = action.to.scaleY;
      // Affine matrix entries — without these, a COMPLETED matrix tween's end value
      // is not carried into the settled state, so a long beat (narration-stretched)
      // reverts the grid to identity after the deform finishes.
      if ((action.to as any).m11 !== undefined) (result as any).m11 = (action.to as any).m11;
      if ((action.to as any).m12 !== undefined) (result as any).m12 = (action.to as any).m12;
      if ((action.to as any).m21 !== undefined) (result as any).m21 = (action.to as any).m21;
      if ((action.to as any).m22 !== undefined) (result as any).m22 = (action.to as any).m22;
      if (action.to.rotationX !== undefined) result.rotationX = action.to.rotationX;
      if (action.to.rotationY !== undefined) result.rotationY = action.to.rotationY;
      if (action.to.rotationZ !== undefined) result.rotationZ = action.to.rotationZ;
      if (action.to.opacity !== undefined) result.opacity = action.to.opacity;
      if (action.to.w !== undefined) result.w = action.to.w;
      if (action.to.h !== undefined) result.h = action.to.h;
      if (action.to.fill !== undefined) result.fill = action.to.fill;
      if (action.to.stroke !== undefined) result.stroke = action.to.stroke;
      if ((action.to as any).color !== undefined) (result as any).color = (action.to as any).color;
      if (action.to.strokeWidth !== undefined) result.strokeWidth = action.to.strokeWidth;
      if (action.to.strokeTrimStart !== undefined) result.strokeTrimStart = action.to.strokeTrimStart;
      if (action.to.strokeTrimEnd !== undefined) result.strokeTrimEnd = action.to.strokeTrimEnd;
      if (action.to.typeProgress !== undefined) result.typeProgress = action.to.typeProgress;
      if ((action.to as any).blur !== undefined) (result as any).blur = (action.to as any).blur;
      if ((action.to as any).drawProgress !== undefined) (result as any).drawProgress = (action.to as any).drawProgress;
      if ((action.to as any).rot3dX !== undefined) (result as any).rot3dX = (action.to as any).rot3dX;
      if ((action.to as any).rot3dY !== undefined) (result as any).rot3dY = (action.to as any).rot3dY;
      if ((action.to as any).rot3dZ !== undefined) (result as any).rot3dZ = (action.to as any).rot3dZ;
      if ((action.to as any).markerX !== undefined) (result as any).markerX = (action.to as any).markerX;
      if ((action.to as any).markerY !== undefined) (result as any).markerY = (action.to as any).markerY;
      if ((action.to as any).markerZ !== undefined) (result as any).markerZ = (action.to as any).markerZ;
      for (const ak of ['arrowTailX', 'arrowTailY', 'arrowTipX', 'arrowTipY', 'pathT'] as const) {
        if ((action.to as any)[ak] !== undefined) (result as any)[ak] = (action.to as any)[ak];
      }
      if ((action.to as any).meshScaleX !== undefined) (result as any).meshScaleX = (action.to as any).meshScaleX;
      if ((action.to as any).meshScaleY !== undefined) (result as any).meshScaleY = (action.to as any).meshScaleY;
      if ((action.to as any).meshScaleZ !== undefined) (result as any).meshScaleZ = (action.to as any).meshScaleZ;
      for (const [mk] of _MESH_M3_KEYS) {
        if ((action.to as any)[mk] !== undefined) (result as any)[mk] = (action.to as any)[mk];
      }
      // Tier 1 shape properties
      if (action.to.value !== undefined) result.value = action.to.value;
      if (action.to.progressColor !== undefined) result.progressColor = action.to.progressColor;
      if (action.to.startAngle !== undefined) result.startAngle = action.to.startAngle;
      if (action.to.endAngle !== undefined) result.endAngle = action.to.endAngle;
      if (action.to.innerRadius !== undefined) result.innerRadius = action.to.innerRadius;
      if (action.to.pointDepth !== undefined) result.pointDepth = action.to.pointDepth;
      if (action.to.topWidth !== undefined) result.topWidth = action.to.topWidth;
      if (action.to.bottomWidth !== undefined) result.bottomWidth = action.to.bottomWidth;
      if (action.to.pointerPosition !== undefined) result.pointerPosition = action.to.pointerPosition;
      if (action.to.pointerSize !== undefined) result.pointerSize = action.to.pointerSize;
      // Rough.js properties
      if (action.to.roughness !== undefined) result.roughness = action.to.roughness;
      if (action.to.roughFillWeight !== undefined) result.roughFillWeight = action.to.roughFillWeight;
      // Algorithm primitives — pointer movement
      if (action.to.pointerTargetIndex !== undefined) result.pointerTargetIndex = action.to.pointerTargetIndex;
      if (action.to.pointerTargetRow !== undefined) result.pointerTargetRow = action.to.pointerTargetRow;
      if (action.to.pointerTargetCol !== undefined) result.pointerTargetCol = action.to.pointerTargetCol;
      if ((action.to as any).pointerTreeNodeId !== undefined) {
        // String-typed; snap rather than lerp. Slide animation between
        // tree nodes (interpolating positions) is a v2 enhancement.
        (result as any).pointerTreeNodeId = (action.to as any).pointerTreeNodeId;
      }
      // Range marker endpoints (algo-array)
      if ((action.to as any).rangeStart !== undefined) {
        (result as any).rangeStart = (action.to as any).rangeStart;
      }
      if ((action.to as any).rangeEnd !== undefined) {
        (result as any).rangeEnd = (action.to as any).rangeEnd;
      }
    }
  }

  // Apply visibility actions - skip disabled. This is the step's END state, so when a node carries
  // several of them (fade a counting digit in, swap it for the final one) the LAST one to start is
  // the one still in force when the step ends.
  const visAll = (step.actions || []).filter(
    (a) => a.type === 'visibility' && a.target.kind === 'node' && a.target.id === nodeId && !(a as any).disabled
  ) as VisibilityAction[];
  const visAction: VisibilityAction | undefined = visAll.length
    ? visAll.reduce((best, a) => ((a.offsetMs ?? 0) >= (best.offsetMs ?? 0) ? a : best))
    : undefined;

  if (visAction) {
    // All visibility actions end at their target state, regardless of iterations
    switch (visAction.mode) {
      case 'show':
      case 'fadeIn':
      case 'slideInLeft':
      case 'slideInRight':
      case 'slideInUp':
      case 'slideInDown':
        result.opacity = 1;
        break;
      case 'hide':
      case 'fadeOut':
      case 'slideOutLeft':
      case 'slideOutRight':
      case 'slideOutUp':
      case 'slideOutDown':
        result.opacity = 0;
        break;
    }
  }

  // NOTE: PathFollow actions are NOT handled here because:
  // 1. We don't have access to the paths object
  // 2. The snapshot position IS the end state (set during action creation)
  // 3. If a path action exists, the snapshot should already have the correct end position
  // The path action's end position should be set in handleUpdateStepAction when the action is created

  // If this node is being removed in this step, its end state is opacity 0
  if (step._removedNodeIds?.includes(nodeId)) {
    result.opacity = 0;
  }

  return result;
}

/**
 * Compute the END state of an edge at the end of a given step.
 * Mirrors getNodeEndState: starts from the step's snapshot, then applies
 * the step's edgeTween action `to` values. Used so prevEdges reflects what
 * the prev step's actions actually settled, not just the raw snapshot —
 * preventing duplicate animation when the snapshot still shows the start
 * value (storyboards write step N snapshot = start of step N = end of step N-1).
 */
function getEdgeEndState(
  edgeId: string,
  stepIndex: number,
  steps: readonly Step[]
): EdgeModel | null {
  if (stepIndex < 0 || stepIndex >= steps.length) return null;
  const step = steps[stepIndex];
  const stepEdges = (step.edges || []) as EdgeModel[];
  const edge = stepEdges.find((e) => e.id === edgeId);
  if (!edge) return null;

  const result: EdgeModel = { ...edge };
  const actions = step.actions?.filter(
    (a) => a.type === 'edgeTween' && a.target.kind === 'edge' && a.target.id === edgeId && !(a as any).disabled
  ) as EdgeTweenAction[] | undefined;

  if (actions) {
    for (const action of actions) {
      if (!action.to) continue;
      if (action.to.trim !== undefined) result.trim = action.to.trim;
      if (action.to.trimStart !== undefined) result.trimStart = action.to.trimStart;
      if (action.to.stroke !== undefined) result.stroke = action.to.stroke;
      if ((action.to as any).color !== undefined) (result as any).color = (action.to as any).color;
      if (action.to.width !== undefined) result.width = action.to.width;
      if (action.to.opacity !== undefined) result.opacity = action.to.opacity;
      if (action.to.roughness !== undefined) result.roughness = action.to.roughness;
      if (action.to.bowing !== undefined) result.bowing = action.to.bowing;
    }
  }

  if (step._removedEdgeIds?.includes(edgeId)) {
    result.trim = 0;
  }

  return result;
}

/**
 * Apply all actions from a step to nodes
 * NEW MODEL: Actions animate from the node's current state (which is the previous step's end state)
 * to the action's `to` values. If action has explicit `from`, use that instead.
 */
function applyActionsToNodes(
  nodes: NodeModel[],
  step: Step,
  localMs: number,
  duration: number,
  steps: readonly Step[],
  stepIndex: number,
  paths: Record<PathId, Path>
): NodeModel[] {
  if (!step.actions || step.actions.length === 0) {
    return nodes;
  }

  return nodes.map((n) => {
    let result = { ...n };

    // "instant"/"fade" transition: skip all explicit actions (fade is handled in evaluateAt)
    const nodeTransition = step.transitions?.[n.id];
    if (nodeTransition === 'instant' || nodeTransition === 'fade') return result;

    // Apply position tween actions (skip disabled)
    const tweenAction = step.actions?.find(
      (act) =>
        act.type === 'positionTween' &&
        act.target.kind === 'node' &&
        act.target.id === n.id &&
        !(act as any).disabled
    ) as PositionTweenAction | undefined;

    if (tweenAction) {
      // Calculate from/to based on relative or absolute mode
      let fromX: number, fromY: number, toX: number, toY: number;

      if (tweenAction.isRelative && tweenAction.dx !== undefined && tweenAction.dy !== undefined) {
        // Relative mode: snapshot is the END position, dx/dy is the movement
        // So the animation goes FROM (snapshot - delta) TO (snapshot)
        fromX = n.x - tweenAction.dx;
        fromY = n.y - tweenAction.dy;
        toX = n.x;
        toY = n.y;
      } else {
        // Absolute mode (legacy): use stored from/to
        fromX = tweenAction.from.x;
        fromY = tweenAction.from.y;
        toX = tweenAction.to.x;
        toY = tweenAction.to.y;
      }

      if (localMs < tweenAction.durationMs) {
        const tTween = clamp(localMs / tweenAction.durationMs, 0, 1);
        const tTweenEased = applyEasing(tTween, tweenAction.ease || 'ease', tweenAction.easeIntensity);
        result = {
          ...result,
          x: lerp(fromX, toX, tTweenEased),
          y: lerp(fromY, toY, tTweenEased),
        };
      } else {
        result = {
          ...result,
          x: toX,
          y: toY,
        };
      }
    }

    // Apply transform tween actions (scale, rotation, opacity, position) - skip disabled
    const transformActions = step.actions?.filter(
      (act) =>
        act.type === 'transformTween' &&
        act.target.kind === 'node' &&
        act.target.id === n.id &&
        !(act as any).disabled
    ) as TransformTweenAction[] | undefined;

    // Check if there's a non-disabled path action that will control position
    // If so, we should skip position updates from transformTween to avoid conflicts
    const hasActivePathAction = step.actions?.some(
      (act) =>
        act.type === 'pathFollow' &&
        act.target.kind === 'node' &&
        act.target.id === n.id &&
        !(act as any).disabled
    );

    if (transformActions && transformActions.length > 0) {
      for (const transformAction of transformActions) {
        const actionDuration = transformAction.durationMs ?? duration;
        const actionDelay = transformAction.offsetMs ?? 0;
        const iterations = transformAction.iterations ?? 1;

        // IMPORTANT: When we're at the very end of the step (localMs >= duration),
        // and an action would extend past the step's end (actionDelay + actionDuration > duration),
        // we should snap to the action's final state. This ensures that actions which
        // start late in a step still complete by the end of the step.
        // Use <= for actionDelay to include actions that start exactly at the step end.
        const isAtStepEnd = localMs >= duration;
        const actionExtendsPastStep = actionDelay + actionDuration > duration;
        const actionHasStarted = actionDelay <= duration;
        const snapToFinal = isAtStepEnd && actionExtendsPastStep && actionHasStarted;

        // Before action starts
        if (localMs < actionDelay && !snapToFinal) {
          // NEW BEHAVIOR: Don't apply explicit `from` values here.
          // The node stays at its current state (previous step's end state).
          // This prevents "jump back" when user edits node positions.
          // The `from` values are only used during interpolation (fallback if not specified).
          // 
          // This matches After Effects/Jitter behavior where animations always
          // start from the current position, not a hardcoded start position.
          //
          // No action needed - node keeps its current position from resultNodes initialization.
        } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
          // During animation (not at step end or action completes within step)
          const elapsed = localMs - actionDelay;
          const isRotation =
            transformAction.to.rotationX !== undefined ||
            transformAction.to.rotationY !== undefined ||
            transformAction.to.rotationZ !== undefined;

          const { t: tAction, multiplier } = calculateIterationProgress(
            elapsed,
            actionDuration,
            iterations,
            isRotation
          );

          const tEased = applyEasing(tAction, transformAction.ease || step.easing || 'ease', transformAction.easeIntensity);
          const tLinear = tAction;

          const updates: Partial<NodeModel> = {};

          // Position - animate from current position to target
          // NEW: Always derive `from` from current state (result.x/y), ignoring explicit from.x/y
          // This prevents "jump back" when user edits positions (matches AE/Jitter behavior)
          // Skip if path action exists (path will control position)
          if (!hasActivePathAction) {
            // Check if this is a relative position action
            if (transformAction.isRelative && transformAction.dx !== undefined && transformAction.dy !== undefined) {
              // Relative mode: snapshot is the END position, dx/dy is the movement
              // Animation goes FROM (snapshot - delta) TO (snapshot)
              const fromX = n.x - transformAction.dx;
              const fromY = n.y - transformAction.dy;
              const toX = n.x;
              const toY = n.y;
              updates.x = lerp(fromX, toX, tEased);
              updates.y = lerp(fromY, toY, tEased);
            } else {
              // Absolute mode: always derive from from current position
              // This ensures edits to node positions "just work" without action updates
              if (transformAction.to.x !== undefined) {
                const fromX = result.x;  // Always use current position, not action.from
                updates.x = lerp(fromX, transformAction.to.x, tEased);
              }
              if (transformAction.to.y !== undefined) {
                const fromY = result.y;  // Always use current position, not action.from
                updates.y = lerp(fromY, transformAction.to.y, tEased);
              }
            }
          }

          // Scale
          if (transformAction.to.scaleX !== undefined) {
            const fromScaleX = transformAction.from?.scaleX ?? result.scaleX ?? 1;
            updates.scaleX = lerp(fromScaleX, transformAction.to.scaleX, tEased);
          }
          if (transformAction.to.scaleY !== undefined) {
            const fromScaleY = transformAction.from?.scaleY ?? result.scaleY ?? 1;
            updates.scaleY = lerp(fromScaleY, transformAction.to.scaleY, tEased);
          }

          // Affine matrix entries (2x2 linear map [[m11,m12],[m21,m22]]) — the basis
          // of "transform the whole plane" visuals (grid deformation, determinant
          // area). Each entry tweens independently; linear interpolation from the
          // identity reproduces the standard "morph space" effect.
          for (const mk of ['m11', 'm12', 'm21', 'm22'] as const) {
            const toVal = (transformAction.to as any)[mk];
            if (toVal !== undefined) {
              const ident = mk === 'm11' || mk === 'm22' ? 1 : 0;
              const fromVal =
                (transformAction.from as any)?.[mk] ?? (result as any)[mk] ?? ident;
              (updates as any)[mk] = lerp(fromVal, toVal, tEased);
            }
          }

          // Depth-of-field blur (px) — tweens from 0 (sharp) so fragments can rack
          // in/out of focus (cinematic pack).
          if ((transformAction.to as any).blur !== undefined) {
            const fromBlur =
              (transformAction.from as any)?.blur ?? (result as any).blur ?? 0;
            (updates as any).blur = lerp(fromBlur, (transformAction.to as any).blur, tEased);
          }

          // mesh3d intrinsic 3D rotation (degrees) — each axis tweens from identity (0)
          // so the renderer re-projects each frame (genuine smooth spin, not a 2D hack).
          for (const rk of ['rot3dX', 'rot3dY', 'rot3dZ', 'markerX', 'markerY', 'markerZ',
                             'arrowTailX', 'arrowTailY', 'arrowTipX', 'arrowTipY', 'pathT'] as const) {
            const toVal = (transformAction.to as any)[rk];
            if (toVal !== undefined) {
              const fromVal = (transformAction.from as any)?.[rk] ?? (result as any)[rk] ?? 0;
              (updates as any)[rk] = lerp(fromVal, toVal, tEased);
            }
          }
          // mesh3d per-axis scale tweens from identity (1) — a scaling matrix.
          for (const sk of ['meshScaleX', 'meshScaleY', 'meshScaleZ'] as const) {
            const toVal = (transformAction.to as any)[sk];
            if (toVal !== undefined) {
              const fromVal = (transformAction.from as any)?.[sk] ?? (result as any)[sk] ?? 1;
              (updates as any)[sk] = lerp(fromVal, toVal, tEased);
            }
          }
          // mesh3d full 3x3 linear map (tm11..tm33) — interpolate each entry from
          // identity (diagonal 1, off-diagonal 0): the 3D "apply this matrix" morph.
          for (const [mk, ident] of _MESH_M3_KEYS) {
            const toVal = (transformAction.to as any)[mk];
            if (toVal !== undefined) {
              const fromVal = (transformAction.from as any)?.[mk] ?? (result as any)[mk] ?? ident;
              (updates as any)[mk] = lerp(fromVal, toVal, tEased);
            }
          }

          // Rotation (cumulative, linear)
          if (transformAction.to.rotationX !== undefined) {
            const fromRotX = transformAction.from?.rotationX ?? result.rotationX ?? 0;
            const toRotX = transformAction.to.rotationX * multiplier;
            updates.rotationX = lerp(fromRotX, toRotX, tLinear);
          }
          if (transformAction.to.rotationY !== undefined) {
            const fromRotY = transformAction.from?.rotationY ?? result.rotationY ?? 0;
            const toRotY = transformAction.to.rotationY * multiplier;
            updates.rotationY = lerp(fromRotY, toRotY, tLinear);
          }
          if (transformAction.to.rotationZ !== undefined) {
            const fromRotZ = transformAction.from?.rotationZ ?? result.rotationZ ?? 0;
            const toRotZ = transformAction.to.rotationZ * multiplier;
            updates.rotationZ = lerp(fromRotZ, toRotZ, tLinear);
          }

          // Opacity
          if (transformAction.to.opacity !== undefined) {
            const fromOpacity = transformAction.from?.opacity ?? result.opacity ?? 1;
            updates.opacity = lerp(fromOpacity, transformAction.to.opacity, tEased);
          }

          // Size (w, h)
          if (transformAction.to.w !== undefined) {
            const fromW = transformAction.from?.w ?? result.w ?? 100;
            updates.w = lerp(fromW, transformAction.to.w, tEased);
          }
          if (transformAction.to.h !== undefined) {
            const fromH = transformAction.from?.h ?? result.h ?? 100;
            updates.h = lerp(fromH, transformAction.to.h, tEased);
          }

          // Fill and Stroke colors (interpolate using lerpColor)
          if (transformAction.to.fill !== undefined) {
            const fromFill = transformAction.from?.fill ?? result.fill ?? '#ffffff';
            updates.fill = lerpColor(fromFill, transformAction.to.fill, tEased);
          }
          if (transformAction.to.stroke !== undefined) {
            const fromStroke = transformAction.from?.stroke ?? result.stroke ?? '#000000';
            updates.stroke = lerpColor(fromStroke, transformAction.to.stroke, tEased);
          }
          // Text color — tweenable like fill/stroke (per-letter staggered color
          // tweens = a gradient that MOVES through a headline)
          if ((transformAction.to as any).color !== undefined) {
            const fromColor =
              (transformAction.from as any)?.color ?? (result as any).color ?? '#ffffff';
            (updates as any).color = lerpColor(fromColor, (transformAction.to as any).color, tEased);
          }

          // Stroke trim properties (for "draw" effects)
          if (transformAction.to.strokeWidth !== undefined) {
            const fromStrokeWidth = transformAction.from?.strokeWidth ?? result.strokeWidth ?? 1;
            updates.strokeWidth = lerp(fromStrokeWidth, transformAction.to.strokeWidth, tEased);
          }
          if (transformAction.to.strokeTrimStart !== undefined) {
            const fromTrimStart = transformAction.from?.strokeTrimStart ?? result.strokeTrimStart ?? 0;
            updates.strokeTrimStart = lerp(fromTrimStart, transformAction.to.strokeTrimStart, tEased);
          }
          if (transformAction.to.strokeTrimEnd !== undefined) {
            const fromTrimEnd = transformAction.from?.strokeTrimEnd ?? result.strokeTrimEnd ?? 1;
            updates.strokeTrimEnd = lerp(fromTrimEnd, transformAction.to.strokeTrimEnd, tEased);
          }

          // Typewriter text reveal (0 = nothing typed, 1 = full text)
          if (transformAction.to.typeProgress !== undefined) {
            const fromType = transformAction.from?.typeProgress ?? result.typeProgress ?? 0;
            updates.typeProgress = lerp(fromType, transformAction.to.typeProgress, tEased);
          }
          // Progressive svgPaths "draw-on"
          if ((transformAction.to as any).drawProgress !== undefined) {
            const fromDraw = (transformAction.from as any)?.drawProgress ?? (result as any).drawProgress ?? 0;
            (updates as any).drawProgress = lerp(fromDraw, (transformAction.to as any).drawProgress, tEased);
          }

          // Tier 1 shape properties
          if (transformAction.to.value !== undefined) {
            const fromValue = transformAction.from?.value ?? result.value ?? 0.5;
            updates.value = lerp(fromValue, transformAction.to.value, tEased);
          }
          if (transformAction.to.progressColor !== undefined) {
            const fromProgressColor = transformAction.from?.progressColor ?? result.progressColor ?? '#3b82f6';
            updates.progressColor = lerpColor(fromProgressColor, transformAction.to.progressColor, tEased);
          }
          if (transformAction.to.startAngle !== undefined) {
            const fromStartAngle = transformAction.from?.startAngle ?? result.startAngle ?? 0;
            updates.startAngle = lerp(fromStartAngle, transformAction.to.startAngle, tEased);
          }
          if (transformAction.to.endAngle !== undefined) {
            const fromEndAngle = transformAction.from?.endAngle ?? result.endAngle ?? 270;
            updates.endAngle = lerp(fromEndAngle, transformAction.to.endAngle, tEased);
          }
          if (transformAction.to.innerRadius !== undefined) {
            const fromInnerRadius = transformAction.from?.innerRadius ?? result.innerRadius ?? 0;
            updates.innerRadius = lerp(fromInnerRadius, transformAction.to.innerRadius, tEased);
          }
          if (transformAction.to.pointDepth !== undefined) {
            const fromPointDepth = transformAction.from?.pointDepth ?? result.pointDepth ?? 0.2;
            updates.pointDepth = lerp(fromPointDepth, transformAction.to.pointDepth, tEased);
          }
          if (transformAction.to.topWidth !== undefined) {
            const fromTopWidth = transformAction.from?.topWidth ?? result.topWidth ?? 1;
            updates.topWidth = lerp(fromTopWidth, transformAction.to.topWidth, tEased);
          }
          if (transformAction.to.bottomWidth !== undefined) {
            const fromBottomWidth = transformAction.from?.bottomWidth ?? result.bottomWidth ?? 0.3;
            updates.bottomWidth = lerp(fromBottomWidth, transformAction.to.bottomWidth, tEased);
          }
          if (transformAction.to.pointerPosition !== undefined) {
            const fromPointerPos = transformAction.from?.pointerPosition ?? result.pointerPosition ?? 0.3;
            updates.pointerPosition = lerp(fromPointerPos, transformAction.to.pointerPosition, tEased);
          }
          if (transformAction.to.pointerSize !== undefined) {
            const fromPointerSize = transformAction.from?.pointerSize ?? result.pointerSize ?? 0.12;
            updates.pointerSize = lerp(fromPointerSize, transformAction.to.pointerSize, tEased);
          }

          // Rough.js properties
          if (transformAction.to.roughness !== undefined) {
            const fromRoughness = transformAction.from?.roughness ?? result.roughness ?? 1;
            updates.roughness = lerp(fromRoughness, transformAction.to.roughness, tEased);
          }
          if (transformAction.to.roughFillWeight !== undefined) {
            const fromFillWeight = transformAction.from?.roughFillWeight ?? result.roughFillWeight ?? 1;
            updates.roughFillWeight = lerp(fromFillWeight, transformAction.to.roughFillWeight, tEased);
          }

          // Algorithm primitives — pointer movement
          if (transformAction.to.pointerTargetIndex !== undefined) {
            const fromIdx = transformAction.from?.pointerTargetIndex ?? result.pointerTargetIndex ?? 0;
            updates.pointerTargetIndex = lerp(fromIdx, transformAction.to.pointerTargetIndex, tEased);
          }
          if (transformAction.to.pointerTargetRow !== undefined) {
            const fromRow = transformAction.from?.pointerTargetRow ?? result.pointerTargetRow ?? 0;
            updates.pointerTargetRow = lerp(fromRow, transformAction.to.pointerTargetRow, tEased);
          }
          if (transformAction.to.pointerTargetCol !== undefined) {
            const fromCol = transformAction.from?.pointerTargetCol ?? result.pointerTargetCol ?? 0;
            updates.pointerTargetCol = lerp(fromCol, transformAction.to.pointerTargetCol, tEased);
          }
          // Tree pointer: snap (string-typed, can't lerp). Slide animation
          // between tree nodes is a v2 enhancement.
          if ((transformAction.to as any).pointerTreeNodeId !== undefined && tEased >= 1) {
            (updates as any).pointerTreeNodeId = (transformAction.to as any).pointerTreeNodeId;
          }
          // Corner radius (used by shapeMorph and container morph expansions)
          if ((transformAction.to as any).cornerRadius !== undefined) {
            const fromCR = (transformAction.from as any)?.cornerRadius ?? (result as any).cornerRadius ?? 0;
            (updates as any).cornerRadius = lerp(fromCR, (transformAction.to as any).cornerRadius, tEased);
          }
          // Range marker endpoints (algo-array) — numeric, lerp for slide
          if ((transformAction.to as any).rangeStart !== undefined) {
            const fromRs = (transformAction.from as any)?.rangeStart ?? (result as any).rangeStart ?? 0;
            (updates as any).rangeStart = lerp(fromRs, (transformAction.to as any).rangeStart, tEased);
          }
          if ((transformAction.to as any).rangeEnd !== undefined) {
            const fromRe = (transformAction.from as any)?.rangeEnd ?? (result as any).rangeEnd ?? 0;
            (updates as any).rangeEnd = lerp(fromRe, (transformAction.to as any).rangeEnd, tEased);
          }

          result = { ...result, ...updates };
        } else {
          // Action complete - apply final state
          // All animations end at target position, regardless of iterations
          // For rotation: cumulative, ends at N * rotation value
          // For oscillating: always ends at "to" (last forward motion completes at target)
          const updates: Partial<NodeModel> = {};

          // Skip position if path action exists (path will control position)
          if (!hasActivePathAction) {
            // Check if this is a relative position action
            if (transformAction.isRelative && transformAction.dx !== undefined && transformAction.dy !== undefined) {
              // Relative mode: end position IS the snapshot (the animation ends at the node's step position)
              updates.x = n.x;
              updates.y = n.y;
            } else {
              // Absolute mode (legacy)
              if (transformAction.to.x !== undefined) {
                updates.x = transformAction.to.x;
              }
              if (transformAction.to.y !== undefined) {
                updates.y = transformAction.to.y;
              }
            }
          }
          if (transformAction.to.scaleX !== undefined) {
            updates.scaleX = transformAction.to.scaleX;
          }
          if (transformAction.to.scaleY !== undefined) {
            updates.scaleY = transformAction.to.scaleY;
          }
          // Affine matrix entries — hold the end value after a completed matrix tween
          // so a narration-stretched beat keeps the deformed grid instead of reverting.
          for (const mk of ['m11', 'm12', 'm21', 'm22'] as const) {
            if ((transformAction.to as any)[mk] !== undefined) {
              (updates as any)[mk] = (transformAction.to as any)[mk];
            }
          }
          for (const rk of ['rot3dX', 'rot3dY', 'rot3dZ', 'meshScaleX', 'meshScaleY', 'meshScaleZ', 'markerX', 'markerY', 'markerZ',
                             'arrowTailX', 'arrowTailY', 'arrowTipX', 'arrowTipY', 'pathT'] as const) {
            if ((transformAction.to as any)[rk] !== undefined) {
              (updates as any)[rk] = (transformAction.to as any)[rk];
            }
          }
          for (const [mk] of _MESH_M3_KEYS) {
            if ((transformAction.to as any)[mk] !== undefined) {
              (updates as any)[mk] = (transformAction.to as any)[mk];
            }
          }
          if (transformAction.to.rotationX !== undefined) {
            updates.rotationX = transformAction.to.rotationX * iterations;
          }
          if (transformAction.to.rotationY !== undefined) {
            updates.rotationY = transformAction.to.rotationY * iterations;
          }
          if (transformAction.to.rotationZ !== undefined) {
            updates.rotationZ = transformAction.to.rotationZ * iterations;
          }
          if (transformAction.to.opacity !== undefined) {
            updates.opacity = transformAction.to.opacity;
          }
          if (transformAction.to.w !== undefined) {
            updates.w = transformAction.to.w;
          }
          if (transformAction.to.h !== undefined) {
            updates.h = transformAction.to.h;
          }
          if (transformAction.to.fill !== undefined) {
            updates.fill = transformAction.to.fill;
          }
          if (transformAction.to.stroke !== undefined) {
            updates.stroke = transformAction.to.stroke;
          }
          if (transformAction.to.strokeWidth !== undefined) {
            updates.strokeWidth = transformAction.to.strokeWidth;
          }
          if (transformAction.to.strokeTrimStart !== undefined) {
            updates.strokeTrimStart = transformAction.to.strokeTrimStart;
          }
          if (transformAction.to.strokeTrimEnd !== undefined) {
            updates.strokeTrimEnd = transformAction.to.strokeTrimEnd;
          }
          if (transformAction.to.typeProgress !== undefined) {
            updates.typeProgress = transformAction.to.typeProgress;
          }
          if ((transformAction.to as any).drawProgress !== undefined) {
            (updates as any).drawProgress = (transformAction.to as any).drawProgress;
          }

          // Tier 1 shape properties - final state
          if (transformAction.to.value !== undefined) {
            updates.value = transformAction.to.value;
          }
          if (transformAction.to.progressColor !== undefined) {
            updates.progressColor = transformAction.to.progressColor;
          }
          if (transformAction.to.startAngle !== undefined) {
            updates.startAngle = transformAction.to.startAngle;
          }
          if (transformAction.to.endAngle !== undefined) {
            updates.endAngle = transformAction.to.endAngle;
          }
          if (transformAction.to.innerRadius !== undefined) {
            updates.innerRadius = transformAction.to.innerRadius;
          }
          if (transformAction.to.pointDepth !== undefined) {
            updates.pointDepth = transformAction.to.pointDepth;
          }
          if (transformAction.to.topWidth !== undefined) {
            updates.topWidth = transformAction.to.topWidth;
          }
          if (transformAction.to.bottomWidth !== undefined) {
            updates.bottomWidth = transformAction.to.bottomWidth;
          }
          if (transformAction.to.pointerPosition !== undefined) {
            updates.pointerPosition = transformAction.to.pointerPosition;
          }
          if (transformAction.to.pointerSize !== undefined) {
            updates.pointerSize = transformAction.to.pointerSize;
          }

          // Algorithm primitives — final state
          if (transformAction.to.pointerTargetIndex !== undefined) {
            updates.pointerTargetIndex = transformAction.to.pointerTargetIndex;
          }
          if ((transformAction.to as any).pointerTreeNodeId !== undefined) {
            (updates as any).pointerTreeNodeId = (transformAction.to as any).pointerTreeNodeId;
          }
          if ((transformAction.to as any).cornerRadius !== undefined) {
            (updates as any).cornerRadius = (transformAction.to as any).cornerRadius;
          }
          if ((transformAction.to as any).rangeStart !== undefined) {
            (updates as any).rangeStart = (transformAction.to as any).rangeStart;
          }
          if ((transformAction.to as any).rangeEnd !== undefined) {
            (updates as any).rangeEnd = (transformAction.to as any).rangeEnd;
          }
          if (transformAction.to.pointerTargetRow !== undefined) {
            updates.pointerTargetRow = transformAction.to.pointerTargetRow;
          }
          if (transformAction.to.pointerTargetCol !== undefined) {
            updates.pointerTargetCol = transformAction.to.pointerTargetCol;
          }

          // Rough.js properties - final state
          if (transformAction.to.roughness !== undefined) {
            updates.roughness = transformAction.to.roughness;
          }
          if (transformAction.to.roughFillWeight !== undefined) {
            updates.roughFillWeight = transformAction.to.roughFillWeight;
          }

          result = { ...result, ...updates };
        }
      }
    }

    // Apply visibility actions - skip disabled.
    // A node can carry SEVERAL visibility actions in one step: a counting digit fades in, then is
    // swapped out for the crisp final one a beat later. Taking the first match alone meant the
    // later ones never ran, so the two glyphs stacked at the same spot until the next step's
    // snapshot cleaned it up — a blot where a number should be. Whichever one has most recently
    // STARTED at this instant is the one in force; before any has started, the earliest one
    // holds (its pre-delay state).
    const visActions = (step.actions || []).filter(
      (act) =>
        act.type === 'visibility' &&
        act.target.kind === 'node' &&
        act.target.id === n.id &&
        !(act as any).disabled
    ) as VisibilityAction[];
    let visibilityAction: VisibilityAction | undefined = visActions[0];
    for (const act of visActions) {
      const off = act.offsetMs ?? 0;
      if (off <= localMs && off >= (visibilityAction?.offsetMs ?? 0)) visibilityAction = act;
    }

    if (visibilityAction) {
      const actionDuration = visibilityAction.durationMs ?? 200;
      const actionDelay = visibilityAction.offsetMs ?? 0;
      const iterations = visibilityAction.iterations ?? 1;

      // Same snap-to-final logic as transformTween
      const isAtStepEnd = localMs >= duration;
      const actionExtendsPastStep = actionDelay + actionDuration > duration;
      const actionHasStarted = actionDelay <= duration;
      const snapToFinal = isAtStepEnd && actionExtendsPastStep && actionHasStarted;

      switch (visibilityAction.mode) {
        case 'show':
          if (localMs >= actionDelay || snapToFinal) {
            result = { ...result, opacity: 1 };
          }
          break;
        case 'hide':
          if (localMs >= actionDelay || snapToFinal) {
            result = { ...result, opacity: 0 };
          }
          break;
        case 'fadeIn':
          if (localMs < actionDelay && !snapToFinal) {
            result = { ...result, opacity: 0 };
          } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
            const elapsed = localMs - actionDelay;
            const { t: tFade } = calculateIterationProgress(elapsed, actionDuration, iterations, false);
            result = { ...result, opacity: tFade };
          } else {
            // fadeIn always ends at full opacity (or snapToFinal)
            result = { ...result, opacity: 1 };
          }
          break;
        case 'fadeOut':
          if (localMs < actionDelay && !snapToFinal) {
            result = { ...result, opacity: 1 };
          } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
            const elapsed = localMs - actionDelay;
            const { t: tFade } = calculateIterationProgress(elapsed, actionDuration, iterations, false);
            result = { ...result, opacity: 1 - tFade };
          } else {
            // fadeOut always ends at zero opacity (or snapToFinal)
            result = { ...result, opacity: 0 };
          }
          break;
        case 'slideInLeft':
        case 'slideInRight':
        case 'slideInUp':
        case 'slideInDown': {
          const dist = visibilityAction.slideDistance ?? 150;
          const slideEase = (visibilityAction.ease || 'ease-out') as Easing;
          const dx = visibilityAction.mode === 'slideInLeft' ? -dist : visibilityAction.mode === 'slideInRight' ? dist : 0;
          const dy = visibilityAction.mode === 'slideInUp' ? -dist : visibilityAction.mode === 'slideInDown' ? dist : 0;
          if (localMs < actionDelay && !snapToFinal) {
            result = { ...result, x: n.x + dx, y: n.y + dy, opacity: 0 };
          } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
            const elapsed = localMs - actionDelay;
            const { t: tRaw } = calculateIterationProgress(elapsed, actionDuration, iterations, false);
            const tEased = applyEasing(tRaw, slideEase);
            const opacityT = Math.min(tRaw / 0.3, 1);
            result = {
              ...result,
              x: lerp(n.x + dx, n.x, tEased),
              y: lerp(n.y + dy, n.y, tEased),
              opacity: lerp(0, 1, opacityT),
            };
          } else {
            result = { ...result, x: n.x, y: n.y, opacity: 1 };
          }
          break;
        }
        case 'slideOutLeft':
        case 'slideOutRight':
        case 'slideOutUp':
        case 'slideOutDown': {
          const dist = visibilityAction.slideDistance ?? 150;
          const slideEase = (visibilityAction.ease || 'ease-in') as Easing;
          const dx = visibilityAction.mode === 'slideOutLeft' ? -dist : visibilityAction.mode === 'slideOutRight' ? dist : 0;
          const dy = visibilityAction.mode === 'slideOutUp' ? -dist : visibilityAction.mode === 'slideOutDown' ? dist : 0;
          const fromOpacity = n.opacity ?? 1;
          if (localMs < actionDelay && !snapToFinal) {
            result = { ...result, opacity: fromOpacity };
          } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
            const elapsed = localMs - actionDelay;
            const { t: tRaw } = calculateIterationProgress(elapsed, actionDuration, iterations, false);
            const tEased = applyEasing(tRaw, slideEase);
            const opacityT = Math.max((tRaw - 0.7) / 0.3, 0);
            result = {
              ...result,
              x: lerp(n.x, n.x + dx, tEased),
              y: lerp(n.y, n.y + dy, tEased),
              opacity: lerp(fromOpacity, 0, opacityT),
            };
          } else {
            result = { ...result, x: n.x + dx, y: n.y + dy, opacity: 0 };
          }
          break;
        }
      }
    }

    // Apply path-follow actions - skip disabled
    const pathAction = step.actions?.find(
      (act) =>
        act.type === 'pathFollow' &&
        act.target.kind === 'node' &&
        act.target.id === n.id &&
        !(act as any).disabled
    ) as PathFollowAction | undefined;

    if (pathAction) {
      const delay = clamp(pathAction.offsetMs || 0, 0, duration);
      // Use explicit durationMs if provided, otherwise use remaining step time
      const actionDuration = pathAction.durationMs ?? (duration - delay);
      const localSpan = Math.max(1, actionDuration);

      if (localMs >= delay) {
        // Calculate progress: 0 at start, 1 at end, clamped to 1 after action completes
        const tLocal = clamp((localMs - delay) / localSpan, 0, 1);
        const actionEasing = pathAction.ease || step.easing || 'ease';
        const tAction = applyEasing(tLocal, actionEasing, (pathAction as any).easeIntensity);
        const progress = lerp(pathAction.from, pathAction.to, tAction);

        const path = paths[pathAction.pathId];
        if (path && path.cum && path.length) {
          let { pos } = pointAndTangentAt(path, progress);

          if (pathAction.instanceTransform) {
            pos = {
              x: pos.x + pathAction.instanceTransform.dx,
              y: pos.y + pathAction.instanceTransform.dy,
            };
          }

          result = {
            ...result,
            x: pos.x - n.w / 2,
            y: pos.y - n.h / 2,
          };
        } else {
          // Debug: log why path action failed
          console.warn(`⚠️ PathFollow action for node ${n.id} failed:`, {
            pathId: pathAction.pathId,
            pathExists: !!path,
            hasCum: path?.cum !== undefined,
            hasLength: path?.length !== undefined,
            pathPointsCount: path?.points?.length,
          });
        }
      }
    }

    return result;
  });
}

/**
 * Helper to set animation starting values from prevSnapshot for properties with actions.
 * 
 * WHY THIS EXISTS:
 * We start with `{ ...curNode }` (snapshot = final state) to fix the R_res color bug
 * where styling properties were incorrectly inherited from previous steps.
 * 
 * But for ANIMATABLE properties that have actions, we need to start from the
 * previous step's end state so the action can animate FROM there TO the snapshot.
 * 
 * This function checks each action's `to` properties and sets the corresponding
 * starting values from prevSnapshot.
 */
function setAnimationStartValues(
  node: NodeModel,
  curNode: Partial<NodeModel> & { id: string },
  prevSnapshot: Partial<NodeModel> & { id: string },
  actions: StepAction[] | undefined
): void {
  if (!actions) return;

  // Find all transform actions targeting this node (skip disabled)
  const nodeActions = actions.filter(
    (a) =>
      a.type === 'transformTween' &&
      a.target.kind === 'node' &&
      a.target.id === curNode.id &&
      !(a as any).disabled
  ) as TransformTweenAction[];

  // For each action, set starting values from prevSnapshot for animated properties
  for (const action of nodeActions) {
    const to = action.to;
    // Guard against malformed actions with missing 'to' property
    if (!to) continue;
    // Position (CRITICAL - was missing before!)
    if (to.x !== undefined) node.x = prevSnapshot.x ?? curNode.x ?? 0;
    if (to.y !== undefined) node.y = prevSnapshot.y ?? curNode.y ?? 0;
    // Stroke trim
    if (to.strokeTrimStart !== undefined) node.strokeTrimStart = prevSnapshot.strokeTrimStart ?? 0;
    if (to.strokeTrimEnd !== undefined) node.strokeTrimEnd = prevSnapshot.strokeTrimEnd ?? 1;
    if (to.strokeWidth !== undefined) node.strokeWidth = prevSnapshot.strokeWidth ?? 1;
    // Transform
    if (to.opacity !== undefined) node.opacity = prevSnapshot.opacity ?? 1;
    if (to.scaleX !== undefined) node.scaleX = prevSnapshot.scaleX ?? 1;
    if (to.scaleY !== undefined) node.scaleY = prevSnapshot.scaleY ?? 1;
    if (to.rotationX !== undefined) node.rotationX = prevSnapshot.rotationX ?? 0;
    if (to.rotationY !== undefined) node.rotationY = prevSnapshot.rotationY ?? 0;
    if (to.rotationZ !== undefined) node.rotationZ = prevSnapshot.rotationZ ?? 0;
    // Size
    if (to.w !== undefined) node.w = prevSnapshot.w ?? curNode.w ?? 100;
    if (to.h !== undefined) node.h = prevSnapshot.h ?? curNode.h ?? 100;
    // Style
    if (to.fill !== undefined) node.fill = prevSnapshot.fill ?? curNode.fill;
    if (to.stroke !== undefined) node.stroke = prevSnapshot.stroke ?? curNode.stroke;
    // Tier 1 shape properties
    if (to.value !== undefined) node.value = prevSnapshot.value ?? curNode.value;
    if (to.progressColor !== undefined) node.progressColor = prevSnapshot.progressColor ?? curNode.progressColor;
    if (to.startAngle !== undefined) node.startAngle = prevSnapshot.startAngle ?? curNode.startAngle;
    if (to.endAngle !== undefined) node.endAngle = prevSnapshot.endAngle ?? curNode.endAngle;
    if (to.innerRadius !== undefined) node.innerRadius = prevSnapshot.innerRadius ?? curNode.innerRadius;
    if (to.pointDepth !== undefined) node.pointDepth = prevSnapshot.pointDepth ?? curNode.pointDepth;
    if (to.topWidth !== undefined) node.topWidth = prevSnapshot.topWidth ?? curNode.topWidth;
    if (to.bottomWidth !== undefined) node.bottomWidth = prevSnapshot.bottomWidth ?? curNode.bottomWidth;
    if (to.pointerPosition !== undefined) node.pointerPosition = prevSnapshot.pointerPosition ?? curNode.pointerPosition;
    if (to.pointerSize !== undefined) node.pointerSize = prevSnapshot.pointerSize ?? curNode.pointerSize;
    // Rough.js properties
    if (to.roughness !== undefined) node.roughness = prevSnapshot.roughness ?? curNode.roughness;
    if (to.roughFillWeight !== undefined) node.roughFillWeight = prevSnapshot.roughFillWeight ?? curNode.roughFillWeight;
    // Algorithm primitives — pointer movement
    if (to.pointerTargetIndex !== undefined) {
      node.pointerTargetIndex = prevSnapshot.pointerTargetIndex ?? curNode.pointerTargetIndex ?? 0;
    }
    if (to.pointerTargetRow !== undefined) {
      node.pointerTargetRow = prevSnapshot.pointerTargetRow ?? curNode.pointerTargetRow ?? 0;
    }
    if (to.pointerTargetCol !== undefined) {
      node.pointerTargetCol = prevSnapshot.pointerTargetCol ?? curNode.pointerTargetCol ?? 0;
    }
    if ((to as any).pointerTreeNodeId !== undefined) {
      (node as any).pointerTreeNodeId =
        (prevSnapshot as any).pointerTreeNodeId ?? (curNode as any).pointerTreeNodeId ?? '';
    }
    if ((to as any).cornerRadius !== undefined) {
      (node as any).cornerRadius =
        (prevSnapshot as any).cornerRadius ?? (curNode as any).cornerRadius ?? 0;
    }
    if ((to as any).rangeStart !== undefined) {
      (node as any).rangeStart =
        (prevSnapshot as any).rangeStart ?? (curNode as any).rangeStart ?? 0;
    }
    if ((to as any).rangeEnd !== undefined) {
      (node as any).rangeEnd =
        (prevSnapshot as any).rangeEnd ?? (curNode as any).rangeEnd ?? 0;
    }
  }

  // Also handle visibility actions (they animate opacity)
  const hasVisibilityAction = actions.some(
    (a) =>
      a.type === 'visibility' &&
      a.target.kind === 'node' &&
      a.target.id === curNode.id &&
      !(a as any).disabled
  );
  if (hasVisibilityAction) {
    node.opacity = prevSnapshot.opacity ?? 1;
  }
}

/**
 * Implicit interpolation for node properties not covered by explicit actions.
 * This is the AE/Figma-style default: property changes between steps animate
 * smoothly over durationMs instead of snapping instantly.
 *
 * Runs AFTER applyActionsToNodes so explicit actions take priority.
 * Only touches properties where: (a) prev and cur values differ, (b) no
 * explicit action already covers the property, (c) transition is not "instant".
 */
function applyImplicitNodeInterpolation(
  resultNodes: NodeModel[],
  currentNodes: readonly NodeModel[],
  prevEndStates: Map<string, Partial<NodeModel>>,
  currentStep: Step,
  localMs: number,
  duration: number,
): NodeModel[] {
  if (duration <= 0) return resultNodes;

  return resultNodes.map((node, idx) => {
    const curNode = currentNodes[idx];
    if (!curNode || curNode.id !== node.id) return node;

    // Check per-node transition override
    const transition = currentStep.transitions?.[node.id];
    if (transition === 'instant' || transition === 'fade') return node;

    const prevEnd = prevEndStates.get(node.id);

    // New node (no previous state) — auto fade-in
    if (!prevEnd) {
      if (currentStep._addedNodeIds?.includes(node.id)) {
        // Check if explicit visibility action already handles this
        const hasVisAction = currentStep.actions?.some(
          a => a.type === 'visibility' && a.target.id === node.id && !(a as any).disabled
        );
        if (!hasVisAction) {
          const delayMs = currentStep.delays?.[node.id] ?? 0;
          const effectiveLocal = localMs - delayMs;
          const effectiveDur = Math.max(1, duration - delayMs);
          const entranceT = effectiveLocal <= 0 ? 0 : effectiveLocal >= effectiveDur ? 1 : effectiveLocal / effectiveDur;
          const entranceTEased = applyEasing(entranceT, currentStep.easing || 'ease');
          const targetOpacity = curNode.opacity ?? 1;
          return { ...node, opacity: lerp(0, targetOpacity, entranceTEased) };
        }
      }
      return node;
    }

    // Exiting node — auto fade-out
    if (currentStep._removedNodeIds?.includes(node.id)) {
      const hasVisAction = currentStep.actions?.some(
        a => a.type === 'visibility' && a.target.id === node.id && !(a as any).disabled
      );
      if (!hasVisAction) {
        const delayMs = currentStep.delays?.[node.id] ?? 0;
        const effectiveLocal = localMs - delayMs;
        const effectiveDur = Math.max(1, duration - delayMs);
        const exitT = effectiveLocal <= 0 ? 0 : effectiveLocal >= effectiveDur ? 1 : effectiveLocal / effectiveDur;
        const exitTEased = applyEasing(exitT, currentStep.easing || 'ease');
        const fromOpacity = prevEnd.opacity ?? 1;
        return { ...node, opacity: lerp(fromOpacity, 0, exitTEased) };
      }
    }

    const coveredProps = getCoveredProps(node.id, 'node', currentStep.actions);

    // Compute per-node timing with delays
    const delayMs = currentStep.delays?.[node.id] ?? 0;
    const effectiveLocal = localMs - delayMs;
    const effectiveDur = Math.max(1, duration - delayMs);
    const nodeT = effectiveLocal <= 0 ? 0 : effectiveLocal >= effectiveDur ? 1 : effectiveLocal / effectiveDur;
    const defaultEasing = currentStep.easing || 'ease';
    const nodeTEased = applyEasing(nodeT, defaultEasing);
    const propEasings = currentStep.propertyEasings;

    let changed = false;
    const updates: Record<string, any> = {};

    // Interpolate numeric properties
    for (const prop of NUMERIC_NODE_PROPS) {
      if (coveredProps.has(prop)) continue;
      const prev = (prevEnd as any)[prop];
      const cur = (curNode as any)[prop];
      if (typeof prev === 'number' && typeof cur === 'number' && prev !== cur) {
        const t = propEasings?.[prop] ? applyEasing(nodeT, propEasings[prop]) : nodeTEased;
        updates[prop] = lerp(prev, cur, t);
        changed = true;
      }
    }

    // Interpolate color properties
    for (const prop of COLOR_NODE_PROPS) {
      if (coveredProps.has(prop)) continue;
      const prev = (prevEnd as any)[prop];
      const cur = (curNode as any)[prop];
      if (prev != null && cur != null && prev !== cur) {
        const t = propEasings?.[prop] ? applyEasing(nodeT, propEasings[prop]) : nodeTEased;
        updates[prop] = lerpColor(prev, cur, t);
        changed = true;
      }
    }

    if (!changed) return node;
    return { ...node, ...updates };
  });
}

/**
 * Cross-fade COLLECTION-shaped properties between step snapshots.
 *
 * This is the *only* animation path for properties whose shape can't fit
 * into transformTween's scalar `from`/`to` model. Specifically:
 *
 *   - algo-array.cellColors    (string|null)[]   per-cell color cross-fade
 *   - algo-grid.gridColors     (string|null)[][] per-cell color cross-fade
 *   - text.highlightedLines    number[]          union of old + new lines
 *
 * Scalar properties (positions, sizes, colors of the *whole* node, opacity,
 * pointer target index/row/col, etc.) go through the regular transformTween
 * action system in applyActionsToNodes. This helper handles ONLY the
 * collection-shaped exceptions that can't be expressed as a tween action.
 *
 * TIMING OVERRIDE (Option C): If a transformTween action exists targeting one
 * of these properties on the same node, this helper uses the action's
 * `durationMs`/`offsetMs`/`ease` to drive the cross-fade timing instead of
 * the step's defaults. The action's `to[prop]` value itself is ignored — the
 * actual array values come from the snapshot. The action exists purely as a
 * timing marker. This lets users/AI override the default cross-fade timing
 * without rewriting the cross-fade as a generic action.
 *
 * Each property respects the _animatedProps[prop] toggle (default = animated;
 * set to false to snap).
 */
function applyCollectionCrossFade(
  resultNodes: NodeModel[],
  prevNodes: readonly NodeModel[],
  defaultTEased: number,
  // Optional context for action-based timing override
  localMs?: number,
  stepDurationMs?: number,
  stepEasing?: Easing,
  stepActions?: StepAction[],
  transitions?: Record<string, string>
): NodeModel[] {
  if (defaultTEased >= 1) return resultNodes;

  // Build a quick lookup: { "<nodeId>::<prop>" → matching transformTween action }
  // Used to override the cross-fade timing per property if the user emitted
  // a transformTween action targeting that exact (node, property) pair.
  const actionByNodeProp = new Map<string, TransformTweenAction>();
  if (stepActions) {
    for (const a of stepActions) {
      if (a.type !== 'transformTween') continue;
      if ((a as any).disabled) continue;
      if (a.target?.kind !== 'node') continue;
      const ta = a as TransformTweenAction;
      const to = ta.to as Record<string, unknown> | undefined;
      if (!to) continue;
      for (const prop of ['cellColors', 'gridColors', 'highlightedLines', 'cellValues', 'gridValues', 'nodeColors']) {
        if (to[prop] !== undefined) {
          actionByNodeProp.set(`${a.target.id}::${prop}`, ta);
        }
      }
    }
  }

  // Helper: returns the eased t value to use for a (node, property) cross-fade.
  // Defaults to the step-derived tEased; overrides via action timing if present.
  const tForProp = (node: NodeModel, prop: string): number => {
    const action = actionByNodeProp.get(`${node.id}::${prop}`);
    if (
      !action ||
      localMs === undefined ||
      stepDurationMs === undefined ||
      stepEasing === undefined
    ) {
      return defaultTEased;
    }
    const actionDelay = action.offsetMs ?? 0;
    const actionDuration = action.durationMs ?? stepDurationMs;
    if (localMs < actionDelay) return 0;
    if (localMs >= actionDelay + actionDuration) return 1;
    const localActionT = (localMs - actionDelay) / Math.max(1, actionDuration);
    return applyEasing(localActionT, action.ease || stepEasing);
  };

  // Helper: returns true unless the node has explicitly disabled animation
  // for this property via the _animatedProps toggle.
  const isAnimated = (node: NodeModel, prop: string): boolean => {
    const flags = (node as any)._animatedProps as Record<string, boolean | undefined> | undefined;
    if (!flags || flags[prop] === undefined) return true;
    return flags[prop] !== false;
  };

  return resultNodes.map((cur) => {
    if (
      cur.kind !== 'algo-array' &&
      cur.kind !== 'algo-grid' &&
      cur.kind !== 'text' &&
      cur.kind !== 'algo-tree' &&
      cur.kind !== 'algo-linked-list' &&
      cur.kind !== 'algo-graph' &&
      cur.kind !== 'algo-chart' &&
      cur.kind !== 'algo-chart-line' &&
      cur.kind !== 'algo-chart-scatter'
    ) {
      return cur;
    }
    const prev = prevNodes.find((p) => p.id === cur.id);
    if (!prev || prev.kind !== cur.kind) return cur;
    const nodeTransition = transitions?.[cur.id];
    if (nodeTransition === 'instant' || nodeTransition === 'fade') return cur;

    // algo-tree: cross-fade per-node fill colors. nodeColors may arrive as
    // either a map {nodeId: color} or an array of {nodeId, color} pairs
    // (the AI emits the array form because Gemini's schema can't express
    // arbitrary-key objects). Normalize both prev and cur to maps before
    // blending. Layout positions are recomputed by drawAlgoTree on each
    // frame, so no need to interpolate node positions here.
    if (cur.kind === 'algo-tree' || cur.kind === 'algo-linked-list' || cur.kind === 'algo-graph') {
      // algo-tree, algo-linked-list, and algo-graph all use the same
      // `nodeColors` shape (per-id fill map). Layout is handled by the
      // respective draw functions on each frame, so we only blend colors
      // here. Structure changes snap between snapshots.
      if (!isAnimated(cur, 'nodeColors')) return cur;
      const curMap = normalizeNodeColors(cur.nodeColors);
      const prevMap = normalizeNodeColors(prev.nodeColors);
      const curKeys = Object.keys(curMap);
      const prevKeys = Object.keys(prevMap);
      if (curKeys.length === 0 && prevKeys.length === 0) return cur;
      const tEasedTree = tForProp(cur, 'nodeColors');
      const blended: { [k: string]: string | null } = {};
      const allKeys = new Set([...curKeys, ...prevKeys]);
      allKeys.forEach((k) => {
        const a = prevMap[k] ?? null;
        const b = curMap[k] ?? null;
        if (a && b && a !== b) {
          blended[k] = lerpColor(a, b, tEasedTree);
        } else if (a && !b) {
          blended[k] = a;
        } else {
          blended[k] = b;
        }
      });
      // Also blend edgeColors for algo-graph
      if (cur.kind === 'algo-graph' && isAnimated(cur, 'edgeColors')) {
        const curEdgeMap = normalizeEdgeColors(cur.edgeColors);
        const prevEdgeMap = normalizeEdgeColors(prev.edgeColors);
        const curEdgeKeys = Object.keys(curEdgeMap);
        const prevEdgeKeys = Object.keys(prevEdgeMap);
        if (curEdgeKeys.length > 0 || prevEdgeKeys.length > 0) {
          const blendedEdges: { [k: string]: string | null } = {};
          const allEdgeKeys = new Set([...curEdgeKeys, ...prevEdgeKeys]);
          allEdgeKeys.forEach((k) => {
            const ea = prevEdgeMap[k] ?? null;
            const eb = curEdgeMap[k] ?? null;
            if (ea && eb && ea !== eb) {
              blendedEdges[k] = lerpColor(ea, eb, tEasedTree);
            } else if (ea && !eb) {
              blendedEdges[k] = ea;
            } else {
              blendedEdges[k] = eb;
            }
          });
          return { ...cur, nodeColors: blended, edgeColors: blendedEdges };
        }
      }
      return { ...cur, nodeColors: blended };
    }

    // algo-chart: cross-fade per-bar colors AND smoothly tween bar heights
    // (values) between snapshots. Both are animated independently — colors
    // use lerpColor, values use plain numeric lerp. The chart's own draw
    // function recomputes layout per frame from chartBars, so changing the
    // value field here makes the bar visibly grow/shrink.
    if (cur.kind === 'algo-chart') {
      let result: NodeModel = cur;

      // ---- 1. Cross-fade per-bar colors ----
      if (isAnimated(cur, 'barColors')) {
        const curMap = normalizeBarColors(cur.barColors);
        const prevMap = normalizeBarColors(prev.barColors);
        const curKeys = Object.keys(curMap);
        const prevKeys = Object.keys(prevMap);
        if (curKeys.length > 0 || prevKeys.length > 0) {
          const tEasedChart = tForProp(cur, 'barColors');
          const blendedBars: { [k: string]: string | null } = {};
          const allKeys = new Set([...curKeys, ...prevKeys]);
          allKeys.forEach((k) => {
            const a = prevMap[k] ?? null;
            const b = curMap[k] ?? null;
            if (a && b && a !== b) {
              blendedBars[k] = lerpColor(a, b, tEasedChart);
            } else if (a && !b) {
              blendedBars[k] = a;
            } else {
              blendedBars[k] = b;
            }
          });
          result = { ...result, barColors: blendedBars };
        }
      }

      // ---- 2. Tween bar heights (chartBars values) ----
      // Only animate when the snapshots actually differ on at least one
      // value. Bars are matched by id; new bars (in cur but not prev) and
      // removed bars (in prev but not cur) snap rather than tween.
      if (isAnimated(cur, 'chartBars')) {
        const curBars = cur.chartBars ?? [];
        const prevBars = prev.chartBars ?? [];
        if (curBars.length > 0 && prevBars.length > 0) {
          const prevById = new Map<string, number>();
          for (const b of prevBars) {
            if (typeof b.value === 'number') prevById.set(b.id, b.value);
          }
          let anyDiff = false;
          for (const b of curBars) {
            const pv = prevById.get(b.id);
            if (pv !== undefined && pv !== b.value) {
              anyDiff = true;
              break;
            }
          }
          if (anyDiff) {
            const tEasedBars = tForProp(cur, 'chartBars');
            const tweenedBars = curBars.map((b) => {
              const pv = prevById.get(b.id);
              if (pv === undefined || typeof b.value !== 'number') return b;
              const blendedValue = pv + (b.value - pv) * tEasedBars;
              return { ...b, value: blendedValue };
            });
            result = { ...result, chartBars: tweenedBars };
          }
        }
      }

      return result;
    }

    // algo-chart-line: cross-fade seriesColors AND tween series point y values
    if (cur.kind === 'algo-chart-line') {
      let result: NodeModel = cur;

      if (isAnimated(cur, 'seriesColors')) {
        const curMap = normalizeSeriesColors(cur.seriesColors);
        const prevMap = normalizeSeriesColors(prev.seriesColors);
        const allKeys = new Set([...Object.keys(curMap), ...Object.keys(prevMap)]);
        if (allKeys.size > 0) {
          const tEased = tForProp(cur, 'seriesColors');
          const blended: { [k: string]: string | null } = {};
          allKeys.forEach((k) => {
            const a = prevMap[k] ?? null;
            const b = curMap[k] ?? null;
            if (a && b && a !== b) blended[k] = lerpColor(a, b, tEased);
            else if (a && !b) blended[k] = a;
            else blended[k] = b;
          });
          result = { ...result, seriesColors: blended };
        }
      }

      // Tween point positions within each series that appears in both snapshots
      if (isAnimated(cur, 'chartSeries')) {
        const curSeries = cur.chartSeries ?? [];
        const prevSeries = prev.chartSeries ?? [];
        if (curSeries.length > 0 && prevSeries.length > 0) {
          const prevById = new Map(prevSeries.map((s) => [s.id, s]));
          const tEased = tForProp(cur, 'chartSeries');
          let anyDiff = false;
          for (const s of curSeries) {
            const ps = prevById.get(s.id);
            if (!ps) continue;
            const minLen = Math.min(s.points?.length ?? 0, ps.points?.length ?? 0);
            for (let i = 0; i < minLen; i++) {
              if (s.points![i].y !== ps.points![i].y || s.points![i].x !== ps.points![i].x) {
                anyDiff = true;
                break;
              }
            }
            if (anyDiff) break;
          }
          if (anyDiff) {
            const tweenedSeries = curSeries.map((s) => {
              const ps = prevById.get(s.id);
              if (!ps || !s.points) return s;
              const tweenedPoints = s.points.map((p, i) => {
                const pp = ps.points?.[i];
                if (!pp) return p;
                return {
                  x: pp.x + (p.x - pp.x) * tEased,
                  y: pp.y + (p.y - pp.y) * tEased,
                };
              });
              return { ...s, points: tweenedPoints };
            });
            result = { ...result, chartSeries: tweenedSeries };
          }
        }
      }

      return result;
    }

    // algo-chart-scatter: cross-fade pointColors AND tween each point's x/y
    if (cur.kind === 'algo-chart-scatter') {
      let result: NodeModel = cur;

      if (isAnimated(cur, 'pointColors')) {
        const curMap = normalizePointColors(cur.pointColors);
        const prevMap = normalizePointColors(prev.pointColors);
        const allKeys = new Set([...Object.keys(curMap), ...Object.keys(prevMap)]);
        if (allKeys.size > 0) {
          const tEased = tForProp(cur, 'pointColors');
          const blended: { [k: string]: string | null } = {};
          allKeys.forEach((k) => {
            const a = prevMap[k] ?? null;
            const b = curMap[k] ?? null;
            if (a && b && a !== b) blended[k] = lerpColor(a, b, tEased);
            else if (a && !b) blended[k] = a;
            else blended[k] = b;
          });
          result = { ...result, pointColors: blended };
        }
      }

      if (isAnimated(cur, 'chartPoints')) {
        const curPoints = cur.chartPoints ?? [];
        const prevPoints = prev.chartPoints ?? [];
        if (curPoints.length > 0 && prevPoints.length > 0) {
          const prevById = new Map(prevPoints.map((p) => [p.id, p]));
          const tEased = tForProp(cur, 'chartPoints');
          let anyDiff = false;
          for (const p of curPoints) {
            const pp = prevById.get(p.id);
            if (pp && (pp.x !== p.x || pp.y !== p.y)) {
              anyDiff = true;
              break;
            }
          }
          if (anyDiff) {
            const tweenedPoints = curPoints.map((p) => {
              const pp = prevById.get(p.id);
              if (!pp) return p;
              return {
                ...p,
                x: pp.x + (p.x - pp.x) * tEased,
                y: pp.y + (p.y - pp.y) * tEased,
              };
            });
            result = { ...result, chartPoints: tweenedPoints };
          }
        }
      }

      return result;
    }

    // algo-grid: cross-fade per-cell colors
    if (cur.kind === 'algo-grid') {
      if (!isAnimated(cur, 'gridColors')) return cur;
      const out: NodeModel = { ...cur };
      const curColors = cur.gridColors || [];
      const prevColors = prev.gridColors || [];
      if (curColors.length > 0 || prevColors.length > 0) {
        const tEasedGrid = tForProp(cur, 'gridColors');
        const rows = Math.max(curColors.length, prevColors.length);
        const blended: (string | null)[][] = [];
        for (let r = 0; r < rows; r++) {
          const curRow = curColors[r] || [];
          const prevRow = prevColors[r] || [];
          const cols = Math.max(curRow.length, prevRow.length);
          const blendedRow: (string | null)[] = [];
          for (let c = 0; c < cols; c++) {
            const a = prevRow[c] ?? null;
            const b = curRow[c] ?? null;
            if (a && b && a !== b) {
              blendedRow.push(lerpColor(a, b, tEasedGrid));
            } else if (a && !b) {
              blendedRow.push(a);
            } else {
              blendedRow.push(b);
            }
          }
          blended.push(blendedRow);
        }
        out.gridColors = blended;
      }
      return out;
    }

    // text: keep union of old + new highlightedLines visible during transition
    if (cur.kind === 'text') {
      if (!isAnimated(cur, 'highlightedLines')) return cur;
      const curLines = cur.highlightedLines;
      const prevLines = prev.highlightedLines;
      const linesChanged =
        Array.isArray(curLines) &&
        Array.isArray(prevLines) &&
        (curLines.length !== prevLines.length ||
          curLines.some((l, i) => l !== prevLines[i]));
      if (linesChanged) {
        // Show union when t < 1; once a custom action's timing reaches 1
        // (or the default step transition reaches 1), the snapshot's lines
        // take over via the normal return path.
        const tEasedLines = tForProp(cur, 'highlightedLines');
        if (tEasedLines < 1) {
          const union = Array.from(new Set([...(prevLines || []), ...(curLines || [])]));
          return { ...cur, highlightedLines: union } as NodeModel;
        }
      }
      return cur;
    }

    // algo-array: cross-fade per-cell colors AND detect cellValue swaps for
    // the swap-animation fly-by.
    if (cur.kind === 'algo-array') {
      const colorsEnabled = isAnimated(cur, 'cellColors');
      const valuesEnabled = isAnimated(cur, 'cellValues');
      if (!colorsEnabled && !valuesEnabled) return cur;

      const out: NodeModel = { ...cur };

      // 1. Color cross-fade (existing behavior)
      if (colorsEnabled) {
        const curColors = cur.cellColors || [];
        const prevColors = prev.cellColors || [];
        if (curColors.length > 0 || prevColors.length > 0) {
          const tEasedArr = tForProp(cur, 'cellColors');
          const length = Math.max(curColors.length, prevColors.length, (cur.cellValues || []).length);
          const blended: (string | null)[] = [];
          for (let i = 0; i < length; i++) {
            const a = prevColors[i] ?? null;
            const b = curColors[i] ?? null;
            if (a && b && a !== b) {
              blended.push(lerpColor(a, b, tEasedArr));
            } else if (a && !b) {
              // Fade out previous color toward default — keep showing previous until t=1
              blended.push(a);
            } else {
              blended.push(b);
            }
          }
          out.cellColors = blended;
        }
      }

      // 2. Swap detection: collect swaps from BOTH sources:
      //    a) Explicit AlgoSwapAction targeting this array (per-action timing)
      //    b) Heuristic detection — pairs of cells that trade values
      //       (uses the default cellValues timing)
      //    Each swap entry carries its own per-swap `t` so the renderer can
      //    animate them with independent timings. Explicit swaps win on
      //    overlap (heuristic skips indices already covered by an explicit).
      if (valuesEnabled) {
        const curValues = cur.cellValues || [];
        const prevValues = prev.cellValues || [];
        type SwapEntry = { a: number; b: number; valueA: string; valueB: string; t: number };
        const swaps: SwapEntry[] = [];
        const usedIdx = new Set<number>();

        // (a) Explicit AlgoSwapAction first — they take priority
        if (stepActions && curValues.length > 0 && prevValues.length === curValues.length) {
          for (const a of stepActions) {
            if (a.type !== 'algoSwap') continue;
            if ((a as any).disabled) continue;
            if (a.target?.kind !== 'node' || a.target.id !== cur.id) continue;
            const [ai, bi] = a.indices;
            if (
              ai < 0 || ai >= curValues.length ||
              bi < 0 || bi >= curValues.length ||
              ai === bi || usedIdx.has(ai) || usedIdx.has(bi)
            ) continue;
            // Compute per-action t
            let actionT = 1;
            if (
              localMs !== undefined &&
              stepDurationMs !== undefined &&
              stepEasing !== undefined
            ) {
              const actionDelay = a.offsetMs ?? 0;
              const actionDuration = a.durationMs ?? stepDurationMs;
              if (localMs < actionDelay) actionT = 0;
              else if (localMs >= actionDelay + actionDuration) actionT = 1;
              else actionT = applyEasing(
                (localMs - actionDelay) / Math.max(1, actionDuration),
                a.ease || stepEasing
              );
            }
            // The "from" values come from prev snapshot. Pick whichever pair
            // of values lets the swap animation reach the cur snapshot.
            // Simplest: assume prev[ai] flies to bi, prev[bi] flies to ai.
            // (If this doesn't match cur, the animation still arcs the
            // correct values past each other — the snapshot has the final
            // values, the static text renders cur after the action ends.)
            swaps.push({
              a: ai,
              b: bi,
              valueA: prevValues[ai],
              valueB: prevValues[bi],
              t: actionT,
            });
            usedIdx.add(ai);
            usedIdx.add(bi);
          }
        }

        // (b) Heuristic for any cells not covered by an explicit swap
        if (curValues.length > 0 && prevValues.length === curValues.length) {
          const heuristicT = tForProp(cur, 'cellValues');
          if (heuristicT < 1) {
            for (let i = 0; i < curValues.length; i++) {
              if (usedIdx.has(i)) continue;
              if (curValues[i] === prevValues[i]) continue;
              // Find a partner j > i where prev[i] === cur[j] && prev[j] === cur[i]
              for (let j = i + 1; j < curValues.length; j++) {
                if (usedIdx.has(j)) continue;
                if (
                  prevValues[i] === curValues[j] &&
                  prevValues[j] === curValues[i] &&
                  prevValues[i] !== prevValues[j] // skip same-value swaps
                ) {
                  swaps.push({
                    a: i,
                    b: j,
                    valueA: prevValues[i],
                    valueB: prevValues[j],
                    t: heuristicT,
                  });
                  usedIdx.add(i);
                  usedIdx.add(j);
                  break;
                }
              }
            }
          }
        }

        if (swaps.length > 0) {
          (out as any)._algoSwaps = swaps;
        }
      }

      return out;
    }

    return cur;
  });
}

/**
 * Pure sampler: evaluates the scene state at a specific time without side effects
 *
 * MODEL (Actions Only):
 * - All scalar animations come from explicit transformTween actions
 * - Actions on Step N play during Step N's duration
 * - If action has no `from`, compute it from previous step's end state
 *
 * SUPPORTS DELTA FORMAT:
 * - Step 0: Full snapshot (all nodes/edges with complete properties)
 * - Step 1+: Delta format (only nodes/properties that changed)
 * - Automatically resolves deltas when evaluating step state
 *
 * COLLECTION-PROPERTY EXCEPTION: cellColors, gridColors, and highlightedLines
 * are arrays whose shape doesn't fit in transformTween's scalar from/to model.
 * They cross-fade between snapshots automatically via applyCollectionCrossFade
 * — this is the only animation path for collection-shaped properties.
 */

function expandContainerTransformActions(
  step: Step,
  prevEndStates: Map<string, Partial<NodeModel>>,
): StepAction[] {
  const actions = step.actions;
  if (!actions || actions.length === 0) return actions || [];

  const hasContainerTransform = actions.some(a => a.type === 'containerTransform');
  if (!hasContainerTransform) return actions;

  const expanded: StepAction[] = [];
  const currentNodesById = new Map((step.nodes || []).map(n => [n.id, n]));

  // Collect all node IDs managed by containerTransform actions so we can strip redundant actions
  const managedNodeIds = new Set<string>();
  for (const action of actions) {
    if (action.type === 'containerTransform' && !(action as any).disabled) {
      const ct = action as ContainerTransformAction;
      for (const cid of ct.childIds || []) managedNodeIds.add(cid);
      for (const cid of ct.outgoingChildIds || []) managedNodeIds.add(cid);
      if (ct.variant === 'hero') {
        managedNodeIds.add(ct.target.id);
        if (ct.heroTargetId) managedNodeIds.add(ct.heroTargetId);
      }
    }
  }

  for (const action of actions) {
    if (action.type !== 'containerTransform' || (action as any).disabled) {
      // Strip redundant actions targeting nodes managed by containerTransform.
      // CT expansion handles visibility, opacity, scale, and position internally.
      if (managedNodeIds.has(action.target?.id)) {
        if (action.type === 'visibility') continue;
        if (action.type === 'transformTween') {
          const to = (action as TransformTweenAction).to;
          if (to) {
            const keys = new Set(Object.keys(to));
            const ctManaged = new Set(['opacity', 'scaleX', 'scaleY', 'x', 'y', 'w', 'h']);
            const allManaged = Array.from(keys).every(k => ctManaged.has(k));
            if (allManaged) continue;
          }
        }
      }
      expanded.push(action);
      continue;
    }

    const ct = action as ContainerTransformAction;
    const variant = ct.variant ?? 'expand';
    const containerId = ct.target.id;
    const totalDur = ct.durationMs ?? step.durationMs ?? 900;
    const baseOffset = ct.offsetMs ?? 0;
    const ease = ct.ease ?? 'ease';

    // Deduplicate childIds and outgoingChildIds
    if (ct.childIds) ct.childIds = Array.from(new Set(ct.childIds));
    if (ct.outgoingChildIds) ct.outgoingChildIds = Array.from(new Set(ct.outgoingChildIds));

    // --- Fade Through variant ---
    if (variant === 'fadeThrough') {
      // Auto-detect incoming vs outgoing from opacity changes if outgoingChildIds not specified
      let outgoing = ct.outgoingChildIds || [];
      let incoming = ct.childIds || [];
      if (outgoing.length === 0 && incoming.length > 0) {
        const autoIncoming: string[] = [];
        const autoOutgoing: string[] = [];
        for (const cid of incoming) {
          const prevOpacity = (prevEndStates.get(cid) as any)?.opacity ?? 1;
          const curOpacity = (currentNodesById.get(cid) as any)?.opacity ?? 1;
          if (prevOpacity > 0.5 && curOpacity < 0.5) {
            autoOutgoing.push(cid);
          } else if (prevOpacity < 0.5 && curOpacity > 0.5) {
            autoIncoming.push(cid);
          } else if (curOpacity > 0.5) {
            autoIncoming.push(cid);
          } else {
            autoOutgoing.push(cid);
          }
        }
        incoming = autoIncoming;
        outgoing = autoOutgoing;
      }
      const outDur = totalDur * 0.35;
      const inDur = totalDur * 0.6;
      const inOffset = baseOffset + totalDur * 0.3;

      for (let i = 0; i < outgoing.length; i++) {
        expanded.push({
          id: `${ct.id}_out_${i}`,
          type: 'visibility',
          target: { kind: 'node', id: outgoing[i] },
          mode: 'fadeOut' as any,
          durationMs: outDur,
          offsetMs: baseOffset,
          actionKind: 'exit',
        } as VisibilityAction);
        expanded.push({
          id: `${ct.id}_out_scale_${i}`,
          type: 'transformTween',
          target: { kind: 'node', id: outgoing[i] },
          to: { scaleX: 0.92, scaleY: 0.92 },
          durationMs: outDur,
          offsetMs: baseOffset,
          ease: ease as any,
        } as TransformTweenAction);
      }

      for (let i = 0; i < incoming.length; i++) {
        expanded.push({
          id: `${ct.id}_in_${i}`,
          type: 'visibility',
          target: { kind: 'node', id: incoming[i] },
          mode: 'fadeIn' as any,
          durationMs: inDur,
          offsetMs: inOffset,
          actionKind: 'entrance',
        } as VisibilityAction);
        expanded.push({
          id: `${ct.id}_in_scale_${i}`,
          type: 'transformTween',
          target: { kind: 'node', id: incoming[i] },
          from: { scaleX: 1.08, scaleY: 1.08 },
          to: { scaleX: 1, scaleY: 1 },
          durationMs: inDur,
          offsetMs: inOffset,
          ease: ease as any,
        } as TransformTweenAction);
      }
      continue;
    }

    // --- Hero variant ---
    if (variant === 'hero') {
      const sourceId = containerId;
      const destId = ct.heroTargetId;
      if (!destId) continue;

      const destNode = currentNodesById.get(destId);
      if (!destNode) continue;

      const heroTo: Record<string, any> = {};
      for (const prop of ['x', 'y', 'w', 'h', 'cornerRadius', 'fill'] as const) {
        const val = (destNode as any)[prop];
        if (val !== undefined) heroTo[prop] = val;
      }

      // Source morphs toward destination
      expanded.push({
        id: `${ct.id}_hero_morph`,
        type: 'transformTween',
        target: { kind: 'node', id: sourceId },
        to: heroTo,
        durationMs: totalDur * 0.75,
        offsetMs: baseOffset,
        ease: ease as any,
      } as TransformTweenAction);

      // Cross-fade: source out, destination in
      expanded.push({
        id: `${ct.id}_hero_src_out`,
        type: 'visibility',
        target: { kind: 'node', id: sourceId },
        mode: 'fadeOut' as any,
        durationMs: totalDur * 0.25,
        offsetMs: baseOffset + totalDur * 0.7,
        actionKind: 'exit',
      } as VisibilityAction);
      expanded.push({
        id: `${ct.id}_hero_dst_in`,
        type: 'visibility',
        target: { kind: 'node', id: destId },
        mode: 'fadeIn' as any,
        durationMs: totalDur * 0.25,
        offsetMs: baseOffset + totalDur * 0.7,
        actionKind: 'entrance',
      } as VisibilityAction);
      continue;
    }

    // --- Shape Morph variant ---
    if (variant === 'shapeMorph') {
      const targetNode = currentNodesById.get(containerId);
      const targetCR = ct.targetCornerRadius ?? (targetNode as any)?.cornerRadius ?? 0;
      expanded.push({
        id: `${ct.id}_shape`,
        type: 'transformTween',
        target: { kind: 'node', id: containerId },
        to: { cornerRadius: targetCR } as any,
        durationMs: totalDur,
        offsetMs: baseOffset,
        ease: (ease || 'ease-in-out') as any,
      } as TransformTweenAction);
      continue;
    }

    // --- Expand / Collapse variant (default) ---
    const childReveal = ct.childReveal ?? 'fade';
    const childStagger = ct.childStaggerMs ?? 50;

    const prevContainer = prevEndStates.get(containerId);
    const curContainer = currentNodesById.get(containerId);
    const prevArea = ((prevContainer?.w as number) ?? 100) * ((prevContainer?.h as number) ?? 60);
    const curArea = ((curContainer?.w as number) ?? 100) * ((curContainer?.h as number) ?? 60);
    const isExpanding = curArea >= prevArea;

    // Container morph: transformTween for w/h/x/y/cornerRadius/fill
    const morphTo: Record<string, any> = {};
    if (curContainer) {
      for (const prop of ['w', 'h', 'x', 'y', 'cornerRadius', 'fill'] as const) {
        const curVal = (curContainer as any)[prop];
        const prevVal = prevContainer ? (prevContainer as any)[prop] : undefined;
        if (curVal !== undefined && curVal !== prevVal) {
          morphTo[prop] = curVal;
        }
      }
    }

    const hasMorph = Object.keys(morphTo).length > 0;

    if (hasMorph) {
      const morphDur = isExpanding ? totalDur * 0.7 : totalDur * 0.6;
      const morphOffset = isExpanding ? baseOffset : baseOffset + totalDur * 0.4;

      expanded.push({
        id: `${ct.id}_morph`,
        type: 'transformTween',
        target: { kind: 'node', id: containerId },
        to: morphTo,
        durationMs: morphDur,
        offsetMs: morphOffset,
        ease: ease as any,
      } as TransformTweenAction);
    } else {
      // Fallback: no w/h change detected — use scale animation for visual "grow" effect
      const scaleDur = totalDur * 0.6;
      if (isExpanding) {
        expanded.push({
          id: `${ct.id}_scale`,
          type: 'transformTween',
          target: { kind: 'node', id: containerId },
          from: { scaleX: 0.85, scaleY: 0.85 },
          to: { scaleX: 1, scaleY: 1 },
          durationMs: scaleDur,
          offsetMs: baseOffset,
          ease: ease as any,
        } as TransformTweenAction);
      } else {
        expanded.push({
          id: `${ct.id}_scale`,
          type: 'transformTween',
          target: { kind: 'node', id: containerId },
          to: { scaleX: 0.85, scaleY: 0.85 },
          durationMs: scaleDur,
          offsetMs: baseOffset + totalDur * 0.4,
          ease: ease as any,
        } as TransformTweenAction);
      }
    }

    const childIds = ct.childIds || [];
    const childModeMap: Record<string, string> = {
      fade: isExpanding ? 'fadeIn' : 'fadeOut',
      slideUp: isExpanding ? 'slideInUp' : 'slideOutDown',
      slideDown: isExpanding ? 'slideInDown' : 'slideOutUp',
      slideIn: isExpanding ? 'slideInLeft' : 'slideOutRight',
    };

    const effectiveReveal = !hasMorph && childReveal === 'fade' ? 'slideUp' : childReveal;
    const mode = childModeMap[effectiveReveal] || (isExpanding ? 'fadeIn' : 'fadeOut');
    const childDur = hasMorph
      ? Math.max(200, totalDur * 0.3)
      : Math.max(300, totalDur * 0.5);

    for (let ci = 0; ci < childIds.length; ci++) {
      let childOffset: number;
      if (!hasMorph) {
        childOffset = baseOffset + ci * childStagger;
      } else if (isExpanding) {
        childOffset = baseOffset + totalDur * 0.5 + ci * childStagger;
      } else {
        childOffset = baseOffset + ci * childStagger;
      }

      expanded.push({
        id: `${ct.id}_child_${ci}`,
        type: 'visibility',
        target: { kind: 'node', id: childIds[ci] },
        mode: mode as any,
        durationMs: childDur,
        offsetMs: childOffset,
        actionKind: isExpanding ? 'entrance' : 'exit',
      } as VisibilityAction);
    }
  }

  return expanded;
}

export function evaluateAt(
  tMs: number,
  steps: readonly Step[],
  paths: Record<PathId, Path>,
  baseNodes: NodeModel[], // Base nodes for reference
  baseEdges?: EdgeModel[], // Base edges for node flow configuration (step-independent)
  skipPhantomCalculation?: boolean // Skip phantom calculation (when draw() calculates them instead)
): FrameState {
  // Handle edge cases
  if (steps.length === 0) {
    return {
      nodes: [],
      edges: [],
      flowOffset: 0,
    };
  }

  if (steps.length === 1) {
    const step = steps[0];
    // Steps are already full snapshots (normalized on load)
    const stepNodes = (step.nodes || []) as NodeModel[];
    const stepEdges = (step.edges || []) as EdgeModel[];
    let resultNodes = stepNodes.map((n) => ({ ...n }) as NodeModel);

    // Apply Step 1 actions (emphasis effects, etc.)
    if (step.actions && step.actions.length > 0) {
      const duration = step.durationMs || 900;
      const localMs = Math.min(tMs, duration);
      const expandedSingle = expandContainerTransformActions(step, new Map());
      const effectiveSingle = expandedSingle !== step.actions ? { ...step, actions: expandedSingle } : step;
      resultNodes = applyActionsToNodes(resultNodes, effectiveSingle, localMs, duration, steps, 0, paths);
    }

    return {
      nodes: resultNodes,
      edges: stepEdges.map((e) => ({ ...e }) as EdgeModel),
      flowOffset: 0,
      caption: step.caption,
      captionElapsedMs: Math.min(tMs, step.durationMs || 900),
      captionDurationMs: step.durationMs || 900,
    };
  }

  // Calculate total duration = sum of all step durations
  // Each step's duration is the time its actions play
  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);

  // IMPORTANT: When tMs lands exactly on the end boundary (tMs === totalDuration),
  // the loop below would advance `acc` to totalDuration and `localMs` becomes 0,
  // which looks like the last-step action "re-runs" for a frame.
  // For any time at or beyond the end, force the final state (end of last step).
  const clampedTMs = tMs >= totalDuration ? totalDuration : tMs;

  // Find which step we're in based on cumulative time
  let acc = 0;
  let stepIndex = 0;
  for (let i = 0; i < steps.length; i++) {
    const stepDur = steps[i].durationMs || 900;
    // Use <= here so the exact boundary resolves to the current (last) step's END,
    // not the next step's START (which doesn't exist for the last step).
    if (clampedTMs <= acc + stepDur) {
      stepIndex = i;
      break;
    }
    acc += stepDur;
    stepIndex = i; // Last step if we go past
  }

  // Clamp to valid step
  stepIndex = Math.min(stepIndex, steps.length - 1);

  const currentStep = steps[stepIndex];
  const duration = currentStep.durationMs || 900;

  // If we are at/beyond the end of the entire animation, pin to end-of-step
  const localMs =
    tMs >= totalDuration ? duration : clamp(clampedTMs - acc, 0, duration);

  // NEW MODEL: Start with previous step's END state, then apply current step's actions
  // This makes actions animate FROM previous state TO current snapshot

  // Steps are already full snapshots (normalized on load)
  const currentNodes = (currentStep.nodes || []) as NodeModel[];
  const currentEdges = (currentStep.edges || []) as EdgeModel[];
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const prevNodes = prevStep ? ((prevStep.nodes || []) as NodeModel[]) : null;

  // Build prev end states map FIRST (needed for containerTransform expansion)
  const prevEndStates = new Map<string, Partial<NodeModel>>();
  if (stepIndex > 0) {
    for (const curNode of currentNodes) {
      const prevEndState = getNodeEndState(curNode.id, stepIndex - 1, steps);
      if (prevEndState) {
        prevEndStates.set(curNode.id, prevEndState);
      }
    }
  }

  // Expand containerTransform macro actions into sub-actions BEFORE node init,
  // so setAnimationStartValues sees the expanded transformTween/visibility actions
  const expandedActions = expandContainerTransformActions(currentStep, prevEndStates);
  const effectiveStep = expandedActions !== currentStep.actions
    ? { ...currentStep, actions: expandedActions }
    : currentStep;

  // Get the starting state for this step (previous step's end state)
  let resultNodes: NodeModel[];

  if (stepIndex === 0) {
    // Step 1: Start from Step 1's snapshot (initial state)
    resultNodes = currentNodes.map((n) => ({ ...n }) as NodeModel);
  } else {
    // Step 2+: Start from previous step's END state (after actions), not just snapshot
    resultNodes = currentNodes.map((curNode) => {
      const prevEndState = prevEndStates.get(curNode.id);

      if (!prevEndState) {
        // Node didn't exist in previous step, use current snapshot
        return { ...curNode } as NodeModel;
      }

      // "instant" transition: snap to current snapshot, skip all animation
      const transition = currentStep.transitions?.[curNode.id];
      if (transition === 'instant') {
        return { ...curNode } as NodeModel;
      }

      // "fade" transition: cross-fade (fade out old, fade in new)
      if (transition === 'fade') {
        const halfDur = duration / 2;
        const delayMs = currentStep.delays?.[curNode.id] ?? 0;
        const effectiveLocal = localMs - delayMs;
        if (effectiveLocal < halfDur) {
          const fadeOutT = halfDur > 0 ? clamp(effectiveLocal / halfDur, 0, 1) : 1;
          const fadeOutEased = applyEasing(fadeOutT, currentStep.easing || 'ease');
          const node = { ...prevEndState } as NodeModel;
          node.id = curNode.id;
          node.opacity = lerp(prevEndState.opacity ?? 1, 0, fadeOutEased);
          return node;
        } else {
          const fadeInT = halfDur > 0 ? clamp((effectiveLocal - halfDur) / halfDur, 0, 1) : 1;
          const fadeInEased = applyEasing(fadeInT, currentStep.easing || 'ease');
          const node = { ...curNode } as NodeModel;
          node.opacity = lerp(0, curNode.opacity ?? 1, fadeInEased);
          return node;
        }
      }

      // Start with current step's snapshot - this is the target/end state for this step
      // Actions will animate specific properties FROM prevEndState TO the snapshot values
      const node = { ...curNode } as NodeModel;

      // Set starting values from prevEndState (not just snapshot!) for animated properties
      // This ensures animations chain correctly: step N ends at X, step N+1 starts at X
      // Uses effectiveStep.actions so expanded containerTransform sub-actions are included
      setAnimationStartValues(node, curNode, prevEndState as Partial<NodeModel> & { id: string }, effectiveStep.actions);

      return node;
    });
  }

  // Apply current step's actions to nodes (handles TransformTweenActions with custom timing)
  resultNodes = applyActionsToNodes(resultNodes, effectiveStep, localMs, duration, steps, stepIndex, paths);

  // Typewriter: a text node only shows a partial reveal while it is ACTIVELY
  // typed (a transformTween → typeProgress in THIS step). In every other step,
  // force it to full so a carried-forward typeProgress < 1 can't leave the text
  // stuck empty after the typing step. Runs here (not in applyActionsToNodes,
  // which early-returns when a step has no actions) so it applies to all steps.
  resultNodes = resultNodes.map((n) => {
    if (typeof n.typeProgress === 'number' && n.typeProgress < 1) {
      const typing = (effectiveStep.actions ?? []).some(
        (a: any) => a.type === 'transformTween' && a.target?.kind === 'node' &&
          a.target?.id === n.id && a.to?.typeProgress !== undefined && !a.disabled,
      );
      if (!typing) return { ...n, typeProgress: 1 };
    }
    return n;
  });

  // Implicit interpolation: for properties NOT covered by explicit actions,
  // smoothly interpolate from previous step's end state to current snapshot.
  // This is the AE/Figma-style default — property changes animate, not snap.
  // Uses effectiveStep so expanded containerTransform sub-actions mark their props as covered
  if (stepIndex > 0 && prevEndStates.size > 0) {
    resultNodes = applyImplicitNodeInterpolation(
      resultNodes,
      currentNodes,
      prevEndStates,
      effectiveStep,
      localMs,
      duration,
    );
  }

  // Cross-fade COLLECTION-shaped properties between snapshots (cellColors,
  // gridColors, highlightedLines). These can't fit in transformTween's scalar
  // from/to model, so they animate via this helper instead.
  if (prevNodes && stepIndex > 0) {
    const tStep = duration > 0 ? clamp(localMs / duration, 0, 1) : 1;
    const tStepEased = applyEasing(tStep, currentStep.easing || 'ease');
    resultNodes = applyCollectionCrossFade(
      resultNodes,
      prevNodes,
      tStepEased,
      localMs,
      duration,
      currentStep.easing,
      currentStep.actions,
      currentStep.transitions
    );
  }

  // NOTE: Group transform stacking is now handled by hierarchical canvas transforms in canvas-render.ts
  // Children have LOCAL coordinates relative to their parent, and the canvas rendering applies
  // parent transforms (translation, rotation, scale) to the coordinate system.
  // We should NOT modify children's local coordinates here - that would double-apply transforms.

  // Edges: Auto-interpolate between steps, with EdgeTweenAction for fine-tuned control.
  // Compute prev edges as the END state of step N-1 (snapshot + actions applied),
  // mirroring how prevEndStates is built for nodes. Without this, implicit
  // interpolation at step N would animate the edge AGAIN from the step N snapshot
  // (start state) to step N+1's snapshot, duplicating what step N-1's actions
  // already did.
  const prevEdges: EdgeModel[] | null = stepIndex > 0
    ? (((prevStep!.edges || []) as EdgeModel[]).map(
        (e) => getEdgeEndState(e.id, stepIndex - 1, steps) ?? e
      ))
    : null;
  const t = duration > 0 ? clamp(localMs / duration, 0, 1) : 1;
  const tEased = applyEasing(t, currentStep.easing || 'ease');

  // Steps are already full snapshots (normalized on load)
  let resultEdges: EdgeModel[] = currentEdges.map((curEdge) => {
    const prevEdge = prevEdges?.find((pe) => pe.id === curEdge.id);
    if (!prevEdge) {
      // No previous state — this happens at step 0 of every scene, and for
      // newly-added edges in later steps. Explicit edgeTween actions still
      // need to fire (they define their own from/to and don't depend on a
      // prev snapshot).
      const edgeActions = (currentStep.actions?.filter(
        (a) => a.type === 'edgeTween' && a.target.id === curEdge.id && !(a as any).disabled
      ) || []) as EdgeTweenAction[];

      if (edgeActions.length > 0) {
        let edge: EdgeModel = { ...curEdge } as EdgeModel;
        const isAtStepEnd = localMs >= duration;

        for (const edgeAction of edgeActions) {
          const actionDuration = edgeAction.durationMs ?? duration;
          const actionDelay = edgeAction.offsetMs ?? 0;
          const actionExtendsPastStep = actionDelay + actionDuration > duration;
          const actionHasStarted = actionDelay <= duration;
          const snapToFinal = isAtStepEnd && actionExtendsPastStep && actionHasStarted;

          if (localMs < actionDelay && !snapToFinal) {
            // Before action starts — initialize covered props to action.from
            // (or leave at curEdge defaults if action.from absent).
            if (edgeAction.from?.trim !== undefined) edge.trim = edgeAction.from.trim;
            if (edgeAction.from?.trimStart !== undefined) edge.trimStart = edgeAction.from.trimStart;
            if (edgeAction.from?.stroke !== undefined) edge.stroke = edgeAction.from.stroke;
            if (edgeAction.from?.width !== undefined) edge.width = edgeAction.from.width;
            if (edgeAction.from?.opacity !== undefined) edge.opacity = edgeAction.from.opacity;
            if (edgeAction.from?.roughness !== undefined) edge.roughness = edgeAction.from.roughness;
            if (edgeAction.from?.bowing !== undefined) edge.bowing = edgeAction.from.bowing;
          } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
            const elapsed = localMs - actionDelay;
            const actionT = elapsed / actionDuration;
            const actionTEased = applyEasing(actionT, edgeAction.ease || currentStep.easing || 'ease');

            if (edgeAction.to.trim !== undefined) {
              const fromTrim = edgeAction.from?.trim ?? curEdge.trim ?? 1;
              edge.trim = lerp(fromTrim, edgeAction.to.trim, actionTEased);
            }
            if (edgeAction.to.trimStart !== undefined) {
              const fromTrimStart = edgeAction.from?.trimStart ?? curEdge.trimStart ?? 0;
              edge.trimStart = lerp(fromTrimStart, edgeAction.to.trimStart, actionTEased);
            }
            if (edgeAction.to.stroke !== undefined) {
              const fromStroke = edgeAction.from?.stroke ?? curEdge.stroke ?? '#000000';
              edge.stroke = lerpColor(fromStroke, edgeAction.to.stroke, actionTEased);
            }
            if (edgeAction.to.width !== undefined) {
              const fromWidth = edgeAction.from?.width ?? curEdge.width ?? 1;
              edge.width = lerp(fromWidth, edgeAction.to.width, actionTEased);
            }
            if (edgeAction.to.opacity !== undefined) {
              const fromOpacity = edgeAction.from?.opacity ?? curEdge.opacity ?? 1;
              edge.opacity = lerp(fromOpacity, edgeAction.to.opacity, actionTEased);
            }
            if (edgeAction.to.roughness !== undefined) {
              const fromRoughness = edgeAction.from?.roughness ?? curEdge.roughness ?? 1;
              edge.roughness = lerp(fromRoughness, edgeAction.to.roughness, actionTEased);
            }
            if (edgeAction.to.bowing !== undefined) {
              const fromBowing = edgeAction.from?.bowing ?? curEdge.bowing ?? 1;
              edge.bowing = lerp(fromBowing, edgeAction.to.bowing, actionTEased);
            }
          } else {
            if (edgeAction.to.trim !== undefined) edge.trim = edgeAction.to.trim;
            if (edgeAction.to.trimStart !== undefined) edge.trimStart = edgeAction.to.trimStart;
            if (edgeAction.to.stroke !== undefined) edge.stroke = edgeAction.to.stroke;
            if (edgeAction.to.width !== undefined) edge.width = edgeAction.to.width;
            if (edgeAction.to.opacity !== undefined) edge.opacity = edgeAction.to.opacity;
            if (edgeAction.to.roughness !== undefined) edge.roughness = edgeAction.to.roughness;
            if (edgeAction.to.bowing !== undefined) edge.bowing = edgeAction.to.bowing;
          }
        }
        return edge;
      }

      // No explicit edgeTween — auto draw-in via trim if it's a newly added edge
      if (currentStep._addedEdgeIds?.includes(curEdge.id)) {
        const edge = { ...curEdge } as EdgeModel;
        const edgeDelay = currentStep.delays?.[curEdge.id] ?? 0;
        const effectiveLocal = localMs - edgeDelay;
        const effectiveDur = Math.max(1, duration - edgeDelay);
        const entranceT = effectiveLocal <= 0 ? 0 : effectiveLocal >= effectiveDur ? 1 : effectiveLocal / effectiveDur;
        const entranceTEased = applyEasing(entranceT, currentStep.easing || 'ease');
        const targetTrim = curEdge.trim ?? 1;
        edge.trim = lerp(0, targetTrim, entranceTEased);
        return edge;
      }
      return { ...curEdge } as EdgeModel;
    }

    // Removed edge — auto draw-out (reverse trim to 0)
    if (currentStep._removedEdgeIds?.includes(curEdge.id)) {
      const transition = currentStep.transitions?.[curEdge.id];
      if (transition !== 'instant') {
        const edge = { ...curEdge } as EdgeModel;
        const edgeDelay = currentStep.delays?.[curEdge.id] ?? 0;
        const effectiveLocal = localMs - edgeDelay;
        const effectiveDur = Math.max(1, duration - edgeDelay);
        const exitT = effectiveLocal <= 0 ? 0 : effectiveLocal >= effectiveDur ? 1 : effectiveLocal / effectiveDur;
        const exitTEased = applyEasing(exitT, currentStep.easing || 'ease');
        const fromTrim = prevEdge.trim ?? 1;
        edge.trim = lerp(fromTrim, 0, exitTEased);
        return edge;
      }
    }

    // Check per-edge transition override
    const transition = currentStep.transitions?.[curEdge.id];
    if (transition === 'instant') {
      return { ...curEdge } as EdgeModel;
    }
    if (transition === 'fade') {
      const halfDur = duration / 2;
      const edgeDelay = currentStep.delays?.[curEdge.id] ?? 0;
      const effectiveLocal = localMs - edgeDelay;
      if (effectiveLocal < halfDur) {
        const fadeOutT = halfDur > 0 ? clamp(effectiveLocal / halfDur, 0, 1) : 1;
        const fadeOutEased = applyEasing(fadeOutT, currentStep.easing || 'ease');
        const edge = { ...prevEdge } as EdgeModel;
        edge.id = curEdge.id;
        edge.opacity = lerp(prevEdge.opacity ?? 1, 0, fadeOutEased);
        return edge;
      } else {
        const fadeInT = halfDur > 0 ? clamp((effectiveLocal - halfDur) / halfDur, 0, 1) : 1;
        const fadeInEased = applyEasing(fadeInT, currentStep.easing || 'ease');
        const edge = { ...curEdge } as EdgeModel;
        edge.opacity = lerp(0, curEdge.opacity ?? 1, fadeInEased);
        return edge;
      }
    }

    // Find ALL EdgeTweenActions for this edge (there may be multiple with different timing)
    const edgeActions = (currentStep.actions?.filter(
      (a) => a.type === 'edgeTween' && a.target.id === curEdge.id && !(a as any).disabled
    ) || []) as EdgeTweenAction[];

    // Coverage: which properties are handled by explicit edgeTween actions
    const edgeCoveredProps = getCoveredProps(curEdge.id, 'edge', currentStep.actions);

    // Start from current snapshot
    let edge: EdgeModel = { ...curEdge } as EdgeModel;

    // ── Explicit edgeTween actions ──
    if (edgeActions.length > 0) {
      // Initialize covered properties from previous step values
      edgeCoveredProps.forEach(prop => {
        if ((prevEdge as any)[prop] !== undefined) {
          (edge as any)[prop] = (prevEdge as any)[prop];
        }
      });

      const isAtStepEnd = localMs >= duration;

      for (const edgeAction of edgeActions) {
        const actionDuration = edgeAction.durationMs ?? duration;
        const actionDelay = edgeAction.offsetMs ?? 0;

        const actionExtendsPastStep = actionDelay + actionDuration > duration;
        const actionHasStarted = actionDelay <= duration;
        const snapToFinal = isAtStepEnd && actionExtendsPastStep && actionHasStarted;

        if (localMs < actionDelay && !snapToFinal) {
          // Before action starts — covered properties stay at previous values
        } else if (localMs < actionDelay + actionDuration && !snapToFinal) {
          const elapsed = localMs - actionDelay;
          const actionT = elapsed / actionDuration;
          const actionTEased = applyEasing(actionT, edgeAction.ease || currentStep.easing || 'ease');

          if (edgeAction.to.trim !== undefined) {
            const fromTrim = edgeAction.from?.trim ?? prevEdge.trim ?? 1;
            edge.trim = lerp(fromTrim, edgeAction.to.trim, actionTEased);
          }
          if (edgeAction.to.trimStart !== undefined) {
            const fromTrimStart = edgeAction.from?.trimStart ?? prevEdge.trimStart ?? 0;
            edge.trimStart = lerp(fromTrimStart, edgeAction.to.trimStart, actionTEased);
          }
          if (edgeAction.to.stroke !== undefined) {
            const fromStroke = edgeAction.from?.stroke ?? prevEdge.stroke ?? '#000000';
            edge.stroke = lerpColor(fromStroke, edgeAction.to.stroke, actionTEased);
          }
          if (edgeAction.to.width !== undefined) {
            const fromWidth = edgeAction.from?.width ?? prevEdge.width ?? 1;
            edge.width = lerp(fromWidth, edgeAction.to.width, actionTEased);
          }
          if (edgeAction.to.opacity !== undefined) {
            const fromOpacity = edgeAction.from?.opacity ?? prevEdge.opacity ?? 1;
            edge.opacity = lerp(fromOpacity, edgeAction.to.opacity, actionTEased);
          }
          if (edgeAction.to.roughness !== undefined) {
            const fromRoughness = edgeAction.from?.roughness ?? prevEdge.roughness ?? 1;
            edge.roughness = lerp(fromRoughness, edgeAction.to.roughness, actionTEased);
          }
          if (edgeAction.to.bowing !== undefined) {
            const fromBowing = edgeAction.from?.bowing ?? prevEdge.bowing ?? 1;
            edge.bowing = lerp(fromBowing, edgeAction.to.bowing, actionTEased);
          }
        } else {
          if (edgeAction.to.trim !== undefined) edge.trim = edgeAction.to.trim;
          if (edgeAction.to.trimStart !== undefined) edge.trimStart = edgeAction.to.trimStart;
          if (edgeAction.to.stroke !== undefined) edge.stroke = edgeAction.to.stroke;
          if (edgeAction.to.width !== undefined) edge.width = edgeAction.to.width;
          if (edgeAction.to.opacity !== undefined) edge.opacity = edgeAction.to.opacity;
          if (edgeAction.to.roughness !== undefined) edge.roughness = edgeAction.to.roughness;
          if (edgeAction.to.bowing !== undefined) edge.bowing = edgeAction.to.bowing;
        }
      }
    }

    // ── Implicit interpolation for uncovered properties ──
    const edgeDelay = currentStep.delays?.[curEdge.id] ?? 0;
    const effectiveLocal = localMs - edgeDelay;
    const effectiveDur = Math.max(1, duration - edgeDelay);
    const edgeT = effectiveLocal <= 0 ? 0 : effectiveLocal >= effectiveDur ? 1 : effectiveLocal / effectiveDur;
    const edgeDefaultEasing = currentStep.easing || 'ease';
    const edgeTEased = applyEasing(edgeT, edgeDefaultEasing);
    const edgePropEasings = currentStep.propertyEasings;

    for (const prop of NUMERIC_EDGE_PROPS) {
      if (edgeCoveredProps.has(prop)) continue;
      const prev = (prevEdge as any)[prop];
      const cur = (curEdge as any)[prop];
      if (typeof prev === 'number' && typeof cur === 'number' && prev !== cur) {
        const t = edgePropEasings?.[prop] ? applyEasing(edgeT, edgePropEasings[prop]) : edgeTEased;
        (edge as any)[prop] = lerp(prev, cur, t);
      }
    }
    for (const prop of COLOR_EDGE_PROPS) {
      if (edgeCoveredProps.has(prop)) continue;
      const prev = (prevEdge as any)[prop];
      const cur = (curEdge as any)[prop];
      if (prev != null && cur != null && prev !== cur) {
        const t = edgePropEasings?.[prop] ? applyEasing(edgeT, edgePropEasings[prop]) : edgeTEased;
        (edge as any)[prop] = lerpColor(prev, cur, t);
      }
    }
    return edge;
  });

  // Calculate phantom nodes for edge flow animations (global, based on total elapsed time)
  // Skip if caller will calculate them separately (e.g., draw() uses performance.now())
  let phantomNodes: PhantomNode[] = [];
  if (!skipPhantomCalculation) {
    const routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'> = {};
    // Legacy nodeFlow phantoms (step-independent)
    phantomNodes = calculateEdgeFlowPhantoms(
      tMs,
      resultEdges,
      resultNodes,
      routeModeRef,
      baseEdges // Pass live edges for nodeFlow config
    );
    // PathAnimateAction phantoms (timeline-controlled)
    const pathAnimatePhantoms = calculatePathAnimatePhantoms(
      tMs,
      steps,
      resultEdges,
      resultNodes,
      routeModeRef
    );
    phantomNodes = [...phantomNodes, ...pathAnimatePhantoms];
  }

  return {
    nodes: resultNodes,
    edges: resultEdges,
    flowOffset: (tMs * 0.05) % 24, // Simple flow animation
    phantomNodes,
    caption: currentStep.caption,
    captionElapsedMs: localMs,
    captionDurationMs: duration,
  };
}

/**
 * Get the correct frame from an animated sprite at a given timestamp
 */
export function getSpriteFrameAt(
  sprite: AnimatedSprite,
  tMs: number
): ImageBitmap | VideoFrame {
  // Single frame (non-animated)
  if (sprite.totalMs === Infinity) {
    return sprite.frames[0];
  }

  // Loop mode: wrap around
  const local = tMs % sprite.totalMs;

  // Find which frame contains this timestamp
  let sum = 0;
  for (let i = 0; i < sprite.delaysMs.length; i++) {
    const d = sprite.delaysMs[i];
    if (local < sum + d) {
      return sprite.frames[i];
    }
    sum += d;
  }

  // Fallback: return last frame
  return sprite.frames[sprite.frames.length - 1];
}

// ============================================================================
// Node Flow Phantom Calculation
// ============================================================================

/**
 * Calculate phantom nodes for edge node flow (global animation).
 * This is a pure function that computes the positions of flowing nodes along edges.
 *
 * @param tMs - Current time in milliseconds
 * @param edges - Array of edges to process
 * @param nodes - Array of nodes for path calculation
 * @param routeMode - Route mode configuration for edge path calculation
 * @returns Array of phantom nodes to render
 */
export function calculateNodeFlowPhantoms(
  tMs: number,
  edges: EdgeModel[],
  nodes: NodeModel[],
  routeMode: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): PhantomNode[] {
  const phantoms: PhantomNode[] = [];

  for (const edge of edges) {
    if (!edge.nodeFlow?.enabled || !edge.nodeFlow.nodeTemplateIds?.length)
      continue;

    // Skip node flow for invisible edges (opacity 0 or very low)
    if (edge.opacity !== undefined && edge.opacity < 0.01)
      continue;

    const flow = edge.nodeFlow;
    const speed = flow.speed || 1000;
    const count = clamp(flow.count || 1, 1, 20);
    const spacing = flow.spacing || 200;
    const loop = flow.loop ?? true;
    const scale = flow.scale ?? 0.5;
    const baseOpacity = flow.opacity ?? 0.8;
    const fadeOut = flow.fadeOut ?? true;
    const offsetMs = flow.offsetMs ?? 0;

    // Apply offset - animation doesn't start until offsetMs has passed
    const adjustedTime = tMs - offsetMs;
    if (adjustedTime < 0) continue; // Not started yet

    // Use captured snapshots instead of live nodes
    const snapshots = flow.nodeSnapshots || [];

    // Check if this is a multi-edge sequence
    const isMultiEdge = flow.edgeSequence && flow.edgeSequence.length > 1;

    if (isMultiEdge) {
      // MULTI-EDGE MODE: Node travels each edge separately with fade transitions
      const edgePaths = getMultiEdgePaths(
        flow.edgeSequence!,
        edges,
        nodes,
        routeMode
      );
      if (!edgePaths || edgePaths.length === 0) continue;

      const numEdges = edgePaths.length;
      // Get per-edge speeds (fallback to default speed for each edge)
      const edgeSpeeds = flow.edgeSpeeds || edgePaths.map(() => speed);
      // Calculate cumulative durations for each edge
      const cumDurations = [0];
      for (let e = 0; e < numEdges; e++) {
        cumDurations.push(cumDurations[e] + (edgeSpeeds[e] || speed));
      }
      const totalDuration = cumDurations[numEdges];
      // Wave duration includes all edges
      const waveDuration = (count - 1) * spacing + totalDuration;

      for (const snapshot of snapshots) {
        // For loop mode: continuous time (clones wrap around)
        // For one-shot mode: waves repeat (fountain effect) using modulo
        const waveTime = loop ? adjustedTime : adjustedTime % waveDuration;

        for (let i = 0; i < count; i++) {
          const spawnTime = i * spacing;
          const cloneElapsed = waveTime - spawnTime;
          if (cloneElapsed < 0) continue;

          if (loop) {
            // In loop mode, wrap around total duration
            // But cap at the end to prevent restart glitch on final frame
            let wrappedTime = cloneElapsed % totalDuration;
            if (wrappedTime < 1 && cloneElapsed >= totalDuration) {
              wrappedTime = totalDuration - 1;
            }
            // Find which edge we're on based on cumulative durations
            let currentEdgeIndex = 0;
            for (let e = 0; e < numEdges; e++) {
              if (wrappedTime < cumDurations[e + 1]) {
                currentEdgeIndex = e;
                break;
              }
            }
            // Calculate progress within this edge (0 to 1)
            const edgeStartTime = cumDurations[currentEdgeIndex];
            const edgeDuration = edgeSpeeds[currentEdgeIndex] || speed;
            const edgeProgress = (wrappedTime - edgeStartTime) / edgeDuration;

            if (currentEdgeIndex >= numEdges) continue;

            const currentPath = edgePaths[currentEdgeIndex];
            const { points, length, cum } = currentPath;

            // Calculate position along this edge
            const targetLen = clamp(edgeProgress, 0, 1) * length;
            let pos = points[0];
            let tan = { x: 1, y: 0 };

            for (let j = 1; j < points.length; j++) {
              if (cum[j] >= targetLen) {
                const segStart = cum[j - 1];
                const segEnd = cum[j];
                const segLen = segEnd - segStart;
                const segT = segLen > 0 ? (targetLen - segStart) / segLen : 0;
                const p0 = points[j - 1];
                const p1 = points[j];
                pos = {
                  x: lerp(p0.x, p1.x, segT),
                  y: lerp(p0.y, p1.y, segT),
                };
                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const mag = Math.sqrt(dx * dx + dy * dy) || 1;
                tan = { x: dx / mag, y: dy / mag };
                break;
              }
            }

            // Fade transitions at edge boundaries
            let opacity = baseOpacity;
            const fadeZone = 0.15; // 15% of edge for fade
            if (fadeOut) {
              if (edgeProgress < fadeZone) {
                // Fade in at start of edge
                opacity = baseOpacity * (edgeProgress / fadeZone);
              } else if (edgeProgress > 1 - fadeZone) {
                // Fade out at end of edge
                opacity = baseOpacity * ((1 - edgeProgress) / fadeZone);
              }
            }

            const rotation = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

            phantoms.push({
              id: `phantom-${edge.id}-${snapshot.id}-${i}-e${currentEdgeIndex}`,
              templateId: snapshot.id,
              x: pos.x - (snapshot.w * scale) / 2,
              y: pos.y - (snapshot.h * scale) / 2,
              w: snapshot.w * scale,
              h: snapshot.h * scale,
              opacity,
              scale,
              rotation,
              fill: snapshot.fill,
              stroke: snapshot.stroke,
              strokeWidth: snapshot.strokeWidth,
              kind: snapshot.kind,
              label: snapshot.label,
              text: snapshot.text,
              imageData: snapshot.imageData,
              lottieData: snapshot.lottieData,
              svgPaths: snapshot.svgPaths,
              svgViewBox: snapshot.svgViewBox,
            });
          } else {
            // Non-loop mode: travel all edges once (one-shot fountain effect)
            if (cloneElapsed > totalDuration) continue; // Finished all edges

            // Find which edge we're on based on cumulative durations
            let currentEdgeIndex = numEdges - 1;
            for (let e = 0; e < numEdges; e++) {
              if (cloneElapsed < cumDurations[e + 1]) {
                currentEdgeIndex = e;
                break;
              }
            }
            // Calculate progress within this edge (0 to 1)
            const edgeStartTime = cumDurations[currentEdgeIndex];
            const edgeDuration = edgeSpeeds[currentEdgeIndex] || speed;
            const edgeProgress =
              (cloneElapsed - edgeStartTime) / edgeDuration;

            if (edgeProgress > 1) continue; // Between edges (shouldn't happen)

            const currentPath = edgePaths[currentEdgeIndex];
            const { points, length, cum } = currentPath;

            // Calculate position along this edge
            const targetLen = clamp(edgeProgress, 0, 1) * length;
            let pos = points[0];
            let tan = { x: 1, y: 0 };

            for (let j = 1; j < points.length; j++) {
              if (cum[j] >= targetLen) {
                const segStart = cum[j - 1];
                const segEnd = cum[j];
                const segLen = segEnd - segStart;
                const segT = segLen > 0 ? (targetLen - segStart) / segLen : 0;
                const p0 = points[j - 1];
                const p1 = points[j];
                pos = {
                  x: lerp(p0.x, p1.x, segT),
                  y: lerp(p0.y, p1.y, segT),
                };
                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const mag = Math.sqrt(dx * dx + dy * dy) || 1;
                tan = { x: dx / mag, y: dy / mag };
                break;
              }
            }

            // Fade transitions at edge boundaries
            let opacity = baseOpacity;
            const fadeZone = 0.15;
            if (fadeOut) {
              if (edgeProgress < fadeZone) {
                opacity = baseOpacity * (edgeProgress / fadeZone);
              } else if (edgeProgress > 1 - fadeZone) {
                opacity = baseOpacity * ((1 - edgeProgress) / fadeZone);
              }
            }

            const rotation = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

            phantoms.push({
              id: `phantom-${edge.id}-${snapshot.id}-${i}-e${currentEdgeIndex}`,
              templateId: snapshot.id,
              x: pos.x - (snapshot.w * scale) / 2,
              y: pos.y - (snapshot.h * scale) / 2,
              w: snapshot.w * scale,
              h: snapshot.h * scale,
              opacity,
              scale,
              rotation,
              fill: snapshot.fill,
              stroke: snapshot.stroke,
              strokeWidth: snapshot.strokeWidth,
              kind: snapshot.kind,
              label: snapshot.label,
              text: snapshot.text,
              imageData: snapshot.imageData,
              lottieData: snapshot.lottieData,
              svgPaths: snapshot.svgPaths,
              svgViewBox: snapshot.svgViewBox,
            });
          }
        }
      }
      continue; // Skip single-edge processing
    }

    // SINGLE-EDGE MODE: Original behavior
    const pathData = getNodeFlowPath(
      edge,
      edge,
      nodes,
      routeMode
    );
    if (!pathData) continue;

    let { points, length, cum } = pathData;

    // Extend path to include arrowhead offset
    const arrowOffset = edge.arrowOffset ?? 2;
    const arrow = edge.arrow || 'end';

    if (
      (arrow === 'end' || arrow === 'both') &&
      arrowOffset > 0 &&
      points.length >= 2
    ) {
      const lastPt = points[points.length - 1];
      const secondLastPt = points[points.length - 2];
      const dx = lastPt.x - secondLastPt.x;
      const dy = lastPt.y - secondLastPt.y;
      const len = Math.hypot(dx, dy) || 1;
      const extendedEnd = {
        x: lastPt.x + (dx / len) * arrowOffset,
        y: lastPt.y + (dy / len) * arrowOffset,
      };
      points = [...points, extendedEnd];
      length += arrowOffset;
      cum = [0];
      for (let j = 1; j < points.length; j++) {
        const p0 = points[j - 1];
        const p1 = points[j];
        cum.push(cum[j - 1] + Math.hypot(p1.x - p0.x, p1.y - p0.y));
      }
    }

    // For one-shot mode, calculate wave duration
    const waveDuration = (count - 1) * spacing + speed;

    for (const snapshot of snapshots) {
      // For loop mode: continuous time (clones wrap around)
      // For one-shot mode: waves repeat (fountain effect) using modulo
      const waveTime = loop ? adjustedTime : adjustedTime % waveDuration;

      for (let i = 0; i < count; i++) {
        const spawnTime = i * spacing;
        const cloneElapsed = waveTime - spawnTime;
        if (cloneElapsed < 0) continue;

        let progress = cloneElapsed / speed;
        if (loop) {
          const modProgress = progress % 1;
          // Cap at end to prevent restart glitch on final frame
          if (modProgress < 0.01 && progress >= 1) {
            progress = 0.999;
          } else {
            progress = modProgress;
          }
        } else if (progress > 1) {
          continue;
        }

        const targetLen = clamp(progress, 0, 1) * length;
        let pos = points[0];
        let tan = { x: 1, y: 0 };

        for (let j = 1; j < points.length; j++) {
          if (cum[j] >= targetLen) {
            const segStart = cum[j - 1];
            const segEnd = cum[j];
            const segLen = segEnd - segStart;
            const segT = segLen > 0 ? (targetLen - segStart) / segLen : 0;
            const p0 = points[j - 1];
            const p1 = points[j];
            pos = {
              x: lerp(p0.x, p1.x, segT),
              y: lerp(p0.y, p1.y, segT),
            };
            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            const mag = Math.sqrt(dx * dx + dy * dy) || 1;
            tan = { x: dx / mag, y: dy / mag };
            break;
          }
        }

        let opacity = baseOpacity;
        if (fadeOut && progress > 0.7) {
          opacity = baseOpacity * (1 - (progress - 0.7) / 0.3);
        }

        const rotation = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

        phantoms.push({
          id: `phantom-${edge.id}-${snapshot.id}-${i}`,
          templateId: snapshot.id,
          x: pos.x - (snapshot.w * scale) / 2,
          y: pos.y - (snapshot.h * scale) / 2,
          w: snapshot.w * scale,
          h: snapshot.h * scale,
          opacity,
          scale,
          rotation,
          fill: snapshot.fill,
          stroke: snapshot.stroke,
          strokeWidth: snapshot.strokeWidth,
          kind: snapshot.kind,
          label: snapshot.label,
          text: snapshot.text,
          imageData: snapshot.imageData,
          lottieData: snapshot.lottieData,
          svgPaths: snapshot.svgPaths,
          svgViewBox: snapshot.svgViewBox,
        });
      }
    }
  }

  return phantoms;
}

