/**
 * Function-plot node geometry — compute the axes/grid + curve svgPaths for a
 * `plotSpec`, in the node's local [0..W]x[0..H] space. The editor stores `plotSpec`
 * on the node (like `mathTex`), recomputes `svgPaths` when it changes, and the
 * renderer draws them — with `drawProgress` the curve traces on. TS twin of the
 * backend `function_plot` template.
 */
export type PlotFn =
  | 'gaussian' | 'sin' | 'cos' | 'exp' | 'line' | 'parabola' | 'tanh' | 'abs' | 'cube';

export interface PlotSpec {
  fn?: PlotFn;
  params?: Record<string, number>;
  points?: [number, number][];
  xRange?: [number, number];
  yRange?: [number, number];      // omit for auto
  color?: string;
  width?: number;
  fill?: boolean;
}

export interface SvgPath {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

function evalFn(fn: PlotFn, p: Record<string, number>, x: number): number {
  const g = (k: string, d: number) => (p[k] ?? d);
  switch (fn) {
    case 'sin': return g('a', 1) * Math.sin(g('k', 1) * x + g('phase', 0));
    case 'cos': return g('a', 1) * Math.cos(g('k', 1) * x + g('phase', 0));
    case 'gaussian': { const s = g('sigma', 1); return g('a', 1) * Math.exp(-((x - g('mu', 0)) ** 2) / (2 * s * s)); }
    case 'exp': return g('a', 1) * Math.exp(g('k', 1) * x);
    case 'line': return g('m', 1) * x + g('b', 0);
    case 'parabola': return g('a', 1) * (x - g('h', 0)) ** 2 + g('k', 0);
    case 'cube': return g('a', 1) * (x - g('h', 0)) ** 3 + g('k', 0);
    case 'tanh': return g('a', 1) * Math.tanh(g('k', 1) * x);
    case 'abs': return g('a', 1) * Math.abs(x);
    default: return 0;
  }
}

function sample(spec: PlotSpec, xmin: number, xmax: number, n = 160): [number, number][] {
  if (spec.points && spec.points.length) return spec.points.map(([x, y]) => [+x, +y]);
  const fn = spec.fn || 'line';
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = xmin + (xmax - xmin) * (i / n);
    const y = evalFn(fn, spec.params || {}, x);
    if (Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

export const PLOT_GRID = '#94a3b8';
export const PLOT_AXIS = '#475569';

/** Build the axes/grid + curve paths for a plot in a W x H box. */
export function buildPlotPaths(
  spec: PlotSpec,
  W: number,
  H: number,
): { svgPaths: SvgPath[]; viewBox: { x: number; y: number; w: number; h: number } } {
  const [xmin, xmax] = spec.xRange || [-5, 5];
  const pts = sample(spec, xmin, xmax);
  let [ymin, ymax] = spec.yRange || [NaN, NaN];
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) {
    const ys = pts.map((p) => p[1]);
    const lo = ys.length ? Math.min(...ys) : -1;
    const hi = ys.length ? Math.max(...ys) : 1;
    const pad = (hi - lo) * 0.12 || 1;
    if (!Number.isFinite(ymin)) ymin = lo - pad;
    if (!Number.isFinite(ymax)) ymax = hi + pad;
  }
  const X = (x: number) => ((x - xmin) / (xmax - xmin)) * W;
  const Y = (y: number) => (1 - (y - ymin) / (ymax - ymin)) * H;

  const paths: SvgPath[] = [];
  // grid
  let g = '';
  for (let xi = Math.ceil(xmin); xi <= Math.floor(xmax); xi++) {
    if (xi === 0) continue;
    g += `M ${X(xi).toFixed(1)} 0 L ${X(xi).toFixed(1)} ${H} `;
  }
  for (let yi = Math.ceil(ymin); yi <= Math.floor(ymax); yi++) {
    if (yi === 0) continue;
    g += `M 0 ${Y(yi).toFixed(1)} L ${W} ${Y(yi).toFixed(1)} `;
  }
  if (g) paths.push({ d: g, fill: 'none', stroke: PLOT_GRID, strokeWidth: 1, opacity: 0.4 });
  // axes (x=0 or bottom, y=0 or left)
  const ay = ymin < 0 && 0 < ymax ? Y(0) : Y(ymin);
  const axx = xmin < 0 && 0 < xmax ? X(0) : X(xmin);
  paths.push({ d: `M 0 ${ay.toFixed(1)} L ${W} ${ay.toFixed(1)} M ${axx.toFixed(1)} 0 L ${axx.toFixed(1)} ${H}`,
    fill: 'none', stroke: PLOT_AXIS, strokeWidth: 2 });

  // curve (clip y to range)
  const col = spec.color || '#2563eb';
  const sp = pts.map(([x, y]) => [X(x), Y(Math.max(ymin, Math.min(ymax, y)))] as [number, number]);
  if (sp.length >= 2) {
    if (spec.fill) {
      const d = `M ${sp[0][0].toFixed(1)} ${ay.toFixed(1)} ` +
        sp.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') +
        ` L ${sp[sp.length - 1][0].toFixed(1)} ${ay.toFixed(1)} Z`;
      paths.push({ d, fill: col, stroke: 'none', opacity: 0.18 });
    }
    const line = 'M ' + sp.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ');
    paths.push({ d: line, fill: 'none', stroke: col, strokeWidth: spec.width || 3 });
  }
  return { svgPaths: paths, viewBox: { x: 0, y: 0, w: W, h: H } };
}

export const DEFAULT_PLOT_SPEC: PlotSpec = {
  fn: 'gaussian', params: { sigma: 1 }, xRange: [-4, 4], color: '#2563eb', fill: true,
};
