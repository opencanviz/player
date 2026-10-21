/**
 * Stage background: instead of a flat fill, paint a subtle radial glow
 * (lighter toward the upper-center) plus a corner vignette, derived from the
 * project's background color. Gives the frame depth so glowing/glass nodes read
 * against gradient rather than a void — the codemia-explainers "stage" look.
 *
 * Sketch mode keeps the flat fill (a hand-drawn whiteboard wants flat paper).
 * Shared by the editor (drawing-helpers) and export (rendering-utils).
 */
import { getGlobalSketchMode } from './sketch-mode';
import { parseColor, rgbToHex } from './color-utils';

/** Per-user atmosphere spec (see backend background_spec). All fields optional so an
 * old doc with only a flat `background` color still renders the legacy treatment. */
/** Procedural PAPER ground (light/whiteboard themes). No gradient, no particles: a warm
 *  sheet with grain, optional ruling and soft edge shading, so the stage reads as a real
 *  page rather than a flat #f6f5fb rectangle. All fields optional. */
export type PaperGround = {
  tint?: string;                 // sheet colour (defaults to the artboard `background`)
  warm?: string;                 // second, warmer tone washed toward one corner
  grain?: number;                // 0..1 fibre-noise strength (default 0.5)
  rule?: 'none' | 'lines' | 'grid' | 'dots';
  ruleColor?: string;
  ruleSize?: number;             // world px between rules (default 46)
  edge?: number;                 // 0..1 edge-shading strength (default 0.3)
};

/** One very light line drawing behind the content — the same drawn strokes the scenes
 *  themselves use, so the ground is DRAWN, not painted. `concept` is what the backend
 *  asks for; `paths`/`viewBox` are filled in by the client once the illustration resolves. */
export type PaperMotif = {
  concept?: string;
  paths?: { d: string }[];
  viewBox?: { x: number; y: number; w: number; h: number };
  ink?: string;                  // stroke colour (default a soft ink from the palette)
  opacity?: number;              // 0..1 (default 0.07 — texture, not a second drawing)
  scale?: number;                // fraction of the smaller stage dimension (default 0.82)
  anchor?: 'center' | 'left' | 'right';
  rotate?: number;               // degrees
  strokeWidth?: number;          // in motif-viewBox units (default 2)
};

export type BackgroundSpec = {
  kind?: 'gradient' | 'solid' | 'paper';
  paper?: PaperGround;
  motif?: PaperMotif;
  palette?: string[];        // dark base first, a touch lighter last
  angle?: number;            // linear-gradient angle (deg); omit for a radial glow
  vignette?: number;         // 0..1 corner-darkening strength (default 0.32)
  particles?: number;        // dot count (0 = none)
  seed?: number;             // deterministic particle layout — per user/video
  particleColor?: string;    // dot tint (default a light tint of the palette)
  preset?: string;           // named preset this spec came from (for the UI picker)
  // Soft aurora glow-orbs: a few large, low-opacity colored blobs blended additively
  // behind content for a "produced" nebula look. x/y are fractions of w/h, r a fraction
  // of the min dimension. Kept faint so foreground stays readable.
  orbs?: { x: number; y: number; r: number; color: string; alpha?: number }[];
  // AI/photo background image (hero scenes): a data: or remote URL, drawn cover-fit as the
  // base layer, darkened by `imageDim` (0..1, default 0.42) so foreground text stays legible.
  imageUrl?: string;
  imageDim?: number;
  // Scrim color laid over the image (as "r,g,b") — dark near-black by default (light text
  // on top). Light themes pass a pale color so dark text stays readable over a light image.
  imageScrim?: string;
  // How hard to work at keeping the drawing readable over the picture, 0..1 (absent = 0, the
  // picture exactly as dimmed above). A creator's photo or clip backdrop is stored with
  // PHOTO_LEGIBILITY_DEFAULT. It does three things together, all scaled by the one number:
  // takes some colour out of the picture (a busy, saturated photo is what fights the ink),
  // lays the scrim a little heavier, and backs every hatched card with its own fill so the
  // hatching sits on a solid-ish card instead of on the photo (see photoCardBacking).
  imageLegibility?: number;
  // Technical grid overlay: faint evenly-spaced lines (or dots) for a blueprint/graph look.
  grid?: { size?: number; color?: string; dots?: boolean };
};

/** The readability a creator's own photo or clip backdrop gets unless they change it. */
export const PHOTO_LEGIBILITY_DEFAULT = 0.6;

/** Named readability levels for the editor's picker. */
export const PHOTO_LEGIBILITY_LEVELS: { label: string; value: number }[] = [
  { label: 'Off', value: 0 },
  { label: 'Soft', value: PHOTO_LEGIBILITY_DEFAULT },
  { label: 'Strong', value: 1 },
];

function legibilityOf(spec?: BackgroundSpec | null): number {
  const v = spec?.imageLegibility;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** Opacity of the solid backing under a hatched card while the ground being drawn is a picture
 *  with a readability setting; 0 when it is not. Set by the stage-ground painter, which every
 *  frame (editor canvas, preview, headless export) calls before any node, so the cards of that
 *  frame read it and the editor and the export draw the same thing. */
let _cardBacking = 0;
export function photoCardBacking(): number {
  return _cardBacking;
}

/** The scrim strength actually laid over the picture: the stored dim, raised by the readability. */
export function effectiveImageDim(spec: BackgroundSpec): number {
  const dim = spec.imageDim ?? 0.42;
  return Math.max(0, Math.min(0.85, dim + 0.3 * legibilityOf(spec)));
}

/** The cache key for a spec's background image (if any), for preloading. */
export function bgImageKey(spec?: BackgroundSpec | null): string | null {
  return spec?.imageUrl || null;
}

function toRgb(color: string): [number, number, number] | null {
  if (!color || color[0] !== '#') return null;
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Deterministic RNG so a given seed always lays particles out the same way. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paint a per-user atmosphere: palette gradient + vignette + a drifting particle
 * field. Kept dark/low-contrast so foreground content stays readable. */
function paintSpec(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  base: string, spec: BackgroundSpec, timeMs: number,
  imageCache?: Map<string, HTMLImageElement>,
): void {
  const pal = (spec.palette && spec.palette.length ? spec.palette : [base]).filter(Boolean);
  const c0 = pal[0] || base || '#0b1020';
  const c1 = pal[pal.length - 1] || c0;

  // 0) AI/photo image base (hero scenes). Cover-fit + darkening scrim so text stays legible.
  //    Only replaces the gradient when the image is actually loaded in the cache; otherwise
  //    we fall through to the gradient so headless/export never renders an empty frame.
  const imgEl = spec.imageUrl ? imageCache?.get(spec.imageUrl) : undefined;
  const hasImg = !!(imgEl && imgEl.complete && imgEl.naturalWidth > 0);
  if (hasImg) {
    const iw = imgEl!.naturalWidth, ih = imgEl!.naturalHeight;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const scale = Math.max(w / iw, h / ih);        // cover
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(imgEl!, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    const leg = legibilityOf(spec);
    if (leg > 0) {
      // Pull part of the colour out first: a 'saturation' blend with a grey takes the grey's
      // (zero) saturation and keeps the photo's own hue and light, so at partial alpha the
      // picture is still plainly itself, only calmer. Canvas-native, so every browser and the
      // headless exporter agree (ctx.filter is not everywhere).
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = 0.5 * leg;
      ctx.fillStyle = '#808080';
      ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    const dim = effectiveImageDim(spec);
    const scrim = spec.imageScrim || '6,9,20'; // dark near-black by default; light themes pass a pale rgb
    ctx.fillStyle = `rgba(${scrim},${dim.toFixed(3)})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    _cardBacking = leg > 0 ? Math.min(0.92, 0.55 + 0.4 * leg) : 0;
  } else {
    // 1) Gradient base — linear if an angle is given, else a center-biased radial glow.
    let grad: CanvasGradient;
    if (typeof spec.angle === 'number') {
      const a = (spec.angle * Math.PI) / 180;
      const dx = Math.cos(a) * w * 0.5;
      const dy = Math.sin(a) * h * 0.5;
      const cx = x + w / 2;
      const cy = y + h / 2;
      grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c0);
    } else {
      const cx = x + w / 2;
      const cy = y + h * 0.4;
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.62);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c0);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  // 1b) Aurora glow-orbs — a few large soft color blobs blended additively, each drifting
  //     on its own slow orbit. This is what reads as "produced" vs a flat gradient. Kept
  //     low-alpha so diagrams stay legible on top.
  const orbs = spec.orbs;
  if (orbs && orbs.length) {
    const minDim = Math.min(w, h);
    const t = timeMs / 1000;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    orbs.forEach((o, i) => {
      const drift = minDim * 0.03;
      const ph = i * 1.7;
      const ocx = x + o.x * w + Math.cos(ph + t * 0.06) * drift;
      const ocy = y + o.y * h + Math.sin(ph + t * 0.05) * drift;
      const orad = Math.max(1, o.r * minDim);
      const rgb = toRgb(o.color) || [140, 160, 255];
      const a = Math.max(0, Math.min(0.5, o.alpha ?? 0.16));
      const g = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, orad);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ocx, ocy, orad, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // 2) Particle field — seeded, faint, slowly drifting (drift invisible in a still
  //    frame but gives the video ambient life). Never bright enough to fight content.
  const n = Math.max(0, Math.min(400, spec.particles ?? 0));
  if (n > 0) {
    const rnd = mulberry32((spec.seed ?? 1) | 0);
    const tint = spec.particleColor || '#c7d2fe';
    const t = timeMs / 1000;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const px0 = rnd();
      const py0 = rnd();
      const r = 0.6 + rnd() * 2.2;
      const ph = rnd() * Math.PI * 2;
      const spd = 0.15 + rnd() * 0.4;
      // gentle circular drift
      const px = x + ((px0 + Math.cos(ph + t * spd) * 0.01 + 1) % 1) * w;
      const py = y + ((py0 + Math.sin(ph + t * spd) * 0.01 + 1) % 1) * h;
      const alpha = 0.10 + rnd() * 0.28;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 2b) Technical grid overlay — faint lines or dots (blueprint / graph-paper look).
  if (spec.grid) {
    const gs = Math.max(6, spec.grid.size ?? 40);
    const gc = spec.grid.color ?? 'rgba(255,255,255,0.06)';
    ctx.save();
    if (spec.grid.dots) {
      ctx.fillStyle = gc;
      for (let gx = x + gs / 2; gx < x + w; gx += gs) {
        for (let gy = y + gs / 2; gy < y + h; gy += gs) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.1, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else {
      ctx.strokeStyle = gc; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = x; gx <= x + w; gx += gs) { ctx.moveTo(gx + 0.5, y); ctx.lineTo(gx + 0.5, y + h); }
      for (let gy = y; gy <= y + h; gy += gs) { ctx.moveTo(x, gy + 0.5); ctx.lineTo(x + w, gy + 0.5); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3) Corner vignette for depth.
  const v = spec.vignette ?? 0.32;
  if (v > 0) {
    const vCx = x + w / 2;
    const vCy = y + h / 2;
    const vg = ctx.createRadialGradient(vCx, vCy, Math.min(w, h) * 0.34, vCx, vCy, Math.hypot(w, h) * 0.64);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${Math.max(0, Math.min(0.6, v)).toFixed(3)})`);
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);
  }
}

// ---------------------------------------------------------------------------
// Paper ground (whiteboard / light themes)
// ---------------------------------------------------------------------------

/** Seeded fibre-noise tiles, keyed by seed. Building one is ~16k random writes, and the
 *  ground repaints every frame, so it is built once and reused as a canvas pattern. */
const _grainTiles = new Map<string, HTMLCanvasElement>();

function grainTile(seed: number): HTMLCanvasElement | null {
  const key = String(seed >>> 0);
  const hit = _grainTiles.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const cx = cv.getContext('2d');
  if (!cx) return null;
  const img = cx.createImageData(N, N);
  const rnd = mulberry32(seed || 1);
  for (let i = 0; i < N * N; i++) {
    const v = rnd();
    // Salt AND pepper: paper fibre catches light as well as shadow, so a purely dark
    // speckle reads as dirt on the sheet rather than texture in it.
    const dark = v < 0.5;
    const o = i * 4;
    img.data[o] = dark ? 40 : 255;
    img.data[o + 1] = dark ? 36 : 255;
    img.data[o + 2] = dark ? 56 : 255;
    img.data[o + 3] = Math.round(rnd() * 46);
  }
  cx.putImageData(img, 0, 0);
  _grainTiles.set(key, cv);
  return cv;
}

/** Mix a hex toward black by `k` (0..1) and return an rgba() string at `alpha`. */
function shadeRgba(hex: string, k: number, alpha: number): string {
  const rgb = toRgb(hex) || [240, 238, 246];
  const m = (c: number) => Math.round(c * (1 - k));
  return `rgba(${m(rgb[0])},${m(rgb[1])},${m(rgb[2])},${alpha.toFixed(3)})`;
}

/** Paint the paper stage: sheet + warm wash + ruling + faint drawn motif + grain + edge
 *  shading. Deliberately time-independent — a page does not shimmer, and any per-frame
 *  motion in the ground would read as video noise behind still ink. */
function paintPaper(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  base: string, spec: BackgroundSpec,
): void {
  const p = spec.paper || {};
  const tint = p.tint || base || '#f6f5fb';
  const seed = (spec.seed ?? 7) | 0;

  // 1) The sheet.
  ctx.save();
  ctx.fillStyle = tint;
  ctx.fillRect(x, y, w, h);

  // 2) Warm wash — a broad, very low-contrast diagonal so the sheet is not one dead
  //    flat colour. Warm toward the top-left (where a desk lamp would be).
  const warm = p.warm;
  if (warm) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.85, y + h);
    const wr = toRgb(warm) || [255, 250, 240];
    g.addColorStop(0, `rgba(${wr[0]},${wr[1]},${wr[2]},0.55)`);
    g.addColorStop(1, `rgba(${wr[0]},${wr[1]},${wr[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  // 3) Ruling (notebook lines / graph grid / dot grid). Off by default.
  const rule = p.rule || 'none';
  if (rule !== 'none') {
    const gs = Math.max(10, p.ruleSize ?? 46);
    const rc = p.ruleColor || shadeRgba(tint, 0.62, 0.09);
    ctx.save();
    if (rule === 'dots') {
      ctx.fillStyle = rc;
      const r = Math.max(0.8, Math.min(w, h) * 0.0016);
      for (let gx = x + gs / 2; gx < x + w; gx += gs) {
        for (let gy = y + gs / 2; gy < y + h; gy += gs) {
          ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else {
      ctx.strokeStyle = rc;
      ctx.lineWidth = Math.max(0.6, Math.min(w, h) * 0.0011);
      ctx.beginPath();
      for (let gy = y + gs; gy < y + h; gy += gs) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
      if (rule === 'grid') {
        for (let gx = x + gs; gx < x + w; gx += gs) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4) Motif — one line drawing of the video's own subject, laid in at a whisper. Painted
  //    UNDER the grain on purpose: grain over the strokes puts the ink in the paper instead
  //    of on top of it. Skipped until the illustration has actually resolved.
  const m = spec.motif;
  const vb = m?.viewBox;
  if (m && m.paths && m.paths.length && vb && vb.w > 0 && vb.h > 0) {
    // Scale is deliberately allowed past 1: an oversized drawing that bleeds off the frame
    // reads as a texture in the paper, where the same strokes at picture size read as a
    // picture, and the eye stops to identify it instead of reading the scene.
    const frac = Math.max(0.2, Math.min(2.4, m.scale ?? 1.5));
    const s = (Math.min(w, h) * frac) / Math.max(vb.w, vb.h);
    const anchor = m.anchor || 'center';
    const cx = anchor === 'left' ? x + w * 0.16 : anchor === 'right' ? x + w * 0.84 : x + w / 2;
    const cy = y + h * (anchor === 'center' ? 0.5 : 0.56);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(0.35, m.opacity ?? 0.07));
    ctx.translate(cx, cy);
    if (m.rotate) ctx.rotate((m.rotate * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.translate(-(vb.x + vb.w / 2), -(vb.y + vb.h / 2));
    ctx.strokeStyle = m.ink || shadeRgba(tint, 0.72, 1);
    // Constant apparent weight regardless of how far the drawing was scaled up.
    ctx.lineWidth = Math.max(0.35, (m.strokeWidth ?? 2.4) / s * (Math.min(w, h) / 900));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of m.paths) {
      if (!path?.d) continue;
      try { ctx.stroke(new Path2D(path.d)); } catch { /* a malformed path never blanks the ground */ }
    }
    ctx.restore();
  }

  // 5) Grain.
  const grain = Math.max(0, Math.min(1, p.grain ?? 0.5));
  if (grain > 0) {
    const tile = grainTile(seed);
    const pat = tile ? ctx.createPattern(tile, 'repeat') : null;
    if (pat) {
      ctx.save();
      ctx.globalAlpha = grain * 0.55;
      ctx.fillStyle = pat;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  }

  // 6) Edge shading — the sheet curving away at the corners. Tinted from the paper itself,
  //    never neutral black, which greys a warm ground into newsprint.
  const edge = Math.max(0, Math.min(1, p.edge ?? 0.3));
  if (edge > 0) {
    const vCx = x + w / 2, vCy = y + h / 2;
    const vg = ctx.createRadialGradient(vCx, vCy, Math.min(w, h) * 0.42, vCx, vCy, Math.hypot(w, h) * 0.60);
    vg.addColorStop(0, shadeRgba(tint, 0.5, 0));
    vg.addColorStop(1, shadeRgba(tint, 0.5, edge * 0.34));
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

export function paintStageBackground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  spec?: BackgroundSpec | null,
  timeMs: number = 0,
  imageCache?: Map<string, HTMLImageElement>,
): void {
  // Only a picture ground actually painted this frame turns card backing on (paintSpec).
  _cardBacking = 0;
  // Paper ground FIRST: whiteboard themes are sketch mode, so the flat-fill branch below
  // would swallow their spec. Paper is the sketch-mode treatment, done properly — flat
  // where flatness matters (behind the cards) with texture and a ghost drawing everywhere
  // else. No gradient, no particles, nothing that fights dark ink on a light sheet.
  if (spec && spec.kind === 'paper') {
    paintPaper(ctx, x, y, w, h, base, spec);
    return;
  }
  // Sketch mode → flat paper (a hand-drawn board wants flat), regardless of spec.
  if (getGlobalSketchMode()) {
    ctx.fillStyle = base || '#0e1729';
    ctx.fillRect(x, y, w, h);
    return;
  }
  // Per-user atmosphere spec: palette gradient / image + vignette + particle field.
  if (spec && (spec.palette?.length || spec.particles || spec.imageUrl)) {
    paintSpec(ctx, x, y, w, h, base, spec, timeMs, imageCache);
    return;
  }
  // No spec → the original base-color treatment.
  if (!toRgb(base)) {
    ctx.fillStyle = base || '#0e1729';
    ctx.fillRect(x, y, w, h);
    return;
  }
  const rgb = toRgb(base)!;
  // Light backgrounds (professional/educational themes) look best FLAT — the dark radial
  // vignette below muddies them into a dirty grey gradient. Detect luminance and bail to
  // a clean flat fill.
  if (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 170) {
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    return;
  }
  const cx = x + w / 2;
  const cy = y + h * 0.42; // bias the glow slightly above center
  const reach = Math.hypot(w, h) * 0.62;
  const lighter = `rgb(${Math.min(255, rgb[0] + 14)}, ${Math.min(255, rgb[1] + 16)}, ${Math.min(255, rgb[2] + 23)})`;

  // Base radial: subtly lit center → the base color at the edges.
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
  glow.addColorStop(0, lighter);
  glow.addColorStop(1, base);
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // Corner vignette for depth.
  const vCx = x + w / 2;
  const vCy = y + h / 2;
  const vignette = ctx.createRadialGradient(vCx, vCy, Math.min(w, h) * 0.36, vCx, vCy, Math.hypot(w, h) * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
}

// ============================================================================
// Background presets — the first-class "atmosphere" picker. Mirrors the backend
// _background.py so a spec built here renders identically headless/in export.
// ============================================================================

type PresetDef = {
  palette: string[]; particleColor: string; particles: number; vignette: number;
  glow: string[]; grid?: { size?: number; color?: string; dots?: boolean };
};

export const BACKGROUND_PRESETS: Record<string, PresetDef> = {
  // --- Aurora: dark base + drifting glow-orbs (the "produced" look) ---
  midnight: { palette: ['#080b18', '#141b3a'], particleColor: '#a5b4fc', particles: 110, vignette: 0.36, glow: ['#4f46e5', '#38bdf8', '#fbbf24', '#a855f7'] },
  aurora:   { palette: ['#0a0e1f', '#1a1642'], particleColor: '#a5b4fc', particles: 90,  vignette: 0.34, glow: ['#6366f1', '#38bdf8', '#a855f7'] },
  violet:   { palette: ['#0d0a1f', '#2a1650'], particleColor: '#c4b5fd', particles: 100, vignette: 0.34, glow: ['#8b5cf6', '#d946ef', '#6366f1'] },
  ocean:    { palette: ['#071a24', '#0f3a44'], particleColor: '#7dd3fc', particles: 80,  vignette: 0.32, glow: ['#22d3ee', '#38bdf8', '#2dd4bf'] },
  forest:   { palette: ['#08140f', '#123324'], particleColor: '#86efac', particles: 70,  vignette: 0.32, glow: ['#34d399', '#4ade80', '#22d3ee'] },
  ember:    { palette: ['#1a0f10', '#3a1f14'], particleColor: '#fbbf24', particles: 70,  vignette: 0.36, glow: ['#fb923c', '#f43f5e', '#fbbf24'] },
  slate:    { palette: ['#0b0f17', '#1b2436'], particleColor: '#94a3b8', particles: 60,  vignette: 0.30, glow: ['#60a5fa', '#818cf8', '#38bdf8'] },
  // --- Gradient: clean two-tone, no orbs (calmer, less busy) ---
  dusk:     { palette: ['#1a1024', '#3a1e3c'], particleColor: '#e9d5ff', particles: 30, vignette: 0.34, glow: [] },
  steel:    { palette: ['#0a0f16', '#20303f'], particleColor: '#cbd5e1', particles: 30, vignette: 0.32, glow: [] },
  sand:     { palette: ['#161009', '#3a2a17'], particleColor: '#fde68a', particles: 30, vignette: 0.34, glow: [] },
  rose:     { palette: ['#1a0b12', '#3a1626'], particleColor: '#fecdd3', particles: 30, vignette: 0.34, glow: [] },
  // --- Minimal: flat solid, no orbs/particles ---
  ink:      { palette: ['#08080c', '#08080c'], particleColor: '#94a3b8', particles: 0, vignette: 0.24, glow: [] },
  graphite: { palette: ['#101216', '#101216'], particleColor: '#94a3b8', particles: 0, vignette: 0.22, glow: [] },
  // --- Grid: technical blueprint / graph-paper ---
  blueprint:{ palette: ['#0a1020', '#0a1020'], particleColor: '#93c5fd', particles: 0, vignette: 0.30, glow: [], grid: { size: 40, color: 'rgba(120,160,255,0.10)', dots: false } },
  dotgrid:  { palette: ['#0b0d12', '#0b0d12'], particleColor: '#cbd5e1', particles: 0, vignette: 0.26, glow: [], grid: { size: 26, color: 'rgba(255,255,255,0.11)', dots: true } },
  graph:    { palette: ['#0b120d', '#0b120d'], particleColor: '#86efac', particles: 0, vignette: 0.28, glow: [], grid: { size: 34, color: 'rgba(110,231,183,0.10)', dots: false } },
  // --- Light: soft tinted grounds for paper-themed documents. Every group above is
  // dark, so a video authored with dark ink (the notebook default) had no readable
  // colored background to pick — creators grabbed forest/ocean anyway and their text
  // vanished (seen on a live portfolio video). Low particle counts, gentle vignette.
  mist:   { palette: ['#f4f6fb', '#dfe5f2'], particleColor: '#8a97ad', particles: 24, vignette: 0.14, glow: [] },
  cream:  { palette: ['#fbf7ee', '#f0e6d2'], particleColor: '#c9a86f', particles: 24, vignette: 0.16, glow: [] },
  meadow: { palette: ['#eff8f1', '#d8eedd'], particleColor: '#69b981', particles: 24, vignette: 0.14, glow: [] },
  sky:    { palette: ['#eef6fb', '#d7e9f5'], particleColor: '#6fa9cf', particles: 24, vignette: 0.14, glow: [] },
  blush:  { palette: ['#fbf1f3', '#f3dde3'], particleColor: '#d38ba0', particles: 24, vignette: 0.15, glow: [] },
};

/** Presets grouped by style, for the picker UI. */
export const BACKGROUND_PRESET_GROUPS: { label: string; names: string[] }[] = [
  // Light leads: the signature look is light paper with dark ink, so the first row a
  // creator sees should be the one that keeps their document readable.
  { label: 'Light',    names: ['mist', 'cream', 'meadow', 'sky', 'blush'] },
  { label: 'Aurora',   names: ['midnight', 'aurora', 'violet', 'ocean', 'forest', 'ember', 'slate'] },
  { label: 'Gradient', names: ['dusk', 'steel', 'sand', 'rose'] },
  { label: 'Minimal',  names: ['ink', 'graphite'] },
  { label: 'Grid',     names: ['blueprint', 'dotgrid', 'graph'] },
];

export const BACKGROUND_PRESET_ORDER = BACKGROUND_PRESET_GROUPS.flatMap((g) => g.names);
export type BackgroundPresetName = string;

/** Relative luminance (0 dark .. 1 light) of a #rgb/#rrggbb hex; null when unparsable. */
export function hexLuminance(hex: unknown): number | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}/.test(h)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Seeded aurora orbs in FRACTIONAL coords (renderer scales by w/h/minDim). Deterministic. */
function orbsFor(seed: number, glow: string[]): NonNullable<BackgroundSpec['orbs']> {
  let st = (seed ^ 0x9e3779b9) >>> 0;
  const nxt = () => { st = (Math.imul(st, 1103515245) + 12345) >>> 0; return st / 0xffffffff; };
  const n = 4 + Math.floor(nxt() * 2); // 4–5
  const out: NonNullable<BackgroundSpec['orbs']> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: +(0.12 + nxt() * 0.76).toFixed(3),
      y: +(0.10 + nxt() * 0.80).toFixed(3),
      r: +(0.34 + nxt() * 0.30).toFixed(3),
      color: glow[i % glow.length],
      alpha: +(0.10 + nxt() * 0.07).toFixed(3),
    });
  }
  return out;
}

/** Build a full BackgroundSpec for a named preset. `fancy` (default true) adds the orbs. */
export function buildBackgroundSpec(name: string, seed = 1, fancy = true): BackgroundSpec {
  const def = BACKGROUND_PRESETS[name] || BACKGROUND_PRESETS.midnight;
  const spec: BackgroundSpec = {
    kind: 'gradient',
    palette: [...def.palette],
    particleColor: def.particleColor,
    particles: def.particles,
    vignette: def.vignette,
    seed,
    preset: BACKGROUND_PRESETS[name] ? name : 'midnight',
  };
  if (def.grid) spec.grid = { ...def.grid };
  // Orbs only for presets that define glow colors (Aurora family); gradient/minimal/grid skip them.
  if (fancy && def.glow.length) spec.orbs = orbsFor(seed, def.glow);
  return spec;
}

// ============================================================================
// Generative / brand backgrounds — derive a whole atmosphere from ONE brand color
// (or a logo's dominant color). Procedural + deterministic, so it renders the same
// headless/in export. This is the "bring your brand" path over the fixed presets.
// ============================================================================

function _clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = _clamp(s, 0, 1); l = _clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

/** Derive a full atmosphere from a single brand color: a dark hue-tinted gradient + a
 *  harmonious set of vivid glow accents (brand + analogous + complementary). Deterministic. */
export function buildBrandBackgroundSpec(brandHex: string, seed = 7): BackgroundSpec {
  const { r, g, b } = parseColor(brandHex);
  const [h, s0] = rgbToHsl(r, g, b);
  const s = _clamp(s0, 0.35, 0.95); // treat washed-out brand colors as reasonably saturated
  const base = [
    hslToHex(h, _clamp(s * 0.5, 0.15, 0.5), 0.055),   // near-black, tinted by the brand hue
    hslToHex(h, _clamp(s * 0.55, 0.2, 0.55), 0.14),   // dark, a touch more saturated/lighter
  ];
  const glow = [
    hslToHex(h, _clamp(s * 1.05, 0.6, 0.95), 0.60),          // the brand color, vivid
    hslToHex(h + 35, _clamp(s * 0.95, 0.55, 0.9), 0.60),     // analogous, warm side
    hslToHex(h - 30, _clamp(s * 0.95, 0.55, 0.9), 0.58),     // analogous, cool side
    hslToHex(h + 180, _clamp(s * 0.8, 0.5, 0.85), 0.62),     // complementary pop
  ];
  return {
    kind: 'gradient',
    palette: base,
    particleColor: hslToHex(h, _clamp(s * 0.5, 0.2, 0.55), 0.78),
    particles: 100,
    vignette: 0.35,
    seed,
    preset: 'brand',
    orbs: orbsFor(seed, glow),
  };
}

/** Extract the dominant SATURATED color from a logo/image (data or remote URL). Returns null
 *  for near-monochrome art (e.g. a black/white logo) so the caller can fall back to a hex. */
export async function dominantBrandColor(src: string): Promise<string | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const im = new Image();
    if (/^https?:\/\//.test(src)) im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  if (!img) return null;
  const N = 48;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const cx = cv.getContext('2d');
  if (!cx) return null;
  cx.drawImage(img, 0, 0, N, N);
  let data: Uint8ClampedArray;
  try { data = cx.getImageData(0, 0, N, N).data; } catch { return null; } // tainted canvas
  let wr = 0, wg = 0, wb = 0, wsum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.12 || l > 0.9 || s < 0.18) continue; // skip near-black/white/grey
    const w = s * s;                                // favor the most vivid pixels
    wr += data[i] * w; wg += data[i + 1] * w; wb += data[i + 2] * w; wsum += w;
  }
  if (wsum < 0.5) return null; // essentially monochrome art
  return rgbToHex(Math.round(wr / wsum), Math.round(wg / wsum), Math.round(wb / wsum));
}
