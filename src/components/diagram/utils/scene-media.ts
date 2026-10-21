/**
 * scene-media.ts
 *
 * A creator's own photos and video clips inside a scene: a photographed backdrop under drawn
 * content, and moving footage in a tile (a split-screen grid, a picture-in-picture).
 *
 * Neither needs a second drawing path. A photo backdrop is the scene's own `bg.imageUrl` (the
 * per-scene ground `project-render.onGround` already honours), and a footage tile is an ordinary
 * image node whose `imageData` is a video URL. What was missing is only the media itself:
 *
 *   * Every preloader collected the artboard's background image and the nodes' pictures, never a
 *     scene's own `bg.imageUrl`, so a scene with its own photographed ground drew the gradient
 *     fallback in every export.
 *   * Nothing could hold a playing clip. A `<video>` element is a valid `drawImage` source, so it
 *     is put into the same image cache every renderer already reads, posing as a loaded picture
 *     (`complete`, `naturalWidth`, `width`). Every draw path (nodes, phantoms, the stage ground)
 *     then paints the clip's current frame with no change of its own.
 *
 * The clip's clock is the scene's: at global time t a clip in scene k shows its frame at
 * (t - sceneStart), looped. Frame-by-frame exporters call `seekSceneVideos` before each frame and
 * wait for the seek, so every frame shows the right moment; live surfaces just let it play.
 */
import type { Diagram, Project } from '../types';
import { PHOTO_LEGIBILITY_DEFAULT, type BackgroundSpec } from './stage-background';
import type { ProjectTimeline } from './project-playback';

/** Whether a media URL is a video clip rather than a still picture. */
export function isVideoUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  if (/^data:video\//i.test(url)) return true;
  return /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url);
}

type NodeLike = { imageData?: string } | null | undefined;

/** Every per-scene ground picture and every clip a project uses, in playback order.
 *  `images` are the scene grounds the other collectors miss; `videos` are clips anywhere
 *  (scene grounds, base nodes, step snapshots) with the scenes each one plays in. */
export function collectSceneMedia(project: Project): { images: string[]; videos: Map<string, number[]> } {
  const images: string[] = [];
  const seen = new Set<string>();
  const videos = new Map<string, number[]>();
  const noteVideo = (u: string, i: number) => {
    const scenes = videos.get(u) || [];
    if (!scenes.includes(i)) scenes.push(i);
    videos.set(u, scenes);
  };
  const consider = (u: string | undefined, i: number, isGround: boolean) => {
    if (!u) return;
    if (isVideoUrl(u)) { noteVideo(u, i); return; }
    if (isGround && !seen.has(u)) { seen.add(u); images.push(u); }
  };
  const artBg = (project.artboard as { bg?: { imageUrl?: string } } | undefined)?.bg?.imageUrl;
  if (artBg && isVideoUrl(artBg)) project.diagrams.forEach((_, i) => noteVideo(artBg, i));
  project.diagrams.forEach((d, i) => {
    consider((d as { bg?: { imageUrl?: string } }).bg?.imageUrl, i, true);
    const fromNodes = (nodes: readonly NodeLike[] | undefined) => nodes?.forEach((n) => consider(n?.imageData, i, false));
    fromNodes(d.nodes as readonly NodeLike[]);
    d.steps?.forEach((s) => fromNodes(s.nodes as readonly NodeLike[]));
  });
  return { images, videos };
}

/** Make a `<video>` read as a loaded picture to code written for `HTMLImageElement`. */
function poseAsImage(v: HTMLVideoElement): HTMLImageElement {
  v.width = v.videoWidth;
  v.height = v.videoHeight;
  for (const [k, get] of [
    ['complete', () => v.readyState >= 2],
    ['naturalWidth', () => v.videoWidth],
    ['naturalHeight', () => v.videoHeight],
  ] as const) {
    try { Object.defineProperty(v, k, { get, configurable: true }); } catch { /* already defined */ }
  }
  return v as unknown as HTMLImageElement;
}

/** Load one clip to first-frame-ready, muted (the narration owns the sound). Null on failure. */
export function loadSceneVideo(url: string, opts: { autoplay?: boolean } = {}): Promise<HTMLImageElement | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const v = document.createElement('video');
    if (/^https?:\/\//.test(url)) v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.loop = true;
    v.preload = 'auto';
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) { resolve(null); return; }
      const img = poseAsImage(v);
      (v as unknown as { __sceneVideo: boolean }).__sceneVideo = true;
      if (opts.autoplay) void v.play().catch(() => { /* autoplay refused: first frame stays */ });
      resolve(img);
    };
    v.onloadeddata = () => done(true);
    v.onerror = () => done(false);
    setTimeout(() => done(v.readyState >= 2), 15000);
    v.src = url;
  });
}

/** Put every per-scene ground picture and every clip into `cache` (skipping what is there).
 *  Resolves to the clips that would not load (an unsupported format, a dead link), so an export
 *  can say a clip is missing instead of quietly shipping a scene without it. */
export async function primeSceneMedia(
  project: Project,
  cache: Map<string, HTMLImageElement>,
  opts: { autoplay?: boolean } = {},
): Promise<string[]> {
  const { images, videos } = collectSceneMedia(project);
  const failed: string[] = [];
  await Promise.all([
    ...images.filter((u) => !cache.has(u)).map((u) => new Promise<void>((resolve) => {
      const img = new Image();
      if (/^https?:\/\//.test(u)) img.crossOrigin = 'anonymous';
      img.onload = () => { cache.set(u, img); resolve(); };
      img.onerror = () => resolve();
      img.src = u;
    })),
    ...Array.from(videos.keys()).filter((u) => !cache.has(u)).map(async (u) => {
      const v = await loadSceneVideo(u, opts);
      if (v) cache.set(u, v);
      else failed.push(u);
    }),
  ]);
  return failed;
}

/** A clip URL as a person would recognise it: its file name. */
export function clipLabel(url: string): string {
  if (/^data:/i.test(url)) return 'an embedded clip';
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url.slice(-60);
  }
}

/** One plain sentence per clip that did not load, in the render service's wording. */
export function clipFailureWarnings(urls: readonly string[]): string[] {
  return Array.from(new Set(urls)).map((u) => `A video clip (${clipLabel(u)}) could not be played and is missing from the video.`);
}

/** The message an export shows when it finished but some content is missing; null when none is. */
export function exportWarningMessage(warnings: readonly string[] | null | undefined): string | null {
  const list = Array.from(new Set((warnings || []).filter((w) => typeof w === 'string' && w.trim())));
  if (!list.length) return null;
  return [
    'Your video is ready, but something is missing from it:',
    ...list.map((w) => `- ${w}`),
    '',
    'Try uploading the clip again, then export again. If it keeps happening, contact support with the clip name.',
  ].join('\n');
}

/** The clip time (seconds) a clip should show at scene-local `localMs`: looped over its length. */
export function clipTimeAt(localMs: number, durationS: number): number {
  const t = Math.max(0, localMs) / 1000;
  if (!(durationS > 0)) return 0;
  const end = Math.max(0, durationS - 0.04);       // never seek onto the very last (often blank) frame
  return end > 0 ? t % end : 0;
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.002) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; v.removeEventListener('seeked', finish); resolve(); };
    v.addEventListener('seeked', finish);
    v.currentTime = t;
    setTimeout(finish, 400);    // a missed 'seeked' never hangs an export
  });
}

/**
 * Seek every clip in a scene that is on screen at global `tMs` to its frame, and wait for it.
 * A clip used in several scenes follows the first one on screen. Clips in scenes that are not on
 * screen are left alone, so a long video does not pay a seek per clip per frame.
 */
export async function seekSceneVideos(
  project: Project,
  timeline: ProjectTimeline,
  tMs: number,
  cache: Map<string, HTMLImageElement>,
  media?: { videos: Map<string, number[]> },
): Promise<void> {
  const videos = (media || collectSceneMedia(project)).videos;
  if (!videos.size) return;
  // a transition draws two scenes at once, so a scene counts as on screen a little either side
  const MARGIN = 1500;
  const onScreen = timeline.slices.filter((s) => tMs >= s.startMs - MARGIN && tMs < s.startMs + s.durationMs + MARGIN);
  const seeks: Promise<void>[] = [];
  videos.forEach((scenes, url) => {
    const el = cache.get(url) as unknown as HTMLVideoElement | undefined;
    if (!el || !(el as unknown as { __sceneVideo?: boolean }).__sceneVideo) return;
    const slice = onScreen.find((s) => scenes.includes(s.sceneIndex));
    if (!slice) return;
    if (!el.paused) el.pause();
    seeks.push(seekTo(el, clipTimeAt(tMs - slice.startMs, el.duration)));
  });
  await Promise.all(seeks);
}

/** A scene's own ground (`bg` + `background`), only the keys it actually sets. */
export function sceneGroundOf(scene: Pick<Diagram, 'bg' | 'background'> | null | undefined): Pick<Diagram, 'bg' | 'background'> {
  const out: Pick<Diagram, 'bg' | 'background'> = {};
  if (scene?.bg) out.bg = scene.bg;
  if (scene?.background) out.background = scene.background;
  return out;
}

/** How dark to lay a creator's own photo or clip under the drawing so the ink stays readable:
 *  a dark sheet takes a heavier dim than a light one (the drawing colours were picked for it). */
export function backdropSpecFor(url: string, darkSheet: boolean): BackgroundSpec {
  // Readable by default: a busy photo under hatched cards is unreadable without it. The creator
  // can turn it down (Off keeps the photo exactly as dimmed here) or up from the Insert rail.
  return darkSheet
    ? { kind: 'gradient', palette: ['#0a0e16', '#1a2233'], imageUrl: url, imageDim: 0.42, imageScrim: '6,9,20', imageLegibility: PHOTO_LEGIBILITY_DEFAULT }
    : { kind: 'gradient', palette: ['#f4f2ec', '#ffffff'], imageUrl: url, imageDim: 0.3, imageScrim: '250,249,245', imageLegibility: PHOTO_LEGIBILITY_DEFAULT };
}

/** The artboard as the active scene shows it: its own ground, when it has one, over the sheet. */
export function withSceneGround<A extends { bg?: BackgroundSpec | null; background?: string }>(
  artboard: A,
  ground: Pick<Diagram, 'bg' | 'background'>,
): A {
  if (!ground.bg) return artboard;
  return { ...artboard, bg: ground.bg, background: ground.background ?? artboard.background };
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/ogg': 'ogv',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};

/**
 * The storage extension for an uploaded scene file. The file type wins for known types: a clip
 * is told apart from a photo by its URL's extension (`isVideoUrl`), so a clip saved with no
 * extension in its name (the whole name came back from `split('.')`) or a wrong one would be
 * drawn as a broken picture. The name's extension is only a fallback, and only when it has one.
 */
export function sceneMediaExtension(file: { name: string; type: string }): string {
  const byType = MIME_EXT[(file.type || '').toLowerCase()];
  if (byType) return byType;
  const dot = file.name.lastIndexOf('.');
  const byName = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (/^[a-z0-9]{1,5}$/.test(byName)) return byName;
  if (file.type.startsWith('video/')) return 'mp4';
  return (file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
}
