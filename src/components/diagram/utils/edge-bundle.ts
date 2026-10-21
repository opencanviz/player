/**
 * Edge bundling — a render-time VIEW option (the View-panel "Bundle edges" switch).
 *
 * Snaps near-parallel orthogonal edge segments onto a shared line so they overlap
 * into a single "trunk", branching only where they diverge. It's situational
 * (great when edges genuinely share a path, noisy when they don't), so it lives
 * here as a toggle rather than being baked into the backend waypoints.
 *
 * Module-global flag (mirrors sketch-mode) so both the live canvas and the
 * same-page export read it; React state in the editor is the source of truth.
 */
type Pt = { x: number; y: number };
interface EdgeLike { id: string; waypoints?: Pt[] }

let _bundle = false;
export const setGlobalEdgeBundle = (v: boolean): void => { _bundle = !!v; };
export const getGlobalEdgeBundle = (): boolean => _bundle;

const TOL = 30; // max gap (px) between segments to consider them the same trunk

/**
 * Return a Map<edgeId, waypoints[]> with near-parallel orthogonal segments
 * snapped onto shared lines. Operates on COPIES — never mutates the input edges.
 */
export function bundleEdgeWaypoints(edges: EdgeLike[]): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  for (const e of edges) {
    if (e.waypoints && e.waypoints.length >= 2) {
      out.set(e.id, e.waypoints.map((p) => ({ x: p.x, y: p.y })));
    }
  }
  if (out.size < 2) return out;

  interface Seg { wps: Pt[]; i: number; c: number; r0: number; r1: number }

  const collect = (orient: 'v' | 'h'): Seg[] => {
    const segs: Seg[] = [];
    for (const wps of Array.from(out.values())) {
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1];
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        if (orient === 'v' && dx <= 2 && dy > 2) {
          segs.push({ wps, i, c: a.x, r0: Math.min(a.y, b.y), r1: Math.max(a.y, b.y) });
        } else if (orient === 'h' && dy <= 2 && dx > 2) {
          segs.push({ wps, i, c: a.y, r0: Math.min(a.x, b.x), r1: Math.max(a.x, b.x) });
        }
      }
    }
    return segs;
  };

  const snap = (segs: Seg[], key: 'x' | 'y'): void => {
    const n = segs.length;
    if (n < 2) return;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
      return r;
    };
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (Math.abs(segs[a].c - segs[b].c) <= TOL &&
            segs[a].r0 <= segs[b].r1 && segs[b].r0 <= segs[a].r1) {
          parent[find(a)] = find(b);
        }
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const g = groups.get(r);
      if (g) g.push(i); else groups.set(r, [i]);
    }
    for (const members of Array.from(groups.values())) {
      if (members.length < 2) continue;
      const snapVal = Math.round(members.reduce((s: number, m: number) => s + segs[m].c, 0) / members.length);
      for (const m of members) {
        segs[m].wps[segs[m].i][key] = snapVal;
        segs[m].wps[segs[m].i + 1][key] = snapVal;
      }
    }
  };

  snap(collect('v'), 'x');
  snap(collect('h'), 'y');
  return out;
}

// Per-render bundle, set once before the edge loop (single-threaded canvas).
// getEdgePath() then looks up the bundled waypoints per edge by id.
let _currentBundle: Map<string, Pt[]> | null = null;

export function prepareEdgeBundle(edges: EdgeLike[]): void {
  _currentBundle = _bundle ? bundleEdgeWaypoints(edges) : null;
}

export function bundledWaypointsFor(edgeId: string): Pt[] | undefined {
  return _currentBundle ? _currentBundle.get(edgeId) : undefined;
}
