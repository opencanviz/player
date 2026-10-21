/**
 * pathMarker — a dot that rides a polyline at a tweenable parameter `pathT` (0..1
 * by arc length), with optional tangent line (derivative) and radius + drop-lines
 * to a center (unit-circle sin/cos). One node, evaluated atomically, so it sweeps
 * smoothly without follow-edge desync. Powers tangent_line, unit_circle, trajectory.
 */
import type { NodeModel } from '../types';

type Pt = [number, number];

export function drawPathMarker(ctx: CanvasRenderingContext2D, node: NodeModel): void {
  const n = node as any;
  const pts: Pt[] = n.pathPts;
  if (!pts || pts.length < 2) return;
  const t = Math.max(0, Math.min(1, n.pathT ?? 0));

  // Parameterize by SAMPLE INDEX (uniform), not arc length — so a point sweeps the
  // curve at the curve's natural pace (uniform x for an x-sampled curve, uniform
  // angle for a circle) instead of lingering at steep parts and zooming flat ones.
  const N = pts.length;
  const idx = t * (N - 1);
  let i = Math.max(0, Math.min(N - 2, Math.floor(idx)));
  const f = idx - i;
  const a = pts[i], b = pts[i + 1];
  const px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f;
  // Smoothed (centered) tangent over a small window so it doesn't snap per segment.
  const lo = Math.max(0, i - 1), hi = Math.min(N - 1, i + 2);
  let dx = pts[hi][0] - pts[lo][0], dy = pts[hi][1] - pts[lo][1];
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;

  ctx.save();
  ctx.globalAlpha = node.opacity ?? 1;
  ctx.lineCap = 'round';
  const lineCol = n.pathLineColor || '#8794ab';

  // radius line + sin/cos drop-lines to a center (unit circle)
  if (n.pathCenterX !== undefined && n.pathCenterY !== undefined) {
    const cx = n.pathCenterX, cy = n.pathCenterY;
    ctx.strokeStyle = n.pathRadiusColor || '#e6edf6';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = n.cosColor || '#22d3ee';      // horizontal extent = cos
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.stroke();
    ctx.strokeStyle = n.sinColor || '#f59e0b';        // vertical extent = sin
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, py); ctx.stroke();
    ctx.setLineDash([]);
  }

  // tangent line (derivative)
  if (n.pathTangent) {
    const L = n.pathTangentLen ?? 64;
    ctx.strokeStyle = n.tangentColor || '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(px - dx * L, py - dy * L); ctx.lineTo(px + dx * L, py + dy * L); ctx.stroke();
  }

  // the dot
  const r = n.pathMarkerR ?? 5;
  ctx.fillStyle = n.pathMarkerColor || '#f43f5e';
  ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
