/**
 * Per-frame edge-label collision registry.
 *
 * Two labeled edges whose ROUTED paths pass through the same region draw their
 * label pills on top of each other (the classic case: two orthogonal edges
 * sharing a corridor, both labels at t=0.5). The layout engine can't predict
 * this — label positions depend on obstacle-avoiding edge routing that only
 * exists at draw time — so collisions are resolved here, where the true paths
 * are known.
 *
 * Usage: the scene compositor / editor canvas calls resetLabelCollisions() at
 * the start of each frame's edge pass; every label draw site computes its pill
 * rect at a few candidate positions along its own edge (t = 0.5 first) and
 * claims the first free one via claimLabelRect(). Deterministic — draw order
 * is stable — so preview, export, and the headless renderer stay
 * pixel-identical.
 */

export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let _rects: LabelRect[] = [];

export function resetLabelCollisions(): void {
  _rects = [];
}

function _hits(a: LabelRect, b: LabelRect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

/**
 * Claim the first candidate rect that doesn't collide with an already-claimed
 * label and return its index. If every candidate collides, the first (the
 * edge's natural position) is claimed anyway — never worse than today.
 */
export function claimLabelRect(candidates: LabelRect[]): number {
  for (let i = 0; i < candidates.length; i++) {
    if (!_rects.some((r) => _hits(r, candidates[i]))) {
      _rects.push(candidates[i]);
      return i;
    }
  }
  _rects.push(candidates[0]);
  return 0;
}

/** Candidate positions along the edge, natural position first. */
export const LABEL_T_CANDIDATES = [0.5, 0.35, 0.65, 0.22, 0.78];
