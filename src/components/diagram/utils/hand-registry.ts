// The catalogue of drawing hands: who they are and how they hold things. NO image bytes.
//
// A hand asset is two things — a picture, and the one point on that picture where the work
// happens. For a WRITE hand that point is the marker nib; for a CARRY hand it is where the
// held object's bottom edge sits against the fingers. Everything else about a hand (its size,
// its sway, its shadow) is computed from the scene, so this pair is the entire contract.
//
// Keeping the catalogue separate from the bytes is what makes a hand LIBRARY possible: this
// module is a few hundred bytes, so every surface that only needs the list of hands (pickers,
// the create page, the outline form) can import it, while the pictures themselves live in
// public/hands and are fetched — or, on the export path, inlined at build time. See
// hand-assets.ts for how the bytes are found.
//
// To add a hand: drop the PNG in public/hands, add a row to BUILT_IN below with its measured
// nib/grip fractions, and it appears in the picker. Nothing else changes. A hand that arrives
// at runtime (a shipped library, or one a user uploads) calls registerHand() with the same
// shape, using a URL or data URI as its `file`.

export type HandKind = 'write' | 'carry';

/** The one hand style that is not a hand: the user chose to have NO drawing hand on screen.
 *  Stored on the document like any other style (artboard.handStyle = 'none'), so it survives
 *  save, reload, embed and export, and stamped by the backend when the create page asked for
 *  it. It lives here — not in the picker — because every module that PAINTS a hand has to be
 *  able to ask "is the hand switched off?" without importing the picker or each other. */
export const NO_HAND = 'none';

// Module state shared by the write hand, the travelling hand and the carry hand. Suppression is
// one global answer, not per-hand: "no hands" means no hands.
let _handsHidden = false;

export function setHandsHidden(v: boolean): void {
  _handsHidden = v;
}

export function handsHidden(): boolean {
  return _handsHidden;
}

/** Built-in ids are spelled out for autocomplete, but the type stays open: library and
 *  user-uploaded hands carry ids this file has never seen, and documents store them verbatim. */
export type WriteHandStyle = 'photoreal' | 'render3d' | (string & {});

export interface HandAsset {
  readonly id: string;
  readonly kind: HandKind;
  /** Shown in the picker. */
  readonly label: string;
  /** Basename under public/hands, or an absolute URL / data URI for a hand added at runtime. */
  readonly file: string;
  /** height / width of the image, so the drawing code only ever has to choose a width. */
  readonly aspect: number;
  /** WRITE: the marker nib, as a fraction of the image's width and height. */
  readonly nibFx?: number;
  readonly nibFy?: number;
  /** CARRY: where the carried object sits on the hand, same units. WHICH point of the object that
   *  is — its bottom-centre or its bottom-left corner — is `gripAt` below. */
  readonly gripFx?: number;
  readonly gripFy?: number;
  /** CARRY: which point of the carried object the grip above refers to. Defaults to bottom-centre.
   *
   *  This exists because a hand that pinches a CORNER cannot be hung from the middle of a picture's
   *  bottom edge. Doing so is what made the first corner hand look welded into the board: the thumb
   *  ended up standing on the picture's face with the whole hand hidden behind it, so it read as a
   *  finger poking out of the wall rather than a hand holding something. Hung from the corner the
   *  pose was actually drawn gripping, the same fingers wrap the picture's real corner, the hand
   *  sits out beyond the picture's outline where it is seen whole, and the picture's own bottom and
   *  left edges land exactly on the edges the magenta card cut into the hand. */
  readonly gripAt?: 'bottom-centre' | 'bottom-left' | 'bottom-right';
}

const BUILT_IN: HandAsset[] = [
  { id: 'photoreal', kind: 'write', label: 'Realistic', file: 'write-photoreal.png',
    aspect: 1.9, nibFx: 0.0065, nibFy: 0.0017 },
  { id: 'render3d', kind: 'write', label: '3D', file: 'write-render3d.png',
    aspect: 1.7194, nibFx: 0.0161, nibFy: 0.0038 },

  // The carry hand was generated holding a solid MAGENTA card so the card could be measured and
  // then deleted; the grip below is that card's own bottom-centre, which is why a picture placed
  // there sits IN the hand rather than near it.
  //
  // gripFy must stay ABOVE zero, and it is what makes this hand's fingers real. An early version
  // of this asset had it at exactly 0, because the model drew the fingers passing BEHIND the card
  // and deleting the card took the fingertips with them. Nothing was wrong while the hand held a
  // picture — the picture's own bottom edge covered the cut precisely — and the moment it let go,
  // two flat stubs were left sitting on blank paper. The hand is now generated in FRONT of the
  // card, so there are real fingertips above the grip and they overlap onto whatever it carries.
  //
  // The arm is swung in on a diagonal, so most of each image is arm reaching in from off-frame and
  // the grip sits near one edge of it. That diagonal is what makes the gesture read as CARRYING
  // something across; the upright version that came before it read as a fist holding up a placard,
  // however good the fingers were.
  //
  // The three carry hands differ in one number that matters more than it looks: how far the
  // fingers reach ABOVE the grip, as a fraction of the hand's width. The renderer sizes a hand off
  // the picture's WIDTH, so that fraction alone decides how far up the picture's FACE the fingers
  // land. The first shallow-grip attempt reached a quarter of the way up a landscape picture and
  // read as grabbing the artwork rather than holding the frame. These reach 12% (corner), 16%
  // (pinch) and 14% (hook) of their own width, which lands on the picture's bottom edge.
  // Pinches a CORNER, so it hangs from the picture's bottom-left corner rather than the middle of
  // its bottom edge — see gripAt above for why that distinction is the difference between a hand
  // holding a picture and a hand that looks embedded in the board behind it.
  { id: 'carry-render3d', kind: 'carry', label: 'Corner', file: 'carry-render3d.png',
    aspect: 1.9661, gripFx: 0.3894, gripFy: 0.0594, gripAt: 'bottom-left' },
  // Holds the bottom edge rather than a corner, with the hand on the opposite side of the picture
  // from the default. Worth having as a pair: a picture arriving from the left wants the hand that
  // trails to the right of it, so the arm reads as coming from where the picture came from.
  //
  // Grips the picture's bottom-RIGHT corner, which is the mirror of the corner hand above and for
  // the same reason. It was calibrated as a bottom-CENTRE hold, and that is not what the asset
  // shows: the magenta card's own right edge is cut into this hand at 0.545 of its width, with the
  // card running off to the left. Held from the middle instead, a picture drifted a third of a
  // hand-width to the right of where the fingers are, so it floated clear above the fingertips
  // with only the thumb touching it and the whole hand hanging underneath holding nothing. The
  // numbers below are that cut, measured off the image.
  { id: 'carry-pinch', kind: 'carry', label: 'Edge pinch', file: 'carry-pinch.png',
    aspect: 2.0081, gripFx: 0.5450, gripFy: 0.0900, gripAt: 'bottom-right' },
  // Two fingers hooked over the edge, the rest of the hand hanging loose. The most casual of the
  // three, and the most legible at small sizes because the silhouette is two fingers, not a fist.
  { id: 'carry-hook', kind: 'carry', label: 'Hooked', file: 'carry-hook.png',
    aspect: 1.9919, gripFx: 0.2132, gripFy: 0.0720 },
];

const REGISTRY = new Map<string, HandAsset>(BUILT_IN.map((h) => [h.id, h]));

export const DEFAULT_WRITE_HAND_STYLE: WriteHandStyle = 'photoreal';
export const DEFAULT_CARRY_HAND = 'carry-render3d';

/** Add or replace a hand at runtime: a hand shipped in a library payload, or one a user
 *  uploaded and calibrated. `file` may be an absolute URL or a data URI. */
export function registerHand(asset: HandAsset): void {
  REGISTRY.set(asset.id, asset);
}

export function getHand(id: string | undefined, kind: HandKind = 'write'): HandAsset {
  const h = id ? REGISTRY.get(id) : undefined;
  if (h && h.kind === kind) return h;
  // An unknown id is normal, not an error: a document can name a hand from a library this build
  // doesn't have, or one that was removed. Falling back keeps the video drawing a hand.
  return REGISTRY.get(kind === 'carry' ? DEFAULT_CARRY_HAND : DEFAULT_WRITE_HAND_STYLE)!;
}

export function listHands(kind: HandKind): HandAsset[] {
  const out: HandAsset[] = [];
  REGISTRY.forEach((h) => { if (h.kind === kind) out.push(h); });
  return out;
}

/** The built-in picker list, snapshotted at load. Kept for callers that want a plain constant;
 *  anything that must also show hands registered later should call listHands('write') instead. */
export const WRITE_HAND_STYLES: { readonly id: WriteHandStyle; readonly label: string }[] =
  listHands('write').map((h) => ({ id: h.id, label: h.label }));
