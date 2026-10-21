/**
 * Project renderer: the one surface every playback path draws through.
 *
 * `createProjectRenderer(canvas, project, opts)` does the one-time render setup (output
 * dimensions, timeline, default camera, per-scene float, transition work canvases, draw
 * options, image preload) and returns `renderFrameAt(tMs)` + `totalDurationMs`. The editor's
 * player, the embed, the server render page and the public `@opencanviz/player` package all
 * call it, so they paint the same frames.
 *
 * It uses only DOM APIs a browser page provides (`document.createElement('canvas')`, `Image`):
 * no React, no editor state, no encoding. Encoding and audio live in headless-renderer.ts.
 * See docs/server-side-render-architecture.md (Phase 0).
 */
import type { Project, NodeModel, CaptionStyle } from '../components/diagram/types';
import { buildProjectTimeline } from '../components/diagram/utils/project-playback';
import { normalizeStepsToFullSnapshots } from '../components/diagram/utils/step-resolution';
import { computeDefaultCamera } from '../components/diagram/utils/project-camera';
import { renderProjectFrame } from '../components/diagram/utils/project-render';
import { collectSceneMedia, isVideoUrl, primeSceneMedia, seekSceneVideos } from '../components/diagram/utils/scene-media';
import { brandFamiliesIn, ensureBrandFonts, ensureLetteringFonts } from '../components/diagram/utils/lettering-fonts';

export interface HeadlessRenderOptions {
  /** Output height in pixels (e.g. 1080); width scales by the artboard aspect ratio. */
  targetHeight?: number;
  /** Burn the active step's narration as a lower-third caption (default true). */
  showCaptions?: boolean;
  captionStyle?: CaptionStyle;
  /** Ambient flow particles on edges (default true). */
  flowEnabled?: boolean;
  /**
   * Resolve as soon as the opening frame can be painted (background + first scene's pictures)
   * and stream the rest in behind playback, reporting arrival counts. Leave unset for exports,
   * which render the whole timeline immediately and need every picture up front.
   */
  progressiveImages?: { onProgress?: (loaded: number, total: number) => void };
}

export interface ProjectRenderer {
  totalDurationMs: number;
  pxW: number;
  pxH: number;
  /** Settles when every referenced picture is in the cache (already settled unless the
   *  renderer was created with `progressiveImages`). */
  imagesReady: Promise<void>;
  /** Render the project frame at global time `tMs` into the canvas passed to create(). */
  renderFrameAt(tMs: number): void;
  /** Seek every on-screen video clip to its frame at `tMs`. Frame-by-frame exporters await it
   *  before renderFrameAt; resolves at once for a project with no clips. */
  prepareFrameAt(tMs: number): Promise<void>;
  /** Clip URLs that would not load: the scene draws without them. The server render reads this
   *  to warn on the export job instead of reporting a clean success. */
  mediaFailures: string[];
}

/** Collect every embedded/remote image URL referenced across all scenes, deduped, in playback
 *  order (artboard background first, then scene by scene), together with how many of them the
 *  opening frame needs (background + first scene). */
function collectImageUrls(project: Project): { urls: string[]; firstSceneCount: number } {
  const urls: string[] = [];
  const seen = new Set<string>();
  // A clip is not a picture: an <img> would download the whole file to fail on it. Clips load as
  // <video> in primeSceneMedia instead.
  const push = (u?: string) => { if (u && !seen.has(u) && !isVideoUrl(u)) { seen.add(u); urls.push(u); } };
  // Hero/AI background image on the artboard's atmosphere spec.
  push((project.artboard as { bg?: { imageUrl?: string } }).bg?.imageUrl);
  // Step nodes are partial (Partial<NodeModel> & {id}); we only read imageData.
  const fromNodes = (nodes: readonly { imageData?: string }[] | undefined) => {
    nodes?.forEach((n) => push(n.imageData));
  };
  const fromEdges = (edges: readonly { nodeFlow?: { nodeSnapshots?: { imageData?: string }[] } }[] | undefined) => {
    edges?.forEach((e) => e.nodeFlow?.nodeSnapshots?.forEach((s) => push(s.imageData)));
  };
  let firstSceneCount = 0;
  project.diagrams.forEach((d, i) => {
    // A scene's own ground (a photographed hallway under the drawing) — collected nowhere before,
    // so a scene with its own photo drew the gradient fallback in every export.
    push((d as { bg?: { imageUrl?: string } }).bg?.imageUrl);
    fromNodes(d.nodes);
    fromEdges(d.edges);
    d.steps.forEach((step) => { fromNodes(step.nodes); fromEdges(step.edges); });
    if (i === 0) firstSceneCount = urls.length;
  });
  return { urls, firstSceneCount };
}

function loadImage(cache: Map<string, HTMLImageElement>, url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const img = new Image();
    if (/^https?:\/\//.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => { cache.set(url, img); resolve(); };
    img.onerror = () => resolve();
    img.src = url;
  });
}

/**
 * Preload referenced images into HTMLImageElements so drawScene can paint them synchronously.
 *
 * Without `progressive`, resolves only after EVERY picture has arrived — the export walks the
 * whole timeline immediately, so it needs them all up front. With `progressive`, resolves as
 * soon as the opening frame's pictures are in, while the rest keep streaming into the same
 * cache in playback order; `allLoaded` settles when the last one lands. Playback redraws every
 * frame, so a picture that arrives later simply appears the next time its scene is drawn —
 * an image-heavy video (hundreds of MB of object cut-outs) otherwise blocks the first paint
 * for minutes behind pictures the viewer will not reach for a long while.
 */
async function preloadImages(
  project: Project,
  progressive?: { onProgress?: (loaded: number, total: number) => void },
): Promise<{ cache: Map<string, HTMLImageElement>; allLoaded: Promise<void> }> {
  const cache = new Map<string, HTMLImageElement>();
  const { urls, firstSceneCount } = collectImageUrls(project);
  if (!progressive) {
    await Promise.all(urls.map((url) => loadImage(cache, url)));
    return { cache, allLoaded: Promise.resolve() };
  }
  let loaded = 0;
  const note = () => progressive.onProgress?.(++loaded, urls.length);
  await Promise.all(urls.slice(0, firstSceneCount).map((url) => loadImage(cache, url).then(note)));
  const rest = urls.slice(firstSceneCount);
  // A small pool kept strictly in scene order, so the download works on what the playhead will
  // reach next instead of fetching the last scene's pictures alongside the second's.
  const allLoaded = (async () => {
    let next = 0;
    const worker = async () => {
      while (next < rest.length) await loadImage(cache, rest[next++]).then(note);
    };
    await Promise.all(Array.from({ length: Math.min(6, rest.length) }, worker));
  })();
  return { cache, allLoaded };
}

export async function createProjectRenderer(
  canvas: HTMLCanvasElement,
  rawProject: Project,
  opts: HeadlessRenderOptions = {},
): Promise<ProjectRenderer> {
  // A saved step may list only what CHANGED since the step before it. Every frame is drawn from
  // the step's own node list, so a document in that shorter form renders one step of content and
  // then goes blank. The editor expands the short form as it loads; this surface is reached by
  // the export, the share player and the embed, none of which passed through that, so it expands
  // here — the one place all of them meet. Documents already in the long form come back a copy.
  const project: Project = {
    ...rawProject,
    diagrams: rawProject.diagrams.map((d) => ({ ...d, steps: normalizeStepsToFullSnapshots(d.steps || []) })),
  };
  const artboard = project.artboard;
  const outW = Math.round(artboard.width);
  const outH = Math.round(artboard.height);
  // Render at higher pixel density than the (small) artboard — content is vector, so the
  // same layout sampled at renderScale× is crisp. H.264 needs even dimensions.
  const renderScale = opts.targetHeight ? Math.max(1, opts.targetHeight / outH) : 1;
  const pxW = 2 * Math.round((outW * renderScale) / 2);
  const pxH = 2 * Math.round((outH * renderScale) / 2);

  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d')!;

  // Bundled webfonts (the marker handwriting faces) must finish loading before the first
  // frame rasterizes, or early frames letter in the fallback face. No-op where FontFaceSet
  // is absent.
  //
  // `fonts.ready` alone is not enough, and its failure mode is the quiet kind: it resolves as
  // soon as the fonts REQUESTED SO FAR are done, so if nothing has asked for a Greek character
  // yet it resolves immediately and the first frame letters Greek in a fallback. The export page
  // kicks the loads itself before the bundle even parses; the in-app callers of this function
  // (the embed, the preview dialog, the cover minter) have nothing that would, so request the
  // faces here and then wait. Both are idempotent.
  try {
    await ensureLetteringFonts();
    // A brand-kit video letters in its brand face; fetched only when the document names one.
    await ensureBrandFonts(brandFamiliesIn(rawProject));
    await (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch { /* non-browser */ }

  const timeline = buildProjectTimeline(project);
  const defaultCamera = computeDefaultCamera(artboard);

  // Per-scene float: opt-in (floatOnScenes) > opt-out (floatOffScenes) > global. Per-element
  // floatInclude/floatExclude is resolved inside drawScene.
  const floatGlobal = project.floatEnabled ?? false;
  const floatOff = project.floatOffScenes ?? [];
  const floatOn = project.floatOnScenes ?? [];
  const sceneFloat = (i: number) => !!(floatOn[i] || (floatGlobal && !floatOff[i]));

  const { cache: imageCache, allLoaded: imagesReady } = await preloadImages(project, opts.progressiveImages);
  // Footage clips (a tile, or a scene's moving ground) go into the same cache as <video> elements
  // posing as pictures; every draw path then paints the clip's current frame.
  const sceneMedia = collectSceneMedia(project);
  const mediaFailures = sceneMedia.videos.size ? await primeSceneMedia(project, imageCache) : [];

  // Work canvases only when crossfade/slide transitions are present (morph + single don't need them).
  const hasTransitions = !!project.transitions?.some((t) => t && t.durationMs > 0);
  let workA: HTMLCanvasElement | null = null;
  let workB: HTMLCanvasElement | null = null;
  if (hasTransitions) {
    workA = document.createElement('canvas'); workA.width = pxW; workA.height = pxH;
    workB = document.createElement('canvas'); workB.width = pxW; workB.height = pxH;
  }

  // Static draw options (floatEnabled is set per-scene by renderProjectFrame; baseNodes is unused).
  const drawOptsBase = {
    showGrid: false,
    flowEnabled: opts.flowEnabled !== false,
    // Respect an explicit opts override (editor preview), else the project's own toggle, else on.
    // The server render doesn't pass opts.showCaptions, so without the project fallback it would
    // ignore a project with captions turned off and burn them in anyway.
    showCaptions: opts.showCaptions ?? project.showCaptions ?? true,
    // Same fallback: the server render carries caption size/opacity/colour on the project JSON
    // (project.captionStyle), not in opts, so without this the export ignores the styling.
    captionStyle: opts.captionStyle ?? (project as { captionStyle?: typeof opts.captionStyle }).captionStyle,
    backgroundColor: artboard.background,
    // Per-user atmosphere layer (gradient + vignette + particles / hero image).
    // This was never passed here, so every SERVER-side export shipped a flat
    // color background while the editor preview and client export drew the
    // real one.
    background: (artboard as { bg?: import('../components/diagram/utils/stage-background').BackgroundSpec }).bg || null,
    imageCache,
    baseNodes: [] as NodeModel[],
  };

  return {
    totalDurationMs: timeline.totalDurationMs,
    pxW,
    pxH,
    imagesReady,
    mediaFailures,
    prepareFrameAt(tMs: number) {
      if (!sceneMedia.videos.size) return Promise.resolve();
      return seekSceneVideos(project, timeline, tMs, imageCache, sceneMedia);
    },
    renderFrameAt(tMs: number) {
      renderProjectFrame({
        ctx,
        tMs,
        renderScale,
        pxW,
        pxH,
        artboard: { width: outW, height: outH },
        drawOpts: { ...drawOptsBase, currentTimeMs: tMs },
        defaultCamera,
        sceneFloat,
        project,
        timeline,
        workA,
        workB,
      });
    },
  };
}
