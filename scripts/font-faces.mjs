/**
 * The bundled lettering and brand-kit faces as [family, file, weight, unicode-range] rows. Shared
 * by the headless render page (scripts/build-headless-bundle.mjs) and the public player package
 * (packages/player/build.mjs), so every surface outside the app letters a document the same way.
 */
// Bundled handwriting faces: the sketch/whiteboard themes letter in Comic Neue, which no
// server has installed — without this, prod renders fall back to a generic cursive
// that doesn't match the editor. Caveat ships alongside because documents saved before
// the switch name it, and a missing face would re-letter videos already in the library.
// Inlined as data URIs because the local worker loads this page via file://, where font
// subresource fetches are unreliable.
//
// Each family is SEVERAL faces split by unicode-range, and the range on the Latin faces is
// load-bearing rather than a download optimisation: a character picks one face per family, and
// if that face has no glyph the browser moves to the next FAMILY in the stack, never to another
// face of the same family. Excluding Greek and Cyrillic from the Latin faces is the only thing
// that lets the Greek and Cyrillic faces below be reached. This has to mirror the app's
// global.css exactly, because the same saved document is lettered by both: the editor paints it
// through the app, the exported video paints it through this page. If the two ever disagree, a
// customer previews one video and downloads a different one.
// Each non-Latin file is listed at 400 AND at 700 rather than once as `font-weight: 400 700`.
// The range spelling is the tidy one and it does not work: weight is matched across the family
// before the character is looked at, so a bold Greek heading matches the bold LATIN face, fails
// the glyph check there, and falls out of the family — regular Greek right, bold Greek wrong.
const LATIN_RANGE = 'U+0000-036F, U+0530-10FFFF';
const GREEK_RANGE = 'U+0370-03FF';
const CYRILLIC_RANGE = 'U+0400-045F, U+0490-0491, U+04B0-04B1';
const CYRILLIC_EXT_RANGE = 'U+0460-052F';
const bothWeights = (family, file, range) => [[family, file, '400', range], [family, file, '700', range]];

export const FONT_FACES = [
  // family        file                          weight  unicode-range
  ['Comic Neue', 'ComicNeue-Regular.woff2', '400', LATIN_RANGE],
  ['Comic Neue', 'ComicNeue-Bold.woff2', '700', LATIN_RANGE],
  // Neither hand face has a single glyph outside Latin. Greek and Cyrillic are lettered by
  // Playpen Sans (marker) and Mynerve / Caveat's own Cyrillic (script) — different designs,
  // but handwriting, which is the point. Without them a Greek board rendered as typeset text
  // sitting inside a hand-drawn scene with a hand animating over it.
  ...bothWeights('Comic Neue', 'PlaypenSans-Greek.woff2', GREEK_RANGE),
  ...bothWeights('Comic Neue', 'PlaypenSans-Cyrillic.woff2', CYRILLIC_RANGE),
  ...bothWeights('Comic Neue', 'PlaypenSans-CyrillicExt.woff2', CYRILLIC_EXT_RANGE),
  ['Caveat', 'Caveat-Regular.woff2', '400', LATIN_RANGE],
  ['Caveat', 'Caveat-Bold.woff2', '700', LATIN_RANGE],
  // Mynerve is a STATIC 400, so its 700 entry is the same outlines relabelled and bold Greek
  // script is not really heavier. Better than the alternative: drop the 700 entry and bold
  // Greek loses the weight match and leaves the family, costing the handwriting look outright.
  ...bothWeights('Caveat', 'Mynerve-Greek.woff2', GREEK_RANGE),
  ...bothWeights('Caveat', 'Caveat-Cyrillic.woff2', CYRILLIC_RANGE),
  ...bothWeights('Caveat', 'Caveat-CyrillicExt.woff2', CYRILLIC_EXT_RANGE),
];

// The brand-kit faces, mirroring global.css "Brand kit faces": no range split (Latin files, and a
// missing glyph falls to the next family in the brand's stack). Variable files carry a weight span.
const ANY_RANGE = 'U+0000-10FFFF';
export const BRAND_FACES = [
  ['Inter Brand', 'Inter-Variable.woff2', '100 900', ANY_RANGE],
  ['Montserrat', 'Montserrat-Variable.woff2', '100 900', ANY_RANGE],
  ['Poppins', 'Poppins-Regular.woff2', '400', ANY_RANGE],
  ['Poppins', 'Poppins-Bold.woff2', '700', ANY_RANGE],
  ['Space Grotesk', 'SpaceGrotesk-Variable.woff2', '300 700', ANY_RANGE],
  ['Lora', 'Lora-Variable.woff2', '400 700', ANY_RANGE],
  ['Playfair Display', 'PlayfairDisplay-Variable.woff2', '400 900', ANY_RANGE],
];
