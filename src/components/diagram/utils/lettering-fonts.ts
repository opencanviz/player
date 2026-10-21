/**
 * Makes sure the hand-lettering faces are actually resident before the canvas draws
 * in them.
 *
 * The board is painted with ctx.fillText, and canvas text does not wait the way DOM
 * text does: it draws in whatever face is resident at that instant and never repaints
 * itself when the real one arrives. A cold load therefore paints the first frames in
 * the host's default and leaves them that way until something else triggers a redraw.
 *
 * It matters more since the faces were split by script. Each family is now several
 * files behind disjoint unicode-ranges (see global.css), and a browser fetches a
 * subset only once a character in its range is laid out — so a Greek board's Greek
 * file does not even begin downloading until the first draw has already missed it.
 *
 * So ask for each script explicitly, then repaint. One probe character per range is
 * enough: it pulls the whole file the range is bound to.
 */

const FAMILIES = ['Comic Neue', 'Caveat'] as const;
const WEIGHTS = [400, 700] as const;

// One character per unicode-range the families are split across — and it has to stay one per
// range, because an unprobed range is a file that arrives after the canvas has already drawn.
// 'A' stands for the Latin files, 'Α' (U+0391) for the Greek, 'А' (U+0410) for Cyrillic, and
// 'Ѡ' (U+0460) for Cyrillic Extended. The last is rare enough to be tempting to drop, but
// dropping it buys ~130KB on a cold load and costs a silently mis-lettered board.
const PROBES = 'AΑАѠ';

let pending: Promise<void> | null = null;

/** Resolves once every lettering face is loaded, or immediately where unsupported. */
export function ensureLetteringFonts(): Promise<void> {
  if (pending) return pending;

  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return (pending = Promise.resolve());

  const requests: Promise<unknown>[] = [];
  for (const family of FAMILIES) {
    for (const weight of WEIGHTS) {
      for (const probe of PROBES) {
        // A face that does not exist rejects rather than throwing; that is a normal
        // answer here (Mynerve has no bold cut) and must not fail the others.
        requests.push(fonts.load(`${weight} 16px "${family}"`, probe).catch(() => {}));
      }
    }
  }

  pending = Promise.all(requests).then(() => {});
  return pending;
}

/**
 * The brand-kit faces (see global.css, "Brand kit faces"). Unlike the lettering faces these are
 * only fetched for a document that names one: a brand video names its face on every text node,
 * and nothing else ever does, so scanning the document is both cheap and exact.
 */
export const BRAND_FONT_FAMILIES = [
  'Inter Brand', 'Montserrat', 'Poppins', 'Space Grotesk', 'Lora', 'Playfair Display',
] as const;

/** The brand families a document (or any JSON-ish value) names in a fontFamily field. */
export function brandFamiliesIn(value: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 12 || found.size === BRAND_FONT_FAMILIES.length) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string') {
        if ((k === 'fontFamily' || k === 'labelFontFamily') && !seen.has(x)) {
          seen.add(x);
          for (const fam of BRAND_FONT_FAMILIES) if (x.includes(`"${fam}"`)) found.add(fam);
        }
      } else if (x && typeof x === 'object') {
        visit(x, depth + 1);
      }
    }
  };
  visit(value, 0);
  return Array.from(found);
}

/** Resolves once the named brand faces (both weights) are resident. Never rejects. */
export function ensureBrandFonts(families: readonly string[]): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load || !families.length) return Promise.resolve();
  return Promise.all(
    families.flatMap((f) => WEIGHTS.map((w) => fonts.load(`${w} 16px "${f}"`, 'A').catch(() => {}))),
  ).then(() => {});
}
