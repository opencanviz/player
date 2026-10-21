/* eslint-disable -- Migrated file */
import { clamp, lerp } from './math-utils';

// Canvas for converting CSS color names to RGB
let canvasCache: HTMLCanvasElement | null = null;

/**
 * Parse any color string (hex, rgba/rgb, or CSS color names) to RGB components
 */
export const parseColor = (color?: string): { r: number; g: number; b: number; a: number } => {
  // Handle transparent as fully transparent black
  if (!color || color === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Check if it's rgba/rgb format
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Try to parse as hex (6-digit or 8-digit)
  const h = color.replace('#', '');
  if (h.length === 6) {
    const n = parseInt(h, 16);
    if (!isNaN(n)) {
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
  } else if (h.length === 8) {
    // 8-digit hex: RRGGBBAA format
    const n = parseInt(h.substring(0, 6), 16);
    const alpha = parseInt(h.substring(6, 8), 16);
    if (!isNaN(n) && !isNaN(alpha)) {
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: alpha / 255 };
    }
  }

  // If not hex, try to parse as CSS color name using canvas
  try {
    if (typeof document !== 'undefined') {
      if (!canvasCache) {
        canvasCache = document.createElement('canvas');
        canvasCache.width = 1;
        canvasCache.height = 1;
      }
      const ctx = canvasCache.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const imageData = ctx.getImageData(0, 0, 1, 1).data;
        return {
          r: imageData[0],
          g: imageData[1],
          b: imageData[2],
          a: imageData[3] / 255,
        };
      }
    }
  } catch (e) {
    // Canvas method failed
  }

  // If all parsing fails, return transparent as fallback
  console.warn(`Failed to parse color: "${color}". Defaulting to transparent.`);
  return { r: 0, g: 0, b: 0, a: 0 };
};

export const hexToRgb = (hex?: string) => {
  const { r, g, b } = parseColor(hex);
  return { r, g, b };
};

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

import { isGradientString, lerpGradient } from './gradient-utils';

/**
 * Interpolate between two colors (supports hex, rgba, and gradient formats)
 * If either color has alpha, returns rgba format; otherwise returns hex.
 * If either value is a gradient string, delegates to lerpGradient.
 */
export const lerpColor = (colorA?: string, colorB?: string, t = 0) => {
  // Gradient interpolation
  if (isGradientString(colorA) || isGradientString(colorB)) {
    return lerpGradient(colorA, colorB, t);
  }

  const a = parseColor(colorA);
  const b = parseColor(colorB);
  const k = clamp(t, 0, 1);
  
  // Special case: if one color is fully transparent (alpha=0), use the other color's RGB
  // This prevents interpolating from/to black when fading in/out
  let r: number, g: number, bl: number;
  
  if (a.a === 0 && b.a > 0) {
    // Start is transparent - use end color's RGB, only interpolate alpha
    r = b.r;
    g = b.g;
    bl = b.b;
  } else if (b.a === 0 && a.a > 0) {
    // End is transparent - use start color's RGB, only interpolate alpha
    r = a.r;
    g = a.g;
    bl = a.b;
  } else {
    // Both colors have alpha > 0, interpolate RGB normally
    r = Math.round(lerp(a.r, b.r, k));
    g = Math.round(lerp(a.g, b.g, k));
    bl = Math.round(lerp(a.b, b.b, k));
  }
  
  const alpha = lerp(a.a, b.a, k);
  
  // If either color has alpha < 1, return rgba format
  if (a.a < 1 || b.a < 1) {
    return `rgba(${r}, ${g}, ${bl}, ${alpha.toFixed(2)})`;
  }
  
  // Otherwise return hex format
  return rgbToHex(r, g, bl);
};

