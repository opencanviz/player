/**
 * Build @opencanviz/player from the app's own engine source, the way the headless render bundle
 * is built (scripts/build-headless-bundle.mjs): nothing is copied or forked, so the package draws
 * what the editor and the export draw.
 *
 * Output (dist/):
 *   index.js, element.js   ES modules for bundlers (shared code split into a chunk)
 *   canviz-player.js       the element with roughjs inlined, for a script tag
 *   *.d.ts                 types, emitted by tsc
 *   assets/                player.css (@font-face rules), fonts/, hands/
 *
 * Fails if anything from the encoder reaches the output.
 * Usage: node packages/player/build.mjs
 */
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FACES, BRAND_FACES } from '../../scripts/font-faces.mjs';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PKG, '../..');
const DIST = path.join(PKG, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets', 'fonts'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'assets', 'hands'), { recursive: true });

const result = await esbuild.build({
  entryPoints: { index: path.join(PKG, 'src/index.ts'), element: path.join(PKG, 'src/element.ts') },
  bundle: true,
  splitting: true,
  outdir: DIST,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  // Dependencies stay dependencies, so a host bundles one copy.
  external: Object.keys(pkg.dependencies ?? {}),
  define: {
    'process.env.NODE_ENV': '"production"',
    __PLAYER_VERSION__: JSON.stringify(pkg.version),
  },
  // Lottie is not drawn on the canvas path (see src/render/stubs/lottie-web.ts).
  alias: { 'lottie-web': path.join(ROOT, 'src/render/stubs/lottie-web.ts') },
  minify: true,
  sourcemap: true,
  metafile: true,
  logLevel: 'warning',
});

// Standalone: the element with every dependency inlined, for a plain
// <script type="module" src="https://unpkg.com/@opencanviz/player/dist/canviz-player.js">.
// It sits beside assets/ so the same relative asset URLs work.
const standalone = await esbuild.build({
  entryPoints: [path.join(PKG, 'src/element.ts')],
  bundle: true,
  outfile: path.join(DIST, 'canviz-player.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  define: {
    'process.env.NODE_ENV': '"production"',
    __PLAYER_VERSION__: JSON.stringify(pkg.version),
  },
  alias: { 'lottie-web': path.join(ROOT, 'src/render/stubs/lottie-web.ts') },
  minify: true,
  metafile: true,
  logLevel: 'warning',
});
Object.assign(result.metafile.inputs, standalone.metafile.inputs);

// The encoder is the app's, not the player's. (narration-assembly does come along: the timeline
// takes each scene's narrated length from it.)
const FORBIDDEN = ['mp4-muxer', 'headless-renderer', 'utils/sfx.ts'];
const leaked = Object.keys(result.metafile.inputs).filter((f) => FORBIDDEN.some((x) => f.includes(x)));
const code = fs.readdirSync(DIST).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
if (leaked.length || /VideoEncoder|VideoFrame\(/.test(code)) {
  console.error('✗ encoder code reached the player:', leaked.join(', ') || 'VideoEncoder in output');
  process.exit(1);
}

// Fonts: one stylesheet with relative URLs, so the faces load from wherever assets/ is served.
const faces = [...FONT_FACES, ...BRAND_FACES];
for (const file of new Set(faces.map((f) => f[1]))) {
  const src = path.join(ROOT, 'public/fonts', file);
  if (!fs.existsSync(src)) {
    console.error(`✗ missing font ${file} (public/fonts)`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DIST, 'assets/fonts', file));
}
const css = faces.map(([family, file, weight, range]) =>
  `@font-face{font-family:'${family}';src:url(fonts/${file}) format('woff2');font-weight:${weight};font-display:block;unicode-range:${range}}`);
fs.writeFileSync(path.join(DIST, 'assets/player.css'), css.join('\n') + '\n');
// The OFL asks that its text and the copyright notices travel with the font files.
fs.copyFileSync(path.join(PKG, 'FONTS-OFL.txt'), path.join(DIST, 'assets/fonts/OFL.txt'));

const hands = fs.readdirSync(path.join(ROOT, 'public/hands')).filter((f) => f.endsWith('.png'));
for (const f of hands) fs.copyFileSync(path.join(ROOT, 'public/hands', f), path.join(DIST, 'assets/hands', f));

// Types: tsc follows the imports into the engine source and emits a .d.ts per file under dist/types.
execSync('npx tsc -p tsconfig.json', { cwd: PKG, stdio: 'inherit' });
for (const entry of ['index', 'element']) {
  fs.writeFileSync(path.join(DIST, `${entry}.d.ts`), `export * from './types/packages/player/src/${entry}';\n`);
}

const kb = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0);
const js = fs.readdirSync(DIST).filter((f) => f.endsWith('.js'));
console.log(`✓ @opencanviz/player ${pkg.version}: ${js.map((f) => `${f} ${kb(f)} KB`).join(', ')}; ${faces.length} font faces, ${hands.length} hands`);
