import { assetResolver } from '../../../src/components/diagram/assets/AssetResolver';
import { parseSvgStringToNode } from '../../../src/components/diagram/utils/svg-utils';
import type { Project } from '../../../src/components/diagram/types';

/**
 * Icon and SVG nodes carry their markup as `asset.data` (or only an iconify `ref`), but the
 * canvas draws `svgPaths`. The site's embed page parses them before playback; this does the same
 * once per asset and patches every copy of the node in place (base nodes and step snapshots).
 * An icon that can't be fetched draws as its plain shape. Returns whether anything was patched.
 */
export async function resolveIcons(project: Pick<Project, 'diagrams'>): Promise<boolean> {
  const lists = project.diagrams.flatMap((d) => [d.nodes ?? [], ...(d.steps ?? []).map((s) => s.nodes ?? [])]) as readonly any[][];
  const keyOf = (n: { id: string; asset: { ref?: string; source?: string } }) =>
    n.asset.ref ? `${n.asset.source}:${n.asset.ref}` : `node:${n.id}`;
  const parsed = new Map<string, { svgPaths: unknown; svgViewBox: unknown } | null>();
  const pending: Promise<void>[] = [];

  for (const list of lists) {
    for (const n of list) {
      const a = n?.asset;
      if (n?.kind !== 'svg' || !a || (a.type !== 'icon' && a.type !== 'svg') || n.svgPaths?.length) continue;
      const key = keyOf(n);
      if (parsed.has(key)) continue;
      parsed.set(key, null);
      pending.push((async () => {
        try {
          const svg = typeof a.data === 'string' ? a.data : (await assetResolver.resolve(a)).data;
          if (typeof svg !== 'string') return;
          const node = parseSvgStringToNode(svg, n.x, n.y);
          if (node?.svgPaths) parsed.set(key, { svgPaths: node.svgPaths, svgViewBox: node.svgViewBox });
        } catch {
          /* unreachable icon: drawn as its plain shape, same as on the site */
        }
      })());
    }
  }
  if (pending.length === 0) return false;
  await Promise.all(pending);

  let patched = false;
  for (const list of lists) {
    for (const n of list) {
      if (n?.kind !== 'svg' || !n.asset || n.svgPaths?.length) continue;
      const hit = parsed.get(keyOf(n));
      if (hit) { Object.assign(n, hit); patched = true; }
    }
  }
  return patched;
}
