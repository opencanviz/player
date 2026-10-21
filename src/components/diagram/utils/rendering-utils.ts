/* eslint-disable -- Migrated file */
/**
 * Rendering Utilities
 * 
 * Pure rendering functions for export systems (PNG/GIF/video).
 * Uses the shared scene compositor for core rendering.
 */

import type { NodeModel, FrameState, SpriteCache, Camera, CaptionStyle, WordTiming } from '../types';
import {
  captionDisplayForm, pageCaptionLines, captionSizingLength, captionBottomMargin, chooseCaptionBand,
  captionAvoidRects, type Rect as CaptionRect,
} from './caption-text';

// Defaults for the on-screen caption lower-third (overridable via CaptionStyle).
export const CAPTION_STYLE_DEFAULTS: Required<CaptionStyle> = {
  fontScale: 1,
  textColor: '#f4f6fb',
  bandColor: '#080c16',
  bandOpacity: 0.74,
  fontWeight: 600,
  variant: 'band',
  highlightColor: '#8b5cf6',
  outlineColor: '#0b0f19',
};
import { renderSceneCore } from './scene-compositor';
import { paintStageBackground } from './stage-background';
import { drawContinuousHand, setSuppressManagedHand } from './write-hand-asset';

// Re-export renderNodeShape from entity-renderers for backward compatibility
export { renderNodeShape } from './entity-renderers';

// ---------------------------------------------------------------------------
// Ambient "floating on water" effect.
// A continuous, time-driven idle bob applied at render time (like edge flow),
// NOT baked into steps. Each node gets a slow vertical bob + slight horizontal
// drift + tiny tilt, phase-offset by a hash of its id so they desync (uniform
// motion reads mechanical). Render-only: logical positions are untouched, and
// edges follow because they route from the offset node copies.
const FLOAT_AMP = 5;            // px vertical bob amplitude
const FLOAT_OMEGA = 0.0013;     // rad/ms  (~0.2 Hz — slow, water-like)
const FLOAT_TILT = 1.5 * Math.PI / 180; // max tilt in radians (~1.5°)

function floatPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}

/** Per-node ambient offset at time `t` (ms). */
function floatOffset(id: string, t: number): { dx: number; dy: number; dr: number } {
  const p = floatPhase(id);
  return {
    dy: FLOAT_AMP * Math.sin(t * FLOAT_OMEGA + p),
    dx: FLOAT_AMP * 0.5 * Math.sin(t * FLOAT_OMEGA * 0.8 + p + 1.0),
    dr: FLOAT_TILT * Math.sin(t * FLOAT_OMEGA + p),
  };
}

/** Return offset copies of `nodes` for the float effect. Text nodes (titles,
 *  captions) are left static so labels stay readable. `sceneFloats` is the
 *  effective scene-level decision (the global toggle, possibly overridden per
 *  scene). A node floats if it opts IN (floatInclude), else stays still if it
 *  opts OUT (floatExclude), else it inherits `sceneFloats`. So a single element
 *  can float while the scene stays still, and vice-versa. */
export function applyFloat(nodes: NodeModel[], t: number, sceneFloats = true): NodeModel[] {
  // Cheap exit: scene not floating and nothing opts in → nothing to do.
  if (!sceneFloats && !nodes.some((n) => n.floatInclude && n.kind !== 'text')) return nodes;
  return nodes.map((n) => {
    if (n.kind === 'text') return n;  // text stays static, always
    const floats = n.floatInclude ? true : n.floatExclude ? false : sceneFloats;
    if (!floats) return n;
    const o = floatOffset(n.id, t);
    return {
      ...n,
      x: n.x + o.dx,
      y: n.y + o.dy,
      rotationZ: (n.rotationZ ?? 0) + o.dr,
    };
  });
}

/**
 * Pure renderer: draws a frame state to a canvas context without side effects
 * Used by export systems (PNG, GIF, video) for clean scene rendering.
 * 
 * This is a thin wrapper around renderSceneCore that handles:
 * - Background clearing and filling
 * - Camera transform setup
 * - Artboard-style rendering (no UI chrome)
 */
// ---- On-screen captions (Phase 1) -------------------------------------------
// Split a verbose narration line into 1-2 line "subtitle" chunks at sentence
// boundaries, so the whole caption never buries the frame at once.
//
// A caption that already carries "\n" rows (a re-voiced Chinese or Japanese line arrives broken
// into balanced rows) is chunked by those rows instead, at most three to a chunk, because it has
// no Latin sentence ends to split at and a tall frame can need more rows than fit at once. The
// rows stay whole and keep their "\n", so the word count the voice timing checks is unchanged.
export function chunkCaption(text: string, maxChars = 100): string[] {
  const rows = text.split('\n').map((r) => r.trim()).filter(Boolean);
  if (rows.length > 1) {
    if (rows.length <= 3) return [rows.join('\n')];
    const groups = Math.ceil(rows.length / 3);
    const out: string[] = [];
    let at = 0;
    for (let g = 0; g < groups; g++) {
      const take = Math.ceil((rows.length - at) / (groups - g));
      out.push(rows.slice(at, at + take).join('\n'));
      at += take;
    }
    return out;
  }
  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [text];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if (cur && (cur + ' ' + t).length > maxChars) {
      chunks.push(cur);
      cur = t;
    } else {
      cur = cur ? cur + ' ' + t : t;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.trim()];
}

// Chinese and Japanese (ideographs, kana, full-width forms) have no spaces to break at, so a line
// may break between any two of their characters. Korean is full-width too but puts spaces between
// words, so it breaks at those spaces like Latin text. Closing punctuation stays with the
// character before it so a row never starts with "。" or "，".
const CAPTION_BREAK_ANY = '\\u2e80-\\ua4cf\\uf900-\\ufaff\\ufe30-\\ufe4f\\uff00-\\uff60\\uffe0-\\uffe6';
const CAPTION_TOKEN = new RegExp(
  `[${CAPTION_BREAK_ANY}][、。，．！？：；）」』〉》】,.!?:;)]*|[^\\s${CAPTION_BREAK_ANY}]+|\\s+`, 'g');

// Greedy wrap a chunk to a pixel width using the ctx's current font. A "\n" is a hard break: a
// re-voiced Chinese or Japanese caption arrives broken into balanced rows, and splitting on
// whitespace used to glue those rows back together with a space between them. Inside a row,
// Latin words wrap at spaces and full-width text wraps between characters, so a long Chinese
// caption with no breaks of its own wraps instead of running off both sides of the frame.
export function wrapCaptionLines(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const row of text.split('\n')) {
    const tokens = row.trim().replace(/[ \t]+/g, ' ').match(CAPTION_TOKEN) || [];
    let line = '';
    for (const tok of tokens) {
      const test = line + tok;
      if (line.trim() && !/^\s+$/.test(tok) && ctx.measureText(test.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = tok;
      } else {
        line = test;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [text.trim()];
}

type DisplayPiece = { text: string; w: number; index: number; glue: boolean };

// Lay a display caption into rows of measured pieces.
// A "\n" is a hard row break, and Chinese or Japanese words (which have no spaces) are cut
// into one-character pieces so a row can break between any two characters, closing
// punctuation staying with the character before it. Every piece keeps the index of the
// whitespace word it came from, so the spoken-word highlight lines up the same way it does
// for Latin text, and pieces after a word's first are set with no gap.
export function layoutCaptionDisplay(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  chunk: string,
  maxW: number,
  spaceW: number,
): DisplayPiece[][] {
  const pieceRe = new RegExp(`[${CAPTION_BREAK_ANY}][、。，．！？：；）」』〉》】,.!?:;)]*|[^${CAPTION_BREAK_ANY}]+`, 'g');
  const lines: DisplayPiece[][] = [];
  let wordIndex = 0;
  for (const row of chunk.split('\n')) {
    let line: DisplayPiece[] = [];
    let lineW = 0;
    for (const word of row.split(/\s+/).filter(Boolean)) {
      const pieces = word.toUpperCase().match(pieceRe) || [word.toUpperCase()];
      pieces.forEach((text, k) => {
        const w = ctx.measureText(text).width;
        const glue = k > 0;
        const add = line.length ? (glue ? 0 : spaceW) + w : w;
        if (line.length && lineW + add > maxW) {
          lines.push(line);
          line = [];
          lineW = 0;
        }
        lineW += line.length ? (glue ? 0 : spaceW) + w : w;
        line.push({ text, w, index: wordIndex, glue });
      });
      wordIndex++;
    }
    if (line.length) lines.push(line);
  }
  return lines;
}

// The whiteboard-video caption: heavy outlined all-caps lettering sitting straight on the
// drawing with no chip behind it, and the word being spoken lit in the accent colour.
//
// The outline is what makes a chip unnecessary. Ink-on-paper frames have no reliable
// background to read against — white paper here, a dark filled shape there — so the letters
// carry their own contrast: a thick stroke in the ink colour drawn UNDER a light fill, which
// stays legible whatever it lands on. Words are laid out one at a time rather than as a
// string because each needs its own colour.
function drawCaptionDisplay(
  ctx: CanvasRenderingContext2D,
  chunk: string,
  activeWord: number,
  frame: { x: number; y: number; w: number; h: number },
  colors: { fontScale: number; textColor: string; highlightColor: string; outlineColor: string },
  progress = 0,
  avoid?: readonly CaptionRect[],
): void {
  if (!chunk.trim()) return;

  ctx.save();
  // Bigger than the chip variant (5.2% vs 3.6%): display lettering IS the lower third, so it
  // has to hold the bottom of the frame on its own. Sized on the frame's sizing length, not its
  // height, so a tall frame does not get letters a tenth of its width.
  const base = captionSizingLength(frame.w, frame.h);
  const fontPx = Math.max(Math.round(base * 0.026), Math.round(base * 0.052 * colors.fontScale));
  ctx.font = `800 ${fontPx}px "Inter", -apple-system, "Segoe UI", system-ui, sans-serif`;
  // A hair of tracking: heavy caps set solid look cramped, and the letters each carry a thick
  // outline that eats into the gap between them. Not supported everywhere, hence the guard.
  try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(fontPx * 0.015).toFixed(2)}px`; } catch {}
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Lay the words into centred lines, measuring each so the highlight can be painted per word.
  // Word gaps set from the space glyph alone are too tight at this weight; the outline needs
  // room or neighbouring words bleed into one another.
  const spaceW = ctx.measureText(' ').width * 1.35;
  const maxW = frame.w * 0.84;
  const allLines = layoutCaptionDisplay(ctx, chunk, maxW, spaceW);
  if (!allLines.length) { ctx.restore(); return; }
  // Never more than two lines at once. With a voice the page is the one holding the spoken word;
  // without one it follows the chunk's progress by length.
  const lineChars = (ln: { text: string }[]) => ln.reduce((sum, p) => sum + p.text.length, 0);
  let prog = progress;
  if (activeWord >= 0) {
    const total = allLines.reduce((sum, ln) => sum + lineChars(ln), 0) || 1;
    let before = 0;
    outer: for (const ln of allLines) {
      for (const p of ln) {
        if (p.index === activeWord) break outer;
        before += p.text.length;
      }
    }
    prog = (before + 0.5) / total;
  }
  const lines = pageCaptionLines(allLines, prog, lineChars).page;

  const lineH = Math.round(fontPx * 1.22);
  const cx = frame.x + frame.w / 2;
  const blockH = lines.length * lineH;
  // Sits in the same band as the chip variant, measured from the bottom of the frame, unless the
  // bottom is where the content is and the top is free.
  const bottomTop = frame.y + frame.h - Math.round(frame.h * captionBottomMargin(frame.w, frame.h)) - blockH;
  const topTop = frame.y + Math.round(frame.h * 0.06);
  const bandRect = (y: number) => ({ x: cx - maxW / 2, y, w: maxW, h: blockH });
  const band = chooseCaptionBand(bandRect(bottomTop), bandRect(topTop), avoid);
  let ty = (band === 'top' ? topTop : bottomTop) + lineH / 2;

  for (const ln of lines) {
    const total = ln.reduce((sum, p, i) => sum + p.w + (i && !p.glue ? spaceW : 0), 0);
    let x = cx - total / 2;
    for (let i = 0; i < ln.length; i++) {
      const p = ln[i];
      if (i && !p.glue) x += spaceW;
      ctx.lineWidth = fontPx * 0.28;
      ctx.strokeStyle = colors.outlineColor;
      ctx.strokeText(p.text, x, ty);
      ctx.fillStyle = p.index === activeWord ? colors.highlightColor : colors.textColor;
      ctx.fillText(p.text, x, ty);
      x += p.w;
    }
    ty += lineH;
  }
  ctx.restore();
}

// Draw the active step's caption as a centered lower-third in SCREEN space.
// `elapsedMs/durationMs` step through the chunks so each shows for its slice.
export function drawCaptionLowerThird(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  caption: string,
  elapsedMs: number,
  durationMs: number,
  style: CaptionStyle = {},
  // Rect (screen space) to anchor the caption within. Defaults to the whole canvas
  // (correct for export, where canvas == artboard). The editor passes the artboard's
  // on-screen rect so the caption sits inside the frame, above the timeline overlay.
  frame?: { x: number; y: number; w: number; h: number },
  // Per-word spans measured by the voice service, when this step's narration has been
  // generated. With them the caption advances on the voice; without them it falls back
  // to splitting the step's duration by character count.
  words?: WordTiming[],
  // Screen rects (same space as `frame`) of the scene's content. When the bottom band would sit
  // on content and the top band is free, the caption goes to the top. See chooseCaptionBand.
  avoid?: readonly CaptionRect[],
): void {
  const text = (caption || '').trim();
  if (!text) return;
  const fx = frame?.x ?? 0;
  const fy = frame?.y ?? 0;
  const fw = frame?.w ?? width;
  const fh = frame?.h ?? height;
  const fontScale = style.fontScale ?? CAPTION_STYLE_DEFAULTS.fontScale;
  const textColor = style.textColor ?? CAPTION_STYLE_DEFAULTS.textColor;
  const bandColor = style.bandColor ?? CAPTION_STYLE_DEFAULTS.bandColor;
  const bandOpacity = style.bandOpacity ?? CAPTION_STYLE_DEFAULTS.bandOpacity;
  const fontWeight = style.fontWeight ?? CAPTION_STYLE_DEFAULTS.fontWeight;
  const variant = style.variant ?? CAPTION_STYLE_DEFAULTS.variant;
  const highlightColor = style.highlightColor ?? CAPTION_STYLE_DEFAULTS.highlightColor;
  const outlineColor = style.outlineColor ?? CAPTION_STYLE_DEFAULTS.outlineColor;
  const chunks = chunkCaption(text);
  const frac = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 1;

  // --- Which chunk, and which word inside it, the voice is on right now.
  //
  // Word spans are only trustworthy when they came from THIS caption: the voice service
  // timed the narration clip's text, and if the step's caption has since been edited the
  // two no longer line up word for word. Comparing the counts is a cheap, exact check —
  // one mismatch and we fall back to the character-count split rather than lighting up
  // the wrong word, which reads worse than no highlight at all. The counts are of the SPOKEN
  // words: the display form below (digits for spelled-out numbers) is applied after this.
  const chunkWordCounts = chunks.map((c) => c.split(/\s+/).filter(Boolean).length);
  const totalChunkWords = chunkWordCounts.reduce((a, b) => a + b, 0);
  const timed = Array.isArray(words) && words.length > 0 && words.length === totalChunkWords;

  let timedChunkIdx = -1;
  let activeWordInChunk = -1;
  if (timed) {
    const ws = words as WordTiming[];
    // The word being said: the last one that has started. Before the first word starts we
    // hold on word 0 so the opening chunk is already on screen when the voice arrives.
    let g = 0;
    for (let i = 0; i < ws.length; i++) {
      if (elapsedMs >= ws[i].s) g = i;
    }
    let base = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (g < base + chunkWordCounts[i]) {
        timedChunkIdx = i;
        activeWordInChunk = g - base;
        break;
      }
      base += chunkWordCounts[i];
    }
    if (timedChunkIdx < 0) {
      timedChunkIdx = chunks.length - 1;
      activeWordInChunk = chunkWordCounts[timedChunkIdx] - 1;
    }
  }
  // Give each chunk on-screen time PROPORTIONAL to its length, not an even slice — the
  // narration audio reads a long sentence slower, so an even split would flip to the next
  // chunk while the audio is still on the current one. Character count approximates the
  // speaking time well enough to keep captions in step with the voice.
  const weights = chunks.map((c) => Math.max(1, c.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const target = frac * totalWeight;
  let acc = 0;
  let idx = chunks.length - 1;
  let accAtIdx = totalWeight - weights[idx];
  for (let i = 0; i < chunks.length; i++) {
    if (target < acc + weights[i]) { idx = i; accAtIdx = acc; break; }
    acc += weights[i];
  }
  // How far through the chunk we are, for paging a chunk that wraps past two lines.
  let progress = Math.max(0, Math.min(1, (target - accAtIdx) / weights[idx]));
  if (timedChunkIdx >= 0) {
    idx = timedChunkIdx;
    progress = (activeWordInChunk + 0.5) / Math.max(1, chunkWordCounts[idx]);
  }
  // What the viewer reads: spelled-out numbers as digits ("600 km", "2020", "3.5%"). The voice
  // still speaks the words; the map carries the spoken word onto the display word that shows it.
  const display = captionDisplayForm(chunks[idx]);
  const chunk = display.text;
  const activeDisplayWord = activeWordInChunk >= 0 ? (display.spokenToDisplay[activeWordInChunk] ?? -1) : -1;

  if (variant === 'display') {
    drawCaptionDisplay(ctx, chunk, activeDisplayWord, { x: fx, y: fy, w: fw, h: fh }, {
      fontScale, textColor, highlightColor, outlineColor,
    }, progress, avoid);
    return;
  }

  ctx.save();
  // Font is 3.6% of the frame's sizing length (its height in landscape; see captionSizingLength
  // for tall frames), scaled by fontScale. The minimum is PROPORTIONAL to the frame (1.8%), not a
  // fixed 15px: a fixed floor clamps in the editor's scaled-down preview, where fh is small, so
  // shrinking below the default (fontScale < 1) had no visible effect. 1.8% sits just under the
  // slider's 0.6 minimum (2.16%), so the whole range shrinks/grows while tiny frames stay legible.
  const sizeBase = captionSizingLength(fw, fh);
  const fontPx = Math.max(Math.round(sizeBase * 0.018), Math.round(sizeBase * 0.036 * fontScale));
  ctx.font = `${fontWeight} ${fontPx}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = fw * 0.78;
  // At most two lines on screen; a chunk that wraps further is shown a page at a time.
  const lines = pageCaptionLines(wrapCaptionLines(ctx, chunk, maxTextWidth), progress, (l) => l.length).page;
  const lineH = Math.round(fontPx * 1.32);
  const padX = Math.round(fontPx * 0.95);
  const padY = Math.round(fontPx * 0.62);
  const longest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.min(maxTextWidth, longest) + padX * 2;
  const boxH = lines.length * lineH + padY * 2;
  const cx = fx + fw / 2;
  const x0 = cx - boxW / 2;
  const yBottom = fy + fh - boxH - Math.round(fh * captionBottomMargin(fw, fh));
  const yTop = fy + Math.round(fh * 0.05);
  const band = chooseCaptionBand({ x: x0, y: yBottom, w: boxW, h: boxH }, { x: x0, y: yTop, w: boxW, h: boxH }, avoid);
  const y0 = band === 'top' ? yTop : yBottom;
  const r = Math.round(fontPx * 0.5);

  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x0 + boxW, y0, x0 + boxW, y0 + boxH, r);
  ctx.arcTo(x0 + boxW, y0 + boxH, x0, y0 + boxH, r);
  ctx.arcTo(x0, y0 + boxH, x0, y0, r);
  ctx.arcTo(x0, y0, x0 + boxW, y0, r);
  ctx.closePath();
  ctx.globalAlpha = Math.max(0, Math.min(1, bandOpacity));
  ctx.fillStyle = bandColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = textColor;
  let ty = y0 + padY + lineH / 2;
  for (const l of lines) {
    ctx.fillText(l, cx, ty);
    ty += lineH;
  }
  ctx.restore();
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: FrameState,
  width: number,
  height: number,
  options: {
    showGrid?: boolean;
    gridSize?: number;
    flowEnabled?: boolean;
    floatEnabled?: boolean; // ambient "floating on water" node bob
    backgroundColor?: string;
    background?: import('./stage-background').BackgroundSpec | null; // per-user atmosphere
    spriteCache?: SpriteCache;
    imageCache?: Map<string, HTMLImageElement>;
    currentTimeMs?: number;
    camera?: Camera;
    baseNodes?: NodeModel[]; // Original nodes for finding Lottie template nodes (unused, kept for API compat)
    showCaptions?: boolean; // draw the active step's narration as a screen-space lower-third
    captionStyle?: CaptionStyle; // optional styling for the caption lower-third
    handTrack?: readonly { id?: string; t0: number; t1: number; sx: number; sy: number; ex: number; ey: number;
    /** 'carry' = the hand brings a finished picture in and sets it down, instead of drawing it. */
    mode?: 'write' | 'carry' }[];
  } = {}
) {
  const {
    showGrid = false,
    gridSize = 40,
    flowEnabled = false,
    floatEnabled = false,
    backgroundColor = '#0e1729',
    background = null,
    spriteCache,
    imageCache,
    currentTimeMs = 0,
    camera = { x: 0, y: 0, zoom: 1 },
    showCaptions = false,
    captionStyle,
    handTrack,
  } = options;

  const { edges, flowOffset = 0, phantomNodes } = state;
  // Ambient float is render-only: bob offset copies of the nodes (edges follow
  // because they route from these positions).
  // Always run applyFloat (it cheap-exits when nothing floats) so a node that
  // opts in (floatInclude) bobs even when the scene's float is off. `floatEnabled`
  // here is the EFFECTIVE per-scene decision the caller passes in.
  const allNodes = applyFloat(state.nodes, currentTimeMs, !!floatEnabled);
  // Screen-pinned nodes sit out the camera pass entirely and are drawn again
  // below, once the camera transform is off the context.
  const nodes = allNodes.some((n) => n.screenPin)
    ? allNodes.filter((n) => !n.screenPin)
    : allNodes;

  // Clear and fill background — stage treatment (radial glow + vignette in
  // vector mode, flat in sketch). Drawn in screen space, centered on the frame.
  paintStageBackground(ctx, 0, 0, width, height, backgroundColor, background, currentTimeMs, imageCache);

  // Apply camera transform
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Suppress the per-node write-hand ONLY when this call will draw the single continuous
  // handTrack hand (below). Otherwise (editor DiagramPlayer/embed, or a doc without a track)
  // the per-node hand stays on as a fallback so a hand is always visible.
  // 1+ (not 2+): a single-write scene's one-segment track must still activate the managed
  // hand — without it the per-node fallback draws inside the z-order and hides behind
  // higher-z content (the marker vanished behind the payment card while writing the title).
  const _handActive = !!(handTrack && handTrack.length >= 1);
  setSuppressManagedHand(_handActive);

  // Render the scene using the shared compositor
  renderSceneCore(ctx, nodes, edges, phantomNodes, {
    camera,
    width,
    height,
    showGrid,
    gridSize,
    flowEnabled,
    globalFlowOffset: flowOffset,
    currentTimeMs,
    spriteCache,
    imageCache,
    backgroundColor,
  });

  // Continuous write-hand: ONE hand for the whole scene, driven entirely by the handTrack so
  // there are no per-node handoffs to flicker. Inside a write window it moves start->end with a
  // full scribble (writing); in the GAP between two windows it glides prev.end->next.start with
  // damped motion (a travel, not a scribble). The per-node hands are suppressed for these nodes
  // (node.handManaged), so this is the only hand drawn.
  drawContinuousHand(ctx, handTrack ?? [], currentTimeMs, nodes, height);

  setSuppressManagedHand(false); // reset the module flag so it never leaks to the next call

  // Restore transform
  ctx.restore();

  // Screen-pinned nodes (a HUD, a watermark, a running readout). Same compositor,
  // second pass, identity camera: with no camera transform on the context, a
  // node's own x/y land straight on the artboard, which is the space the author
  // is already thinking in. Drawn after the world so a HUD is always on top, and
  // before the captions so the lower-third still wins its own band.
  const pinnedNodes = nodes === allNodes ? [] : allNodes.filter((n) => n.screenPin);
  if (pinnedNodes.length > 0) {
    ctx.save();
    renderSceneCore(ctx, pinnedNodes, [], undefined, {
      camera: { x: width / 2, y: height / 2, zoom: 1 },
      width,
      height,
      currentTimeMs,
      spriteCache,
      imageCache,
      backgroundColor,
    });
    ctx.restore();
  }

  // On-screen captions (Phase 1): a screen-space lower-third of the active step's
  // narration, drawn after the camera restore so it stays fixed under zoom/pan.
  if (showCaptions && state.caption) {
    drawCaptionLowerThird(
      ctx,
      width,
      height,
      state.caption,
      state.captionElapsedMs ?? 0,
      state.captionDurationMs ?? 1,
      captionStyle,
      undefined,
      state.captionWords,
      // Keep off the scene's content where the frame allows it. Every node counts (pinned ones
      // too), placed by the same camera the frame was drawn with.
      captionAvoidRects(state.nodes, camera, width, height),
    );
  }
}
