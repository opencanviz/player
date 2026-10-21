/**
 * Glowing-node treatment, drawn as additive passes WRAPPED AROUND the normal
 * node render (no surgery in the core paint path). Shared by export
 * (scene-compositor) and editor (canvas-render). Off in sketch mode.
 *
 * THE GLOW is a `shadowBlur` cast by the node's OWN shape (the standard neon
 * technique): trace the shape, set shadowColor + shadowBlur (offset 0), stroke.
 * The shadow hugs the exact outline (circle/rect/cyl/diamond/funnel), is bounded
 * by the blur radius (so it can't flood the frame or render as a rectangle), and
 * needs no gradient/fillRect. Levels:
 *  - `glow` (0..1): the shadow glow. Default-on for solid entity nodes.
 *  - `glassy` (circle/rect): dark glass body + 2-stop gradient border.
 *  - `sublabel` (circles): a dim mono line below the node.
 * All keyed off `haloColor` (the node's identity tone) || its fill/stroke.
 */
import type { NodeModel } from '../types';
import { getGlobalSketchMode } from './sketch-mode';
import { drawDiamond, drawFunnel, drawCylinder, resolveCylinderOrientation } from './geometry-utils';

const TAU = Math.PI * 2;
const GLASS_TOP = '#141b28';
const GLASS_EDGE = '#080a10';

function toRgb(color: string): [number, number, number] | null {
  if (!color || color[0] !== '#') return null;
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
// A node's color/haloColor may arrive as a THEME TONE keyword (e.g. "info", "accent")
// rather than a hex — resolve those, and never hand an unparseable value to the canvas
// (addColorStop throws on a string it can't parse to a color, which crashes the render).
const _TONE_HEX: Record<string, string> = {
  info: '#3b82f6', ok: '#22c55e', good: '#22c55e', warn: '#ef4444', bad: '#ef4444',
  danger: '#ef4444', accent: '#f59e0b', hub: '#8b5cf6', neutral: '#94a3b8',
};
function resolveColor(color: string): string {
  return _TONE_HEX[(color || '').toLowerCase()] || color;
}
function withAlpha(color: string, alpha: number): string {
  const rgb = toRgb(resolveColor(color));
  if (!rgb) return 'transparent';          // safe fallback — never a color addColorStop can't parse
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}
function lighten(color: string, amt: number): string {
  const rgb = toRgb(resolveColor(color));
  if (!rgb) return 'transparent';
  const m = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${m(rgb[0])}, ${m(rgb[1])}, ${m(rgb[2])})`;
}
const _visible = (c?: string): boolean => !!c && c !== 'transparent' && c !== 'none';

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface GlowGeom {
  kind: 'circle' | 'rect' | 'cyl' | 'diamond' | 'funnel';
  cx: number; cy: number; r: number;
  x: number; y: number; w: number; h: number; rx: number;
  glow: number; op: number; glassy: boolean; color: string;
}

/** Trace the node's exact outline as the current path (for stroke/fill/clip). */
function traceShape(ctx: CanvasRenderingContext2D, g: GlowGeom, node: NodeModel): void {
  switch (g.kind) {
    case 'circle': ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, TAU); break;
    case 'cyl': drawCylinder(ctx, g.x, g.y, g.w, g.h, resolveCylinderOrientation((node as any).cylinderOrientation, g.w, g.h)); break;
    case 'diamond': drawDiamond(ctx, g.x, g.y, g.w, g.h); break;
    case 'funnel': drawFunnel(ctx, g.x, g.y, g.w, g.h); break;
    default: roundRectPath(ctx, g.x, g.y, g.w, g.h, g.rx); break;
  }
}

function glowGeom(node: NodeModel): GlowGeom | null {
  if (getGlobalSketchMode()) return null;
  if ((node as { noGlow?: boolean }).noGlow) return null;   // e.g. shockwave rings
  const HALOABLE = ['circle', 'rect', 'cylinder', 'diamond', 'funnel'];
  if (!HALOABLE.includes(node.kind)) return null;
  const n = node as any;
  const op = node.opacity ?? 1;
  if (op <= 0.01) return null;
  const glassy = !!n.glassy && (node.kind === 'circle' || node.kind === 'rect');
  let glow = typeof n.glow === 'number' ? n.glow : 0;
  const fillVis = _visible(node.fill);
  const strokeVis = _visible(node.stroke);
  if (glow <= 0 && !glassy) {
    if (!fillVis && !strokeVis) return null;
    if (Math.min(node.w, node.h) < 46 || node.w < 70) return null;
    glow = node.kind === 'circle' ? 0.45 : 0.4;
  }
  // Resolve tone keywords ("info"/"accent"/…) to hex and guarantee a parseable color —
  // g.color is used raw in addColorStop (e.g. drawNodeGlowStroke), which throws on any
  // value the canvas can't parse. Fall back to the default so the render can never crash.
  const rawColor = n.haloColor || (fillVis ? node.fill : node.stroke) || '#60a5fa';
  const resolved = resolveColor(rawColor);
  const color = toRgb(resolved) ? resolved : '#60a5fa';
  return {
    kind: (node.kind === 'cylinder' ? 'cyl' : node.kind) as GlowGeom['kind'],
    cx: node.x + node.w / 2, cy: node.y + node.h / 2, r: Math.min(node.w, node.h) / 2,
    x: node.x, y: node.y, w: node.w, h: node.h, rx: n.cornerRadius ?? 10,
    glow: glow > 0 ? glow : 0.6, op, glassy, color,
  };
}

/** Shadow-blur glow (+ glass body for glassy). Call BEFORE the node. */
export function drawNodeGlowBehind(ctx: CanvasRenderingContext2D, node: NodeModel): void {
  const g = glowGeom(node);
  if (!g) return;
  ctx.save();
  ctx.globalAlpha = g.op;

  // The glow: the node's own outline, stroked with a colored shadow blur. The
  // shadow IS the glow — shape-accurate, bounded by blur (no flood / no rect).
  ctx.shadowColor = g.color;
  ctx.shadowBlur = Math.max(8, 24 * g.glow);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = g.color;
  ctx.lineWidth = 2;
  traceShape(ctx, g, node); ctx.stroke();
  traceShape(ctx, g, node); ctx.stroke();   // second pass deepens the glow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (g.glassy) {
    // Glass body fill (circle = radial from the top; rect = vertical gradient).
    const body = g.kind === 'circle'
      ? ctx.createRadialGradient(g.cx, g.cy - g.r * 0.3, g.r * 0.1, g.cx, g.cy, g.r)
      : ctx.createLinearGradient(g.cx, g.y, g.cx, g.y + g.h);
    body.addColorStop(0, GLASS_TOP);
    body.addColorStop(1, GLASS_EDGE);
    traceShape(ctx, g, node);
    ctx.fillStyle = body;
    ctx.fill();
    // Identity-colored inner highlight, clipped to the shape (no spill).
    ctx.save();
    traceShape(ctx, g, node);
    ctx.clip();
    const inner = ctx.createRadialGradient(g.cx, g.y + g.h * 0.2, 0, g.cx, g.y + g.h * 0.2, Math.max(g.w, g.h) * 0.7);
    inner.addColorStop(0, withAlpha(g.color, 0.18));
    inner.addColorStop(1, withAlpha(g.color, 0));
    ctx.fillStyle = inner;
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.restore();
  }
  ctx.restore();
}

/** Crisp gradient border for glassy nodes (the glow is already behind) + sublabel. Call AFTER the node. */
export function drawNodeGlowStroke(ctx: CanvasRenderingContext2D, node: NodeModel): void {
  const g = glowGeom(node);
  if (!g) return;
  if (g.glassy) {
    ctx.save();
    ctx.globalAlpha = g.op;
    const grad = ctx.createLinearGradient(g.cx, g.y, g.cx, g.y + g.h);
    grad.addColorStop(0, lighten(g.color, 0.4));
    grad.addColorStop(1, g.color);
    traceShape(ctx, g, node);
    ctx.strokeStyle = grad;
    ctx.lineWidth = (node as any).strokeWidth ?? 2.5;
    ctx.stroke();
    ctx.restore();
  }

  const sub = (node as any).sublabel;
  if (sub && g.kind === 'circle') {
    ctx.save();
    ctx.globalAlpha = g.op;
    ctx.fillStyle = '#7d8694';
    ctx.font = `500 ${Math.max(10, Math.round(g.r * 0.32))}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(sub), g.cx, g.cy + g.r + 14);
    ctx.restore();
  }
}
