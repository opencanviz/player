/**
 * Caption text and placement helpers, shared by the editor preview and the headless export
 * (both draw captions through drawCaptionLowerThird in rendering-utils).
 *
 * Three jobs live here:
 *  1. The DISPLAY form of a spoken line. Narration is written for the voice ("six hundred
 *     kilometers", "two thousand twenty"), and a subtitle should read "600 km", "2020". The
 *     spoken text is never changed: the voice service times the spoken words, so the display
 *     form carries a map from every spoken word to the display word that shows it, and the
 *     karaoke highlight still lands on the right word.
 *  2. Paging a wrapped caption so no more than two lines are ever on screen at once.
 *  3. Choosing the caption band (bottom, or top when the bottom is where the content is).
 *
 * Pure functions, no canvas state, so scripts/caption-quality-smoke.mjs can test them.
 */

// ---------------------------------------------------------------------------------------------
// 1. Spoken numbers -> digits
// ---------------------------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
};
const ORD_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, thirtieth: 30,
};
const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'sept', 'oct', 'nov', 'dec']);
// Unit words written after a figure. `percent` glues to the number ("3.5%"); the rest become the
// usual abbreviation as their own word ("600 km").
const UNIT_ABBR: Record<string, string> = {
  percent: '%', kilometers: 'km', kilometres: 'km', kilometer: 'km', kilometre: 'km',
  kilograms: 'kg', kilogram: 'kg', centimeters: 'cm', centimetres: 'cm', millimeters: 'mm',
  millimetres: 'mm',
};

type Tok =
  | { k: 'U'; v: number }        // zero..nine
  | { k: 'T'; v: number }        // ten..nineteen
  | { k: 'D'; v: number }        // twenty, thirty, ... ninety
  | { k: 'DU'; v: number }       // twenty-one .. ninety-nine (one hyphenated word)
  | { k: 'H' }                   // hundred
  | { k: 'S'; v: number }        // thousand, million, ...
  | { k: 'AND' }
  | { k: 'POINT' };

function numTok(core: string): Tok | null {
  if (core in UNITS && core !== 'oh') return { k: 'U', v: UNITS[core] };
  if (core in TEENS) return { k: 'T', v: TEENS[core] };
  if (core in TENS) return { k: 'D', v: TENS[core] };
  if (core === 'hundred') return { k: 'H' };
  if (core in SCALES) return { k: 'S', v: SCALES[core] };
  const m = core.match(/^([a-z]+)-([a-z]+)$/);
  if (m && m[1] in TENS && m[2] in UNITS && m[2] !== 'zero' && m[2] !== 'oh') {
    return { k: 'DU', v: TENS[m[1]] + UNITS[m[2]] };
  }
  return null;
}

/** "zero-one-zero-one-two" -> "01012": a code read out digit by digit. */
function digitString(core: string): string | null {
  const parts = core.split('-');
  if (parts.length < 2) return null;
  let out = '';
  for (const p of parts) {
    if (!(p in UNITS)) return null;
    out += String(UNITS[p]);
  }
  return out;
}

/** "thirtieth" -> 30, "twenty-first" -> 21. */
function ordinalValue(core: string): number | null {
  if (core in ORD_UNITS) return ORD_UNITS[core];
  const m = core.match(/^([a-z]+)-([a-z]+)$/);
  if (m && m[1] in TENS && m[2] in ORD_UNITS && ORD_UNITS[m[2]] < 10) return TENS[m[1]] + ORD_UNITS[m[2]];
  return null;
}

/** Parse 0..999 starting at `i`: [small] [hundred [and] [small]]. */
function parseBelowThousand(t: Tok[], i: number): { v: number; next: number; parts: number } | null {
  let v = 0;
  let j = i;
  let parts = 0;
  const small = (at: number): { v: number; next: number } | null => {
    const a = t[at];
    if (!a) return null;
    if (a.k === 'U' || a.k === 'T' || a.k === 'DU') return { v: a.v, next: at + 1 };
    if (a.k === 'D') {
      const b = t[at + 1];
      if (b && b.k === 'U' && b.v > 0) return { v: a.v + b.v, next: at + 2 };
      return { v: a.v, next: at + 1 };
    }
    return null;
  };
  const s0 = small(j);
  if (!s0) return null;
  v = s0.v;
  j = s0.next;
  parts = 1;
  if (t[j]?.k === 'H' && v > 0 && v < 10) {
    v *= 100;
    j += 1;
    parts += 1;
    let k = j;
    if (t[k]?.k === 'AND') k += 1;
    const s1 = small(k);
    if (s1) { v += s1.v; j = s1.next; parts += 1; }
  }
  return { v, next: j, parts };
}

type Parsed = { v: number; next: number; scaleWord?: string; plain: boolean; small: boolean };

/** Parse a full cardinal at `i`. `plain` = no hundred/thousand words (a bare 0..99). */
function parseCardinal(t: Tok[], i: number, words: string[]): Parsed | null {
  let total = 0;
  let j = i;
  let lastScale = Infinity;
  let plain = true;
  let scaleWord: string | undefined;
  let any = false;
  while (true) {
    const seg = parseBelowThousand(t, j);
    if (!seg) break;
    const after = t[seg.next];
    if (after && after.k === 'S' && after.v < lastScale) {
      total += seg.v * after.v;
      lastScale = after.v;
      scaleWord = words[seg.next];
      j = seg.next + 1;
      plain = false;
      any = true;
      // "one thousand AND five"
      if (t[j]?.k === 'AND' && parseBelowThousand(t, j + 1)) j += 1;
      continue;
    }
    if (seg.parts > 1) plain = false;
    total += seg.v;
    j = seg.next;
    any = true;
    scaleWord = undefined;
    break;
  }
  if (!any) return null;
  const first = t[i];
  return { v: total, next: j, scaleWord, plain, small: plain && !!first && first.k === 'U' && j === i + 1 };
}

function groupThousands(n: number): string {
  if (n < 10000) return String(n);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type DisplayCaption = {
  /** The caption as it should read on screen. Keeps "\n" rows. */
  text: string;
  /** For every whitespace word of the spoken text, the display word that shows it. */
  spokenToDisplay: number[];
  /** How many whitespace words the display text has. */
  displayWords: number;
};

const LEAD_PUNCT = /^[("“‘'\[«¿¡]+/;
const TRAIL_PUNCT = /[.,;:!?)"”’'\]»…]+$/;

/**
 * Rewrite spelled-out English numbers as digits, for display only.
 *
 * Follows newsroom style: a lone one..nine stays a word ("one of the reasons", "three steps"),
 * ten and up becomes digits, and anything with a unit, a percent or a decimal point is digits
 * whatever its size. Codes read digit by digit ("zero-one-zero-one-two") come back as "01012",
 * a spoken year ("twenty twenty-four", "two thousand twenty") as "2024"/"2020", and an ordinal
 * after a month as a date ("November thirtieth" -> "November 30"). Text in other languages has
 * none of these words and passes through unchanged.
 */
export function captionDisplayForm(spoken: string): DisplayCaption {
  const rows = spoken.split('\n');
  const outRows: string[] = [];
  const map: number[] = [];
  let displayCount = 0;
  for (const row of rows) {
    const words = row.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    const push = (w: string, spokenCount: number) => {
      out.push(w);
      for (let k = 0; k < spokenCount; k++) map.push(displayCount);
      displayCount += 1;
    };
    const lead = words.map((w) => (w.match(LEAD_PUNCT)?.[0] ?? ''));
    const trail = words.map((w) => (w.match(TRAIL_PUNCT)?.[0] ?? ''));
    const core = words.map((w, i) => w.slice(lead[i].length, w.length - trail[i].length).toLowerCase());
    let i = 0;
    while (i < words.length) {
      // A code read digit by digit.
      const ds = core[i] ? digitString(core[i]) : null;
      if (ds) {
        push(lead[i] + ds + trail[i], 1);
        i += 1;
        continue;
      }
      // A date: month then ordinal.
      if (i > 0 && MONTHS.has(core[i - 1]) && !trail[i - 1] && !lead[i]) {
        const ov = ordinalValue(core[i]);
        if (ov !== null && ov >= 1 && ov <= 31) {
          push(lead[i] + String(ov) + trail[i], 1);
          i += 1;
          continue;
        }
      }
      // A run of number words. Only the first word may carry leading punctuation and only the
      // last trailing punctuation, so a run never crosses a comma or a sentence end.
      const toks: Tok[] = [];
      let j = i;
      while (j < words.length) {
        if (j > i && lead[j]) break;
        let tk = numTok(core[j]);
        if (!tk && core[j] === 'and' && toks.length) tk = { k: 'AND' };
        if (!tk && core[j] === 'point' && toks.length) tk = { k: 'POINT' };
        if (!tk) break;
        toks.push(tk);
        j += 1;
        if (trail[j - 1]) break;
      }
      // Trailing "and"/"point" are not part of the number.
      while (toks.length && (toks[toks.length - 1].k === 'AND' || toks[toks.length - 1].k === 'POINT')) {
        toks.pop();
      }
      const runWords = core.slice(i, i + toks.length);
      const p = toks.length ? parseCardinal(toks, 0, runWords) : null;
      if (!p) {
        push(words[i], 1);
        i += 1;
        continue;
      }
      let used = p.next;            // spoken words consumed
      let text = '';
      let isYear = false;
      // A spoken year: "nineteen ninety", "twenty twenty-four", "twenty oh five".
      if (p.plain && p.v >= 11 && p.v <= 20 && used < toks.length && !trail[i + used - 1]) {
        let yv: number | null = null;
        let yUsed = 0;
        if (core[i + used] === 'oh' && toks[used + 1]?.k === 'U') { yv = (toks[used + 1] as { v: number }).v; yUsed = 2; }
        else {
          const q = parseCardinal(toks, used, runWords);
          if (q && q.plain && q.v >= 10 && q.v <= 99) { yv = q.v; yUsed = q.next - used; }
        }
        if (yv !== null) {
          text = String(p.v * 100 + yv);
          used += yUsed;
          isYear = true;
        }
      }
      const value = p.v;
      let decimals = '';
      if (!isYear && toks[used]?.k === 'POINT') {
        let k = used + 1;
        let ds2 = '';
        while (k < toks.length && toks[k].k === 'U') { ds2 += String((toks[k] as { v: number }).v); k += 1; }
        if (ds2) { decimals = '.' + ds2; used = k; }
      }
      const lastIdx = i + used - 1;
      const tail = trail[lastIdx];
      // A unit right after the number (only when nothing separates them).
      const nextCore = !tail ? core[i + used] : undefined;
      const unit = nextCore !== undefined && !lead[i + used] ? UNIT_ABBR[nextCore] : undefined;
      const perCent = !tail && core[i + used] === 'per' && core[i + used + 1] === 'cent' && !trail[i + used];
      if (!isYear) {
        // "two million" reads better as "2 million" than as a row of zeros.
        if (p.scaleWord && SCALES[p.scaleWord] >= 1e6 && value % SCALES[p.scaleWord] === 0 && !decimals) {
          text = `${value / SCALES[p.scaleWord]} ${p.scaleWord}`;
        } else {
          text = groupThousands(value) + decimals;
        }
        // Newsroom style: a lone one..nine stays a word unless it carries a unit or a decimal.
        if (p.small && used === 1 && !decimals && !unit && !perCent) {
          push(words[i], 1);
          i += 1;
          continue;
        }
      }
      const head = lead[i];
      if (unit === '%' || perCent) {
        const n = perCent ? 2 : 1;
        const t2 = trail[i + used + n - 1];
        // Number and percent sign are one display word; every spoken word maps onto it.
        push(head + text + '%' + t2, used + n);
        i += used + n;
        continue;
      }
      if (unit) {
        const parts = text.split(' ');
        parts[0] = head + parts[0];
        if (parts.length === 1) push(parts[0], used);
        else { push(parts[0], used - 1); push(parts[1], 1); }
        push(unit + trail[i + used], 1);
        i += used + 1;
        continue;
      }
      const parts = text.split(' ');
      if (parts.length === 1) {
        push(head + text + tail, used);
      } else {
        push(head + parts[0], used - 1);
        push(parts[1] + tail, 1);
      }
      i += used;
    }
    outRows.push(out.join(' '));
  }
  return { text: outRows.join('\n'), spokenToDisplay: map, displayWords: displayCount };
}

// ---------------------------------------------------------------------------------------------
// 2. At most two lines on screen
// ---------------------------------------------------------------------------------------------

/** Most lines a caption shows at once. More than this and the caption IS the frame. */
export const CAPTION_MAX_LINES = 2;

/**
 * Split wrapped lines into pages of at most `maxLines`, spread evenly (5 lines at two a page -> 2+2+1),
 * and pick the page for `progress` (0..1 through the chunk) by each page's share of the text.
 */
export function pageCaptionLines<T>(
  lines: T[],
  progress: number,
  weigh: (line: T) => number,
  maxLines = CAPTION_MAX_LINES,
): { page: T[]; index: number; count: number; firstLine: number } {
  if (lines.length <= maxLines) return { page: lines, index: 0, count: 1, firstLine: 0 };
  const count = Math.ceil(lines.length / maxLines);
  const pages: T[][] = [];
  const starts: number[] = [];
  let at = 0;
  for (let g = 0; g < count; g++) {
    const take = Math.ceil((lines.length - at) / (count - g));
    starts.push(at);
    pages.push(lines.slice(at, at + take));
    at += take;
  }
  const w = pages.map((p) => Math.max(1, p.reduce((s, l) => s + Math.max(1, weigh(l)), 0)));
  const total = w.reduce((a, b) => a + b, 0);
  const target = Math.max(0, Math.min(1, progress)) * total;
  let acc = 0;
  let idx = pages.length - 1;
  for (let i = 0; i < pages.length; i++) {
    if (target < acc + w[i]) { idx = i; break; }
    acc += w[i];
  }
  return { page: pages[idx], index: idx, count, firstLine: starts[idx] };
}

// ---------------------------------------------------------------------------------------------
// 3. Size and placement
// ---------------------------------------------------------------------------------------------

/**
 * The length the caption's type is sized against. Landscape keeps sizing on frame height. A tall
 * frame used to as well, so a 9:16 caption was set at 3.6% of 1920 px — 69 px type wrapped to 25
 * characters a line, five or six lines, about half the frame. Sizing a tall frame on its width
 * (x1.15, roughly the height of a 16:9 frame that wide plus a bit for the phone) keeps the type
 * readable on a phone without the box taking over the picture.
 */
export function captionSizingLength(w: number, h: number): number {
  return Math.min(h, w * 1.15);
}

/** Gap between the caption box and the bottom of the frame, as a fraction of frame height.
 *  A tall frame lifts it clear of the player chrome (the Shorts/Reels title and buttons). */
export function captionBottomMargin(w: number, h: number): number {
  return h > w * 1.2 ? 0.1 : 0.05;
}

export type Rect = { x: number; y: number; w: number; h: number };

type NodeLike = {
  kind?: string; x: number; y: number; w: number; h: number;
  scaleX?: number; scaleY?: number; screenPin?: boolean;
  text?: string; label?: string;
};

/**
 * Screen rects of the content a caption should keep off: every node in the scene, wherever the
 * camera puts it, except backdrops (anything filling more than 45% of the frame — a plate, a
 * paper sheet, a full-bleed picture) and specks. Opacity is deliberately ignored: a scene's
 * steps carry every node, including ones not revealed yet, so the band decided from them holds
 * still for the scene instead of hopping as things fade in.
 */
export function captionAvoidRects(
  nodes: readonly NodeLike[],
  camera: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  // The video frame on that screen, when it is not the whole canvas (the editor draws the
  // artboard inside a larger canvas). Backdrop size and off-frame are judged against it.
  frame?: Rect,
): Rect[] {
  const out: Rect[] = [];
  const f = frame ?? { x: 0, y: 0, w: width, h: height };
  // Only tall frames move the caption. In landscape the band is a thin strip and the bottom is
  // where viewers expect it; in portrait it is a large block that sat on the subject.
  if (!(f.h > f.w * 1.2)) return out;
  const frameArea = f.w * f.h;
  for (const n of nodes) {
    if (!n || n.kind === 'group' || n.kind === 'frame') continue;
    const sx = n.scaleX ?? 1;
    const sy = n.scaleY ?? 1;
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const ww = Math.abs(n.w * sx);
    const hh = Math.abs(n.h * sy);
    const z = n.screenPin ? 1 : camera.zoom;
    const ox = n.screenPin ? 0 : (cx - ww / 2 - camera.x) * z + width / 2;
    const oy = n.screenPin ? 0 : (cy - hh / 2 - camera.y) * z + height / 2;
    const r = n.screenPin ? { x: cx - ww / 2, y: cy - hh / 2, w: ww, h: hh } : { x: ox, y: oy, w: ww * z, h: hh * z };
    if (!(r.w > 6 && r.h > 6)) continue;
    if (r.w * r.h > frameArea * 0.45) continue;
    // Off-frame entirely.
    if (r.x > f.x + f.w || r.y > f.y + f.h || r.x + r.w < f.x || r.y + r.h < f.y) continue;
    out.push(r);
  }
  return out;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Bottom unless the bottom band sits on content and the top band is clearly freer. A caption
 * that moves is worse than one that covers a corner, so it only goes up for a real win: the
 * bottom has to cover a meaningful amount and the top has to be nearly clear.
 */
export function chooseCaptionBand(bottom: Rect, top: Rect, avoid: readonly Rect[] | undefined): 'bottom' | 'top' {
  if (!avoid || !avoid.length) return 'bottom';
  const cover = (r: Rect) => avoid.reduce((s, a) => s + overlapArea(r, a), 0);
  const b = cover(bottom);
  const t = cover(top);
  // Top only when it is essentially empty. A full illustrated scene has content in both bands,
  // and moving the caption onto its sky and window frames is no better than the floor.
  const area = bottom.w * bottom.h;
  if (b > area * 0.08 && t < area * 0.02 && t < b * 0.25) return 'top';
  return 'bottom';
}

// ---------------------------------------------------------------------------------------------
// 4. Which step's caption clock is running
// ---------------------------------------------------------------------------------------------

/**
 * The step whose caption clock a step runs on.
 *
 * The storyboard appends a short silent hold step after a scene's last beat and copies that
 * beat's caption onto it so the subtitle persists. Timed as a step of its own, that copy
 * restarted the caption at its first chunk, so every scene flashed its opening sentence for the
 * final second. A step that repeats the previous step's caption and has no voice clip of its
 * own is the same caption continuing: it runs on the step it continues, and having already
 * outlasted that step's time, it shows the closing chunk.
 */
export function captionAnchorStep(
  steps: readonly { caption?: string }[],
  i: number,
  hasClip: (stepIndex: number) => boolean,
): number {
  let j = i;
  while (j > 0) {
    const cur = (steps[j]?.caption || '').trim();
    const prev = (steps[j - 1]?.caption || '').trim();
    if (!cur || cur !== prev || hasClip(j)) break;
    j -= 1;
  }
  return j;
}
