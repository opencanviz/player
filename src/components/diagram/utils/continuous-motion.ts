/**
 * Continuous motion — the small, endless movement a figure or a prop keeps up for as long as it is
 * on screen, underneath whatever the step timeline is doing to it.
 *
 * Two vocabularies live here.
 *
 * The ORIGINAL FOUR (bounce / pulse / shake / breathe) came from the diagram editor. Every one of
 * them is a slide, a scale or an opacity fade of the whole node box, on a ping-pong ramp. Their
 * numbers are reproduced here EXACTLY as they were, because saved projects depend on them.
 *
 * The DRAWN VOCABULARY (sway / wobble / tremble / bob / nod / jiggle / throb / drift / flip) was
 * added for drawn scenes, where the thing being moved is a person or an object someone drew. It
 * differs from the original four in three ways that matter:
 *
 *  1. It can TURN. A person swaying, a nervous tremble, an excited little dance are all rotations,
 *     and a rotation is nothing without a pivot in the right place. A figure turns about its FEET,
 *     a nod turns about the neck. Turning about the middle of the box makes a person look like a
 *     compass needle.
 *  2. It is measured off the DRAWING, not the box. A plate is a square with the drawing somewhere
 *     inside it and a great deal of transparent margin all round. A slide sized as a fraction of
 *     the box is a fraction of mostly nothing, so the same number moves a big drawing and a small
 *     one by wildly different visible amounts. `inkBox` (stamped by the backend, fractions of the
 *     node box) is where the drawing actually is.
 *  3. It carries a PHASE. Two figures given the same motion at the same phase move as one object,
 *     which reads as a rendering fault rather than as two people. Whoever assigns the motion gives
 *     each figure its own phase.
 *
 * These move on a SINE rather than the original ramp: a swing has to slow at the ends and reverse
 * smoothly, and the ramp's ease-in-out still arrives at the turn with speed.
 *
 * This module is shared on purpose. The editor preview and the exported video are two separate
 * render paths, and a motion implemented in only one of them is a motion the customer never sees.
 */

import type { NodeModel } from '../types';

/** Where the ink actually is, as fractions of the node box. Whole box when nothing says otherwise. */
export function inkRect(node: NodeModel): { x: number; y: number; w: number; h: number } {
  const ink = (node as unknown as { inkBox?: { x: number; y: number; w: number; h: number } }).inkBox;
  if (
    ink &&
    Number.isFinite(ink.w) && Number.isFinite(ink.h) &&
    ink.w > 0.02 && ink.h > 0.02
  ) {
    return ink;
  }
  return { x: 0, y: 0, w: 1, h: 1 };
}

interface Preset {
  /** Peak turn in degrees at intensity 1. */
  rot?: number;
  /** Peak sideways slide as a fraction of the DRAWING's width at intensity 1. */
  dx?: number;
  /** Peak up-down slide as a fraction of the DRAWING's height at intensity 1. */
  dy?: number;
  /** Peak scale departure from 1 at intensity 1. */
  scale?: number;
  /** Where down the drawing the turn happens: 0 = top of the ink, 1 = the feet. */
  pivot?: number;
  /** Multiplier on the cycle length. Below 1 is faster than the stated speed. */
  beat?: number;
  /** Amount of a second, double-rate wobble mixed in, which is what stops a swing reading mechanical. */
  harmonic?: number;
  /** Slide the sideways and up-down components a quarter turn apart, so the thing traces a loop. */
  orbit?: boolean;
}

/**
 * The vocabulary. These words are a CONTRACT with whatever decides the motion — on the backend,
 * `_MOTIONS` in the art-direction brief. A word only one side knows silently does nothing at all.
 */
export const MOTION_PRESETS: Record<string, Preset> = {
  // A standing figure's weight shifting. The default for a person who is simply present.
  sway:    { rot: 3.2,  pivot: 1,    beat: 1,    harmonic: 0.25 },
  // Bigger and looser than a sway: unsteady, tipsy, about to fall over.
  wobble:  { rot: 7,    pivot: 1,    beat: 0.55, dx: 0.012 },
  // Fear. Quicker than anything else here, small, and mostly sideways.
  //
  // It used to run at 0.12, which is roughly five quivers a second, and at that rate the figure
  // stops reading as frightened and starts reading as a frame the renderer failed to draw. Real
  // shivering IS that fast, but a shiver on a living body is a hundred small movements at once,
  // and all a flat drawing can do is slide the whole picture back and forth. Slowed to a little
  // under two a second it reads as a person barely holding still, which is the thing the word
  // was always for. The amplitude goes up to pay for the slowdown: fewer quivers have to be
  // individually visible, where a buzz was carried by its rate alone.
  tremble: { rot: 1.6,  pivot: 1,    beat: 0.3,  dx: 0.02 },
  // Floating, breathing, hovering. No turn at all.
  bob:     { dy: 0.045, beat: 0.8 },
  // Agreement, talking, listening. Turns about the neck, not the feet.
  nod:     { rot: 5.5,  pivot: 0.72, beat: 0.5 },
  // Delight. A turn about the feet with a hop mixed in — the closest thing here to a dance.
  jiggle:  { rot: 6,    pivot: 1,    beat: 0.4,  dy: 0.03, harmonic: 0.45 },
  // A heartbeat: swelling and shrinking in place. For objects, not people.
  throb:   { scale: 0.07, beat: 0.9 },
  // Slow aimless travel round a small loop. Smoke, a balloon, a thought.
  drift:   { dx: 0.02,  dy: 0.02,   beat: 1.6,  orbit: true },
  // Turning to show its other side: a coin, a card, a sign. Handled specially below.
  flip:    { beat: 2 },
};

export interface MotionState {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  /** Degrees. */
  rotate: number;
  /** Turn/scale centre, in world coordinates. */
  pivotWorldX: number;
  pivotWorldY: number;
  /** Multiplier on the node's opacity, or null when this motion does not touch opacity. */
  alphaMul: number | null;
}

const IDENTITY_ALPHA = null;

/**
 * What this node's continuous motion comes to at this instant, or null when it has none.
 *
 * `timeMs` is a clock, not a progress fraction: the editor hands it wall time and the export hands
 * it scene time. Both are fine; the export's is the reproducible one.
 */
export function computeContinuousMotion(node: NodeModel, timeMs: number): MotionState | null {
  const anim = node.continuousAnimation;
  if (!anim || anim.type === 'none') return null;

  const speed = anim.speed || 500;
  const intensity = anim.intensity || 0.5;
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;

  const state: MotionState = {
    offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotate: 0,
    pivotWorldX: cx, pivotWorldY: cy, alphaMul: IDENTITY_ALPHA,
  };

  // ---- the original four, unchanged ----------------------------------------------------------
  if (anim.type === 'bounce' || anim.type === 'pulse' || anim.type === 'shake' || anim.type === 'breathe') {
    const cycleTime = timeMs % (speed * 2);
    const t = cycleTime < speed ? cycleTime / speed : 1 - (cycleTime - speed) / speed;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    switch (anim.type) {
      case 'bounce': {
        const s = 1 + (eased - 0.5) * intensity * 0.4;
        state.scaleX = s;
        state.scaleY = s;
        break;
      }
      case 'pulse':
        state.alphaMul = 0.5 + eased * 0.5 * intensity + (1 - intensity) * 0.5;
        break;
      case 'shake':
        state.offsetX = (eased - 0.5) * intensity * 10;
        break;
      case 'breathe': {
        const s = 1 + Math.sin(eased * Math.PI) * intensity * 0.1;
        state.scaleX = s;
        state.scaleY = s;
        break;
      }
    }
    return state;
  }

  // ---- the drawn vocabulary ------------------------------------------------------------------
  const preset = MOTION_PRESETS[anim.type];
  if (!preset) return null;

  const ink = inkRect(node);
  const inkW = node.w * ink.w;
  const inkH = node.h * ink.h;
  const period = Math.max(1, speed * 2 * (preset.beat ?? 1));
  const turns = timeMs / period + (anim.phase ?? 0);
  const angle = turns * Math.PI * 2;
  const s = Math.sin(angle);

  if (anim.type === 'flip') {
    // A flip is a turn about the drawing's own upright axis, drawn the only way a flat canvas can
    // draw one: the width goes to nothing and comes back. It must never reach exactly zero, or the
    // shape vanishes for a frame and the reversal looks like a dropped frame rather than an edge.
    const c = Math.cos(angle);
    state.scaleX = Math.abs(c) < 0.02 ? (c < 0 ? -0.02 : 0.02) : c;
    state.pivotWorldX = node.x + (ink.x + ink.w / 2) * node.w;
    state.pivotWorldY = node.y + (ink.y + ink.h / 2) * node.h;
    return state;
  }

  const harmonic = preset.harmonic ? Math.sin(angle * 2) * preset.harmonic : 0;

  if (preset.rot) {
    state.rotate = preset.rot * intensity * (s + harmonic);
    state.pivotWorldX = node.x + (ink.x + ink.w / 2) * node.w;
    state.pivotWorldY = node.y + (ink.y + ink.h * (preset.pivot ?? 1)) * node.h;
  }
  if (preset.dx) {
    state.offsetX = preset.dx * intensity * inkW * s;
  }
  if (preset.dy) {
    // An orbit needs its two axes a quarter turn apart; everything else moves both at once.
    state.offsetY = preset.dy * intensity * inkH * (preset.orbit ? Math.cos(angle) : s + harmonic);
  }
  if (preset.scale) {
    const sc = 1 + preset.scale * intensity * s;
    state.scaleX = sc;
    state.scaleY = sc;
    if (!preset.rot) {
      state.pivotWorldX = node.x + (ink.x + ink.w / 2) * node.w;
      state.pivotWorldY = node.y + (ink.y + ink.h / 2) * node.h;
    }
  }

  return state;
}

/** True when this state actually moves anything, so callers can skip the transform entirely. */
export function motionMoves(m: MotionState | null): boolean {
  return (
    !!m &&
    (m.offsetX !== 0 || m.offsetY !== 0 || m.scaleX !== 1 || m.scaleY !== 1 || m.rotate !== 0)
  );
}

/**
 * Put the motion on the context. Call this INSIDE the node's own save/restore and BEFORE
 * `applyNodeTransform`, so the node's step-timeline transform composes on top of the movement
 * rather than fighting it for the same pivot.
 */
export function applyMotionTransform(ctx: CanvasRenderingContext2D, m: MotionState | null): void {
  if (!motionMoves(m)) return;
  const s = m as MotionState;
  if (s.offsetX !== 0 || s.offsetY !== 0) ctx.translate(s.offsetX, s.offsetY);
  if (s.rotate !== 0 || s.scaleX !== 1 || s.scaleY !== 1) {
    ctx.translate(s.pivotWorldX, s.pivotWorldY);
    if (s.rotate !== 0) ctx.rotate((s.rotate * Math.PI) / 180);
    if (s.scaleX !== 1 || s.scaleY !== 1) ctx.scale(s.scaleX, s.scaleY);
    ctx.translate(-s.pivotWorldX, -s.pivotWorldY);
  }
}

/** Convenience for the render paths: compute and apply in one call, returning the alpha multiplier. */
export function applyContinuousMotion(
  ctx: CanvasRenderingContext2D,
  node: NodeModel,
  timeMs: number
): number | null {
  const m = computeContinuousMotion(node, timeMs);
  applyMotionTransform(ctx, m);
  return m ? m.alphaMul : null;
}
