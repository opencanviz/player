/**
 * @opencanviz/player: plays openCanviz explainer documents on a canvas, frame for frame the way
 * opencanviz.com and its MP4 export draw them. Encoding, narration and the editor are not here.
 *
 *   import { createPlayer } from '@opencanviz/player';
 *   const player = await createPlayer(canvas, doc);
 *   player.renderFrameAt(1200);
 *
 * or, without code: `<canviz-player src="explainer.canviz" autoplay loop></canviz-player>` after
 * `import '@opencanviz/player/element'`.
 */
// Must come first: it points the hand pictures at the package's own copies before any engine
// module starts fetching the default hand at import time.
import { configureAssets, ensureFontsLoaded } from './assets';
import { createProjectRenderer, type HeadlessRenderOptions, type ProjectRenderer } from '../../../src/render/project-renderer';
import type { Project } from '../../../src/components/diagram/types';
import { resolveIcons } from './icons';

export { configureAssets, fontFaceRules, type AssetOptions } from './assets';
export { resolveIcons } from './icons';
export { buildProjectTimeline } from '../../../src/components/diagram/utils/project-playback';
export { normalizeStepsToFullSnapshots } from '../../../src/components/diagram/utils/step-resolution';
export { evaluateAt } from '../../../src/components/diagram/utils/animation-utils';
export { drawScene } from '../../../src/components/diagram/utils/rendering-utils';
export { parseSvgStringToNode } from '../../../src/components/diagram/utils/svg-utils';
export { assetResolver } from '../../../src/components/diagram/assets/AssetResolver';
export type { Project, HeadlessRenderOptions as RenderOptions, ProjectRenderer };

/**
 * Highest document format this build plays. A document may carry `formatVersion`; one from a
 * newer editor still plays, but createPlayer warns, since features it uses may draw wrong.
 */
export const FORMAT_VERSION = 1;
// Set by build.mjs; a host compiling the package from source sees 'source'.
export const VERSION = typeof __PLAYER_VERSION__ === 'string' ? __PLAYER_VERSION__ : 'source';

/** A single scene (`nodes`/`steps` at the top) or a project (`diagrams: [...]`), as exported. */
export type CanvizDocument = Record<string, any>;

const DEFAULT_ARTBOARD = { background: '#ffffff', showBounds: false, shadeOutside: false, cropPreview: false };

/** Wrap a single-scene document as a one-scene project and fill the artboard fields the
 *  renderer needs, so every exported shape plays. Returns a copy; the input is not touched. */
export function toProject(doc: CanvizDocument): Project {
  const copy = JSON.parse(JSON.stringify(doc));
  const project = Array.isArray(copy.diagrams) ? copy : { diagrams: [copy], artboard: copy.artboard };
  let artboard = project.artboard ?? project.diagrams[0]?.artboard;
  if (!artboard || !(artboard.width > 0 && artboard.height > 0)) {
    artboard = { ...artboard, ...boundsOf(project.diagrams[0]?.nodes ?? []) };
  }
  project.artboard = { ...DEFAULT_ARTBOARD, ...artboard };
  return project as Project;
}

function boundsOf(nodes: Array<{ x: number; y: number; width?: number; height?: number }>) {
  if (nodes.length === 0) return { x: -640, y: -360, width: 1280, height: 720 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.width ?? 0, h = n.height ?? 0;
    minX = Math.min(minX, n.x - w / 2); maxX = Math.max(maxX, n.x + w / 2);
    minY = Math.min(minY, n.y - h / 2); maxY = Math.max(maxY, n.y + h / 2);
  }
  const pad = 60;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/**
 * Prepare `doc` for playback on `canvas`: load the lettering faces, parse icons, preload
 * pictures, then return a renderer. The canvas is sized to the artboard at `targetHeight`
 * (default: the artboard's own height); scale it with CSS.
 */
export async function createPlayer(
  canvas: HTMLCanvasElement,
  doc: CanvizDocument,
  opts: HeadlessRenderOptions = {},
): Promise<ProjectRenderer> {
  if (typeof doc.formatVersion === 'number' && doc.formatVersion > FORMAT_VERSION) {
    console.warn(`@opencanviz/player: document format ${doc.formatVersion} is newer than this player (${FORMAT_VERSION})`);
  }
  const project = toProject(doc);
  await Promise.all([ensureFontsLoaded(), resolveIcons(project)]);
  return createProjectRenderer(canvas, project, opts);
}

/** The renderer without the conveniences: expects a full Project and loads nothing itself. */
export { createProjectRenderer };

