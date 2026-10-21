/**
 * Sync the public source mirror of @opencanviz/player (github.com/opencanviz/player).
 *
 * This repo stays the source of truth. The mirror gets only what the player is built from: the
 * engine files its imports reach (the TypeScript import graph, so type-only imports come too),
 * the package itself, the font list, the font and hand assets, and nothing else of the app. Every
 * file keeps its path here, so packages/player/build.mjs runs unchanged in the mirror.
 *
 * Usage:
 *   node packages/player/mirror.mjs --list          print the files the mirror would hold
 *   node packages/player/mirror.mjs <dir>           replace <dir>'s contents (its .git is kept)
 *   node packages/player/mirror.mjs <dir> --commit  ...and commit there, with no trailers
 *
 * The sync is one-way: a change made in the mirror is ported back here by hand, then synced.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FACES, BRAND_FACES } from '../../scripts/font-faces.mjs';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PKG, '../..');
const rel = (f) => path.relative(ROOT, f);
const git = (...a) => execFileSync('git', a, { cwd: ROOT }).toString().trim();

function sourceFiles() {
  const out = execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--listFilesOnly'], { cwd: PKG }).toString();
  const files = out.split('\n').filter((f) => f && !f.includes('/node_modules/')).map((f) => rel(path.resolve(f)));
  const outside = files.filter((f) => f.startsWith('..'));
  if (outside.length) throw new Error(`imports reach outside the repo: ${outside.join(', ')}`);
  return files;
}

function mirrorFiles() {
  const faces = new Set([...FONT_FACES, ...BRAND_FACES].map((f) => f[1]));
  const hands = fs.readdirSync(path.join(ROOT, 'public/hands')).filter((f) => f.endsWith('.png'));
  return [...new Set([
    ...sourceFiles(),
    ...['build.mjs', 'mirror.mjs', 'package.json', 'README.md', 'LICENSE', 'FONTS-OFL.txt', 'tsconfig.json']
      .map((f) => `packages/player/${f}`),
    'scripts/font-faces.mjs',
    'src/render/stubs/lottie-web.ts', // aliased in for lottie-web by build.mjs
    ...[...faces].map((f) => `public/fonts/${f}`),
    ...hands.map((f) => `public/hands/${f}`),
  ])].sort();
}

function rootPackageJson() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pin = (name) => app.dependencies?.[name] ?? app.devDependencies?.[name];
  return {
    name: 'opencanviz-player-source',
    private: true,
    description: 'Source of @opencanviz/player, mirrored from openCanviz. The package itself is packages/player.',
    license: 'MIT',
    type: 'module',
    scripts: { build: 'node packages/player/build.mjs' },
    devDependencies: Object.fromEntries(
      // lottie-web is here for its types only: build.mjs swaps in a stub, so it is never bundled.
      ['esbuild', 'typescript', 'roughjs', 'lottie-web'].map((n) => [n, pin(n)]),
    ),
  };
}

// The app's root tsconfig without its Next.js parts. esbuild reads it for the engine files (its
// es5 target is what keeps class fields as plain assignments), so the mirror must have it too or
// it builds a different bundle.
function rootTsconfig() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
  const { plugins, incremental, ...compilerOptions } = app.compilerOptions;
  return { compilerOptions, include: ['src', 'packages/player/src', 'scripts'], exclude: ['node_modules', 'packages/*/dist'] };
}

const README = (commit) => `# @opencanviz/player

The source of [\`@opencanviz/player\`](packages/player/README.md), the MIT-licensed player for
[openCanviz](https://opencanviz.com) animated explainers. It draws the same frames as
opencanviz.com and its MP4 export.

This repository is a mirror. openCanviz is developed in a private repository, and this one
receives only the files the player is built from, at the same paths they have there. Synced
from openCanviz commit \`${commit}\`.

\`\`\`sh
npm install
npm run build   # writes packages/player/dist
\`\`\`

Usage, options and the document format are in [packages/player/README.md](packages/player/README.md).

## Contributing

Issues and pull requests are welcome. A merged change is ported into openCanviz and arrives
back here with the next sync, so the commit history here is sync commits rather than the
original ones.

## License

MIT, see [LICENSE](LICENSE). The fonts in \`public/fonts\` are under the SIL Open Font License,
see [packages/player/FONTS-OFL.txt](packages/player/FONTS-OFL.txt).
`;

const args = process.argv.slice(2);
const files = mirrorFiles();

if (args[0] === '--list' || !args[0]) {
  for (const f of files) console.log(f);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
  console.error(`${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);
  process.exit(0);
}

const dest = path.resolve(args[0]);
const dirty = git('status', '--porcelain', '--', ...files) !== '';
const commit = git('rev-parse', '--short', 'HEAD') + (dirty ? '+local changes' : '');

fs.mkdirSync(dest, { recursive: true });
for (const entry of fs.readdirSync(dest)) {
  if (entry !== '.git') fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
}
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
}
fs.copyFileSync(path.join(PKG, 'LICENSE'), path.join(dest, 'LICENSE'));
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(rootPackageJson(), null, 2) + '\n');
fs.writeFileSync(path.join(dest, 'tsconfig.json'), JSON.stringify(rootTsconfig(), null, 2) + '\n');
fs.writeFileSync(path.join(dest, 'README.md'), README(commit));
fs.writeFileSync(path.join(dest, '.gitignore'), 'node_modules/\npackages/player/dist/\n');
console.log(`✓ ${files.length} files synced to ${dest} from ${commit}`);

if (args.includes('--commit')) {
  if (dirty) throw new Error('commit or discard the local changes to mirrored files first');
  const g = (...a) => execFileSync('git', a, { cwd: dest, stdio: 'inherit' });
  if (!fs.existsSync(path.join(dest, '.git'))) g('init', '-q', '-b', 'main');
  // The mirror is public, so its commits must not carry a personal address: set a GitHub noreply
  // one in the mirror checkout (git -C <dir> config user.email <id>+<login>@users.noreply.github.com).
  const email = execFileSync('git', ['config', 'user.email'], { cwd: dest }).toString().trim();
  if (!email.endsWith('@users.noreply.github.com')) {
    throw new Error(`the mirror would commit as ${email}; set a GitHub noreply user.email in ${dest} first`);
  }
  g('add', '-A');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: dest }).toString() === '') {
    console.log('nothing changed since the last sync');
  } else {
    g('commit', '-q', '-m', `Sync from openCanviz ${commit}`);
  }
}
