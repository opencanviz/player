/**
 * Felt-tip MARKER strokes for edges.
 *
 * The sketch look (rough.js) draws every line twice with a wide wobble, which reads as a pencil
 * sketch: tentative, searching for the line. A marker is the opposite gesture — one confident
 * pass, laid down wet. What actually tells the eye it is a marker is not wobble at all:
 *
 *   - the width BREATHES along the stroke, because a felt tip loads and unloads ink;
 *   - the ends are dabs rather than machined caps, slightly narrower where the tip lands and
 *     lifts;
 *   - the ink is very slightly transparent with a soft fringe, so it sits ON the paper instead
 *     of being cut into it.
 *
 * So this draws a filled RIBBON down the path rather than stroking a constant-width line. Every
 * wiggle is a deterministic function of the edge id, never of time: a stroke that re-jitters each
 * frame is the single most obvious tell that a hand-drawn look is fake, and it is the same trap
 * the rough renderer had to be pinned with a fixed seed to avoid.
 */
import type { EdgeModel, Vec2 } from '../types';

type Sample = { x: number; y: number; nx: number; ny: number; d: number };

/** A small, stable number per edge, so the same line wobbles the same way on every frame. */
function seedOf(edge: EdgeModel): number {
  if (typeof edge.roughSeed === 'number') return edge.roughSeed % 997;
  const id = String(edge.id || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
  return h % 997;
}

/** Two out-of-phase sines: enough irregularity to read as a hand, none of it random. */
function wave(seed: number, u: number, a: number, b: number): number {
  return Math.sin(seed * 0.61 + u * a) * 0.62 + Math.sin(seed * 1.73 + u * b) * 0.38;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Walk the polyline between two arc-length positions, dropping a sample every `step` px and
 * carrying the unit NORMAL at each one. Corners get a sample on both sides so the ribbon turns
 * instead of pinching.
 */
function sampleSpan(pts: Vec2[], from: number, to: number, step: number): Sample[] {
  const out: Sample[] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 0.0001) continue;
    const segStart = acc;
    acc += seg;
    const lo = Math.max(from, segStart);
    const hi = Math.min(to, acc);
    if (hi <= lo) continue;
    const ux = (b.x - a.x) / seg;
    const uy = (b.y - a.y) / seg;
    const nx = -uy;
    const ny = ux;
    const n = Math.max(1, Math.ceil((hi - lo) / step));
    for (let k = 0; k <= n; k++) {
      const d = lo + ((hi - lo) * k) / n;
      const t = (d - segStart) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx, ny, d });
    }
  }
  return out;
}

/** One dab of ink: the ribbon for a single continuous run of the stroke. */
function ribbon(
  ctx: CanvasRenderingContext2D,
  samples: Sample[],
  half: number,
  seed: number,
  totalLen: number,
  wobble: number,
): void {
  if (samples.length < 2) return;
  const runLen = samples[samples.length - 1].d - samples[0].d;
  // The tip lands and lifts over a few pixels; on a very short run the dab never reaches full
  // width, which is exactly what a short marker tick looks like.
  const lead = Math.min(5, runLen * 0.3);
  const tail = Math.min(8, runLen * 0.34);
  const d0 = samples[0].d;

  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (const s of samples) {
    const local = s.d - d0;
    const u = totalLen > 0 ? s.d / totalLen : 0;
    // Ink load along the stroke, plus the dab at each end.
    const press = 1 + 0.12 * wave(seed, u, 9.1, 21.7);
    const ends = 0.58 + 0.42 * smoothstep(Math.min(
      lead > 0 ? local / lead : 1,
      tail > 0 ? (runLen - local) / tail : 1,
    ));
    const w = Math.max(0.4, half * press * ends);
    // The whole centreline drifts a hair off true, the way a hand-held pen does.
    const off = wobble * wave(seed + 11, u, 5.3, 12.9);
    const cx = s.x + s.nx * off;
    const cy = s.y + s.ny * off;
    left.push([cx + s.nx * w, cy + s.ny * w]);
    right.push([cx - s.nx * w, cy - s.ny * w]);
  }

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
}

export type MarkerDash = { on: number; off: number; offset: number } | null;

/**
 * Draw `edge` between two arc-length positions as a marker stroke. `ctx.lineWidth` is the width
 * the caller wants (it may already carry a pulse animation), and `ctx.strokeStyle` its colour.
 */
export function drawMarkerEdge(
  ctx: CanvasRenderingContext2D,
  edge: EdgeModel,
  pts: Vec2[],
  start: number,
  end: number,
  dash: MarkerDash = null,
): void {
  if (pts.length < 2 || end <= start) return;
  const color = (ctx.strokeStyle as string) || edge.stroke || '#9aa6bc';
  // A nib is a physical thing: the thinnest felt tip anyone owns still lays down about this much.
  // Below it the breathing has no room to show and the stroke is indistinguishable from a clean
  // line, which is the whole reason to have asked for a marker.
  const width = Math.max(3, ctx.lineWidth || edge.width || 2);
  const half = width * 0.62;          // a marker lays down a little more than the nominal width
  const seed = seedOf(edge);
  const wobble = Math.min(1.1, width * 0.28);

  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);

  // Runs of ink: one for a solid line, many for a dashed or dotted one. A dashed marker line is
  // a row of separate dabs, so each run tapers at both ends on its own.
  const runs: Array<[number, number]> = [];
  if (dash && dash.on > 0 && dash.off > 0) {
    const period = dash.on + dash.off;
    // Anchor the pattern to the START OF THE PATH, not to the trim point, so a line that is
    // being drawn on does not slide its own dashes along underneath itself. `offset` is the
    // canvas lineDashOffset, which is where in the pattern distance zero sits.
    const base = (((-dash.offset) % period) + period) % period - period;
    let cursor = base + Math.floor((start - base) / period) * period;
    while (cursor < end) {
      const a = Math.max(start, cursor);
      const b = Math.min(end, cursor + dash.on);
      if (b > a) runs.push([a, b]);
      cursor += period;
    }
  } else {
    runs.push([start, end]);
  }

  const prevAlpha = ctx.globalAlpha;
  const prevDash = ctx.getLineDash();
  const prevJoin = ctx.lineJoin;
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;

  for (const [a, b] of runs) {
    const samples = sampleSpan(pts, a, b, 3.5);
    if (samples.length < 2) continue;
    ribbon(ctx, samples, half, seed, total || 1, wobble);
    // The fringe first: a soft halo of the same ink, which is what stops the stroke looking
    // like a cut-out shape and makes it sit on the paper.
    ctx.globalAlpha = prevAlpha * 0.16;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, width * 0.45);
    ctx.stroke();
    // …then the body, a shade under full opacity so crossing strokes darken where they meet.
    ctx.globalAlpha = prevAlpha * 0.94;
    ctx.fill();
  }

  ctx.globalAlpha = prevAlpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = prevJoin;
  ctx.setLineDash(prevDash);
}
