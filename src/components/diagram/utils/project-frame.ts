// Shared per-frame project compositor.
//
// Draws ONE composited project frame (single scene, morph match-cut, or
// crossfade/slide boundary) into an artboard-sized 2D context. This is the exact
// recipe the video/GIF export uses, factored out so the live editor Preview loop
// and the export path stay pixel-identical by construction (no drift).

import type { Project, SceneTransition } from '../types';
import { drawScene } from './rendering-utils';
import {
  evaluateProjectComposition,
  morphFrames,
  type ProjectTimeline,
} from './project-playback';
import { applyEasing } from './geometry-utils';
import { drawWriteHand } from './write-hand-asset';
import { handsHidden, setHandsHidden } from './hand-registry';

/** The board width the wipe hand is sized against (see the hand at the end of the scribble wipe). */
const WIPE_HAND_BOARD_W = 1280;
/** Up-and-down passes the hand makes along the edge over one wipe. */
const WIPE_HAND_SCRUBS = 1.5;

type DrawSceneOpts = Parameters<typeof drawScene>[4];

/** Hex -> rgb, for the one decision below that has to know how dark the board is. */
function groundRgb(color?: string): [number, number, number] {
  const fallback: [number, number, number] = [255, 255, 255];
  if (!color || color[0] !== '#') return fallback;
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return fallback;
  const v = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((p) => parseInt(p, 16));
  return v.some(Number.isNaN) ? fallback : [v[0], v[1], v[2]];
}

/**
 * What colour the hand is holding, given the surface it is drawing on.
 *
 * The whole point of a scribble edge is that it looks like a mark someone made, which means it
 * has to be VISIBLE, and the ground it lands on is not fixed: a blackboard or a blueprint board
 * takes chalk, white paper takes marker. Deciding this from the board rather than pinning a
 * colour is what stops dark ink being drawn on a dark board — the one failure mode that turns
 * this transition into a scene that appears to freeze for half a second.
 */
function wipeInk(ground?: string): string {
  const [r, g, b] = groundRgb(ground);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#2a2a2e' : '#f2efe6';
}

/**
 * The leading edge's shape: a fixed wobble, sampled by position ALONG the edge.
 *
 * Three sines rather than one, at frequencies that do not divide each other, so the line never
 * settles into a visible repeat over the length of a frame. Crucially this is a function of the
 * coordinate only and not of time: the same shape slides across, the way a hand drags one long
 * stroke. Reseeding it per frame would make the edge boil, which reads as a broken render.
 */
function edgeWobble(u: number, amp: number): number {
  return amp * (0.55 * Math.sin(u * 0.021)
    + 0.30 * Math.sin(u * 0.047 + 1.7)
    + 0.15 * Math.sin(u * 0.091 + 3.9));
}

/** The colour wipe's block when the transition names none: the brand violet. */
const COLOR_WIPE_DEFAULT = '#6c3ce0';
/** How far each band's start trails the one ahead of it, as a share of the whole wipe. */
const COLOR_WIPE_STAGGER = 0.07;
/** Edge slant, as a share of the frame's short side: enough to read as motion, not as a tilt. */
const COLOR_WIPE_SKEW = 0.16;

/** `hex` moved toward white (t > 0) or black (t < 0) by |t|. */
export function shadeHex(hex: string, t: number): string {
  const [r, g, b] = groundRgb(hex);
  const to = t > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(t));
  const ch = (v: number) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/** Smooth in and out, so each band launches and lands rather than sliding at constant speed. */
function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * The span each of the three bands covers at `alpha`, in travel coordinates (0 = the side the
 * wipe comes from, `travel` = past the far side). Exported for the tests.
 *
 * Band 0 leads (a light tint), band 1 follows (a dark tint), band 2 is the block colour and is
 * drawn on top. The HEADS sweep in staggered and the block's head lands exactly at alpha 0.5,
 * which is the one frame where nothing of either scene shows. The TAILS then sweep on in the
 * reverse order, the block leaving first, so the tints flash past once more on the way out and
 * the last band to clear is the one that arrived first.
 */
export function colorWipeBands(alpha: number, travel: number): Array<[number, number]> {
  const st = COLOR_WIPE_STAGGER;
  const D = 0.5 - 2 * st;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 3; i += 1) {
    const head = easeInOutCubic((alpha - i * st) / D) * travel;
    const tail = easeInOutCubic((alpha - 0.5 - (2 - i) * st) / D) * travel;
    out.push([tail, head]);
  }
  return out;
}

function drawColorWipe(
  ctx: CanvasRenderingContext2D,
  workA: HTMLCanvasElement | OffscreenCanvas,
  workB: HTMLCanvasElement | OffscreenCanvas,
  alpha: number,
  kind: SceneTransition['kind'],
  W: number,
  H: number,
  color?: string,
): void {
  // Nothing of either scene moves; the scene underneath swaps at the midpoint, the one frame
  // the block covers everything, so the swap itself is never seen.
  ctx.drawImage((alpha < 0.5 ? workA : workB) as CanvasImageSource, 0, 0);
  const vert = kind === 'colorWipeUp' || kind === 'colorWipeDown';
  const forward = kind === 'colorWipe' || kind === 'colorWipeDown';
  const L = vert ? W : H;            // along the edge
  const P = vert ? H : W;            // across it, the way the bands travel
  const sk = Math.min(W, H) * COLOR_WIPE_SKEW;
  // Every band must clear the frame entirely at both ends, slant included.
  const travel = P + sk + 4;
  const base = color && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : COLOR_WIPE_DEFAULT;
  const fills = [shadeHex(base, 0.45), shadeHex(base, -0.35), base];
  // Travel coordinate c, position v along the edge -> canvas point. The slant leans every edge
  // the same way, its far end trailing, which reads as the band being dragged.
  const pt = (c: number, v: number): [number, number] => {
    const cc = c - sk * (v / L);
    const across = forward ? cc : P - cc;
    return vert ? [v, across] : [across, v];
  };
  colorWipeBands(alpha, travel).forEach(([tail, head], i) => {
    if (head - tail < 0.5) return;
    ctx.save();
    ctx.fillStyle = fills[i];
    ctx.beginPath();
    const a = pt(tail, -2), b = pt(head, -2), c = pt(head, L + 2), d = pt(tail, L + 2);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

/**
 * Render the two sides of a boundary, with the scenes' own hands held back while a scribble
 * wipe runs. The wipe brings its own hand along the edge; the incoming scene starts writing its
 * title under it, so without this there are two hands on screen, one wiping and one writing.
 */
export function drawBoundarySides(kind: SceneTransition['kind'] | undefined, draw: () => void): void {
  if (!kind || !kind.startsWith('scribbleWipe') || handsHidden()) { draw(); return; }
  setHandsHidden(true);
  try { draw(); } finally { setHandsHidden(false); }
}

/** Composite two pre-rendered scene canvases into `outCtx` (crossfade, slide, push, travel-off). */
export function compositeBoundary(
  outCtx: CanvasRenderingContext2D,
  workA: HTMLCanvasElement | OffscreenCanvas,
  workB: HTMLCanvasElement | OffscreenCanvas,
  alpha: number,
  kind: SceneTransition['kind'],
  outW: number,
  outH: number,
  /** The artboard's ground colour, for transitions that draw a mark of their own. Passed in
   *  rather than sampled off the canvas: a per-frame pixel read costs a GPU stall, and a scene
   *  carrying a remote image would make it throw outright. */
  ground?: string,
  /** The transition's own colour (`colorWipe*`). */
  color?: string,
): void {
  outCtx.clearRect(0, 0, outW, outH);
  outCtx.globalAlpha = 1;
  if (kind && kind.startsWith('colorWipe')) {
    drawColorWipe(outCtx, workA, workB, alpha, kind, outW, outH, color);
  } else if (kind && kind.startsWith('scribbleWipe')) {
    // Uncover, rather than move. Both scenes stay exactly where they are; a hand-drawn edge
    // travels across the frame and the next scene is simply already there behind it. That is
    // what makes this the only transition here that belongs on a drawn board: nothing about it
    // implies a camera or a sheet of paper, only somebody's arm.
    const vert = kind === 'scribbleWipeUp' || kind === 'scribbleWipeDown';
    // Along the edge vs across it. For a horizontal edge sweeping down, the edge RUNS along the
    // frame's width and TRAVELS through its height.
    const L = vert ? outW : outH;
    const P = vert ? outH : outW;
    const forward = kind === 'scribbleWipe' || kind === 'scribbleWipeDown';
    const amp = Math.min(outW, outH) * 0.035;
    const band = amp * 0.55;                       // how far the scribble strays off the edge
    const lw = Math.max(2, Math.min(outW, outH) * 0.006);
    // Overshoot both ends by everything that can stick out past the edge line. Without it a
    // sliver of the outgoing scene survives at alpha 1 along whichever rows the wobble happens
    // to lag on, which is a bright seam down one side of the first frame of the new scene.
    const over = amp + band + lw * 2 + 8;
    const travel = P + over * 2;
    const pos = forward ? -over + alpha * travel : P + over - alpha * travel;
    const edge = (u: number) => pos + edgeWobble(u, amp);
    // u runs along the edge, c across it — one mapping so the four directions share every line
    // of geometry below instead of being four transcriptions of it.
    const px = (u: number, c: number) => (vert ? u : c);
    const py = (u: number, c: number) => (vert ? c : u);
    const step = Math.max(6, L / 90);

    outCtx.drawImage(workA as CanvasImageSource, 0, 0);
    outCtx.save();
    // The swept-past side is a closed region: the edge itself, then out to the frame corner on
    // the side the wipe came FROM.
    const home = forward ? -8 : P + 8;
    outCtx.beginPath();
    outCtx.moveTo(px(-8, home), py(-8, home));
    for (let u = -8; u <= L + 8; u += step) outCtx.lineTo(px(u, edge(u)), py(u, edge(u)));
    outCtx.lineTo(px(L + 8, edge(L + 8)), py(L + 8, edge(L + 8)));
    outCtx.lineTo(px(L + 8, home), py(L + 8, home));
    outCtx.closePath();
    outCtx.clip();
    outCtx.drawImage(workB as CanvasImageSource, 0, 0);
    outCtx.restore();

    // The mark itself: a zigzag straddling the edge, so it reads as somebody scrubbing a marker
    // back and forth rather than as a clean vector boundary. Two passes at different widths and
    // opacities — a single stroke of uniform weight is the thing that looks computed.
    //
    // Every reach and every pitch is nudged by a fixed pseudo-random per vertex. An even sawtooth
    // is the tell: no hand produces one, and at this size the eye reads perfect regularity as a
    // pattern fill rather than as a mark. Fixed, again, so the scribble is one shape travelling
    // and not a new shape each frame.
    const wiggle = (i: number) => {
      const s = Math.sin(i * 12.9898) * 43758.5453;
      return s - Math.floor(s);                       // 0..1, stable for a given vertex
    };
    const ink = wipeInk(ground);
    const zig = Math.max(9, L / 55);
    for (const [w, a, lean] of [[lw * 1.3, 0.92, 0], [lw * 0.65, 0.4, band * 0.3]] as const) {
      outCtx.save();
      outCtx.strokeStyle = ink;
      outCtx.globalAlpha = a;
      outCtx.lineWidth = w;
      outCtx.lineCap = 'round';
      outCtx.lineJoin = 'round';
      outCtx.beginPath();
      let flip = lean ? -1 : 1;
      let u = -12 - (lean ? zig * 0.5 : 0);
      for (let i = 0; u <= L + 12; i += 1) {
        const reach = band * (0.6 + 0.5 * wiggle(i + (lean ? 97 : 0)));
        const c = edge(u) + flip * reach + lean;
        if (i === 0) outCtx.moveTo(px(u, c), py(u, c));
        else outCtx.lineTo(px(u, c), py(u, c));
        flip = -flip;
        u += zig * (0.75 + 0.5 * wiggle(i + (lean ? 311 : 53)));
      }
      outCtx.stroke();
      outCtx.restore();
    }
    outCtx.globalAlpha = 1;

    // And the arm making it. A scribble with nobody holding the marker reads as a graphic effect;
    // with the marker hand riding the edge, scrubbing up and down it as it advances, it reads as
    // somebody wiping the board to the next picture, which is the whole point of this transition.
    // The same hand that writes the scene, so "no hand" switches this one off too.
    //
    // This runs in output pixels, but the hand's sizing rules are in board units, so draw it in a
    // board-sized space: at 4K the hand stays the share of the frame it is at 1280.
    if (alpha > 0 && alpha < 1) {
      const k = outW / WIPE_HAND_BOARD_W;
      const scrub = 0.5 + 0.38 * Math.sin(alpha * Math.PI * 2 * WIPE_HAND_SCRUBS - Math.PI / 2);
      const u = L * scrub;
      const c = edge(u);
      outCtx.save();
      outCtx.scale(k, k);
      drawWriteHand(outCtx, px(u, c) / k, py(u, c) / k, 32, alpha * 900);
      outCtx.restore();
    }
  } else if (kind && kind.startsWith('travelOff')) {
    // Move the finished picture ASIDE. The outgoing scene travels out of frame; the next
    // scene is already lying underneath it, and on a drawn board that is blank paper with
    // the first strokes of the next drawing just appearing on it. Both canvases carry the
    // same paper colour, so nothing about the surface appears to move — only the artwork.
    //
    // Hence the draw order: incoming DOWN FIRST, outgoing riding over the top. The reverse
    // order would need the outgoing canvas to be transparent everywhere it has no ink, which
    // it is not; every scene paints its own background.
    const e = applyEasing(alpha, 'ease-in');   // rests, then accelerates away
    const vert = kind === 'travelOffUp' || kind === 'travelOffDown';
    const sign = kind === 'travelOffUp' || kind === 'travelOffLeft' ? -1 : 1;
    // 1.3 frames, not 1: the scene also GROWS on its way out, so its trailing corner has
    // further to go than the frame is wide before the last of it clears the edge.
    const d = e * (vert ? outH : outW) * 1.3 * sign;
    // A sheet pushed across a desk never leaves square along one axis, and the drift and the
    // slight growth together are what make this read as a physical object being taken away
    // rather than as a camera pan. Both are deliberately small.
    const drift = e * (vert ? outW : outH) * 0.10 * sign;
    const s = 1 + e * 0.12;
    outCtx.drawImage(workB as CanvasImageSource, 0, 0);
    outCtx.save();
    outCtx.translate(outW / 2 + (vert ? drift : d), outH / 2 + (vert ? d : drift));
    outCtx.scale(s, s);
    outCtx.drawImage(workA as CanvasImageSource, -outW / 2, -outH / 2);
    outCtx.restore();
  } else if (kind && kind.startsWith('push')) {
    // Push: BOTH scenes travel, locked edge to edge, as one long strip passing the frame.
    // The offsets are deliberately derived from a SINGLE displacement so the two panels can
    // never drift apart or overlap — a one-pixel seam between two full-bleed pictures reads
    // as a tear, and it would only show on some frames, which is the worst kind of glitch.
    //
    // Direction names the OUTGOING scene's travel, because that is what the person asking
    // for it is watching: "this scene slides up and the next one comes in".
    const e = applyEasing(alpha, 'ease-out');
    const dist = kind === 'pushUp' || kind === 'pushDown' ? outH : outW;
    const sign = kind === 'pushUp' || kind === 'pushLeft' ? -1 : 1;
    const d = e * dist * sign;                       // how far the pair has travelled
    const vert = kind === 'pushUp' || kind === 'pushDown';
    outCtx.drawImage(workA as CanvasImageSource, vert ? 0 : d, vert ? d : 0);
    // The incoming panel sits exactly one frame away on the trailing side, so it arrives
    // flush as the outgoing one leaves.
    const back = d - dist * sign;
    outCtx.drawImage(workB as CanvasImageSource, vert ? 0 : back, vert ? back : 0);
  } else if (kind && kind !== 'crossfade') {
    // Slide: outgoing stays put underneath; incoming slides in over it.
    const e = applyEasing(alpha, 'ease-out');
    let dx = 0;
    let dy = 0;
    if (kind === 'slideDown') dy = -(1 - e) * outH; // from top
    else if (kind === 'slideUp') dy = (1 - e) * outH; // from bottom
    else if (kind === 'slideLeft') dx = (1 - e) * outW; // from right
    else if (kind === 'slideRight') dx = -(1 - e) * outW; // from left
    outCtx.drawImage(workA as CanvasImageSource, 0, 0);
    outCtx.drawImage(workB as CanvasImageSource, dx, dy);
  } else {
    outCtx.globalAlpha = 1 - alpha;
    outCtx.drawImage(workA as CanvasImageSource, 0, 0);
    outCtx.globalAlpha = alpha;
    outCtx.drawImage(workB as CanvasImageSource, 0, 0);
    outCtx.globalAlpha = 1;
  }
}

export interface ComposeWork {
  ctxA: CanvasRenderingContext2D | null;
  ctxB: CanvasRenderingContext2D | null;
  canvasA: HTMLCanvasElement | null;
  canvasB: HTMLCanvasElement | null;
}

/**
 * Render the project at global time `tMs` into `ctx` (sized to the artboard).
 * `work` supplies two scratch canvases for crossfade/slide boundaries; without
 * them a boundary degrades to a hard switch at the midpoint. `sceneFloat(i)`
 * gives the effective per-scene float decision (defaults to drawOpts.floatEnabled).
 *
 * @deprecated Prefer renderProjectFrame (project-render.ts): it is the shared
 * export/headless compositor AND resolves per-step cameras (push-ins, cameraEnd
 * drift, morph camera lerp). This function draws every frame with whatever fixed
 * camera is in drawOpts — using it for playback silently drops all camera motion
 * (that exact drift hid camera moves from the editor Preview until 2026-07-14).
 */
export function composeProjectFrame(
  ctx: CanvasRenderingContext2D,
  tMs: number,
  project: Project,
  timeline: ProjectTimeline,
  drawOpts: DrawSceneOpts,
  work?: ComposeWork,
  sceneFloat?: (i: number) => boolean,
): void {
  const w = project.artboard.width;
  const h = project.artboard.height;
  const float = (i: number) =>
    sceneFloat ? sceneFloat(i) : !!(drawOpts && drawOpts.floatEnabled);

  const comp = evaluateProjectComposition(tMs, project, timeline);

  // Time-based node props (countTo number tick, caret) are SCENE-relative, so each
  // scene must be drawn at its OWN scene-local time — not the global project time `tMs`,
  // which would clamp every count past the first scene to its final value.
  if (comp.kind === 'single') {
    drawScene(ctx, comp.frame, w, h, { ...drawOpts, currentTimeMs: comp.localT, floatEnabled: float(comp.sceneIndex),
      handTrack: project.diagrams[comp.sceneIndex].handTrack });
    return;
  }

  if (comp.transitionKind === 'morph') {
    const morphed = morphFrames(comp.from, comp.to, comp.alpha);
    const lead = comp.alpha < 0.5 ? comp.fromSceneIndex : comp.toSceneIndex;
    const leadLocalT = comp.alpha < 0.5 ? comp.fromLocalT : comp.toLocalT;
    drawScene(ctx, morphed, w, h, { ...drawOpts, currentTimeMs: leadLocalT, floatEnabled: float(lead) });
    return;
  }

  if (work?.ctxA && work.ctxB && work.canvasA && work.canvasB) {
    drawBoundarySides(comp.transitionKind, () => {
      drawScene(work.ctxA!, comp.from, w, h, { ...drawOpts, currentTimeMs: comp.fromLocalT, floatEnabled: float(comp.fromSceneIndex) });
      drawScene(work.ctxB!, comp.to, w, h, { ...drawOpts, currentTimeMs: comp.toLocalT, floatEnabled: float(comp.toSceneIndex) });
    });
    compositeBoundary(ctx, work.canvasA, work.canvasB, comp.alpha, comp.transitionKind, w, h,
      project.artboard?.background, comp.transitionColor);
    return;
  }

  // No scratch canvases available — hard switch at the midpoint so playback
  // still advances through the boundary.
  const useTo = comp.alpha >= 0.5;
  drawScene(ctx, useTo ? comp.to : comp.from, w, h, {
    ...drawOpts,
    currentTimeMs: useTo ? comp.toLocalT : comp.fromLocalT,
    floatEnabled: float(useTo ? comp.toSceneIndex : comp.fromSceneIndex),
  });
}
