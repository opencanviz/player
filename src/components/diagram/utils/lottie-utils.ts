/* eslint-disable -- Migrated file */
import lottie, { AnimationItem } from 'lottie-web';
import type { NodeModel } from '../types';

/**
 * Convert hex color to Lottie color array [r, g, b] where values are 0-1
 */
function hexToLottieColor(hex: string): [number, number, number] {
  // Remove # if present
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  
  // Handle 3-char hex
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
  }
  
  // Parse RGB values (ignore alpha if present)
  const r = parseInt(fullHex.slice(0, 2), 16) / 255;
  const g = parseInt(fullHex.slice(2, 4), 16) / 255;
  const b = parseInt(fullHex.slice(4, 6), 16) / 255;
  
  return [r, g, b];
}

/**
 * Convert hex8 color to Lottie color with opacity [r, g, b, opacity]
 * Returns opacity as 0-100 (Lottie opacity format)
 */
function hexToLottieColorWithOpacity(hex: string): { color: [number, number, number]; opacity: number } {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
  }
  
  const r = parseInt(fullHex.slice(0, 2), 16) / 255;
  const g = parseInt(fullHex.slice(2, 4), 16) / 255;
  const b = parseInt(fullHex.slice(4, 6), 16) / 255;
  
  // Extract alpha if present (hex8 format)
  let opacity = 100; // Default 100%
  if (fullHex.length >= 8) {
    opacity = Math.round((parseInt(fullHex.slice(6, 8), 16) / 255) * 100);
  }
  
  return { color: [r, g, b], opacity };
}

/**
 * Recursively replace all colors in a Lottie JSON with a single color (flatten)
 */
function flattenColors(obj: any, color: [number, number, number]): void {
  if (!obj || typeof obj !== 'object') return;
  
  // Handle arrays
  if (Array.isArray(obj)) {
    obj.forEach(item => flattenColors(item, color));
    return;
  }
  
  // Check for color properties in shapes
  // 'c' is the color property in Lottie shapes (fill and stroke)
  if (obj.ty === 'fl' || obj.ty === 'st') {
    // Fill or stroke shape
    if (obj.c && obj.c.k) {
      if (Array.isArray(obj.c.k) && obj.c.k.length >= 3 && typeof obj.c.k[0] === 'number') {
        // Static color [r, g, b] or [r, g, b, a]
        obj.c.k[0] = color[0];
        obj.c.k[1] = color[1];
        obj.c.k[2] = color[2];
      } else if (Array.isArray(obj.c.k)) {
        // Animated color - keyframes
        obj.c.k.forEach((keyframe: any) => {
          if (keyframe && keyframe.s && Array.isArray(keyframe.s) && keyframe.s.length >= 3) {
            keyframe.s[0] = color[0];
            keyframe.s[1] = color[1];
            keyframe.s[2] = color[2];
          }
          if (keyframe && keyframe.e && Array.isArray(keyframe.e) && keyframe.e.length >= 3) {
            keyframe.e[0] = color[0];
            keyframe.e[1] = color[1];
            keyframe.e[2] = color[2];
          }
        });
      }
    }
  }
  
  // Recursively process all object properties
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      flattenColors(obj[key], color);
    }
  }
}

/**
 * Custom flatten implementation - replaces all colors with a single color
 */
function customFlatten(color: string, lottieJson: any): any {
  const result = JSON.parse(JSON.stringify(lottieJson));
  const lottieColor = hexToLottieColor(color);
  flattenColors(result, lottieColor);
  return result;
}

/**
 * Convert RGB to grayscale while preserving relative brightness
 */
function toGrayscale(r: number, g: number, b: number): [number, number, number] {
  // Use luminance formula for perceptual grayscale
  const gray = r * 0.299 + g * 0.587 + b * 0.114;
  return [gray, gray, gray];
}

/**
 * Apply grayscale conversion to all colors in a Lottie JSON
 * Preserves the original tonal variations
 */
function applyGrayscale(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach(item => applyGrayscale(item));
    return;
  }
  
  // Check for color properties in shapes
  if (obj.ty === 'fl' || obj.ty === 'st') {
    if (obj.c && obj.c.k) {
      if (Array.isArray(obj.c.k) && obj.c.k.length >= 3 && typeof obj.c.k[0] === 'number') {
        // Static color
        const gray = toGrayscale(obj.c.k[0], obj.c.k[1], obj.c.k[2]);
        obj.c.k[0] = gray[0];
        obj.c.k[1] = gray[1];
        obj.c.k[2] = gray[2];
      } else if (Array.isArray(obj.c.k)) {
        // Animated color
        obj.c.k.forEach((keyframe: any) => {
          if (keyframe && keyframe.s && Array.isArray(keyframe.s) && keyframe.s.length >= 3) {
            const gray = toGrayscale(keyframe.s[0], keyframe.s[1], keyframe.s[2]);
            keyframe.s[0] = gray[0];
            keyframe.s[1] = gray[1];
            keyframe.s[2] = gray[2];
          }
          if (keyframe && keyframe.e && Array.isArray(keyframe.e) && keyframe.e.length >= 3) {
            const gray = toGrayscale(keyframe.e[0], keyframe.e[1], keyframe.e[2]);
            keyframe.e[0] = gray[0];
            keyframe.e[1] = gray[1];
            keyframe.e[2] = gray[2];
          }
        });
      }
    }
  }
  
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      applyGrayscale(obj[key]);
    }
  }
}

/**
 * Custom grayscale implementation - converts to grayscale while preserving variations
 */
function customGrayscale(lottieJson: any): any {
  const result = JSON.parse(JSON.stringify(lottieJson));
  applyGrayscale(result);
  return result;
}

/**
 * Apply stroke and fill colors separately
 * strokeColor -> all stroke shapes (ty: 'st')
 * fillColor -> all fill shapes (ty: 'fl')
 */
function applyStrokeFillColors(
  obj: any,
  strokeColor: [number, number, number] | null,
  fillColor: [number, number, number] | null
): void {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach(item => applyStrokeFillColors(item, strokeColor, fillColor));
    return;
  }
  
  // Apply to strokes
  if (obj.ty === 'st' && strokeColor && obj.c && obj.c.k) {
    if (Array.isArray(obj.c.k) && obj.c.k.length >= 3 && typeof obj.c.k[0] === 'number') {
      obj.c.k[0] = strokeColor[0];
      obj.c.k[1] = strokeColor[1];
      obj.c.k[2] = strokeColor[2];
    } else if (Array.isArray(obj.c.k)) {
      obj.c.k.forEach((keyframe: any) => {
        if (keyframe?.s?.length >= 3) {
          keyframe.s[0] = strokeColor[0];
          keyframe.s[1] = strokeColor[1];
          keyframe.s[2] = strokeColor[2];
        }
        if (keyframe?.e?.length >= 3) {
          keyframe.e[0] = strokeColor[0];
          keyframe.e[1] = strokeColor[1];
          keyframe.e[2] = strokeColor[2];
        }
      });
    }
  }
  
  // Apply to fills
  if (obj.ty === 'fl' && fillColor && obj.c && obj.c.k) {
    if (Array.isArray(obj.c.k) && obj.c.k.length >= 3 && typeof obj.c.k[0] === 'number') {
      obj.c.k[0] = fillColor[0];
      obj.c.k[1] = fillColor[1];
      obj.c.k[2] = fillColor[2];
    } else if (Array.isArray(obj.c.k)) {
      obj.c.k.forEach((keyframe: any) => {
        if (keyframe?.s?.length >= 3) {
          keyframe.s[0] = fillColor[0];
          keyframe.s[1] = fillColor[1];
          keyframe.s[2] = fillColor[2];
        }
        if (keyframe?.e?.length >= 3) {
          keyframe.e[0] = fillColor[0];
          keyframe.e[1] = fillColor[1];
          keyframe.e[2] = fillColor[2];
        }
      });
    }
  }
  
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      applyStrokeFillColors(obj[key], strokeColor, fillColor);
    }
  }
}

/**
 * Custom colorify implementation - applies stroke and fill colors separately
 * colors[0] = Stroke color (outlines)
 * colors[1] = Fill color (accents)
 */
function customColorify(colors: string[], lottieJson: any): any {
  if (colors.length === 0) return lottieJson;
  
  const result = JSON.parse(JSON.stringify(lottieJson));
  const strokeColor = colors[0] ? hexToLottieColor(colors[0]) : null;
  const fillColor = colors.length > 1 && colors[1] ? hexToLottieColor(colors[1]) : null;
  
  // If only one color provided, apply it to both stroke and fill
  if (colors.length === 1) {
    applyStrokeFillColors(result, strokeColor, strokeColor);
  } else {
    // Two colors: primary for strokes, secondary for fills
    applyStrokeFillColors(result, strokeColor, fillColor);
  }
  
  return result;
}

/**
 * Apply only stroke color (keep original fills)
 */
function applyStrokeColorOnly(lottieJson: any, strokeColor: string): any {
  const result = JSON.parse(JSON.stringify(lottieJson));
  applyStrokeFillColors(result, hexToLottieColor(strokeColor), null);
  return result;
}

/**
 * Apply only fill color (keep original strokes)
 */
function applyFillColorOnly(lottieJson: any, fillColor: string): any {
  const result = JSON.parse(JSON.stringify(lottieJson));
  applyStrokeFillColors(result, null, hexToLottieColor(fillColor));
  return result;
}

/**
 * Apply stroke dash pattern to all strokes
 * Lottie dash format: d property with array of dash objects
 * n = 'o' (offset), 'd' (dash), 'g' (gap)
 */
function applyStrokeDash(obj: any, pattern: 'solid' | 'dashed' | 'dotted'): void {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach(item => applyStrokeDash(item, pattern));
    return;
  }
  
  // Apply to stroke shapes
  if (obj.ty === 'st') {
    if (pattern === 'solid') {
      // Remove dash property for solid
      delete obj.d;
    } else {
      // Get current stroke width for proportional dash
      const strokeWidth = obj.w?.k ?? 2;
      const baseWidth = typeof strokeWidth === 'number' ? strokeWidth : 2;
      
      if (pattern === 'dashed') {
        // Dashed: dash = 4x width, gap = 2x width
        obj.d = [
          { n: 'd', nm: 'dash', v: { a: 0, k: baseWidth * 4 } },
          { n: 'g', nm: 'gap', v: { a: 0, k: baseWidth * 2 } },
          { n: 'o', nm: 'offset', v: { a: 0, k: 0 } }
        ];
      } else if (pattern === 'dotted') {
        // Dotted: dash = 1x width, gap = 1.5x width
        obj.d = [
          { n: 'd', nm: 'dash', v: { a: 0, k: baseWidth * 0.5 } },
          { n: 'g', nm: 'gap', v: { a: 0, k: baseWidth * 1.5 } },
          { n: 'o', nm: 'offset', v: { a: 0, k: 0 } }
        ];
      }
    }
  }
  
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      applyStrokeDash(obj[key], pattern);
    }
  }
}

/**
 * Apply stroke dash pattern to Lottie JSON
 */
function customStrokeDash(lottieJson: any, pattern: 'solid' | 'dashed' | 'dotted'): any {
  const result = JSON.parse(JSON.stringify(lottieJson));
  applyStrokeDash(result, pattern);
  return result;
}

/**
 * Cache for Lottie animation instances
 * Key: nodeId
 */
const lottieInstanceCache = new Map<string, AnimationItem>();

/**
 * Offscreen canvas cache for rendering Lottie animations
 * Key: nodeId
 */
const offscreenCanvasCache = new Map<string, HTMLCanvasElement>();

/**
 * Cache for phantom Lottie animation instances (independent of template nodes)
 * Key: snapshotId (the original node's ID stored in the snapshot)
 */
const phantomLottieCache = new Map<string, AnimationItem>();

/**
 * Offscreen canvas cache for phantom Lottie animations
 * Key: snapshotId
 */
const phantomCanvasCache = new Map<string, HTMLCanvasElement>();

/**
 * Cache for tracking which transform options were used for each instance
 * Used to detect when we need to recreate due to style changes
 */
const lottieTransformCache = new Map<string, string>();

/**
 * Cache for tracking the raw lottieData object reference used for each instance.
 * When a node's lottieData is swapped (e.g., user uploads a replacement asset),
 * the reference changes and we must recreate the animation. Without this, the
 * cached AnimationItem keeps rendering the old JSON.
 */
const lottieDataRefCache = new Map<string, unknown>();

/**
 * Get the effective Lottie data for a node (applies color/style transforms if set)
 */
export function getTransformedLottieData(node: NodeModel): any {
  if (!node.lottieData) return null;
  
  // Check if any transform options are set
  const hasColorMap = node.lottieColorMap && Object.keys(node.lottieColorMap).length > 0;
  const hasTransforms = 
    (node.lottiePreset && node.lottiePreset !== 'normal') ||
    node.lottieColorPrimary ||
    node.lottieColorSecondary ||
    hasColorMap ||
    (node.lottieStrokeScale !== undefined && node.lottieStrokeScale !== 1) ||
    (node.lottieStrokeDash && node.lottieStrokeDash !== 'solid');
  
  if (!hasTransforms) {
    return node.lottieData;
  }
  
  // Apply transforms
  const options: LottieTransformOptions = {
    preset: node.lottiePreset,
    primaryColor: node.lottieColorPrimary,
    secondaryColor: node.lottieColorSecondary,
    colorMap: node.lottieColorMap,
    strokeScale: node.lottieStrokeScale,
    strokeDash: node.lottieStrokeDash,
  };
  
  return transformLottieInternal(node.lottieData, options);
}

/**
 * Normalize a color to 6-character hex format (lottie-colorify doesn't handle 8-char hex)
 */
function normalizeColorForLottie(color: string | undefined): string | undefined {
  if (!color) return undefined;
  
  // Remove alpha channel if present (convert #rrggbbaa to #rrggbb)
  if (color.length === 9 && color.startsWith('#')) {
    return color.slice(0, 7);
  }
  
  // Handle 4-char hex with alpha (#rgba -> #rgb -> #rrggbb)
  if (color.length === 5 && color.startsWith('#')) {
    const r = color[1];
    const g = color[2];
    const b = color[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  
  // Handle 3-char hex (#rgb -> #rrggbb)
  if (color.length === 4 && color.startsWith('#')) {
    const r = color[1];
    const g = color[2];
    const b = color[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  
  return color;
}

/**
 * Internal transform function (called before transformLottie is exported)
 */
function transformLottieInternal(originalJson: any, options: LottieTransformOptions): any {
  if (!originalJson) return originalJson;

  try {
    // IMPORTANT: Deep clone to avoid mutating the original Lottie data
    let result = JSON.parse(JSON.stringify(originalJson));
    
    // Normalize colors (lottie-colorify needs 6-char hex, not 8-char with alpha)
    const primaryColor = normalizeColorForLottie(options.primaryColor);
    const secondaryColor = normalizeColorForLottie(options.secondaryColor);
    
    // Apply preset first (unless it's 'normal' which keeps original colors)
    if (options.preset && options.preset !== 'normal') {
      switch (options.preset) {
        case 'grayTone':
          // Convert to grayscale while preserving tonal variations
          result = customGrayscale(result);
          break;
        case 'dark':
          // Flatten everything to a dark color
          result = customFlatten('#1f2937', result);
          break;
      }
    }

    // Apply custom colors (overrides preset for twoTone mode)
    // Only apply if we're NOT using grayTone or dark preset
    if (!options.preset || options.preset === 'twoTone' || options.preset === 'normal') {
      // First, apply color map if provided (fine-grained per-color mapping)
      if (options.colorMap && Object.keys(options.colorMap).length > 0) {
        result = customColorMap(result, options.colorMap);
      }
      // Then apply bulk stroke/fill colors (these override the color map)
      else if (primaryColor && secondaryColor) {
        // Both colors: primary for strokes, secondary for fills
        result = customColorify([primaryColor, secondaryColor], result);
      } else if (primaryColor && !secondaryColor) {
        // Only stroke color specified - apply to strokes only
        result = applyStrokeColorOnly(result, primaryColor);
      } else if (secondaryColor && !primaryColor) {
        // Only fill color specified - apply to fills only
        result = applyFillColorOnly(result, secondaryColor);
      }
    }

    // Apply stroke width scaling
    if (options.strokeScale !== undefined && options.strokeScale !== 1) {
      result = adjustStrokeWidthInternal(result, options.strokeScale);
    }

    // Apply stroke dash pattern
    if (options.strokeDash && options.strokeDash !== 'solid') {
      result = customStrokeDash(result, options.strokeDash);
    }

    // Validate result has required Lottie properties
    if (!result || !result.v || !result.fr) {
      console.error('Lottie transform produced invalid result, returning original');
      return JSON.parse(JSON.stringify(originalJson));
    }

    return result;
  } catch (error) {
    console.error('Error transforming Lottie:', error);
    // Return a clone of the original on error
    return JSON.parse(JSON.stringify(originalJson));
  }
}

/**
 * Internal stroke width adjustment (called before adjustStrokeWidth is exported)
 */
function adjustStrokeWidthInternal(json: any, scale: number): any {
  if (!json || scale === undefined || scale === 1) return json;

  const modified = JSON.parse(JSON.stringify(json));

  function traverse(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    if (obj.ty) {
      if ((obj.ty === 'st' || obj.ty === 'gs') && obj.w) {
        if (typeof obj.w.k === 'number') {
          obj.w.k = obj.w.k * scale;
        }
      }
    }
    if (Array.isArray(obj)) {
      obj.forEach(traverse);
    } else {
      for (const key of Object.keys(obj)) {
        if (key === 'layers' || key === 'shapes' || key === 'it') {
          traverse(obj[key]);
        }
      }
    }
  }
  traverse(modified);
  return modified;
}

/**
 * Get or create a Lottie animation instance for a node
 */
export function getLottieInstance(
  node: NodeModel,
  forceRecreate = false
): AnimationItem | null {
  if (!node.lottieData) return null;

  // Include transform options in cache key so we recreate when style changes
  const colorMapKey = node.lottieColorMap ? JSON.stringify(node.lottieColorMap) : '';
  const transformKey = `${node.lottiePreset || 'normal'}-${node.lottieColorPrimary || ''}-${node.lottieColorSecondary || ''}-${colorMapKey}-${node.lottieStrokeScale ?? 1}-${node.lottieStrokeDash || 'solid'}`;
  const cacheKey = node.id;
  
  // Check if transform options changed - if so, force recreation
  const cachedTransformKey = lottieTransformCache.get(cacheKey);
  if (cachedTransformKey && cachedTransformKey !== transformKey) {
    forceRecreate = true;
  }

  // Check if the raw lottieData reference changed (asset swapped, fixture
  // reloaded, etc.). Identity compare is enough: the reducer produces a new
  // node object on every patch, and parseLottieJSON returns a fresh object.
  const cachedDataRef = lottieDataRefCache.get(cacheKey);
  if (cachedDataRef && cachedDataRef !== node.lottieData) {
    forceRecreate = true;
  }

  // Return cached instance if it exists and we're not forcing recreation
  if (!forceRecreate && lottieInstanceCache.has(cacheKey)) {
    return lottieInstanceCache.get(cacheKey)!;
  }

  // Clean up old instance if exists
  if (lottieInstanceCache.has(cacheKey)) {
    const oldInstance = lottieInstanceCache.get(cacheKey)!;
    oldInstance.destroy();
    lottieInstanceCache.delete(cacheKey);
  }

  // When forcing recreation (style changed), also recreate the canvas to avoid stale state
  if (forceRecreate && offscreenCanvasCache.has(cacheKey)) {
    offscreenCanvasCache.delete(cacheKey);
  }

  // Create or get offscreen canvas
  // Lottie nodes keep original size on crop (clip only), so canvas = node size
  let canvas = offscreenCanvasCache.get(cacheKey);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(node.w);
    canvas.height = Math.ceil(node.h);
    offscreenCanvasCache.set(cacheKey, canvas);
  } else {
    // Update canvas size if node size changed
    if (canvas.width !== Math.ceil(node.w) || canvas.height !== Math.ceil(node.h)) {
      canvas.width = Math.ceil(node.w);
      canvas.height = Math.ceil(node.h);
    }
    // Clear canvas before creating new instance
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  try {
    // Get transformed Lottie data (applies color/style if options are set)
    const animationData = getTransformedLottieData(node);
    
    if (!animationData) {
      console.error('No animation data for Lottie node:', node.id);
      return null;
    }
    
    // Create Lottie animation instance with canvas renderer
    // Type assertion needed due to outdated @types/lottie-web which doesn't support canvas renderer properly
    const animationItem = (lottie.loadAnimation as any)({
      renderer: 'canvas',
      loop: node.lottieLoop ?? true,
      autoplay: node.lottieAutoplay ?? false,
      animationData,
      rendererSettings: {
        context: canvas.getContext('2d')!,
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: true,
      },
    }) as AnimationItem;

    // Set playback speed
    if (node.lottieSpeed) {
      animationItem.setSpeed(node.lottieSpeed);
    }

    lottieInstanceCache.set(cacheKey, animationItem);
    lottieTransformCache.set(cacheKey, transformKey);
    lottieDataRefCache.set(cacheKey, node.lottieData);
    // Instance created successfully
    return animationItem;
  } catch (error) {
    console.error('❌ Failed to create Lottie instance:', error);
    return null;
  }
}

/**
 * Render a Lottie animation to the main canvas at a specific frame
 */
export function renderLottieToCanvas(
  ctx: CanvasRenderingContext2D,
  node: NodeModel,
  frame: number // Frame number (0 to totalFrames)
) {
  const instance = getLottieInstance(node);
  if (!instance) {
    console.warn('No Lottie instance for node:', node.id);
    return;
  }

  const canvas = offscreenCanvasCache.get(node.id);
  if (!canvas) {
    console.warn('No offscreen canvas for node:', node.id);
    return;
  }

  try {
    // Seek to specific frame
    const clampedFrame = Math.max(0, Math.min(frame, instance.totalFrames - 1));
    instance.goToAndStop(clampedFrame, true);

    // Draw the offscreen canvas to the main canvas
    ctx.save();
    
    // Apply opacity
    if (node.opacity !== undefined) {
      ctx.globalAlpha = node.opacity;
    }

    // Check if crop is applied (imageCropX/Y/W/H are normalized 0-1 values)
    const hasCrop = 
      node.imageCropX !== undefined || 
      node.imageCropY !== undefined || 
      node.imageCropW !== undefined || 
      node.imageCropH !== undefined;

    if (hasCrop) {
      // Calculate source rectangle from normalized crop values
      const cropX = node.imageCropX ?? 0;
      const cropY = node.imageCropY ?? 0;
      const cropW = node.imageCropW ?? 1;
      const cropH = node.imageCropH ?? 1;

      // Source coordinates in the offscreen canvas
      const srcX = cropX * canvas.width;
      const srcY = cropY * canvas.height;
      const srcW = cropW * canvas.width;
      const srcH = cropH * canvas.height;

      // Draw only the cropped portion, scaled to fill the node's bounds
      ctx.drawImage(
        canvas,
        srcX, srcY, srcW, srcH,  // Source rectangle (the crop)
        node.x, node.y, node.w, node.h  // Destination (node bounds)
      );
    } else {
      // No crop - draw the full Lottie canvas
      ctx.drawImage(canvas, node.x, node.y, node.w, node.h);
    }

    ctx.restore();
    
    // Render complete
  } catch (error) {
    console.error('❌ Failed to render Lottie:', error);
  }
}

/**
 * Render a Lottie animation for a phantom node (uses template node's instance)
 * @deprecated Use renderLottieFromData for snapshot-independent rendering
 * @param ctx Canvas context
 * @param templateNode The original node that was used as template (has the Lottie instance)
 * @param x Phantom's x position
 * @param y Phantom's y position
 * @param w Phantom's width
 * @param h Phantom's height
 * @param opacity Phantom's opacity
 * @param frame Frame number to render
 */
export function renderLottieForPhantom(
  ctx: CanvasRenderingContext2D,
  templateNode: NodeModel,
  x: number,
  y: number,
  w: number,
  h: number,
  opacity: number,
  frame: number
) {
  const instance = getLottieInstance(templateNode);
  if (!instance) {
    return false; // No Lottie instance available
  }

  const canvas = offscreenCanvasCache.get(templateNode.id);
  if (!canvas) {
    return false; // No offscreen canvas available
  }

  try {
    // Seek to specific frame
    const clampedFrame = Math.max(0, Math.min(frame, instance.totalFrames - 1));
    instance.goToAndStop(clampedFrame, true);

    // Draw the offscreen canvas at phantom position
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(canvas, x, y, w, h);
    ctx.restore();
    
    return true;
  } catch (error) {
    console.error('❌ Failed to render Lottie for phantom:', error);
    return false;
  }
}

/**
 * Render a Lottie animation from raw lottieData (snapshot-independent)
 * This works even if the original template node is deleted
 * @param ctx Canvas context
 * @param cacheKey Unique key for caching (typically the snapshot's original node ID)
 * @param lottieData The raw Lottie animation data from the snapshot
 * @param x Phantom's x position
 * @param y Phantom's y position
 * @param w Phantom's width
 * @param h Phantom's height
 * @param opacity Phantom's opacity
 * @param frame Frame number to render
 */
/**
 * Simple hash function for Lottie data to detect changes
 */
function hashLottieData(lottieData: any): string {
  try {
    const str = JSON.stringify(lottieData);
    // Simple hash: use length and sample characters
    let hash = str.length;
    for (let i = 0; i < str.length; i += Math.max(1, Math.floor(str.length / 100))) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  } catch {
    return 'unknown';
  }
}

// Track which lottieData hash was used for each cache key
const phantomLottieDataHash = new Map<string, string>();

export function renderLottieFromData(
  ctx: CanvasRenderingContext2D,
  cacheKey: string,
  lottieData: any,
  x: number,
  y: number,
  w: number,
  h: number,
  opacity: number,
  frame: number
): boolean {
  if (!lottieData) return false;

  // Calculate hash of current lottie data
  const currentHash = hashLottieData(lottieData);
  const cachedHash = phantomLottieDataHash.get(cacheKey);
  
  // If lottie data changed, invalidate the cache for this key
  if (cachedHash && cachedHash !== currentHash) {
    console.log(`🔄 Phantom Lottie data changed for ${cacheKey}, recreating instance`);
    const oldInstance = phantomLottieCache.get(cacheKey);
    if (oldInstance) {
      oldInstance.destroy();
    }
    phantomLottieCache.delete(cacheKey);
    phantomCanvasCache.delete(cacheKey);
  }

  // Get or create the Lottie instance for this snapshot
  let instance = phantomLottieCache.get(cacheKey);
  let canvas = phantomCanvasCache.get(cacheKey);

  if (!instance || !canvas) {
    // Create new canvas
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    phantomCanvasCache.set(cacheKey, canvas);

    try {
      // Create Lottie animation instance
      instance = (lottie.loadAnimation as any)({
        renderer: 'canvas',
        loop: true,
        autoplay: false,
        animationData: lottieData,
        rendererSettings: {
          context: canvas.getContext('2d')!,
          preserveAspectRatio: 'xMidYMid meet',
          clearCanvas: true,
        },
      }) as AnimationItem;

      phantomLottieCache.set(cacheKey, instance);
      phantomLottieDataHash.set(cacheKey, currentHash);
    } catch (error) {
      console.error('❌ Failed to create phantom Lottie instance:', error);
      return false;
    }
  }

  try {
    // Seek to specific frame
    const clampedFrame = Math.max(0, Math.min(frame, instance.totalFrames - 1));
    instance.goToAndStop(clampedFrame, true);

    // Draw the offscreen canvas at phantom position
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(canvas, x, y, w, h);
    ctx.restore();

    return true;
  } catch (error) {
    console.error('❌ Failed to render Lottie from data:', error);
    return false;
  }
}

/**
 * Get the total number of frames in a Lottie animation
 */
export function getLottieTotalFrames(node: NodeModel): number {
  const instance = getLottieInstance(node);
  if (!instance) return 0;
  return instance.totalFrames;
}

/**
 * Get the frame rate (FPS) of a Lottie animation
 */
export function getLottieFrameRate(node: NodeModel): number {
  const instance = getLottieInstance(node);
  if (!instance) return 30; // Default FPS
  return instance.frameRate || 30;
}

/**
 * Calculate which frame to show based on timeline position
 * @param node The Lottie node
 * @param progress Progress through the step (0 to 1)
 * @returns Frame number to display
 */
export function getLottieFrameForProgress(
  node: NodeModel,
  progress: number
): number {
  const totalFrames = getLottieTotalFrames(node);
  if (totalFrames === 0) return 0;

  // Clamp progress to 0-1
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Calculate frame (0-indexed)
  const frame = Math.floor(clampedProgress * (totalFrames - 1));

  return frame;
}

/**
 * Clean up Lottie instance and canvas for a node
 */
export function cleanupLottieInstance(nodeId: string) {
  // Destroy animation instance
  if (lottieInstanceCache.has(nodeId)) {
    const instance = lottieInstanceCache.get(nodeId)!;
    instance.destroy();
    lottieInstanceCache.delete(nodeId);
  }

  // Remove offscreen canvas
  if (offscreenCanvasCache.has(nodeId)) {
    offscreenCanvasCache.delete(nodeId);
  }

  lottieTransformCache.delete(nodeId);
  lottieDataRefCache.delete(nodeId);
}

/**
 * Clean up all Lottie instances (e.g., when component unmounts)
 */
export function cleanupAllLottieInstances() {
  lottieInstanceCache.forEach((instance) => instance.destroy());
  lottieInstanceCache.clear();
  offscreenCanvasCache.clear();
  lottieTransformCache.clear();
  lottieDataRefCache.clear();

  // Also clean up phantom caches
  phantomLottieCache.forEach((instance) => instance.destroy());
  phantomLottieCache.clear();
  phantomCanvasCache.clear();
  phantomLottieDataHash.clear();
}

/**
 * Parse and validate a Lottie JSON file
 */
export function parseLottieJSON(jsonString: string): any | null {
  try {
    const data = JSON.parse(jsonString);
    
    // Basic validation - check for required Lottie/Bodymovin properties
    if (!data.v || !data.fr || !data.w || !data.h) {
      console.error('Invalid Lottie JSON: missing required properties');
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to parse Lottie JSON:', error);
    return null;
  }
}

// ============================================
// Lottie Color/Style Transformation Utilities
// ============================================

export type LottiePreset = 'normal' | 'twoTone' | 'grayTone' | 'dark';

export interface LottieTransformOptions {
  preset?: LottiePreset;
  primaryColor?: string; // Applies to all strokes
  secondaryColor?: string; // Applies to all fills
  colorMap?: Record<string, string>; // Fine-grained color mapping: { originalHex: newHex8 } (hex8 includes alpha for opacity)
  strokeScale?: number; // Multiplier for stroke widths (0-3, where 1 = original, 2 = 200%, 3 = 300%)
  strokeDash?: 'solid' | 'dashed' | 'dotted'; // Stroke dash pattern
}

/**
 * Recursively traverse Lottie JSON and apply a callback to each shape
 */
function traverseShapes(obj: any, callback: (shape: any) => void): void {
  if (!obj || typeof obj !== 'object') return;

  // Check if this is a shape with a type
  if (obj.ty) {
    callback(obj);
  }

  // Traverse arrays
  if (Array.isArray(obj)) {
    obj.forEach((item) => traverseShapes(item, callback));
    return;
  }

  // Traverse object properties
  for (const key of Object.keys(obj)) {
    if (key === 'layers' || key === 'shapes' || key === 'it') {
      traverseShapes(obj[key], callback);
    }
  }
}

/**
 * Adjust stroke widths in a Lottie animation
 * @param json - Original Lottie JSON
 * @param scale - Multiplier for stroke widths (0-1)
 * @returns Modified Lottie JSON
 */
export function adjustStrokeWidth(json: any, scale: number): any {
  if (!json || scale === undefined || scale === 1) return json;

  const modified = JSON.parse(JSON.stringify(json));

  traverseShapes(modified, (shape) => {
    // 'st' = stroke, 'gs' = gradient stroke
    if ((shape.ty === 'st' || shape.ty === 'gs') && shape.w) {
      if (typeof shape.w.k === 'number') {
        // Static value
        shape.w.k = shape.w.k * scale;
      } else if (Array.isArray(shape.w.k)) {
        // Animated value - scale all keyframe values
        shape.w.k = shape.w.k.map((keyframe: any) => {
          if (typeof keyframe === 'number') {
            return keyframe * scale;
          } else if (keyframe && typeof keyframe.s === 'number') {
            return { ...keyframe, s: keyframe.s * scale };
          } else if (keyframe && Array.isArray(keyframe.s)) {
            return { ...keyframe, s: keyframe.s.map((v: number) => v * scale) };
          }
          return keyframe;
        });
      }
    }
  });

  return modified;
}

/**
 * Extract colors from a Lottie animation for display in the UI
 * Returns an array of unique hex colors found in the animation
 */
export function extractLottieColors(json: any): string[] {
  if (!json) return [];

  const colors = new Set<string>();

  traverseShapes(json, (shape) => {
    // Check for fill colors (fl = fill, st = stroke)
    if ((shape.ty === 'fl' || shape.ty === 'st') && shape.c?.k) {
      const colorArray = shape.c.k;
      if (Array.isArray(colorArray) && colorArray.length >= 3 && typeof colorArray[0] === 'number') {
        // Convert 0-1 RGB to hex
        const r = Math.round((colorArray[0] || 0) * 255);
        const g = Math.round((colorArray[1] || 0) * 255);
        const b = Math.round((colorArray[2] || 0) * 255);
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        colors.add(hex.toLowerCase());
      }
    }
  });

  return Array.from(colors);
}

/**
 * Extract colors from a Lottie animation, categorized by type (stroke vs fill)
 */
export interface LottieColorInfo {
  hex: string;
  type: 'stroke' | 'fill';
}

export function extractLottieColorsByType(json: any): LottieColorInfo[] {
  if (!json) return [];

  const colorMap = new Map<string, 'stroke' | 'fill'>();

  traverseShapes(json, (shape) => {
    if ((shape.ty === 'fl' || shape.ty === 'st') && shape.c?.k) {
      const colorArray = shape.c.k;
      if (Array.isArray(colorArray) && colorArray.length >= 3 && typeof colorArray[0] === 'number') {
        const r = Math.round((colorArray[0] || 0) * 255);
        const g = Math.round((colorArray[1] || 0) * 255);
        const b = Math.round((colorArray[2] || 0) * 255);
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toLowerCase();
        
        const type = shape.ty === 'st' ? 'stroke' : 'fill';
        // If already exists with different type, mark as 'stroke' (prioritize showing it as stroke)
        if (!colorMap.has(hex)) {
          colorMap.set(hex, type);
        }
      }
    }
  });

  return Array.from(colorMap.entries()).map(([hex, type]) => ({ hex, type }));
}

/**
 * Apply a color map to remap specific colors in a Lottie animation
 */
function applyColorMap(obj: any, colorMap: Record<string, string>): void {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach(item => applyColorMap(item, colorMap));
    return;
  }
  
  if ((obj.ty === 'fl' || obj.ty === 'st') && obj.c && obj.c.k) {
    if (Array.isArray(obj.c.k) && obj.c.k.length >= 3 && typeof obj.c.k[0] === 'number') {
      // Get current color as hex
      const r = Math.round(obj.c.k[0] * 255);
      const g = Math.round(obj.c.k[1] * 255);
      const b = Math.round(obj.c.k[2] * 255);
      const currentHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toLowerCase();
      
      // Check if this color should be remapped
      const newHex = colorMap[currentHex];
      if (newHex) {
        const { color: newColor, opacity } = hexToLottieColorWithOpacity(newHex);
        obj.c.k[0] = newColor[0];
        obj.c.k[1] = newColor[1];
        obj.c.k[2] = newColor[2];
        
        // Apply opacity if different from 100%
        if (opacity < 100 && obj.o) {
          if (typeof obj.o.k === 'number') {
            obj.o.k = opacity;
          } else if (obj.o.k?.k !== undefined) {
            obj.o.k.k = opacity;
          }
        } else if (opacity < 100) {
          // Create opacity property if it doesn't exist
          obj.o = { a: 0, k: opacity };
        }
      }
    } else if (Array.isArray(obj.c.k)) {
      // Animated colors
      obj.c.k.forEach((keyframe: any) => {
        if (keyframe?.s?.length >= 3 && typeof keyframe.s[0] === 'number') {
          const r = Math.round(keyframe.s[0] * 255);
          const g = Math.round(keyframe.s[1] * 255);
          const b = Math.round(keyframe.s[2] * 255);
          const currentHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toLowerCase();
          
          const newHex = colorMap[currentHex];
          if (newHex) {
            const { color: newColor } = hexToLottieColorWithOpacity(newHex);
            keyframe.s[0] = newColor[0];
            keyframe.s[1] = newColor[1];
            keyframe.s[2] = newColor[2];
          }
        }
        if (keyframe?.e?.length >= 3 && typeof keyframe.e[0] === 'number') {
          const r = Math.round(keyframe.e[0] * 255);
          const g = Math.round(keyframe.e[1] * 255);
          const b = Math.round(keyframe.e[2] * 255);
          const currentHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toLowerCase();
          
          const newHex = colorMap[currentHex];
          if (newHex) {
            const { color: newColor } = hexToLottieColorWithOpacity(newHex);
            keyframe.e[0] = newColor[0];
            keyframe.e[1] = newColor[1];
            keyframe.e[2] = newColor[2];
          }
        }
      });
    }
  }
  
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      applyColorMap(obj[key], colorMap);
    }
  }
}

/**
 * Apply color map to Lottie JSON
 */
function customColorMap(lottieJson: any, colorMap: Record<string, string>): any {
  const result = JSON.parse(JSON.stringify(lottieJson));
  applyColorMap(result, colorMap);
  return result;
}

/**
 * Apply a color preset to a Lottie animation
 */
function applyPreset(json: any, preset: LottiePreset): any {
  switch (preset) {
    case 'grayTone':
      // Convert to grayscale while preserving tonal variations
      return customGrayscale(json);
    case 'dark':
      // Flatten everything to a dark color
      return customFlatten('#1f2937', json);
    case 'twoTone':
      // Two-tone keeps the structure but we'll apply colors separately
      return json;
    case 'normal':
    default:
      return json;
  }
}

/**
 * Transform a Lottie animation with the given options
 * This is the main function to use for applying all transformations
 */
export function transformLottie(
  originalJson: any,
  options: LottieTransformOptions
): any {
  if (!originalJson) return originalJson;

  let result = originalJson;

  // Apply preset first (unless it's 'normal' which keeps original colors)
  if (options.preset && options.preset !== 'normal') {
    result = applyPreset(result, options.preset);
  }

  // Apply custom colors (overrides preset for twoTone mode)
  if (options.preset === 'twoTone' || options.preset === 'normal') {
    if (options.primaryColor && options.secondaryColor) {
      // Use colorify to apply a two-color palette
      result = customColorify([options.primaryColor, options.secondaryColor], result);
    } else if (options.primaryColor) {
      // Single color - flatten to that color
      result = customFlatten(options.primaryColor, result);
    }
  }

  // Apply stroke width scaling
  if (options.strokeScale !== undefined && options.strokeScale !== 1) {
    result = adjustStrokeWidth(result, options.strokeScale);
  }

  return result;
}

/**
 * Generate a cache key for transformed Lottie data
 * Used to determine if we need to re-transform
 */
export function getLottieCacheKey(
  nodeId: string,
  options: LottieTransformOptions
): string {
  const colorMapKey = options.colorMap ? JSON.stringify(options.colorMap) : '';
  return `${nodeId}-${options.preset || 'normal'}-${options.primaryColor || ''}-${options.secondaryColor || ''}-${colorMapKey}-${options.strokeScale ?? 1}`;
}

/**
 * Capture a single frame of a Lottie animation as a data URL (PNG)
 * Used for generating crop preview images
 * @param node The Lottie node
 * @param frame Optional frame number to capture (defaults to first frame of segment or 0)
 * @param scale Optional scale factor for higher resolution preview (defaults to 1)
 * @returns Data URL string or null if capture failed
 */
export function captureLottieFrameAsDataUrl(
  node: NodeModel,
  frame?: number,
  scale: number = 1
): string | null {
  if (!node.lottieData) return null;

  try {
    // Determine which frame to capture
    const targetFrame = frame ?? node.lottieSegment?.[0] ?? node.lottieData.ip ?? 0;

    // Create a temporary canvas at the desired resolution
    const width = Math.ceil(node.w * scale);
    const height = Math.ceil(node.h * scale);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    // Get transformed Lottie data
    const animationData = getTransformedLottieData(node);
    if (!animationData) return null;

    // Create a temporary Lottie instance on this canvas
    const tempInstance = (lottie.loadAnimation as any)({
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData,
      rendererSettings: {
        context: tempCtx,
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: true,
      },
    }) as AnimationItem;

    // Seek to the target frame and render
    const clampedFrame = Math.max(0, Math.min(targetFrame, tempInstance.totalFrames - 1));
    tempInstance.goToAndStop(clampedFrame, true);

    // Get the data URL
    const dataUrl = tempCanvas.toDataURL('image/png');

    // Clean up the temporary instance
    tempInstance.destroy();

    return dataUrl;
  } catch (error) {
    console.error('Failed to capture Lottie frame:', error);
    return null;
  }
}
