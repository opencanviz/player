/**
 * Shared Implicit Transition Planner
 *
 * Single source of truth for:
 * - Animatable property classification (number vs color)
 * - Explicit action coverage rules (which props skip implicit interpolation)
 * - Step diffing (detecting added/removed/changed elements between steps)
 *
 * Consumed by the animation evaluator, timeline visualization, and
 * future "Convert to Action" feature.
 */

import type {
  Step,
  NodeModel,
  EdgeModel,
  StepAction,
  TransformTweenAction,
  EdgeTweenAction,
  VisibilityAction,
} from '../types';

// ─── Property Classification ──────────────────────────────────────────────────
// Properties in these lists interpolate smoothly between steps.
// Properties NOT in these lists are discrete (snap at step start).

export const NUMERIC_NODE_PROPS: readonly string[] = [
  'x', 'y', 'w', 'h', 'opacity', 'strokeWidth', 'scaleX', 'scaleY',
  'rotationX', 'rotationY', 'rotationZ', 'fontSize', 'cornerRadius',
  'strokeTrimStart', 'strokeTrimEnd', 'value', 'startAngle', 'endAngle',
  'innerRadius', 'pointDepth', 'topWidth', 'bottomWidth', 'pointerPosition',
  'pointerSize', 'roughness', 'roughFillWeight', 'arrowSize', 'arrowOffset',
  'labelFontSize', 'labelOffset', 'labelPositionT', 'pointerTargetIndex',
  'pointerTargetRow', 'pointerTargetCol', 'rangeStart', 'rangeEnd',
  'letterSpacing', 'lineHeight', 'textStrokeWidth', 'iconBgPadding',
  'pivotX', 'pivotY', 'labelPadding',
];

export const COLOR_NODE_PROPS: readonly string[] = [
  'fill', 'stroke', 'progressColor', 'color', 'labelColor',
  'cylinderTopFill', 'iconBg', 'pointerColor', 'rangeColor',
  'textStroke', 'varColor', 'varNameColor',
];

export const NUMERIC_EDGE_PROPS: readonly string[] = [
  'trim', 'trimStart', 'width', 'opacity', 'roughness', 'bowing',
  'arrowSize', 'arrowOffset', 'labelFontSize', 'labelOffset',
  'labelPositionT', 'cornerRadius', 'labelBgPadding',
  'labelOffsetX', 'labelOffsetY',
];

export const COLOR_EDGE_PROPS: readonly string[] = [
  'stroke', 'labelColor', 'labelBgColor',
];

// Pre-built lookup sets for O(1) classification
const NUMERIC_NODE_SET = new Set(NUMERIC_NODE_PROPS);
const COLOR_NODE_SET = new Set(COLOR_NODE_PROPS);
const NUMERIC_EDGE_SET = new Set(NUMERIC_EDGE_PROPS);
const COLOR_EDGE_SET = new Set(COLOR_EDGE_PROPS);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValueKind = 'number' | 'color';

export interface PropertyChange {
  prop: string;
  from: number | string;
  to: number | string;
  valueKind: ValueKind;
}

export interface TargetTransition {
  targetId: string;
  targetKind: 'node' | 'edge';
  changes: PropertyChange[];
  coveredProps: ReadonlySet<string>;
  isEntering: boolean;
  isExiting: boolean;
}

export interface TransitionPlan {
  stepIndex: number;
  addedNodeIds: readonly string[];
  removedNodeIds: readonly string[];
  addedEdgeIds: readonly string[];
  removedEdgeIds: readonly string[];
  nodeTransitions: ReadonlyMap<string, TargetTransition>;
  edgeTransitions: ReadonlyMap<string, TargetTransition>;
}

// ─── Coverage Rules ───────────────────────────────────────────────────────────

/**
 * Compute the set of properties covered by explicit actions for a target.
 * Implicit interpolation skips these properties.
 */
export function getCoveredProps(
  targetId: string,
  targetKind: 'node' | 'edge',
  actions: readonly StepAction[] | undefined,
): Set<string> {
  const covered = new Set<string>();
  if (!actions) return covered;

  for (const action of actions) {
    if ((action as any).disabled) continue;
    if (action.target.kind !== targetKind || action.target.id !== targetId) continue;

    switch (action.type) {
      case 'transformTween': {
        const ta = action as TransformTweenAction;
        if (ta.to) {
          for (const key of Object.keys(ta.to)) {
            covered.add(key);
          }
        }
        break;
      }
      case 'visibility': {
        covered.add('opacity');
        const va = action as VisibilityAction;
        if (va.mode.startsWith('slideIn') || va.mode.startsWith('slideOut')) {
          covered.add('x');
          covered.add('y');
        }
        break;
      }
      case 'positionTween':
      case 'pathFollow':
      case 'pathAnimate':
        covered.add('x');
        covered.add('y');
        break;
      case 'edgeTween': {
        const ea = action as EdgeTweenAction;
        if (ea.to) {
          for (const key of Object.keys(ea.to)) {
            covered.add(key);
          }
        }
        break;
      }
    }
  }

  return covered;
}

// ─── Property Classification Helper ───────────────────────────────────────────

export function classifyProp(
  prop: string,
  targetKind: 'node' | 'edge',
): ValueKind | null {
  if (targetKind === 'node') {
    if (NUMERIC_NODE_SET.has(prop)) return 'number';
    if (COLOR_NODE_SET.has(prop)) return 'color';
  } else {
    if (NUMERIC_EDGE_SET.has(prop)) return 'number';
    if (COLOR_EDGE_SET.has(prop)) return 'color';
  }
  return null;
}

// ─── Transition Plan Builder ──────────────────────────────────────────────────

/**
 * Build a TransitionPlan for the transition INTO stepIndex.
 *
 * @param stepIndex       Must be >= 1 (step 0 has no transition into it)
 * @param currentStep     The current step (full snapshot)
 * @param prevEndNodes    Map of nodeId -> end state after previous step's actions
 * @param prevEndEdges    Previous step's edge array (end state)
 */
export function buildTransitionPlan(
  stepIndex: number,
  currentStep: Step,
  prevEndNodes: ReadonlyMap<string, Partial<NodeModel>>,
  prevEndEdges: readonly EdgeModel[],
): TransitionPlan {
  const currentNodes = (currentStep.nodes || []) as readonly NodeModel[];
  const currentEdges = (currentStep.edges || []) as readonly EdgeModel[];

  // Detect added/removed
  const prevNodeIds = new Set(prevEndNodes.keys());
  const curNodeIds = new Set(currentNodes.map(n => n.id));
  const prevEdgeIds = new Set(prevEndEdges.map(e => e.id));
  const curEdgeIds = new Set(currentEdges.map(e => e.id));

  // Use metadata if available (includes re-inserted removed elements), else derive
  const addedNodeIds = currentStep._addedNodeIds
    ?? Array.from(curNodeIds).filter(id => !prevNodeIds.has(id));
  const removedNodeIds = currentStep._removedNodeIds
    ?? Array.from(prevNodeIds).filter(id => !curNodeIds.has(id));
  const addedEdgeIds = currentStep._addedEdgeIds
    ?? Array.from(curEdgeIds).filter(id => !prevEdgeIds.has(id));
  const removedEdgeIds = currentStep._removedEdgeIds
    ?? Array.from(prevEdgeIds).filter(id => !curEdgeIds.has(id));

  const addedNodeSet = new Set(addedNodeIds);
  const removedNodeSet = new Set(removedNodeIds);
  const addedEdgeSet = new Set(addedEdgeIds);
  const removedEdgeSet = new Set(removedEdgeIds);

  // Build node transitions
  const nodeTransitions = new Map<string, TargetTransition>();
  for (const curNode of currentNodes) {
    const covered = getCoveredProps(curNode.id, 'node', currentStep.actions);
    const isEntering = addedNodeSet.has(curNode.id);
    const isExiting = removedNodeSet.has(curNode.id);
    const prevEnd = prevEndNodes.get(curNode.id);

    const changes: PropertyChange[] = [];
    if (prevEnd && !isEntering) {
      for (const prop of NUMERIC_NODE_PROPS) {
        const prev = (prevEnd as any)[prop];
        const cur = (curNode as any)[prop];
        if (typeof prev === 'number' && typeof cur === 'number' && prev !== cur) {
          changes.push({ prop, from: prev, to: cur, valueKind: 'number' });
        }
      }
      for (const prop of COLOR_NODE_PROPS) {
        const prev = (prevEnd as any)[prop];
        const cur = (curNode as any)[prop];
        if (prev != null && cur != null && prev !== cur) {
          changes.push({ prop, from: prev, to: cur, valueKind: 'color' });
        }
      }
    }

    if (changes.length > 0 || isEntering || isExiting) {
      nodeTransitions.set(curNode.id, {
        targetId: curNode.id,
        targetKind: 'node',
        changes,
        coveredProps: covered,
        isEntering,
        isExiting,
      });
    }
  }

  // Build edge transitions
  const edgeTransitions = new Map<string, TargetTransition>();
  const prevEdgeMap = new Map(prevEndEdges.map(e => [e.id, e]));
  for (const curEdge of currentEdges) {
    const covered = getCoveredProps(curEdge.id, 'edge', currentStep.actions);
    const isEntering = addedEdgeSet.has(curEdge.id);
    const isExiting = removedEdgeSet.has(curEdge.id);
    const prevEdge = prevEdgeMap.get(curEdge.id);

    const changes: PropertyChange[] = [];
    if (prevEdge && !isEntering) {
      for (const prop of NUMERIC_EDGE_PROPS) {
        const prev = (prevEdge as any)[prop];
        const cur = (curEdge as any)[prop];
        if (typeof prev === 'number' && typeof cur === 'number' && prev !== cur) {
          changes.push({ prop, from: prev, to: cur, valueKind: 'number' });
        }
      }
      for (const prop of COLOR_EDGE_PROPS) {
        const prev = (prevEdge as any)[prop];
        const cur = (curEdge as any)[prop];
        if (prev != null && cur != null && prev !== cur) {
          changes.push({ prop, from: prev, to: cur, valueKind: 'color' });
        }
      }
    }

    if (changes.length > 0 || isEntering || isExiting) {
      edgeTransitions.set(curEdge.id, {
        targetId: curEdge.id,
        targetKind: 'edge',
        changes,
        coveredProps: covered,
        isEntering,
        isExiting,
      });
    }
  }

  return {
    stepIndex,
    addedNodeIds,
    removedNodeIds,
    addedEdgeIds,
    removedEdgeIds,
    nodeTransitions,
    edgeTransitions,
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let planCache = new Map<number, TransitionPlan>();
let planCacheVersion = -1;

export function clearTransitionPlanCache(): void {
  planCache.clear();
  planCacheVersion = -1;
}

/**
 * Get or build a TransitionPlan with caching.
 *
 * @param stepIndex  Step to build the plan for (must be >= 1)
 * @param steps      All steps (full snapshots)
 * @param version    Monotonic counter — cache invalidates when this changes
 * @param getNodeEndStateFn  Function to compute a node's end state for a given step
 *                           (injected to avoid circular dependency with animation-utils)
 */
export function getTransitionPlan(
  stepIndex: number,
  steps: readonly Step[],
  version: number,
  getNodeEndStateFn: (nodeId: string, stepIdx: number, allSteps: readonly Step[]) => Partial<NodeModel> | null,
): TransitionPlan | null {
  if (stepIndex < 1 || stepIndex >= steps.length) return null;

  if (version !== planCacheVersion) {
    planCache = new Map();
    planCacheVersion = version;
  }

  const cached = planCache.get(stepIndex);
  if (cached) return cached;

  const currentStep = steps[stepIndex];
  const prevStep = steps[stepIndex - 1];

  // Build prev end states for nodes
  const prevEndNodes = new Map<string, Partial<NodeModel>>();
  const prevStepNodes = (prevStep.nodes || []) as readonly NodeModel[];
  for (const node of prevStepNodes) {
    const endState = getNodeEndStateFn(node.id, stepIndex - 1, steps);
    if (endState) prevEndNodes.set(node.id, endState);
  }

  const prevEndEdges = (prevStep.edges || []) as readonly EdgeModel[];

  const plan = buildTransitionPlan(stepIndex, currentStep, prevEndNodes, prevEndEdges);

  if (planCache.size > 100) {
    const firstKey = planCache.keys().next().value;
    if (firstKey !== undefined) planCache.delete(firstKey);
  }
  planCache.set(stepIndex, plan);

  return plan;
}
