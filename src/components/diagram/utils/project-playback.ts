/**
 * Project-level playback driver.
 *
 * Routes a global clock to per-scene evaluateAt calls. Supports optional
 * crossfade transitions at scene boundaries via evaluateProjectComposition.
 */

import type { Project, Diagram, FrameState, Step, PathId, Path, NodeModel, EdgeModel, SceneTransition } from '../types';
import { evaluateAt } from './animation-utils';
import { captionAnchorStep } from './caption-text';
import { calculateTotalDuration } from './editor-utils';
import { calculateNarratedDuration, assembleNarrationTrack, mixSceneAudioBuffers, computeEffectiveDurations } from './narration-assembly';

export type SceneSlice = {
  startMs: number;
  durationMs: number;
  /** Raw animation duration (without narration stretch) for visual evaluation clamping */
  animationDurationMs: number;
  sceneIndex: number;
};

export type ProjectTimeline = {
  slices: SceneSlice[];
  totalDurationMs: number;
};

/** Scene duration: narrated (with stretch-to-fit) if narration exists, else raw. */
function sceneDurationMs(diagram: Diagram): number {
  if (diagram.narration?.length) {
    return calculateNarratedDuration(diagram.steps, [...diagram.edges], diagram.narration);
  }
  return calculateTotalDuration(diagram.steps, [...diagram.edges]);
}

/** Raw animation duration (no narration stretch) for visual clamping. */
function sceneAnimationDurationMs(diagram: Diagram): number {
  return calculateTotalDuration(diagram.steps, [...diagram.edges]);
}

/** Build a flat timeline of scene slices — each scene plays sequentially (hard cuts). */
export function buildProjectTimeline(project: Project): ProjectTimeline {
  const slices: SceneSlice[] = [];
  let cursor = 0;

  for (let i = 0; i < project.diagrams.length; i++) {
    const dur = sceneDurationMs(project.diagrams[i]);
    const animDur = sceneAnimationDurationMs(project.diagrams[i]);
    slices.push({ startMs: cursor, durationMs: dur, animationDurationMs: animDur, sceneIndex: i });
    cursor += dur;
  }

  return { slices, totalDurationMs: cursor };
}

/**
 * Remap a scene-local time (in the narration-STRETCHED timeline) to the equivalent visual time
 * (RAW animation timeline) plus the caption window for the active step.
 *
 * Audio is placed at stretch-to-fit offsets (each step held to max(animation, narration audio)),
 * but the visual animations should still play at their authored speed. So within each step the
 * animation plays over its raw duration then HOLDS, while the step (and its caption) stays active
 * for the full stretched window — keeping captions in lockstep with the audio. No-op for scenes
 * with no longer-than-animation narration (effective durations == raw).
 */
function remapNarratedTime(
  scene: Diagram,
  localT: number,
): { visualT: number; captionElapsedMs: number; captionDurationMs: number; stepIndex: number } {
  const steps = scene.steps;
  const eff = scene.narration?.length
    ? computeEffectiveDurations(steps, scene.narration)
    : steps.map((s) => s.durationMs || 900);
  let holdAcc = 0;
  let rawAcc = 0;
  for (let i = 0; i < steps.length; i++) {
    const raw = steps[i].durationMs || 900;
    const hold = eff[i] ?? raw;
    if (localT < holdAcc + hold || i === steps.length - 1) {
      const within = Math.max(0, localT - holdAcc);
      // A silent hold step repeating the previous caption keeps that caption's clock (and its
      // word spans), so it holds the closing chunk instead of restarting at the first one.
      const hasClip = (k: number) => !!scene.narration?.some((cl) => cl.stepIndex === k && (cl.text || '').trim());
      const a = captionAnchorStep(steps, i, hasClip);
      const capHold = eff[a] ?? (steps[a].durationMs || 900);
      return {
        visualT: rawAcc + Math.min(within, raw), // animate over raw, then hold
        // caption chunk timing spans the audio
        captionElapsedMs: a === i ? Math.min(within, hold) : capHold + within,
        captionDurationMs: a === i ? hold : capHold,
        stepIndex: a,
      };
    }
    holdAcc += hold;
    rawAcc += raw;
  }
  return {
    visualT: localT,
    captionElapsedMs: localT,
    captionDurationMs: steps[steps.length - 1]?.durationMs || 900,
    stepIndex: Math.max(0, steps.length - 1),
  };
}

/**
 * Evaluate the project at a global time, returning the FrameState for whichever
 * scene is active at that moment. Hard cuts: no blending between scenes.
 */
export function evaluateProjectAt(
  tMs: number,
  project: Project,
  timeline?: ProjectTimeline,
): FrameState {
  const tl = timeline ?? buildProjectTimeline(project);

  if (tl.slices.length === 0) {
    return { nodes: [], edges: [], flowOffset: 0 };
  }

  // Clamp to [0, totalDurationMs]
  const clamped = Math.max(0, Math.min(tMs, tl.totalDurationMs));

  // Find active slice
  let slice = tl.slices[0];
  for (const s of tl.slices) {
    if (clamped >= s.startMs && clamped < s.startMs + s.durationMs) {
      slice = s;
      break;
    }
    // If we're past this slice, move to the next
    if (clamped >= s.startMs + s.durationMs) {
      slice = s; // keep updating — last one wins if we're at the very end
    }
  }

  const scene = project.diagrams[slice.sceneIndex];
  const localT = clamped - slice.startMs;

  // Per-step stretch-to-fit: animations hold at their final frame while narration finishes,
  // and the caption stays on its step (synced to the audio) instead of racing ahead.
  const { visualT, captionElapsedMs, captionDurationMs, stepIndex: capStep } = remapNarratedTime(scene, localT);
  const frame = evaluateAt(
    visualT,
    scene.steps,
    scene.paths ?? {},
    [...scene.nodes],
    [...scene.edges],
  );
  frame.captionElapsedMs = captionElapsedMs;
  frame.captionDurationMs = captionDurationMs;
  // Per-word spans for the active step, so exported captions highlight on the voice.
  frame.captionWords = scene.narration?.find((cl) => cl.stepIndex === capStep)?.words;
  return frame;
}

/**
 * Evaluate a specific scene at its local time. Used by composition for both sides of a crossfade.
 *
 * `localT` is scene-local time on the NARRATION-STRETCHED timeline (the same clock the slices are
 * laid out on); the returned `visualT` is the corresponding RAW animation time. Callers want both:
 * the frame comes from the visual time, and so does anything else keyed off the authored timeline
 * (camera lookup, per-node float phase) — feeding those a stretched time reads the wrong step.
 */
function evaluateSceneAt(scene: Diagram, localT: number): { frame: FrameState; visualT: number } {
  const { visualT, captionElapsedMs, captionDurationMs, stepIndex: capStep } = remapNarratedTime(scene, Math.max(0, localT));
  const frame = evaluateAt(
    visualT,
    scene.steps,
    scene.paths ?? {},
    [...scene.nodes],
    [...scene.edges],
  );
  frame.captionElapsedMs = captionElapsedMs;
  frame.captionDurationMs = captionDurationMs;
  // Per-word spans for the active step, so exported captions highlight on the voice.
  frame.captionWords = scene.narration?.find((cl) => cl.stepIndex === capStep)?.words;
  return { frame, visualT };
}

export type ProjectComposition =
  | {
      kind: 'single';
      frame: FrameState;
      sceneIndex: number;
      /** Scene-local time used to evaluate the frame. Useful for camera lookup. */
      localT: number;
    }
  | {
      kind: 'crossfade';
      from: FrameState;
      to: FrameState;
      fromSceneIndex: number;
      toSceneIndex: number;
      /** Scene-local times for from/to. Useful for per-scene camera lookup. */
      fromLocalT: number;
      toLocalT: number;
      /** 0 = fully `from`, 1 = fully `to`. */
      alpha: number;
      /** Boundary transition style (crossfade or a slide direction). The
       *  composition always returns kind:'crossfade' for the two-scene case;
       *  this tells the renderer HOW to combine them (alpha-blend vs slide). */
      transitionKind: SceneTransition['kind'];
      /** The transition's own colour, for the kinds that paint one (`colorWipe*`). */
      transitionColor?: string;
    };

/**
 * Evaluate the project at a global time, returning either a single frame or a
 * crossfade pair if `tMs` lands inside a transition window. The crossfade window
 * for the boundary between slice i and slice i+1 is centered on the boundary:
 * `[boundary - dur/2, boundary + dur/2]`. Outside transitions this behaves
 * identically to evaluateProjectAt.
 */
export function evaluateProjectComposition(
  tMs: number,
  project: Project,
  timeline?: ProjectTimeline,
): ProjectComposition {
  const tl = timeline ?? buildProjectTimeline(project);

  if (tl.slices.length === 0) {
    return {
      kind: 'single',
      frame: { nodes: [], edges: [], flowOffset: 0 },
      sceneIndex: 0,
      localT: 0,
    };
  }

  const clamped = Math.max(0, Math.min(tMs, tl.totalDurationMs));

  // Find the slice that owns `clamped`. Same logic as evaluateProjectAt.
  let activeIdx = 0;
  for (let i = 0; i < tl.slices.length; i++) {
    const s = tl.slices[i];
    if (clamped >= s.startMs && clamped < s.startMs + s.durationMs) {
      activeIdx = i;
      break;
    }
    if (clamped >= s.startMs + s.durationMs) {
      activeIdx = i; // last wins at the very end
    }
  }

  const transitions = project.transitions ?? [];

  // Check whether `clamped` lands inside a transition window centered on a slice boundary.
  // Boundary `b` lives between slice b and slice b+1 — we check both b = activeIdx-1
  // (we're in the back half) and b = activeIdx (we're in the front half).
  const candidates: number[] = [];
  if (activeIdx > 0) candidates.push(activeIdx - 1);
  if (activeIdx < tl.slices.length - 1) candidates.push(activeIdx);

  for (const b of candidates) {
    const tx = transitions[b];
    if (!tx || tx.durationMs <= 0) continue;
    const boundary = tl.slices[b].startMs + tl.slices[b].durationMs;
    const half = tx.durationMs / 2;
    const winStart = boundary - half;
    const winEnd = boundary + half;
    if (clamped < winStart || clamped >= winEnd) continue;

    const fromSlice = tl.slices[b];
    const toSlice = tl.slices[b + 1];
    // Both sides are evaluated from STRETCHED scene-local time and hand back the raw visual time,
    // exactly as the single-frame path below does. The outgoing side used to be pre-clamped to the
    // raw animation duration and then remapped a second time, which mixes two clocks: on a scene
    // whose narration runs longer than its animation the clamp landed mid-timeline and the remap
    // walked that as if it were audio time, so the last step never resolved. Visible as the intro
    // brand mark completing its exit and then SNAPPING back to full size for the crossfade.
    const fromRes = evaluateSceneAt(project.diagrams[fromSlice.sceneIndex], clamped - fromSlice.startMs);
    const toRes = evaluateSceneAt(project.diagrams[toSlice.sceneIndex], clamped - toSlice.startMs);
    const fromLocalT = fromRes.visualT;
    const toLocalT = toRes.visualT;
    const alpha = (clamped - winStart) / tx.durationMs;

    return {
      kind: 'crossfade',
      from: fromRes.frame,
      to: toRes.frame,
      fromSceneIndex: fromSlice.sceneIndex,
      toSceneIndex: toSlice.sceneIndex,
      fromLocalT,
      toLocalT,
      alpha: Math.max(0, Math.min(1, alpha)),
      transitionKind: tx.kind ?? 'crossfade',
      transitionColor: tx.color,
    };
  }

  // No transition active — single-frame path.
  const slice = tl.slices[activeIdx];
  const scene = project.diagrams[slice.sceneIndex];
  const localT = clamped - slice.startMs;
  const { visualT, captionElapsedMs, captionDurationMs, stepIndex: capStep } = remapNarratedTime(scene, localT);
  const frame = evaluateAt(
    visualT,
    scene.steps,
    scene.paths ?? {},
    [...scene.nodes],
    [...scene.edges],
  );
  frame.captionElapsedMs = captionElapsedMs;
  frame.captionDurationMs = captionDurationMs;
  // Per-word spans for the active step, so exported captions highlight on the voice.
  frame.captionWords = scene.narration?.find((cl) => cl.stepIndex === capStep)?.words;
  return { kind: 'single', frame, sceneIndex: slice.sceneIndex, localT: visualT };
}

// ---------- morph transition (shared-element match cut) ----------

const easeInOutMorph = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const lerpNum = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Blend two colors. Non-hex values (gradients, 'transparent') can't lerp —
 *  snap at the midpoint so the switch hides inside the motion. */
function lerpColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
  if (a === b) return a;
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const c = pa.map((v, i) => Math.round(lerpNum(v, pb[i], t)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(s: string | undefined): number[] | null {
  if (!s || !s.startsWith('#')) return null;
  let h = s.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Blend two scene frames into ONE morphed frame (the 'morph' transition).
 *
 * Nodes are paired by `morphKey` (falling back to id — ids are scene-prefixed,
 * so cross-scene pairs normally need explicit keys). Paired nodes tween
 * geometry/colors with an ease-in-out; everything unpaired crossfades
 * (from-only fades out, to-only fades in). Edges pair by id only.
 *
 * The result renders with a single drawScene call — the match cut IS the frame,
 * so node glows, captions, and z-ordering all stay consistent.
 */
export function morphFrames(from: FrameState, to: FrameState, alpha: number): FrameState {
  const e = easeInOutMorph(Math.max(0, Math.min(1, alpha)));
  const key = (n: NodeModel): string => n.morphKey ?? n.id;
  const toByKey = new Map(to.nodes.map((n) => [key(n), n]));
  const paired = new Set<string>();
  const nodes: NodeModel[] = [];

  for (const fn of from.nodes) {
    const k = key(fn);
    const tn = toByKey.get(k);
    if (tn) {
      paired.add(k);
      // Base props (label/text/kind/z) switch at the midpoint, hidden inside
      // the motion; geometry + colors tween continuously.
      const base = alpha < 0.5 ? fn : tn;
      nodes.push({
        ...base,
        x: lerpNum(fn.x, tn.x, e),
        y: lerpNum(fn.y, tn.y, e),
        w: lerpNum(fn.w, tn.w, e),
        h: lerpNum(fn.h, tn.h, e),
        scaleX: lerpNum(fn.scaleX ?? 1, tn.scaleX ?? 1, e),
        scaleY: lerpNum(fn.scaleY ?? 1, tn.scaleY ?? 1, e),
        opacity: lerpNum(fn.opacity ?? 1, tn.opacity ?? 1, alpha),
        fill: lerpColor(fn.fill, tn.fill, e),
        stroke: lerpColor(fn.stroke, tn.stroke, e),
        fontSize: fn.fontSize !== undefined && tn.fontSize !== undefined
          ? lerpNum(fn.fontSize, tn.fontSize, e)
          : base.fontSize,
      });
    } else {
      nodes.push({ ...fn, opacity: (fn.opacity ?? 1) * (1 - alpha) });
    }
  }
  for (const tn of to.nodes) {
    if (!paired.has(key(tn))) nodes.push({ ...tn, opacity: (tn.opacity ?? 1) * alpha });
  }

  const toEdge = new Map(to.edges.map((ed) => [ed.id, ed]));
  const pairedE = new Set<string>();
  const edges: EdgeModel[] = [];
  for (const fe of from.edges) {
    const te = toEdge.get(fe.id);
    if (te) {
      pairedE.add(fe.id);
      edges.push({ ...te, opacity: lerpNum(fe.opacity ?? 1, te.opacity ?? 1, alpha) });
    } else {
      edges.push({ ...fe, opacity: (fe.opacity ?? 1) * (1 - alpha) });
    }
  }
  for (const te of to.edges) {
    if (!pairedE.has(te.id)) edges.push({ ...te, opacity: (te.opacity ?? 1) * alpha });
  }

  const lead = alpha < 0.5 ? from : to;
  return {
    nodes,
    edges,
    flowOffset: lead.flowOffset,
    phantomNodes: lead.phantomNodes,
    caption: lead.caption,
    captionElapsedMs: lead.captionElapsedMs,
    captionDurationMs: lead.captionDurationMs,
    captionWords: lead.captionWords,
  };
}

/**
 * Convenience: wrap a legacy flat diagram (nodes/edges/steps/paths + artboard)
 * into a single-scene Project.
 */
export function wrapLegacyDiagram(data: {
  artboard: Project['artboard'];
  nodes: NodeModel[];
  edges: EdgeModel[];
  steps: Step[];
  paths?: Record<PathId, Path>;
}): Project {
  return {
    artboard: data.artboard,
    diagrams: [
      {
        nodes: data.nodes,
        edges: data.edges,
        steps: data.steps,
        paths: data.paths,
      },
    ],
    sceneNames: ['Scene 1'],
  };
}

/**
 * Assemble the full project narration into a single audio track (base64 WAV
 * data URL + duration). Mirrors the video-export assembly: per-scene tracks
 * mixed at their timeline offsets. Returns null if there is no narration.
 *
 * Used by the MP4 export and by AI-avatar generation (the avatar lip-syncs to
 * this exact audio, so timing matches the rendered video).
 */
export async function assembleProjectNarration(
  project: Project,
): Promise<{ audioData: string; durationMs: number } | null> {
  const timeline = buildProjectTimeline(project);
  if (project.diagrams.length > 1) {
    const sceneAudios: Array<{ audioData: string; offsetMs: number; durationMs: number }> = [];
    for (const slice of timeline.slices) {
      const scene = project.diagrams[slice.sceneIndex];
      if (!scene.narration?.length) continue;
      const assembled = await assembleNarrationTrack(scene.narration, scene.steps, [...scene.edges]);
      if (assembled) {
        sceneAudios.push({ audioData: assembled.audioData, offsetMs: slice.startMs, durationMs: assembled.durationMs });
      }
    }
    if (!sceneAudios.length) return null;
    return await mixSceneAudioBuffers(sceneAudios, timeline.totalDurationMs);
  }
  const scene = project.diagrams[0];
  if (!scene?.narration?.length) return null;
  return await assembleNarrationTrack(scene.narration, scene.steps, [...scene.edges]);
}
