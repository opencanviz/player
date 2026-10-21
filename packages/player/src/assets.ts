import { setHandAssetBase, registerHandBytes } from '../../../src/components/diagram/utils/hand-assets';
import { FONT_FACES, BRAND_FACES } from '../../../scripts/font-faces.mjs';

/**
 * Where the package's fonts and hand pictures live. They ship in `dist/assets/` next to the
 * module, so by default they resolve relative to it. Hosts that copy them elsewhere (or serve a
 * strict CSP) call configureAssets before the first render.
 */
export interface AssetOptions {
  /** URL of the folder holding `player.css`, `fonts/` and `hands/`. Must end in a slash. */
  base?: string;
  /** Inject `player.css` (the @font-face rules) into the document. Default true. Pass false when
   *  the host loads the faces itself. */
  fonts?: boolean;
  /** Where each font file (e.g. `ComicNeue-Regular.woff2`) is served, when not under `base`.
   *  The rules are then injected inline, for hosts whose bundler emits the files itself. */
  fontUrl?: (file: string) => string;
  /** Hand pictures by file name (e.g. `marker-right.png`) to data or blob URIs, overriding `base`. */
  hands?: Record<string, string>;
}

// An IIFE or script-concatenating build has no import.meta.url; such hosts call configureAssets.
const DEFAULT_BASE = (() => {
  try {
    return new URL('./assets/', import.meta.url).href;
  } catch {
    return './assets/';
  }
})();
let base = DEFAULT_BASE;
let injectFonts = true;
let fontUrl: ((file: string) => string) | null = null;
setHandAssetBase(base + 'hands/');

export function configureAssets(opts: AssetOptions): void {
  if (opts.base) {
    base = opts.base.endsWith('/') ? opts.base : opts.base + '/';
    setHandAssetBase(base + 'hands/');
  }
  if (opts.fonts !== undefined) injectFonts = opts.fonts;
  if (opts.fontUrl) fontUrl = opts.fontUrl;
  for (const [file, uri] of Object.entries(opts.hands ?? {})) registerHandBytes(file, uri);
}

/** Add the lettering faces to the page once, resolving when their rules are in (or failed to
 *  load). The renderer awaits this before its first frame, so text never letters in a fallback. */
let fontsReady: Promise<void> | null = null;
export function ensureFontsLoaded(): Promise<void> {
  if (!injectFonts || typeof document === 'undefined') return Promise.resolve();
  if (fontsReady) return fontsReady;
  if (fontUrl) {
    const style = document.createElement('style');
    style.dataset.canvizPlayer = '';
    style.textContent = fontFaceRules(fontUrl);
    document.head.appendChild(style);
    return (fontsReady = Promise.resolve());
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = base + 'player.css';
  link.dataset.canvizPlayer = '';
  fontsReady = new Promise((resolve) => {
    link.onload = () => resolve();
    link.onerror = () => resolve();
  });
  document.head.appendChild(link);
  return fontsReady;
}

/** The @font-face rules for every bundled face, with each file at `url(file)`. dist/assets/player.css
 *  is this with relative URLs. */
export function fontFaceRules(url: (file: string) => string): string {
  return [...FONT_FACES, ...BRAND_FACES]
    .map(([family, file, weight, range]) =>
      `@font-face{font-family:'${family}';src:url(${url(file)}) format('woff2');font-weight:${weight};font-display:block;unicode-range:${range}}`)
    .join('\n');
}
