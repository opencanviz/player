// Where a hand's picture comes from, and the only module that answers that question.
//
// Three callers need the same PNG under three very different conditions:
//
//   the editor and the embed  — a normal page, so the hand is fetched from this app's own origin
//                               and the browser caches it. Nothing sits in the JS bundle.
//   the export renderer       — a headless page opened over file://, which cannot reliably fetch
//                               subresources and, worse, would TAINT the canvas if it did, and
//                               the exporter reads raw pixels back off that canvas every frame.
//                               So the build step bakes every hand into the page as a data URI
//                               (exactly as it already does for the handwriting fonts) and this
//                               module finds them there.
//   a library / uploaded hand — arrives as an absolute URL or a data URI on the hand's own record,
//                               and is used verbatim.
//
// Resolution order is inline map, then verbatim URI, then this app's /hands directory.

/** Hands baked into the page by scripts/build-headless-bundle.mjs, keyed by file basename. */
const INLINE = new Map<string, string>();

const bootstrap = (globalThis as { __HAND_ASSET_URIS?: Record<string, string> }).__HAND_ASSET_URIS;
if (bootstrap) for (const [file, uri] of Object.entries(bootstrap)) INLINE.set(file, uri);

/** Bake a hand's bytes in at runtime — a user's upload resolved server-side onto the document,
 *  the same way illustration references are bound before a render. Overrides the fetched copy. */
export function registerHandBytes(file: string, dataUri: string): void {
  INLINE.set(file, dataUri);
}

const ABSOLUTE = /^(data:|blob:|https?:)/i;

/** Where bundled hands are fetched from when not inlined. The app serves them at /hands/; the
 *  public player package points this at the copies it ships. Must end in a slash. */
let handBase = '/hands/';
export function setHandAssetBase(base: string): void {
  handBase = base.endsWith('/') ? base : base + '/';
}

export function handAssetSrc(file: string): string {
  const inlined = INLINE.get(file);
  if (inlined) return inlined;
  if (ABSOLUTE.test(file)) return file;
  return `${handBase}${file}`;
}

const CACHE = new Map<string, Promise<HTMLImageElement | null>>();

/** Load a hand's picture, decoded and ready to draw. Resolves to null rather than throwing:
 *  a missing hand must cost the video its hand, never its frames. */
export function loadHandImage(file: string): Promise<HTMLImageElement | null> {
  const src = handAssetSrc(file);
  const hit = CACHE.get(src);
  if (hit) return hit;
  if (typeof Image === 'undefined') return Promise.resolve(null);

  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    // A hand served from somewhere else would otherwise taint the canvas, and the export path
    // reads pixels straight back off it — one uploaded hand would break every export.
    if (/^https?:/i.test(src) && typeof location !== 'undefined' && !src.startsWith(location.origin)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    const dec = (img as unknown as { decode?: () => Promise<void> }).decode?.();
    if (dec) dec.then(() => resolve(img)).catch(() => { /* onload/onerror still settle it */ });
  });
  CACHE.set(src, p);
  return p;
}


// ---------------------------------------------------------------- how big a hand is drawn
//
// Shared by both gestures. They used to size themselves by unrelated rules — the marker hand off
// the type it was writing, the carrying hand off the picture it was holding — and the second of
// those is what produced a doll's hand on a long stretched forearm whenever it carried something
// small. There is one person in these videos and their hand is one size, so the two rules that
// decide it live here, together, and neither gesture can drift from the other.

/** How wide a hand has to be for its forearm to run off the bottom of frame, when the point it is
 *  anchored by sits at `anchorY`.
 *
 *  `aspect` is how far BELOW that anchor the picture of the hand ends, per unit of its width: the
 *  marker hand is anchored at its nib, near the top, so that is simply the picture's proportions;
 *  the carrying hand is anchored at its grip, partway down, so it is the part of the picture below
 *  the grip. Below the width this returns the arm would stop in mid-air on a flat horizontal cut.
 *
 *  Read out of the live transform, so it is right in the editor, in the export, and at any zoom.
 *  Falls back to the historical 460 if the transform can't be inverted (a degenerate camera). */
export function armReachWidth(
  ctx: CanvasRenderingContext2D, anchorY: number, aspect: number,
): number {
  try {
    const p = ctx.getTransform().inverse().transformPoint(new DOMPoint(0, ctx.canvas.height));
    const reach = (p.y - anchorY) / (aspect || 1);
    return Number.isFinite(reach) && reach > 0 ? reach : 460;
  } catch {
    return 460;
  }
}

/** The widest a hand may be drawn, in WORLD units, so that on SCREEN it never covers more of the
 *  frame than it does at rest.
 *
 *  A hand is drawn inside the camera transform, like everything else on the board, so a scene that
 *  opens pushed in draws it zoom-times too big: the "enter inside" opening on a cropped scene
 *  reached zoom 3.19, at which a 620-unit hand is wider than the whole frame — a forearm and a
 *  marker with the board somewhere behind them. Physically a hand at a zoomed board WOULD look
 *  bigger, but this hand is a presenter overlay, not something lying on the paper, so it reads as
 *  a mistake rather than as a close-up.
 *
 *  0.55 of the frame is chosen to be a NO-OP at rest and to bite only when pushed in: on the
 *  1200-wide board the existing 620 cap is 0.517 of the frame, so an unzoomed scene keeps exactly
 *  the hand it has today and a pushed-in one is held to that same on-screen size. Read out of the
 *  live transform and the live canvas, whose ratio is free of device pixel ratio and of the
 *  editor's fit-to-viewport scale, so this is the true share of the frame. */
export function maxHandWidth(ctx: CanvasRenderingContext2D): number {
  try {
    const s = Math.abs(ctx.getTransform().a);
    if (!Number.isFinite(s) || s <= 1e-6) return Infinity;
    return (ctx.canvas.width * 0.55) / s;
  } catch {
    return Infinity;
  }
}

/** The width a hand is drawn at when nothing about the moment argues for another size, and the
 *  number both gestures agree on. It is what the marker hand has always come out at for a picture
 *  or a gesture (its type-driven rule bottoms out here), so adopting it for the carrying hand is
 *  what makes the two the same hand rather than two different people's. */
export const BASE_HAND_W = 480;
