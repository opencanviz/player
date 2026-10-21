# @opencanviz/player

Play [openCanviz](https://opencanviz.com) animated explainers in any web page. It draws the same
frames as opencanviz.com and its MP4 export, because it is built from the same engine source.

It plays documents. Editing, AI generation, narration audio and video export stay in openCanviz.

## On a page, no build step

```html
<script type="module" src="https://unpkg.com/@opencanviz/player/dist/canviz-player.js"></script>

<canviz-player src="/explainers/load-balancer.json" autoplay loop></canviz-player>
```

Attributes:

| Attribute  | Effect |
|------------|--------|
| `src`      | URL of an exported document (JSON). |
| `autoplay` | Start playing once loaded. |
| `loop`     | Start again at the end. |
| `controls` | Play button and scrubber. On unless set to `"false"`. |
| `captions` | Narration captions. On unless set to `"false"`. |

From script: set `player.doc = json` to play a document you already have, and use `play()`,
`pause()`, `seek(ms)`, `duration` and `currentTime`. It fires `ready`, `ended` and `error`.
Players scrolled out of view stop drawing until they're back.

## In an app

```sh
npm install @opencanviz/player
```

```ts
import '@opencanviz/player/element'; // registers <canviz-player>
```

Or draw frames yourself:

```ts
import { createPlayer } from '@opencanviz/player';

const canvas = document.querySelector('canvas')!;
const player = await createPlayer(canvas, doc, { targetHeight: 720 });

function frame(now: number) {
  player.renderFrameAt(now % player.totalDurationMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`createPlayer` takes a single scene or a multi-scene project, exactly as openCanviz exports them.
It loads the lettering fonts, fetches icons and preloads pictures, then sizes the canvas to the
artboard at `targetHeight` pixels tall. Scale it with CSS.

Options: `targetHeight`, `showCaptions`, `captionStyle`, `flowEnabled` (moving dots along
edges), and `progressiveImages: { onProgress }` to show the first frame before every picture has
arrived (`player.imagesReady` settles when they have).

Lower-level pieces are exported too: `createProjectRenderer`, `buildProjectTimeline`,
`evaluateAt`, `drawScene`, `normalizeStepsToFullSnapshots`, `resolveIcons`, `toProject`.

## Fonts and hand drawings

The player ships its handwriting and brand fonts and the drawing-hand pictures in
`dist/assets/`, and loads them from next to its own module. If your bundler or CDN puts them
somewhere else, or your page's Content Security Policy only allows your own origin, copy
`dist/assets/` and say where it is before the first player loads:

```ts
import { configureAssets } from '@opencanviz/player';

configureAssets({ base: '/static/canviz/' }); // folder holding player.css, fonts/ and hands/
```

`configureAssets({ fonts: false })` skips the font stylesheet if you load the faces yourself, and
`configureAssets({ hands: { 'write-render3d.png': dataUri } })` supplies hand pictures directly.

Icons referenced by name are fetched from the Iconify API the first time they're drawn. Documents
exported with their icons inlined make no network requests besides the assets above.

## Document format

`FORMAT_VERSION` is the newest document format this build plays. A document carrying a newer
`formatVersion` still plays, with a console warning, since features it relies on may not draw.

## License

MIT. The bundled fonts are under the SIL Open Font License; see `LICENSE`.
