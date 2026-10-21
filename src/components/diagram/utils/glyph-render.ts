/**
 * Procedural, time-animated glyphs — the Lottie alternative.
 *
 * Small status/accent icons drawn directly on the canvas (no raster, no Lottie
 * file), so they stay crisp at any zoom and are fully deterministic. Driven by
 * the scene clock (or wall clock in the editor), like the count-up:
 *   - draw-on glyphs (check / x / arrow) trace their stroke from `drawStartMs`
 *     over `drawDurationMs` — render-time progress, so they persist after.
 *   - the `dot` pulses continuously (a "live" status indicator).
 *
 * A node uses these via `kind: "glyph"` + `glyph: "check"|"x"|"dot"|"arrow"`.
 */
import { getGlobalSketchMode } from './sketch-mode';

type Pt = [number, number];

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

// Draw a polyline up to fraction `p` of its total length (the "draw-on" trace).
function drawPolyPartial(ctx: CanvasRenderingContext2D, pts: Pt[], p: number): void {
  if (p <= 0 || pts.length < 2) return;
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push(d);
    total += d;
  }
  let target = total * p;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const d = segs[i - 1];
    if (target >= d) {
      ctx.lineTo(pts[i][0], pts[i][1]);
      target -= d;
    } else {
      const f = d > 0 ? target / d : 0;
      ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
                 pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
      break;
    }
  }
  ctx.stroke();
}

interface GlyphNode {
  glyph?: string;
  x: number; y: number; w: number; h: number;
  color?: string; stroke?: string; opacity?: number;
  drawStartMs?: number; drawDurationMs?: number; glyphPeriodMs?: number;
}

export function drawGlyph(ctx: CanvasRenderingContext2D, node: GlyphNode, timeMs?: number): void {
  const g = node.glyph;
  if (!g) return;
  const { x, y, w, h } = node;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.min(w, h);
  const color = node.color || node.stroke || '#22c55e';
  const op = node.opacity ?? 1;
  if (op <= 0.01) return;
  const sketch = getGlobalSketchMode();
  const t = timeMs ?? 0;

  ctx.save();
  ctx.globalAlpha = op;
  ctx.lineWidth = Math.max(2, s * 0.11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (g === 'dot') {
    // Pulsing "live" status dot: a soft expanding ring + a solid glowing core.
    const period = node.glyphPeriodMs || 1400;
    const ph = timeMs === undefined ? 0.5 : (Math.sin((t / period) * Math.PI * 2) + 1) / 2;
    const r = s * 0.2;
    ctx.globalAlpha = op * (0.22 + 0.22 * ph);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.5 + 0.7 * ph), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = op;
    if (!sketch) { ctx.shadowColor = color; ctx.shadowBlur = 8 + 7 * ph; }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Draw-on glyphs: progress from drawStartMs over drawDurationMs (eased).
  const start = node.drawStartMs ?? 0;
  const dur = node.drawDurationMs ?? 480;
  const p = timeMs === undefined ? 1 : easeOut(clamp01((t - start) / dur));
  if (!sketch) { ctx.shadowColor = color; ctx.shadowBlur = 6; }

  if (g === 'check') {
    drawPolyPartial(ctx, [
      [x + w * 0.26, y + h * 0.55],
      [x + w * 0.45, y + h * 0.72],
      [x + w * 0.78, y + h * 0.30],
    ], p);
  } else if (g === 'x') {
    drawPolyPartial(ctx, [[x + w * 0.28, y + h * 0.28], [x + w * 0.72, y + h * 0.72]], clamp01(p * 2));
    drawPolyPartial(ctx, [[x + w * 0.72, y + h * 0.28], [x + w * 0.28, y + h * 0.72]], clamp01(p * 2 - 1));
  } else if (g === 'arrow') {
    drawPolyPartial(ctx, [[x + w * 0.16, cy], [x + w * 0.76, cy]], p);
    if (p > 0.66) {
      const hp = clamp01((p - 0.66) / 0.34);
      drawPolyPartial(ctx, [
        [x + w * 0.58, cy - h * 0.17],
        [x + w * 0.80, cy],
        [x + w * 0.58, cy + h * 0.17],
      ], hp);
    }
  }
  ctx.restore();
}
