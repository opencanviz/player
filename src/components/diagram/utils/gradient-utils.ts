/* eslint-disable -- Migrated file */
/**
 * Gradient Utilities
 *
 * Parsing, rendering, and interpolation for CSS gradient strings stored in node.fill.
 * Supports linear-gradient and radial-gradient syntax.
 *
 * Examples:
 *   "linear-gradient(90deg, #8B5CF6, #6D28D9)"
 *   "linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #EC4899 100%)"
 *   "radial-gradient(#ffffff, #3B82F6)"
 */

import { parseColor, rgbToHex } from './color-utils';
import { lerp, clamp } from './math-utils';

// ============================================================================
// Types
// ============================================================================

export interface GradientStop {
  color: string;
  position: number; // 0-1
}

export interface ParsedGradient {
  type: 'linear' | 'radial';
  angle: number; // degrees, for linear gradients
  stops: GradientStop[];
}

// ============================================================================
// Detection
// ============================================================================

/** Returns true if the string looks like a CSS gradient. */
export function isGradientString(fill: string | undefined): boolean {
  if (!fill) return false;
  const trimmed = fill.trim().toLowerCase();
  return trimmed.startsWith('linear-gradient(') || trimmed.startsWith('radial-gradient(');
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a CSS gradient string into a structured object.
 * Returns null if the string is not a valid gradient.
 */
export function parseGradient(fill: string): ParsedGradient | null {
  if (!fill) return null;
  const trimmed = fill.trim();

  const isLinear = trimmed.toLowerCase().startsWith('linear-gradient(');
  const isRadial = trimmed.toLowerCase().startsWith('radial-gradient(');
  if (!isLinear && !isRadial) return null;

  // Extract content inside parentheses
  const prefix = isLinear ? 'linear-gradient(' : 'radial-gradient(';
  const startIdx = trimmed.toLowerCase().indexOf(prefix) + prefix.length;
  const endIdx = trimmed.lastIndexOf(')');
  if (endIdx < 0) return null;
  const inner = trimmed.slice(startIdx, endIdx).trim();

  // Split by commas, but respect nested parentheses (e.g. rgba(…))
  const parts = splitGradientArgs(inner);
  if (parts.length < 2) return null;

  let angle = isLinear ? 180 : 0; // default: top-to-bottom for linear
  let colorStartIndex = 0;

  if (isLinear) {
    // Check if first part is an angle (e.g. "90deg", "135deg")
    const angleMatch = parts[0].trim().match(/^([\d.]+)\s*deg$/i);
    if (angleMatch) {
      angle = parseFloat(angleMatch[1]);
      colorStartIndex = 1;
    } else if (parts[0].trim().startsWith('to ')) {
      // Handle "to right", "to bottom left", etc.
      angle = directionToAngle(parts[0].trim());
      colorStartIndex = 1;
    }
  }

  // Parse color stops
  const colorParts = parts.slice(colorStartIndex);
  if (colorParts.length < 2) return null;

  const stops: GradientStop[] = [];
  for (let i = 0; i < colorParts.length; i++) {
    const part = colorParts[i].trim();
    // Try to extract color and optional position
    const posMatch = part.match(/^(.+?)\s+([\d.]+)%\s*$/);
    if (posMatch) {
      stops.push({
        color: posMatch[1].trim(),
        position: parseFloat(posMatch[2]) / 100,
      });
    } else {
      // No explicit position — will distribute evenly
      stops.push({
        color: part,
        position: -1, // sentinel for auto-distribute
      });
    }
  }

  // Distribute positions for stops without explicit positions
  distributeStopPositions(stops);

  return { type: isLinear ? 'linear' : 'radial', angle, stops };
}

/** Split gradient arguments by top-level commas (respects nested parens). */
function splitGradientArgs(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === ',' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

/** Convert "to right", "to bottom left" etc. to degrees. */
function directionToAngle(dir: string): number {
  const d = dir.replace('to ', '').trim().toLowerCase();
  const map: Record<string, number> = {
    'top': 0,
    'right': 90,
    'bottom': 180,
    'left': 270,
    'top right': 45,
    'right top': 45,
    'bottom right': 135,
    'right bottom': 135,
    'bottom left': 225,
    'left bottom': 225,
    'top left': 315,
    'left top': 315,
  };
  return map[d] ?? 180;
}

/** Fill in auto-distributed positions (-1 sentinel) for gradient stops. */
function distributeStopPositions(stops: GradientStop[]): void {
  if (stops.length === 0) return;

  // First stop defaults to 0, last to 1
  if (stops[0].position < 0) stops[0].position = 0;
  if (stops[stops.length - 1].position < 0) stops[stops.length - 1].position = 1;

  // Fill in gaps
  let i = 0;
  while (i < stops.length) {
    if (stops[i].position >= 0) {
      i++;
      continue;
    }
    // Find the next stop with a defined position
    let j = i + 1;
    while (j < stops.length && stops[j].position < 0) j++;

    const prevPos = stops[i - 1].position;
    const nextPos = stops[j].position;
    const count = j - i;
    for (let k = 0; k < count; k++) {
      stops[i + k].position = prevPos + ((nextPos - prevPos) * (k + 1)) / (count + 1);
    }
    i = j;
  }
}

// ============================================================================
// Serialization
// ============================================================================

/** Serialize a parsed gradient back to a CSS gradient string. */
export function gradientToString(parsed: ParsedGradient): string {
  const stopsStr = parsed.stops
    .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
    .join(', ');

  if (parsed.type === 'radial') {
    return `radial-gradient(${stopsStr})`;
  }
  return `linear-gradient(${parsed.angle}deg, ${stopsStr})`;
}

// ============================================================================
// Canvas Application
// ============================================================================

/**
 * Apply a fill style to a canvas context.
 * Handles gradient strings, flat colors, and undefined values.
 *
 * @param ctx - Canvas rendering context
 * @param fill - The fill string (gradient, hex, rgba, etc.)
 * @param x - Bounding box x
 * @param y - Bounding box y
 * @param w - Bounding box width
 * @param h - Bounding box height
 * @param defaultFill - Fallback if fill is undefined
 */
export function applyFillStyle(
  ctx: CanvasRenderingContext2D,
  fill: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  defaultFill: string = '#ffffff'
): void {
  const effectiveFill = fill || defaultFill;

  if (isGradientString(effectiveFill)) {
    const parsed = parseGradient(effectiveFill);
    if (parsed) {
      ctx.fillStyle = createCanvasGradient(ctx, parsed, x, y, w, h);
      return;
    }
  }

  // Flat color or fallback
  ctx.fillStyle = effectiveFill;
}

/** Create a CanvasGradient from a parsed gradient definition. */
function createCanvasGradient(
  ctx: CanvasRenderingContext2D,
  parsed: ParsedGradient,
  x: number,
  y: number,
  w: number,
  h: number
): CanvasGradient {
  if (parsed.type === 'radial') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.max(w, h) / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const stop of parsed.stops) {
      grad.addColorStop(clamp(stop.position, 0, 1), stop.color);
    }
    return grad;
  }

  // Linear gradient
  const angleRad = ((parsed.angle - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Project gradient line to bounding box
  const diagonal = Math.sqrt(w * w + h * h) / 2;
  const dx = Math.cos(angleRad) * diagonal;
  const dy = Math.sin(angleRad) * diagonal;

  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (const stop of parsed.stops) {
    grad.addColorStop(clamp(stop.position, 0, 1), stop.color);
  }
  return grad;
}

// ============================================================================
// Color Extraction
// ============================================================================

/**
 * Extract the first stop color from a gradient string.
 * Useful for functions like lightenColor that only handle flat colors.
 * Returns the fill as-is if it's not a gradient.
 */
export function getGradientBaseColor(fill: string | undefined): string {
  if (!fill) return '#ffffff';
  if (!isGradientString(fill)) return fill;

  const parsed = parseGradient(fill);
  if (parsed && parsed.stops.length > 0) {
    return parsed.stops[0].color;
  }
  return '#ffffff';
}

// ============================================================================
// Internal flat color interpolation (avoids circular import with color-utils)
// ============================================================================

/** Interpolate two flat colors (hex/rgba). Returns hex string. */
function _lerpFlatColor(colorA: string | undefined, colorB: string | undefined, t: number): string {
  const a = parseColor(colorA);
  const b = parseColor(colorB);
  const k = clamp(t, 0, 1);
  const r = Math.round(lerp(a.r, b.r, k));
  const g = Math.round(lerp(a.g, b.g, k));
  const bl = Math.round(lerp(a.b, b.b, k));
  return rgbToHex(r, g, bl);
}

// ============================================================================
// Gradient Interpolation
// ============================================================================

/**
 * Interpolate between two gradient (or flat color) strings.
 * - Both gradients with same stop count → interpolate each stop color + position + angle
 * - Gradient ↔ flat → treat flat as uniform 2-stop gradient, interpolate
 * - Different stop counts → snap at t=0.5
 */
export function lerpGradient(a: string | undefined, b: string | undefined, t: number): string {
  const k = clamp(t, 0, 1);
  const aIsGrad = isGradientString(a);
  const bIsGrad = isGradientString(b);

  // Neither is gradient — delegate to flat color lerp
  if (!aIsGrad && !bIsGrad) {
    return _lerpFlatColor(a, b, k);
  }

  const parsedA = aIsGrad ? parseGradient(a!) : flatToGradient(a);
  const parsedB = bIsGrad ? parseGradient(b!) : flatToGradient(b);

  if (!parsedA || !parsedB) {
    // Fallback: snap at 0.5
    return k < 0.5 ? (a || '#ffffff') : (b || '#ffffff');
  }

  // Different stop counts → snap at 0.5
  if (parsedA.stops.length !== parsedB.stops.length) {
    return k < 0.5 ? (a || '#ffffff') : (b || '#ffffff');
  }

  // Interpolate
  const type = k < 0.5 ? parsedA.type : parsedB.type;
  const angle = lerp(parsedA.angle, parsedB.angle, k);
  const stops: GradientStop[] = parsedA.stops.map((sa, i) => {
    const sb = parsedB.stops[i];
    return {
      color: _lerpFlatColor(sa.color, sb.color, k),
      position: lerp(sa.position, sb.position, k),
    };
  });

  return gradientToString({ type, angle, stops });
}

/** Convert a flat color to a 2-stop uniform gradient for interpolation. */
function flatToGradient(color: string | undefined): ParsedGradient {
  const c = color || '#ffffff';
  return {
    type: 'linear',
    angle: 180,
    stops: [
      { color: c, position: 0 },
      { color: c, position: 1 },
    ],
  };
}
