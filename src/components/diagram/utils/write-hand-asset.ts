// The write-on hand: the marker hand that draws titles and labels, with its nib sitting on the
// type-on leading edge (triggered by node.writeHand on a typing text node). The forearm is
// extruded long and solid so a big draw always runs the arm off the bottom of frame — a person
// writing from off-screen.
//
// The hand PICTURES are not in here. They live in public/hands and are resolved by
// hand-assets.ts, which knows the three ways they can arrive (fetched in the editor, baked into
// the page for export, handed over as a URI by a library or an upload). This module is only the
// drawing: where the hand goes, how it moves, and when it lets go.
import { carryGripFrac, drawCarryHand } from './carry-hand-asset';
import { armReachWidth, loadHandImage, maxHandWidth } from './hand-assets';
import {
  DEFAULT_WRITE_HAND_STYLE, NO_HAND, WRITE_HAND_STYLES, getHand, handsHidden, setHandsHidden,
  type WriteHandStyle,
} from './hand-registry';
export { WRITE_HAND_STYLES };
export type { WriteHandStyle };

let _style: WriteHandStyle = DEFAULT_WRITE_HAND_STYLE;
// The nib — the one point on the picture where the pen meets the page — plus the picture's
// proportions. Refreshed whenever the style changes, before any frame can be drawn with it.
let NIB_FX = 0, NIB_FY = 0, ASPECT = 1;
let _img: HTMLImageElement | null = null;
let _loading: Promise<void> | null = null;

export function getWriteHandStyle(): WriteHandStyle { return _style; }

/** Switch the write-on hand style. Loads the image; the returned promise resolves once it is
 *  decoded (await it before rendering frames in the export path). */
export function setWriteHandStyle(s: WriteHandStyle): Promise<void> {
  // 'none' is a real choice, not an unknown id: the user (or the create page, via the backend
  // stamp) switched the drawing hand off. Everything else about the video plays as planned; the
  // three hand painters just decline to paint. Handled BEFORE the unknown-id guard below, which
  // would otherwise swallow it. Any real style picked afterwards switches the hands back on.
  if (s === NO_HAND) { setHandsHidden(true); return ensureWriteHandLoaded(); }
  setHandsHidden(false);
  // An id this build doesn't know keeps the hand we already have rather than snapping back to the
  // default: a document naming a library hand that hasn't been registered yet should not silently
  // undo a pick the user can see.
  if (s === _style || getHand(s, 'write').id !== s) return ensureWriteHandLoaded();
  _style = s; _img = null; _loading = null;
  return ensureWriteHandLoaded();
}

export function ensureWriteHandLoaded(): Promise<void> {
  if (_loading) return _loading;
  const h = getHand(_style, 'write');
  NIB_FX = h.nibFx ?? 0; NIB_FY = h.nibFy ?? 0; ASPECT = h.aspect;
  _loading = loadHandImage(h.file).then((img) => { _img = img; });
  return _loading;
}
// Start the default hand loading now, so it is decoded before the first frame that wants it.
ensureWriteHandLoaded();

// Per-node write-hand suppression. drawScene sets this true ONLY while it will draw the single
// continuous handTrack hand, so the per-node hands don't double up. When false (any path that
// doesn't drive the handTrack — editor DiagramPlayer, embed, or a doc without a track), the
// per-node hand draws as a FALLBACK so a hand is always visible.
let _suppressManagedHand = false;
export function setSuppressManagedHand(v: boolean): void {
  _suppressManagedHand = v;
}
export function isManagedHandSuppressed(): boolean {
  return _suppressManagedHand;
}

/** Draw the writing hand with its marker nib anchored at (penX, penY). The hand ROCKS around
 *  the nib (pivot rotation) so the pen stays on the text line while the arm swings — reads as
 *  writing, never floats below the text. Big enough that the forearm runs off the frame. */
export function drawWriteHand(
  ctx: CanvasRenderingContext2D, penX: number, penY: number, fontPx: number, clock: number | undefined,
  motion = 1, vScale = 1,
): void {
  if (handsHidden()) return;
  if (!_img || !_img.complete || !_img.naturalWidth) return;
  // Size the hand to the TYPE it is writing (a marker hand is ~15 line-heights across), then
  // raise it only as far as the forearm needs to leave the frame. The old rule was a flat
  // 460-unit floor, which is a third of a 1200-wide board: writing a 17px chapter title it
  // produced a hand half the frame tall sitting on top of the text below it. The floor was
  // there for the forearm, so ask the frame how much arm is actually needed rather than
  // guessing a number that only suits big headings.
  // ...then hold it to a constant SHARE OF THE FRAME, so a pushed-in camera does not inflate it.
  const hw = Math.min(
    Math.max(Math.min(620, fontPx * 15), Math.min(620, armReachWidth(ctx, penY, ASPECT))),
    maxHandWidth(ctx),
  );
  const hh = hw * ASPECT;
  const t = clock ?? 0;
  // Writing SCRIBBLE: fast, slightly irregular pen-tip jitter (as if forming letters) plus a
  // quicker arm rock around the nib. Mixed high frequencies read as writing, not a slow sway.
  // `motion` scales the scribble — 1 while writing, ~0.15 while the hand TRAVELS between
  // items (a glide should be near-still, not scribbling mid-air).
  const A = fontPx * 0.10 * motion;
  const jx = Math.sin(t / 72) * A + Math.sin(t / 36 + 1.1) * A * 0.65 + Math.sin(t / 19) * A * 0.35;
  const jy = (Math.sin(t / 58 + 0.5) * A * 0.8 + Math.sin(t / 29) * A * 0.5 + Math.sin(t / 15 + 2) * A * 0.3) * vScale;
  const angle = (Math.sin(t / 86) * 0.02 + Math.sin(t / 40 + 0.6) * 0.014 + Math.sin(t / 20) * 0.008) * motion;
  ctx.save();
  ctx.translate(penX + jx, penY + jy);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(28,24,48,0.22)';
  ctx.shadowBlur = fontPx * 0.5;
  ctx.shadowOffsetX = fontPx * 0.12;
  ctx.shadowOffsetY = fontPx * 0.2;
  ctx.drawImage(_img, -NIB_FX * hw, -NIB_FY * hh, hw, hh);
  ctx.restore();
}

/** How long the hand takes to let go of a picture and drop out of frame, once it has been set
 *  down. Long enough to read as releasing, short enough that the next beat isn't waiting on it. */
const CARRY_RELEASE_MS = 430;

/** ONE continuous write-hand for a whole scene, driven by a `handTrack` (ordered scene-local
 *  write windows). Inside a window it moves start->end with a full scribble (writing); in the
 *  GAP between two windows it glides prev.end->next.start with damped motion (a travel, not a
 *  scribble). Shared by BOTH render paths — drawScene (export/preview) and renderCanvas (the
 *  live editor / single-scene player) — so the hand behaves identically everywhere. The caller
 *  must have already set setSuppressManagedHand(true) so the per-node hands don't double up, and
 *  must draw this INSIDE the world-space camera transform. `nodes` is the frame's node list, used
 *  to read each write node's exact leading edge (`__penPt`) and kind. */
// Last progress value seen for each written node, and the playback time it was seen at. Used to
// tell a write that is happening from one that has stopped part-way; see the ground-truth block.
const _penSeen = new Map<string, { p: number; t: number }>();

export function drawContinuousHand(
  ctx: CanvasRenderingContext2D,
  rawTrack: ReadonlyArray<{ id?: string; t0: number; t1: number; sx: number; sy: number; ex: number; ey: number;
    mode?: 'write' | 'carry' }>,
  currentTimeMs: number | undefined,
  nodes: ReadonlyArray<unknown>,
  frameH: number = 1200,
): void {
  if (handsHidden()) return;
  // 1+ (not 2+): single-write scenes carry one-segment tracks (see build_hand_track) — the
  // managed hand must still ride that one write, else no hand draws at all.
  if (!rawTrack || rawTrack.length < 1) return;
  const now = currentTimeMs ?? 0;
  const nodeOf = (id?: string) =>
    id ? (nodes.find((m) => (m as { id?: string }).id === id) as
          { __penPt?: { x: number; y: number; fs?: number }; kind?: string; fontSize?: number;
            typeProgress?: number; drawProgress?: number;
            carryGrip?: { x: number; y: number; w: number; h: number }; carryPose?: string;
            illustrationPrompt?: string; svgPaths?: unknown[]; imageData?: string; imageUrl?: string;
            x?: number; y?: number; w?: number; h?: number } | undefined) : undefined;
  // NEVER MIME A DRAWING THAT ISN'T THERE. A picture slot can reach the screen still empty: the
  // library had never drawn that concept, so the node is a promise the renderer is told to draw
  // as nothing rather than as a loading card. The pen knew nothing about that and rode the empty
  // slot anyway, so the audience watched a marker travel across a finished scene, hold at a wall,
  // scribble at nothing for two seconds and leave. A hand drawing air is worse than no hand: it
  // is the one gesture in the whole format that promises something is coming.
  const handTrack = rawTrack.filter((s) => {
    const n = nodeOf(s.id);
    if (!n || !n.illustrationPrompt) return true;      // not a picture slot, or not in this frame
    return !!(n.svgPaths && n.svgPaths.length) || !!n.imageData || !!n.imageUrl;
  });
  if (handTrack.length < 1) return;
  // How big the marker is for THIS write: the effective size of the type going down, stamped on
  // __penPt as the text renders (so it is the post-autoFit size, not the authored one). Pictures
  // and gestures carry no type, so they keep the historical 32. Sizing every write at 32 was the
  // bug: a chapter title set at 17px got a hand built for double that, wide enough to cover the
  // right half of the frame and sit on the paragraph underneath it.
  const HAND_FS = 32;
  const fsOf = (n: ReturnType<typeof nodeOf>) =>
    (n && n.kind === 'text' ? (n.__penPt?.fs ?? n.fontSize ?? HAND_FS) : HAND_FS);

  // A CARRY owns the hand outright: it is holding something, so it cannot also be writing, and
  // nothing else may draw a hand while it is on screen. Checked before everything else for that
  // reason, and because a scene can mix carries and writes in one track.
  // A still-travelling window WINS over one that has just been set down: a carry is emitted as a
  // move plus a small settle, so the moment the travel ends the settle is already running. Taking
  // the first match in track order would start the hand letting go while the picture is still
  // moving under it.
  const carry = handTrack.find(s => s.mode === 'carry' && now >= s.t0 && now <= s.t1)
    // ...and among windows already set down, the one that ended LAST, so the drop is measured from
    // the settle rather than restarting part-way through from the travel that preceded it.
    ?? handTrack.filter(s => s.mode === 'carry' && now > s.t1 && now <= s.t1 + CARRY_RELEASE_MS)
      .sort((p, q) => q.t1 - p.t1)[0];
  if (carry) {
    const n = nodeOf(carry.id);
    // The carried picture's own LIVE bottom-centre, not the window's clock. Same reasoning as the
    // writing hand below: the times come from raw step durations and drift once playback stretches
    // a step to its narration, and a hand that drifts off what it is carrying is worse than no
    // hand. The track's own endpoints are the fallback for a node missing from this frame.
    const live = n && typeof n.x === 'number' && typeof n.w === 'number';
    const done = now > carry.t1;
    const boxW = live ? n!.w! : Math.max(120, Math.abs(carry.ex - carry.sx) || 320);
    const boxH = live ? (n!.h! ?? 0) : 0;
    // WHERE THE PICTURE IS INSIDE ITS BOX. A generated plate is a square with a drawing somewhere
    // in the middle of it and transparent margin all round, so the box and the picture are simply
    // not the same rectangle. Everything below used to use the box, which put the fingers on the
    // bottom edge of the MARGIN: on a thought bubble that is a plain gap of empty air between the
    // hand and the thing it is meant to be holding, and because the hand is also sized off what it
    // holds, a small prop got a hand built for the whole plate. Defaults to the whole box, which
    // is right for a photograph and for anything drawn edge to edge.
    const g = n?.carryGrip;
    const objW = boxW * (g ? g.w : 1);
    // WHERE along the picture's bottom edge this hand holds. The corner hand grips a corner, so
    // hanging it from the middle would sink the whole hand behind the picture and leave a lone
    // thumb standing on the artwork. The track's fallback endpoints are stored as bottom-centres,
    // so they get the same shift applied rather than a second convention.
    const at = carryGripFrac(n?.carryPose);
    const gx = live ? n!.x! + boxW * (g ? g.x : 0) + objW * at
                    : (done ? carry.ex : carry.sx) + (at - 0.5) * objW;
    const gy = live ? n!.y! + boxH * (g ? g.y + g.h : 1) : (done ? carry.ey : carry.sy);
    if (done) {
      // Let go. The picture stays exactly where it was set down and the hand alone drops out of
      // frame — the whole point of the gesture is that the thing it brought remains.
      const k = Math.min(1, (now - carry.t1) / CARRY_RELEASE_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      drawCarryHand(ctx, gx, gy + (frameH + 420 - gy) * e, objW, now, 0.35, n?.carryPose, frameH);
    } else {
      drawCarryHand(ctx, gx, gy, objW, now, 1, n?.carryPose, frameH);
    }
    return;
  }

  // GROUND TRUTH first: if a tracked node is genuinely mid-write THIS frame — its OWN
  // typeProgress/drawProgress is strictly between 0 and 1 — sit the hand on its exact leading
  // edge and ignore the handTrack times. The track's t0/t1 come from raw step durations; once
  // playback stretches steps to narration length they can drift, and trusting them would leave
  // the hand resting while text is actually being written. The node's real animation progress
  // can't drift, so keying off it makes the writing bulletproof. (Times are still used below,
  // only to travel/rest BETWEEN writes, where exact timing doesn't matter.)
  // ...but PART-DRAWN IS NOT MID-WRITE. A full-frame picture is drawn over several beats and sits
  // still between them, so its progress rests at (say) 0.81 for as long as the sentence runs. Read
  // as ground truth that pinned the pen to a leading edge where nothing was happening: a hand
  // parked on the page for seconds, apparently drawing and producing no ink. What makes a write a
  // write is that the progress is MOVING, so that is what is measured — remembered per node from
  // the previous frame, which no amount of timing drift can fake. A brief hold keeps the pen down
  // through a paused player and the odd repeated frame; past that the hand leaves the way it does
  // in any other gap.
  const HOLD_MS = 240;
  let writing: ReturnType<typeof nodeOf> = undefined;
  for (const s of handTrack) {
    const n = nodeOf(s.id);
    if (!n || !n.__penPt || !s.id) continue;
    const p = typeof n.typeProgress === 'number' ? n.typeProgress
      : typeof n.drawProgress === 'number' ? n.drawProgress : NaN;
    if (!(p > 0.001 && p < 0.999)) continue;
    const seen = _penSeen.get(s.id);
    if (!seen || seen.p !== p) {
      _penSeen.set(s.id, { p, t: now });
      writing = n;                            // it moved this frame → the pen is on the page
    } else if (Math.abs(now - seen.t) < HOLD_MS) {
      writing = n;                            // moved a moment ago → still the same write
    }
  }
  if (writing && writing.__penPt) {
    const isText = writing.kind === 'text';
    drawWriteHand(ctx, writing.__penPt.x, writing.__penPt.y, fsOf(writing), now, isText ? 0.5 : 1, isText ? 5 : 1);
    return;
  }

  // Nothing is being written right now → use the track's times to place the hand between writes.
  // CARRIES ARE NOT WRITES and are skipped outright. Their endpoints are the carried picture's
  // bottom edge — off frame at the start — not a pen position, and the carry brings its own hand
  // up from under the frame. Let one be `next` and the travel below sends the MARKER hand across
  // the page to meet it, so a pen flashes on for the last moment before the carry and the carrying
  // hand then rises underneath it: two hands for one gesture. Let one be `prev` and the pen slides
  // out from wherever the picture was set down, having never been there.
  let active: (typeof handTrack)[number] | null = null;
  let prev: (typeof handTrack)[number] | null = null;
  let next: (typeof handTrack)[number] | null = null;
  for (const s of handTrack) {
    if (s.mode === 'carry') continue;
    if (now >= s.t0 && now <= s.t1) { active = s; break; }
    if (s.t1 < now && (!prev || s.t1 > prev.t1)) prev = s;
    if (s.t0 > now && (!next || s.t0 < next.t0)) next = s;
  }
  if (active) {
    // Time says we're in a write window but the node isn't animating (drift, or the window's
    // edges): hold the pen at the node's last known leading edge / the linear estimate.
    const n = nodeOf(active.id);
    const pp = n && n.__penPt ? n.__penPt : null;
    const f = active.t1 > active.t0 ? (now - active.t0) / (active.t1 - active.t0) : 1;
    const x = pp ? pp.x : active.sx + (active.ex - active.sx) * f;
    const y = pp ? pp.y : active.sy + (active.ey - active.sy) * f;
    const isText = !!(n && n.kind === 'text');
    drawWriteHand(ctx, x, y, fsOf(n), now, isText ? 0.5 : 1, isText ? 5 : 1);
  } else if (prev && next && next.t0 > prev.t1) {
    const gap = next.t0 - prev.t1;
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const OFF_Y = frameH + 260;      // pen this far down → the whole hand+arm is below the frame
    const EXIT = 480, ENTER = 640;   // slide-out / slide-in durations (ms)
    if (gap >= 1600) {
      // LONG wait (narration plays, no writing): don't park the hand on the page — slide it OUT
      // below the frame after the last word, stay hidden through the wait, then slide it back IN
      // to the next write spot just before writing resumes.
      const pn = nodeOf(prev.id);
      const pp = pn && pn.__penPt ? pn.__penPt : null;
      const px = pp ? pp.x : prev.ex;
      const py = pp ? pp.y : prev.ey;
      if (now < prev.t1 + EXIT) {
        const e = ease((now - prev.t1) / EXIT);
        drawWriteHand(ctx, px, py + (OFF_Y - py) * e, fsOf(pn), now, 0.12);
      } else if (now > next.t0 - ENTER) {
        const e = ease(1 - (next.t0 - now) / ENTER);
        // Sized for the write it is arriving to do, not the one it just left.
        drawWriteHand(ctx, next.sx, OFF_Y + (next.sy - OFF_Y) * e, fsOf(nodeOf(next.id)), now, 0.12);
      }
      // else: fully off-screen — draw nothing.
    } else if (handTrack.length >= 4 || gap <= 2000) {
      // SHORT gap: rest where the last word landed, then sweep to the next item in the final
      // ~0.9s (arrive-late) — a presenter finishing a thought, not hovering over empty space.
      const travelDur = Math.min(gap, 900);
      const travelStart = next.t0 - travelDur;
      const g = Math.max(0, Math.min(1, (now - travelStart) / travelDur));
      const e = ease(g);
      const pn = nodeOf(prev.id);
      const pp = pn && pn.__penPt ? pn.__penPt : null;
      const sx = pp ? pp.x : prev.ex;
      const sy = pp ? pp.y : prev.ey;
      const x = sx + (next.sx - sx) * e;
      const y = sy + (next.sy - sy) * e;
      const lift = Math.sin(Math.PI * g) * 16;
      // One size for the whole sweep — taken from where it started, so the hand doesn't change
      // scale in mid-air on its way across the page.
      drawWriteHand(ctx, x, y - lift, fsOf(pn), now, 0.15);
    }
  } else if (prev && !next) {
    // After the LAST write: slide the hand out below the frame instead of vanishing on the spot.
    const EXIT = 480;
    const OFF_Y = frameH + 260;
    if (now < prev.t1 + EXIT) {
      const pn = nodeOf(prev.id);
      const pp = pn && pn.__penPt ? pn.__penPt : null;
      const px = pp ? pp.x : prev.ex;
      const py = pp ? pp.y : prev.ey;
      const e = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      const k = e((now - prev.t1) / EXIT);
      drawWriteHand(ctx, px, py + (OFF_Y - py) * k, fsOf(pn), now, 0.12);
    }
  }
}
