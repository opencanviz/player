/**
 * Isometric-block node geometry — a shaded 3-face cuboid (top + two sides) drawn
 * as svgPaths in the node's local box. The editor stores `isoSpec` on the node and
 * recomputes `svgPaths` when it changes (like `plotSpec`). TS twin of the backend
 * `_iso.iso_box`.
 */
export interface IsoSpec {
  w?: number;     // footprint width  (x)
  d?: number;     // footprint depth  (y)
  h?: number;     // height           (z)
  color?: string; // base colour; top is lightened, sides darkened
}

export interface SvgPath {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

function shade(hex: string, f: number): string {
  const n = parseInt((hex || '#3b82f6').replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + (f > 0 ? (255 - c) * f : c * f))));
  return '#' + [adj(r), adj(g), adj(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_ISO_SPEC: IsoSpec = { w: 1, d: 1, h: 1, color: '#3b82f6' };

/** Build the 3 shaded faces of an isometric cuboid, fit into a W x H box. */
export function buildIsoPaths(spec: IsoSpec, W: number, H: number): {
  svgPaths: SvgPath[]; viewBox: { x: number; y: number; w: number; h: number };
} {
  const w = spec.w ?? 1, d = spec.d ?? 1, h = spec.h ?? 1;
  const col = spec.color || '#3b82f6';
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const P = (x: number, y: number, z: number): [number, number] => [(x - y) * c, (x + y) * s - z];

  const v = {
    c100: P(w, 0, 0), c010: P(0, d, 0), c110: P(w, d, 0),
    c001: P(0, 0, h), c101: P(w, 0, h), c011: P(0, d, h), c111: P(w, d, h),
  };
  // Visible faces (viewer from front-top-right): top, the x=w side, the y=d side.
  const faces = [
    { pts: [v.c001, v.c101, v.c111, v.c011], fill: shade(col, 0.24) },  // top
    { pts: [v.c100, v.c110, v.c111, v.c101], fill: shade(col, -0.1) },  // right
    { pts: [v.c010, v.c110, v.c111, v.c011], fill: shade(col, -0.28) }, // left
  ];

  const all = faces.flatMap((f) => f.pts);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const bw = (maxx - minx) || 1, bh = (maxy - miny) || 1;
  const pad = 0.12;
  const scale = Math.min((W * (1 - 2 * pad)) / bw, (H * (1 - 2 * pad)) / bh);
  const ox = (W - bw * scale) / 2 - minx * scale;
  const oy = (H - bh * scale) / 2 - miny * scale;
  const T = (p: [number, number]) => [(p[0] * scale + ox).toFixed(1), (p[1] * scale + oy).toFixed(1)];

  const edge = shade(col, -0.45);
  const svgPaths: SvgPath[] = faces.map((f) => ({
    d: 'M ' + f.pts.map((p) => { const t = T(p); return `${t[0]} ${t[1]}`; }).join(' L ') + ' Z',
    fill: f.fill, stroke: edge, strokeWidth: 1.5,
  }));
  return { svgPaths, viewBox: { x: 0, y: 0, w: W, h: H } };
}
