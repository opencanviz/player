import type { NodeModel } from '../types';

/**
 * The drawProgress wipe on an IMAGE node, in one place for every image draw path.
 *
 * 'y' (default) uncovers the picture top to bottom and 'x' left to right, each with a hard edge,
 * which is what a sketched-in picture or a written word wants. 'radial' is the SPREAD: the picture
 * grows out of `wipeOrigin` (fractions of the node box, default the centre) in a widening circle
 * with a soft front, which is how a change moves through a scene that is already on screen (a
 * field withering out from one corner, a fire spreading across a city). The front is soft so the
 * new state bleeds into the old one instead of arriving as a disc with a hard rim.
 *
 * The soft edge is drawn as a few concentric bands of falling alpha rather than through an
 * offscreen mask: it works in whatever transform the camera has set, costs only while the wipe is
 * running (drawProgress < 1), and a finished node is a single plain drawImage again.
 */
const RADIAL_BANDS = 10;
const RADIAL_SOFT = 0.22;   // feather width, as a share of the farthest corner's distance

export function drawImageWithWipe(
  ctx: CanvasRenderingContext2D, node: NodeModel, draw: () => void,
): void {
  const dp = (node as { drawProgress?: number }).drawProgress ?? 1;
  if (dp >= 1) { draw(); return; }
  if (dp <= 0) return;
  const ax = (node as { wipeAxis?: 'x' | 'y' | 'radial' }).wipeAxis ?? 'y';
  if (ax !== 'radial') {
    ctx.save();
    ctx.beginPath();
    if (ax === 'x') ctx.rect(node.x, node.y, node.w * dp, node.h);
    else ctx.rect(node.x, node.y, node.w, node.h * dp);
    ctx.clip();
    draw();
    ctx.restore();
    return;
  }
  const o = (node as { wipeOrigin?: [number, number] }).wipeOrigin;
  const fx = Array.isArray(o) && Number.isFinite(o[0]) ? o[0] : 0.5;
  const fy = Array.isArray(o) && Number.isFinite(o[1]) ? o[1] : 0.5;
  const ox = node.x + node.w * fx;
  const oy = node.y + node.h * fy;
  const far = Math.max(
    Math.hypot(node.x - ox, node.y - oy),
    Math.hypot(node.x + node.w - ox, node.y - oy),
    Math.hypot(node.x - ox, node.y + node.h - oy),
    Math.hypot(node.x + node.w - ox, node.y + node.h - oy),
  );
  // `wipeSoft` widens or narrows the front. A wipe from an origin set well outside the box (a
  // near-straight sweep across the frame) has a far corner a long way off, so the default share
  // of that distance would smear the front across half the picture.
  const ws = (node as { wipeSoft?: number }).wipeSoft;
  const share = typeof ws === 'number' && Number.isFinite(ws) ? Math.max(0, Math.min(1, ws)) : RADIAL_SOFT;
  const soft = Math.max(1, far * share);
  // At dp = 1 the INNER edge of the feather has reached the farthest corner, so the last frame of
  // the wipe and the first frame after it are the same picture.
  const r = dp * (far + soft);
  const base = ctx.globalAlpha;
  const inner = r - soft;
  if (inner > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ox, oy, inner, 0, Math.PI * 2);
    ctx.clip();
    draw();
    ctx.restore();
  }
  const band = soft / RADIAL_BANDS;
  for (let k = 0; k < RADIAL_BANDS; k++) {
    const ri = inner + k * band;
    const ro = ri + band;
    if (ro <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ox, oy, ro, 0, Math.PI * 2);
    if (ri > 0) ctx.arc(ox, oy, ri, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
    ctx.globalAlpha = base * (1 - (k + 0.5) / RADIAL_BANDS);
    draw();
    ctx.restore();
  }
  ctx.globalAlpha = base;
}
