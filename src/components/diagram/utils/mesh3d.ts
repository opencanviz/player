/**
 * mesh3d renderer — the Tier 3 3D engine. A node carrying `mesh3d` (3D vertices +
 * edges/faces) and a tweenable `rot3dX/Y/Z` is rotated, projected (ortho/persp),
 * back-face-culled + painter-sorted, flat-shaded, and drawn into the node box.
 *
 * Design: the 3D DATA lives on the node; the projection lives here (model/view
 * separation) — so rotation is "free" (change rot3d, re-project) and backend- and
 * editor-authored meshes render identically. See docs / the Tier 3 plan.
 */
import type { NodeModel } from '../types';

type V3 = [number, number, number];

export interface Mesh3D {
  vertices: V3[];
  edges?: [number, number][];
  faces?: number[][];        // CCW from outside, so normals point outward
  faceColor?: string;
  faceColors?: (string | null)[]; // per-face color (index-aligned to faces)
  faceOpacity?: number;      // <1 => translucent "glass" — no cull, full depth sort
  faceOpacities?: (number | null)[]; // per-face alpha override (glass cube + solid arrows)
  edgeColor?: string;
  edgeColors?: (string | null)[]; // per-edge color (index-aligned to edges)
  edgeWidth?: number;
  light?: V3;
  scaleMask?: number[]; // per-vertex 0..1 — how much meshScale applies (1=object, 0=fixed frame)
  labels?: Label3D[]; // 3D-anchored text that tracks the transform (axis names, vectors)
  markerColor?: string; // shaded ball at (markerX,markerY,markerZ) — a point that rides the surface
  markerR?: number;     // marker radius in mesh units (default 0.14)
  dots?: boolean;       // render each vertex as a filled dot (lattice / point-cloud look)
  dotColor?: string;    // dot fill (fallback when no per-vertex dotColors)
  dotColors?: (string | null)[]; // per-vertex dot color (index-aligned to vertices)
  dotR?: number;        // dot radius in mesh units (default 0.05)
}

export interface Label3D {
  at: V3;          // mesh-local anchor point
  text: string;
  color?: string;
  size?: number;
  fixed?: boolean; // true => stays with the coordinate frame; false => rides the object
  italic?: boolean; // italic serif (the "Column Space" hand-label look)
  font?: string;   // explicit font-family override
}

/** Editor authoring spec — a named preset + size/color. buildMesh() turns it into a Mesh3D. */
export interface MeshSpec {
  preset: 'cube' | 'box' | 'pyramid' | 'axes' | 'prism';
  sx?: number; sy?: number; sz?: number; // box dimensions (relative)
  color?: string;
  wireframe?: boolean;
}

export const DEFAULT_MESH_SPEC: MeshSpec = { preset: 'cube', sx: 1, sy: 1, sz: 1, color: '#3b82f6' };

/** Unique undirected edges of a face list — turns any solid into a wireframe. */
function edgesFromFaces(faces: number[][]): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  }
  return edges;
}

/** Pure builder: MeshSpec -> Mesh3D data. Mirrors the backend _mesh3d.py builders. */
export function buildMesh(spec: MeshSpec): Mesh3D {
  const color = spec.color || '#3b82f6';
  const sx = spec.sx ?? 1, sy = spec.sy ?? 1, sz = spec.sz ?? 1;
  if (spec.preset === 'axes') {
    const L = 1;
    return {
      vertices: [[0, 0, 0], [L, 0, 0], [0, L, 0], [0, 0, L]],
      edges: [[0, 1], [0, 2], [0, 3]],
      edgeColor: color, edgeWidth: 2.5,
    };
  }
  if (spec.preset === 'pyramid') {
    const verts: V3[] = [
      [-sx, 0, -sz], [sx, 0, -sz], [sx, 0, sz], [-sx, 0, sz], [0, sy * 1.6, 0],
    ];
    return {
      vertices: verts,
      faces: [[0, 1, 2, 3], [0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]],
      edges: spec.wireframe ? [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]] : undefined,
      faceColor: color,
    };
  }
  if (spec.preset === 'prism') {
    const verts: V3[] = [
      [-sx, -sy, sz], [sx, -sy, sz], [0, sy, sz],
      [-sx, -sy, -sz], [sx, -sy, -sz], [0, sy, -sz],
    ];
    const faces = [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]];
    return spec.wireframe
      ? { vertices: verts, edges: edgesFromFaces(faces), edgeColor: color, edgeWidth: 2 }
      : { vertices: verts, faces, faceColor: color };
  }
  // cube / box — 8 corners, 6 quad faces wound CCW from outside (normals point out)
  const verts: V3[] = [
    [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz],   // 0-3 front (+z)
    [-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz], // 4-7 back (-z)
  ];
  const faces = [
    [0, 1, 2, 3], // front +z
    [5, 4, 7, 6], // back -z
    [1, 5, 6, 2], // right +x
    [4, 0, 3, 7], // left -x
    [3, 2, 6, 7], // top +y
    [4, 5, 1, 0], // bottom -y
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return spec.wireframe
    ? { vertices: verts, edges, edgeColor: color, edgeWidth: 2 }
    : { vertices: verts, faces, edges: undefined, faceColor: color };
}

function shade(hex: string, f: number): string {
  const n = parseInt((hex || '#3b82f6').replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + (f > 0 ? (255 - c) * f : c * f))));
  return '#' + [adj(r), adj(g), adj(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function rotate([x, y, z]: V3, rx: number, ry: number, rz: number): V3 {
  let cz = Math.cos(rz), sz = Math.sin(rz);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];           // Rz
  let cy = Math.cos(ry), sy = Math.sin(ry);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];          // Ry
  let cx = Math.cos(rx), sx = Math.sin(rx);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];           // Rx
  return [x, y, z];
}

export function drawMesh3d(ctx: CanvasRenderingContext2D, node: NodeModel): void {
  const m = (node as any).mesh3d as Mesh3D | undefined;
  if (!m || !m.vertices || m.vertices.length === 0) return;
  const { x, y, w, h } = node;
  const rx = ((node as any).rot3dX || 0) * Math.PI / 180;
  const ry = ((node as any).rot3dY || 0) * Math.PI / 180;
  const rz = ((node as any).rot3dZ || 0) * Math.PI / 180;
  const msx = (node as any).meshScaleX ?? 1;
  const msy = (node as any).meshScaleY ?? 1;
  const msz = (node as any).meshScaleZ ?? 1;

  // Centre the mesh, then apply the (animatable) per-axis 3D scale, then rotate.
  // The fit radius is taken from the UNSCALED mesh so scaling visibly grows /
  // shrinks the object (matrix transform) instead of being normalised away.
  const c: V3 = [0, 0, 0];
  for (const v of m.vertices) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  c[0] /= m.vertices.length; c[1] /= m.vertices.length; c[2] /= m.vertices.length;
  let radius = 0;
  for (const v of m.vertices) radius = Math.max(radius, Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]));
  radius = radius || 1;
  // Full 3x3 linear map (tm11..tm33, identity by default) applied AFTER the
  // diagonal scale — animate it from identity to rotate / shear / SVD a cube.
  const a = (node as any).tm11 ?? 1, b = (node as any).tm12 ?? 0, cc = (node as any).tm13 ?? 0;
  const d = (node as any).tm21 ?? 0, e = (node as any).tm22 ?? 1, f3 = (node as any).tm23 ?? 0;
  const g3 = (node as any).tm31 ?? 0, h3 = (node as any).tm32 ?? 0, i3 = (node as any).tm33 ?? 1;
  // A per-vertex scaleMask lets one part of a composite transform while another
  // (the coordinate frame) stays fixed: g=1 => full transform, g=0 => identity.
  const mask = m.scaleMask;
  const scale = (Math.min(w, h) * 0.7) / (2 * radius);
  const persp = (node as any).meshProj === 'persp';
  const f = radius * 3.2;
  const cx = x + w / 2, cyy = y + h / 2;
  // One pipeline reused by vertices AND labels: center -> diagonal scale -> 3x3 ->
  // blend by mask g -> rotate. Labels project through the same path so they track.
  const xform = (p: V3, g: number): V3 => {
    const cx0 = p[0] - c[0], cy0 = p[1] - c[1], cz0 = p[2] - c[2];
    const sx0 = cx0 * msx, sy0 = cy0 * msy, sz0 = cz0 * msz;
    const mx = a * sx0 + b * sy0 + cc * sz0;
    const my = d * sx0 + e * sy0 + f3 * sz0;
    const mz = g3 * sx0 + h3 * sy0 + i3 * sz0;
    return rotate([cx0 + g * (mx - cx0), cy0 + g * (my - cy0), cz0 + g * (mz - cz0)], rx, ry, rz);
  };
  const project = (rr: V3): [number, number] => {
    const k = persp ? f / (f - rr[2]) : 1;
    return [cx + rr[0] * scale * k, cyy - rr[1] * scale * k];
  };
  const rv = m.vertices.map((v, idx) => xform(v, mask ? (mask[idx] ?? 1) : 1));
  const screen: [number, number][] = rv.map(project);

  const lt = m.light || [0.45, 0.65, 0.9];
  const ll = Math.hypot(lt[0], lt[1], lt[2]) || 1;
  const L: V3 = [lt[0] / ll, lt[1] / ll, lt[2] / ll];
  const base = m.faceColor || '#3b82f6';
  const edgeColor = m.edgeColor || shade(base, -0.45);
  const edgeW = m.edgeWidth ?? 1.5;

  if (m.faces && m.faces.length) {
    const faceAlpha = m.faceOpacity ?? 1;
    const translucent = faceAlpha < 1 || !!m.faceOpacities;
    const faces = m.faces.map((idx, fi) => {
      const a = rv[idx[0]], b = rv[idx[1]], d = rv[idx[2]];
      const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const t: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let nx = u[1] * t[2] - u[2] * t[1], ny = u[2] * t[0] - u[0] * t[2], nz = u[0] * t[1] - u[1] * t[0];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const avgz = idx.reduce((s, j) => s + rv[j][2], 0) / idx.length;
      return { idx, fi, nx, ny, nz, avgz };
    });
    // Opaque: back-face cull. Translucent "glass": keep every face and paint
    // strictly back-to-front so the alpha layers build up like 3b1b's cube.
    const ordered = faces.slice().sort((p, q) => p.avgz - q.avgz);
    const vis = translucent ? ordered : ordered.filter((fc) => fc.nz > 0.0001);
    ctx.lineJoin = 'round';
    for (const fc of vis) {
      const fcBase = m.faceColors?.[fc.fi] || base;
      const diff = Math.max(0, fc.nx * L[0] + fc.ny * L[1] + fc.nz * L[2]);
      ctx.beginPath();
      fc.idx.forEach((j, k) => { const [px, py] = screen[j]; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.closePath();
      ctx.globalAlpha = m.faceOpacities?.[fc.fi] ?? faceAlpha;
      ctx.fillStyle = shade(fcBase, -0.32 + 0.64 * diff);
      ctx.fill();
      ctx.globalAlpha = 1;                       // crisp edges over the glass
      if (edgeW > 0) { ctx.strokeStyle = edgeColor; ctx.lineWidth = edgeW; ctx.stroke(); }
    }
  }
  // Edges draw AFTER faces (on top) so a composite can carry glass faces + axis
  // lines + arrow shafts. Per-edge color falls back to the mesh edgeColor.
  if (m.edges && m.edges.length) {
    ctx.globalAlpha = 1;
    if (m.edgeColors) {
      m.edges.forEach(([i, j], ei) => {
        ctx.strokeStyle = m.edgeColors![ei] || edgeColor;
        ctx.lineWidth = edgeW;
        const a = screen[i], b = screen[j];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      });
    } else {
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = edgeW;
      ctx.beginPath();
      for (const [i, j] of m.edges) {
        const a = screen[i], b = screen[j];
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  }
  // Dot-lattice: render each vertex as a filled dot (a lattice / point cloud that
  // rides the transform). Per-vertex dotColors give signed/region two-tone grids;
  // dots depth-sort back-to-front so near points paint over far ones. Reusable for
  // any mesh — a grid shown as points, a sampled surface, a particle set.
  if (m.dots) {
    ctx.globalAlpha = 1;
    const dbase = m.dotColor || m.edgeColor || '#c084fc';
    const dr = m.dotR ?? 0.05;
    // With a dotColors array present, a null/undefined entry means "skip" — so a
    // merged mesh (grid + axes + arrows) draws dots only on the lattice vertices.
    const dcols = m.dotColors;
    const order = m.vertices.map((_, idx) => idx).sort((p, q) => rv[p][2] - rv[q][2]);
    for (const idx of order) {
      if (dcols && (dcols[idx] === null || dcols[idx] === undefined)) continue;
      const [px, py] = screen[idx];
      const k = persp ? f / (f - rv[idx][2]) : 1;
      const r = Math.max(1.2, dr * scale * k);
      ctx.fillStyle = (dcols?.[idx]) || dbase;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 3D-anchored labels — projected through the same pipeline so they track the
  // rotation/scale/transform. `fixed` labels stay with the frame (g=0).
  if (m.labels && m.labels.length) {
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lb of m.labels) {
      const [px, py] = project(xform(lb.at, lb.fixed ? 0 : 1));
      ctx.fillStyle = lb.color || '#e6edf6';
      const fam = lb.font || (lb.italic ? 'Georgia, "Times New Roman", serif' : 'ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial');
      const sty = lb.italic ? 'italic 600' : '600';
      ctx.font = `${sty} ${lb.size || 17}px ${fam}`;
      ctx.fillText(lb.text, px, py);
    }
  }
  // A shaded ball at (markerX,markerY,markerZ) — a point that rides the transformed
  // object (gradient-descent ball on a surface). Tween markerX/Y/Z through a path.
  const mkx = (node as any).markerX;
  if (mkx !== undefined) {
    const rr = xform([mkx, (node as any).markerY ?? 0, (node as any).markerZ ?? 0], 1);
    const k = persp ? f / (f - rr[2]) : 1;
    const px = cx + rr[0] * scale * k, py = cyy - rr[1] * scale * k;
    const r = Math.max(2, (m.markerR ?? 0.14) * scale * k);
    const col = m.markerColor || '#f43f5e';
    // Optional stem from the origin to the ball so it reads as a VECTOR (the output
    // A[x,y]), not a stray dot. Drawn first so the ball caps it.
    if ((node as any).markerStem) {
      const o = xform([0, 0, 0], 1);
      const ok = persp ? f / (f - o[2]) : 1;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = (node as any).markerStemColor || col;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + o[0] * scale * ok, cyy - o[1] * scale * ok);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    const grad = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
    grad.addColorStop(0, shade(col, 0.55));
    grad.addColorStop(1, shade(col, -0.3));
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Coordinate axes (editor "Coordinate axes" toggle). Drawn FIXED (g=0 — they
  // rotate with the view but don't deform with the object's scale/3x3), reusing
  // the same projection so they sit in the object's frame.
  if ((node as any).meshShowAxes) {
    // Math-accurate: axes are drawn in the object's OWN coordinate units (a unit
    // cube is ±1 = ±1 unit), with tick marks on the integers — a real coordinate
    // system, not radius-fractions. Extent E (in units) defaults just past the object.
    const E = Math.max(1, Math.min(12, Math.round((node as any).meshAxesExtent ?? Math.ceil(radius * 1.1))));
    const tk = 0.07 * E;                        // tick half-size in units
    const acol = (node as any).meshAxesColor || '#aebacc';
    const proj0 = (p: V3): [number, number] => project(xform(p, 0));
    const AX: [V3, V3, string][] = [
      [[1, 0, 0], [0, 1, 0], 'x'], [[0, 1, 0], [1, 0, 0], 'y'], [[0, 0, 1], [1, 0, 0], 'z'],
    ];
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = acol;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    for (const [u, pp, lbl] of AX) {
      const end = E + 0.22;
      const neg = proj0([-u[0] * end, -u[1] * end, -u[2] * end]);
      const pos = proj0([u[0] * end, u[1] * end, u[2] * end]);
      ctx.beginPath(); ctx.moveTo(neg[0], neg[1]); ctx.lineTo(pos[0], pos[1]); ctx.stroke();
      // arrowhead at +end (small V in screen space)
      const dx = pos[0] - neg[0], dy = pos[1] - neg[1], dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl, hl = 9;
      ctx.beginPath();
      ctx.moveTo(pos[0], pos[1]); ctx.lineTo(pos[0] - hl * ux + hl * 0.5 * uy, pos[1] - hl * uy - hl * 0.5 * ux);
      ctx.moveTo(pos[0], pos[1]); ctx.lineTo(pos[0] - hl * ux - hl * 0.5 * uy, pos[1] - hl * uy + hl * 0.5 * ux);
      ctx.stroke();
      // tick marks at each integer unit
      for (let d = 1; d <= E; d++) {
        for (const s of [1, -1]) {
          const c0: V3 = [u[0] * s * d - pp[0] * tk, u[1] * s * d - pp[1] * tk, u[2] * s * d - pp[2] * tk];
          const c1: V3 = [u[0] * s * d + pp[0] * tk, u[1] * s * d + pp[1] * tk, u[2] * s * d + pp[2] * tk];
          const a = proj0(c0), b = proj0(c1);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
      // axis label
      const [lx, ly] = proj0([u[0] * (E + 0.5), u[1] * (E + 0.5), u[2] * (E + 0.5)]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = aol(acol);
      ctx.font = '600 16px ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lbl, lx, ly);
      ctx.globalAlpha = 0.85;
    }
    ctx.globalAlpha = 1;
  }
}

function aol(c: string): string {
  return c; // label uses the axis color; kept as a hook for future contrast tuning
}
