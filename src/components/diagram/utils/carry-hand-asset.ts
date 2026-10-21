// The hand that CARRIES a picture: it rises in from below the frame holding a finished picture,
// sets it down, and drops away. The write-on hands draw things; this one delivers things that were
// never drawn (photos, plates, generated pictures), which otherwise could only fade up with no
// hand anywhere near them.
//
// Its calibration — where the held picture's bottom edge sits against the fingers — lives in
// hand-registry.ts beside every other hand, and its picture is resolved by hand-assets.ts. Kept
// in its own module because it is a distinct gesture with its own timing, not because of its size.
//
// EVERY carry pose is kept loaded, not just the chosen one, and each drawing may name its own.
// One pose per artboard meant a whole video held a scroll, a coin bag and a thought bubble in the
// identical fist, which reads as one sticker being reused rather than as somebody handling things:
// the gesture is part of what the thing IS, and a bubble hooked by two fingers and a heavy bag
// pinched by a corner are simply different actions.
import { BASE_HAND_W, loadHandImage, maxHandWidth } from './hand-assets';
import { DEFAULT_CARRY_HAND, getHand, handsHidden, listHands } from './hand-registry';

interface Pose {
  img: HTMLImageElement;
  // Where the carried picture sits on the picture of the hand, plus its proportions.
  gripFx: number; gripFy: number; aspect: number;
  // WHICH point of the carried picture that grip holds, across the picture's own width: 0.5 for a
  // hand that takes the middle of the bottom edge, 0 for one that pinches the bottom-left corner,
  // 1 for one that pinches the bottom-right.
  gripAt: number;
}

const _poses = new Map<string, Pose>();
const _pending = new Map<string, Promise<void>>();
/** The artboard-wide default, used by anything that does not name a pose of its own. */
let _carry = DEFAULT_CARRY_HAND;

function _load(id: string): Promise<void> {
  const h = getHand(id, 'carry');
  if (_poses.has(h.id)) return Promise.resolve();
  const already = _pending.get(h.id);
  if (already) return already;
  const p = loadHandImage(h.file).then((img) => {
    if (img) {
      _poses.set(h.id, {
        img, gripFx: h.gripFx ?? 0, gripFy: h.gripFy ?? 0, aspect: h.aspect,
        gripAt: h.gripAt === 'bottom-left' ? 0 : h.gripAt === 'bottom-right' ? 1 : 0.5,
      });
    }
  });
  _pending.set(h.id, p);
  return p;
}

/** Switch which carrying hand is used by anything that has not named one. Same contract as the
 *  write-on hands. */
export function setCarryHand(id: string): Promise<void> {
  if (getHand(id, 'carry').id === id) _carry = id;
  return ensureCarryHandLoaded();
}

/** Have every carry pose decoded and ready. All of them, not just the current one: a pose is
 *  chosen per drawing and is only discovered when that drawing arrives, which during a render is
 *  the frame it must already be visible on. Three small pictures, baked into the page on the
 *  export path, so holding them all costs nothing worth measuring. */
export function ensureCarryHandLoaded(): Promise<void> {
  const ids = listHands('carry').map((h) => h.id);
  if (ids.indexOf(_carry) < 0) ids.push(_carry);
  return Promise.all(ids.map(_load)).then(() => undefined);
}
ensureCarryHandLoaded();

function _pose(id?: string): Pose | undefined {
  return _poses.get(getHand(id || _carry, 'carry').id) ?? _poses.get(getHand(_carry, 'carry').id);
}

/** Where along the carried picture's bottom edge the named hand grips, as a fraction of that
 *  picture's width. Callers place the hand with it instead of assuming the middle, because a
 *  corner-pinch pose hung from the middle puts its fingers in the middle of the artwork. */
export function carryGripFrac(id?: string): number { return _pose(id)?.gripAt ?? 0.5; }


/** THE ONE RATIO THE ASSETS WERE DRAWN AT, and it is not a free parameter.
 *
 *  Every carry pose is a photograph of a hand that was holding a flat CARD, and the card is gone
 *  from the picture: each asset ends in a straight horizontal cut across the fingers where its
 *  edge was, and the grip point sits on that cut. The carried picture is what covers it. So the
 *  picture has to be big enough to hide the cut, which across these three poses means roughly
 *  0.62 of the hand's width — hence the multiplier below, which is a measurement of the artwork
 *  rather than a taste call.
 *
 *  Break it in either direction and the gesture stops reading as holding. A hand much bigger than
 *  what it holds leaves the sliced-off fingers on show with a speck floating beside them, which is
 *  what a full-sized hand did to a thumbnail-sized thought bubble. A hand much smaller than what
 *  it holds is a fingertip under a levitating poster. */
const FIT = 0.62;

/** The size this presenter's hand is, which is the size the WRITING hand already comes out at for
 *  a picture or a gesture. There is one person in these videos and their hand does not change size
 *  between drawing something and handing something over.
 *
 *  It only ever raises the result of FIT, never lowers it: a bigger picture gets a bigger hand
 *  because the alternative is a fingertip under a levitating poster, but a smaller picture does
 *  NOT get a smaller hand, because a doll's hand has a doll's arm and the arm has to come in from
 *  outside the shot. What happens to a picture too small for this hand to hold is that it is not
 *  handed in at all — the storyboard side declines the gesture and the picture arrives on its own.
 *  Kept in step with the same floor there, which parks carried pictures off frame far enough that
 *  neither they nor their hand show early. */
const MIN_W = BASE_HAND_W;

/** ...and the widest a hand may be relative to what it holds, which is the safety valve on the
 *  floor above. 1/FIT is the ratio at which the picture covers the cut and no more; past it the
 *  sliced fingers are on show beside something visibly too small to be what they are holding.
 *  Nothing that small should reach here, and this is what it costs if one does. */
const MAX_OVER_OBJ = 1 / FIT;

/** Draw the hand carrying a picture, with the picture's GRIP POINT at (gripX, gripY) — the middle
 *  of its bottom edge, or one of its bottom corners, whichever this hand was drawn holding. Ask
 *  carryGripFrac() for which; the caller owns that because only it knows where the picture is.
 *
 *  `objW` is the carried picture's width, and it can only make the hand BIGGER: the hand starts at
 *  the size this presenter's hand is (see MIN_W) and grows from there so a full-width plate is not
 *  levitating over a fist. It is the width of the DRAWING, not of the box around it — a generated
 *  plate is mostly transparent margin, and sizing off the box is what gave a small picture a hand
 *  several times its size.
 *
 *  `pose` names which carry hand to use for this one picture; without it the artboard's own is
 *  used.
 *
 *  `sway` scales the drift. A carried object is heavy and near-still (unlike the write hand's
 *  scribble), so this is a slow lean, not a jitter — but it has to exist, or the hand and its
 *  picture read as one rigid sticker sliding up the screen.
 *
 *  `frameH` is the frame's height, and it is what keeps the arm attached to a body. A hand picture
 *  is a fixed length, so a thing set down high in the frame can still get an arm that STOPS in
 *  mid-air on a flat horizontal cut — a forearm with a sawn end floating over a hillside. A real
 *  arm always comes in from outside the shot. The bottom of every carry asset is already a
 *  constant cross-section, so the last slice of it is repeated down to below the bottom edge
 *  whenever the arm falls short.
 *
 *  That repeat is a LAST RESORT, not the mechanism. The size rule above already grows the hand
 *  until its own drawn forearm reaches the edge, so on almost every placement there is nothing
 *  left to repeat; what remains here is for the case where the frame-share cap holds the hand
 *  smaller than the reach wants, which is a pushed-in camera. Leaning on the repeat instead is
 *  what produced a narrow column of skin under a tiny fist. */
export function drawCarryHand(
  ctx: CanvasRenderingContext2D, gripX: number, gripY: number, objW: number,
  clock: number | undefined, sway = 1, pose?: string, frameH = 0,
): void {
  // Hands switched off is one global answer (see hand-registry): the carried PICTURE is drawn by
  // its own node either way, so skipping here removes only the gripping hand, never content.
  if (handsHidden()) return;
  const p = _pose(pose);
  if (!p || !p.img.complete || !p.img.naturalWidth) return;
  // Size to the PICTURE, because the artwork gives no choice (see FIT), then hold the result to a
  // constant share of the frame so a camera pushed into the scene cannot inflate the hand into a
  // forearm with the board somewhere behind it.
  //
  // This used to raise the hand until its own forearm reached the bottom edge, which fixed a
  // stretched arm and broke the grip: a thumbnail-sized prop got a full-sized hand and the two had
  // visibly nothing to do with each other. A hand cannot be sized for its arm and for its grip at
  // once, and the grip is the part the viewer reads. The arm is answered on the storyboard side
  // instead, by not asking a hand to carry something it could never reach.
  const hw = Math.min(
    Math.min(620, Math.max(Math.min(MIN_W, objW * MAX_OVER_OBJ), objW * FIT)),
    maxHandWidth(ctx),
  );
  const hh = hw * p.aspect;
  const t = clock ?? 0;
  const a = hw * 0.006 * sway;
  const dx = Math.sin(t / 690) * a + Math.sin(t / 310 + 1.3) * a * 0.4;
  const dy = Math.sin(t / 520 + 0.7) * a * 0.7;
  // Rotate about the GRIP, not the wrist: a hand that pivots anywhere else swings the picture it
  // is holding off its own fingers.
  const angle = (Math.sin(t / 900) * 0.012 + Math.sin(t / 430 + 0.4) * 0.006) * sway;
  ctx.save();
  ctx.translate(gripX + dx, gripY + dy);
  ctx.rotate(angle);
  // All four shadow fields, explicitly. The canvas arrives with whatever the last drawing call
  // left on it, and an inherited offset pointing the wrong way puts a dark smear ABOVE the
  // fingers, across the picture the hand is supposed to be holding. Kept much lighter than the
  // marker hand's: this one sits directly on the artwork rather than on the paper beside it.
  ctx.shadowColor = 'rgba(28,24,48,0.13)';
  ctx.shadowBlur = hw * 0.03;
  ctx.shadowOffsetX = hw * 0.004;
  ctx.shadowOffsetY = hw * 0.012;
  ctx.drawImage(p.img, -p.gripFx * hw, -p.gripFy * hh, hw, hh);
  // Continue the arm off the bottom edge. Measured in the hand's own rotated space, with a pad so
  // the lean never uncovers the corner it swings away from, and skipped entirely once the arm
  // already passes the edge (which is every frame of the travel up, and the drop away afterwards).
  const armEnd = (1 - p.gripFy) * hh;
  const missing = frameH > 0 ? (frameH - gripY) + hw * 0.1 - armEnd : 0;
  if (missing > 0) {
    const sh = Math.max(1, Math.round(p.img.naturalHeight * 0.02));
    ctx.drawImage(p.img, 0, p.img.naturalHeight - sh, p.img.naturalWidth, sh,
                  -p.gripFx * hw, armEnd - 1, hw, missing + 1);
  }
  ctx.restore();
}
