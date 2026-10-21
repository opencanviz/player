/**
 * vector2d — a movable 2D arrow drawn as ONE node from (arrowTailX, arrowTailY)
 * to (arrowTipX, arrowTipY), with the head computed analytically each frame from
 * those four props. Because tail AND tip live on the same node and are evaluated
 * together, they can't desync — unlike the old origin-node + tip-node + follow-edge
 * (which recomputed the head from two drifting endpoints and flickered).
 *
 * This is the "free positioning" half of the vector toolkit: tween the tip to any
 * point, slide the tail (free vectors), chain tail=other.tip (vector addition),
 * walk an arbitrary path. The affine_vector primitive covers the other half
 * (vectors that ride a shared linear map of the whole space).
 */
import type { NodeModel } from '../types';

export function drawVector2d(ctx: CanvasRenderingContext2D, node: NodeModel): void {
  const n = node as any;
  if (n.arrowTipX === undefined || n.arrowTipY === undefined) return;
  const tailX = n.arrowTailX ?? 0, tailY = n.arrowTailY ?? 0;
  const tipX = n.arrowTipX, tipY = n.arrowTipY;
  const color = n.arrowColor || '#ef4444';
  const width = n.arrowWidth ?? 3;
  const head = n.arrowHead ?? 13;
  const hw = head * 0.5;

  const dx = tipX - tailX, dy = tipY - tailY;
  const len = Math.hypot(dx, dy);
  ctx.save();
  ctx.globalAlpha = node.opacity ?? 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Degenerate (near-zero length): just a dot — never derive a head angle from
  // ~0 length (that was a flicker source). A real vector is never this short.
  if (len < 1.2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tipX, tipY, Math.max(2, width), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const ux = dx / len, uy = dy / len;          // unit direction
  const px = -uy, py = ux;                       // perpendicular
  const headLen = Math.min(head, len);           // don't overshoot a tiny vector
  const baseX = tipX - headLen * ux, baseY = tipY - headLen * uy;

  // Shaft (stop at the head base so the line doesn't poke through the tip).
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(tailX, tailY);
  ctx.lineTo(baseX, baseY);
  ctx.stroke();

  // Filled arrowhead.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + hw * px, baseY + hw * py);
  ctx.lineTo(baseX - hw * px, baseY - hw * py);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
