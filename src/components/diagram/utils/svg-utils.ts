/* eslint-disable -- New file */
import type { NodeModel } from '../types';
import { parseMarkers, inlineMarkersFromElements } from './svg-marker-utils';

interface ParsedText {
  x: number;
  y: number;
  content: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fill?: string;
  textAnchor?: 'start' | 'middle' | 'end';
}

/**
 * Parse an SVG file and convert it to a NodeModel with SVG paths
 * This includes sanitization and extraction of shapes/paths
 */
export async function parseSvgToNode(
  file: File,
  x: number = 100,
  y: number = 100
): Promise<NodeModel | null> {
  try {
    const text = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    
    // Check for parse errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.error('SVG parse error:', parserError.textContent);
      return null;
    }

    const svgElement = doc.querySelector('svg');
    if (!svgElement) {
      console.error('No SVG element found');
      return null;
    }

    // Sanitize: remove scripts and suspicious attributes
    sanitizeSvg(svgElement);

    // Extract viewBox or use width/height
    let viewBox = extractViewBox(svgElement);
    if (!viewBox) {
      // Fallback to width/height attributes
      const width = parseFloat(svgElement.getAttribute('width') || '200');
      const height = parseFloat(svgElement.getAttribute('height') || '200');
      viewBox = { x: 0, y: 0, w: width, h: height };
    }

    // Extract root-level style attributes as defaults
    const rootDefaults = {
      fill: resolveColor(svgElement.getAttribute('fill')),
      stroke: resolveColor(svgElement.getAttribute('stroke')),
      strokeWidth: svgElement.getAttribute('stroke-width')
        ? parseFloat(svgElement.getAttribute('stroke-width')!)
        : undefined,
    };

    // Warn about transforms
    if (svgElement.querySelector('[transform]')) {
      console.warn('⚠️ SVG contains transform attributes which are not currently flattened. Rendering may be inaccurate.');
    }

    // Parse marker definitions from <defs>
    const markers = parseMarkers(svgElement);

    // Extract all path elements
    const paths = extractPaths(svgElement, rootDefaults);
    
    // Inline markers from lines/paths into the paths array
    inlineMarkersFromElements(svgElement, paths, markers);

    if (paths.length === 0) {
      console.warn('No paths found in SVG');
      return null;
    }

    // Debug logging: compare original SVG vs what we extracted
    console.group('🔍 SVG Parser Debug');
    console.log('📄 Original SVG:', text);
    console.log('📦 ViewBox:', viewBox);
    console.log('🎨 Root Defaults:', rootDefaults);
    console.log(`📊 Extracted ${paths.length} paths:`);
    paths.forEach((path, i) => {
      console.log(`  Path ${i + 1}:`, {
        d: path.d.substring(0, 50) + (path.d.length > 50 ? '...' : ''),
        fill: path.fill,
        stroke: path.stroke,
        strokeWidth: path.strokeWidth,
        opacity: path.opacity,
      });
    });
    
    // Count elements in original SVG
    const elementCounts = {
      path: svgElement.querySelectorAll('path').length,
      rect: svgElement.querySelectorAll('rect').length,
      circle: svgElement.querySelectorAll('circle').length,
      ellipse: svgElement.querySelectorAll('ellipse').length,
      polygon: svgElement.querySelectorAll('polygon').length,
      polyline: svgElement.querySelectorAll('polyline').length,
      line: svgElement.querySelectorAll('line').length,
      g: svgElement.querySelectorAll('g').length,
      text: svgElement.querySelectorAll('text').length,
      marker: svgElement.querySelectorAll('marker').length,
      defs: svgElement.querySelectorAll('defs').length,
    };
    console.log('📐 Elements in original SVG:', elementCounts);
    
    // Parse text elements
    const parsedTexts = parseTextElements(svgElement);
    
    // Info about supported features
    if (elementCounts.marker > 0) {
      console.log(`✅ Found ${elementCounts.marker} marker definitions (arrows will be inlined)`);
    }
    if (parsedTexts.length > 0) {
      console.log(`✅ Found ${parsedTexts.length} text elements (will create companion text nodes)`);
    }
    console.groupEnd();

    // Create SVG node
    // Note: Default to undefined iconStyle for uploaded SVGs (preserves original colors)
    // Icons from icon library will have iconStyle set explicitly in handleAddIcon
    const svgId = 'svg' + Math.random().toString(36).slice(2, 7);
    const svgNode: NodeModel = {
      id: svgId,
      kind: 'svg',
      x,
      y,
      w: viewBox.w,
      h: viewBox.h,
      svgPaths: paths,
      svgViewBox: viewBox,
      fill: undefined, // No fill override by default
      stroke: undefined, // No stroke override by default
      iconStyle: undefined, // Preserve original colors (uploaded SVGs)
    };

    // If there are text elements, create text nodes and group them with the SVG
    if (parsedTexts.length > 0) {
      const textNodes = createTextNodes(parsedTexts, x, y, viewBox);
      
      // Calculate bounding box for the group (SVG + all text)
      let minX = svgNode.x;
      let minY = svgNode.y;
      let maxX = svgNode.x + svgNode.w;
      let maxY = svgNode.y + svgNode.h;
      
      textNodes.forEach((tn) => {
        minX = Math.min(minX, tn.x);
        minY = Math.min(minY, tn.y);
        maxX = Math.max(maxX, tn.x + tn.w);
        maxY = Math.max(maxY, tn.y + tn.h);
      });
      
      // Create group node
      const groupId = 'group' + Math.random().toString(36).slice(2, 7);
      const groupNode: NodeModel = {
        id: groupId,
        kind: 'group',
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        fill: 'transparent',
        stroke: 'transparent', // Hide group outline by default
        strokeWidth: 1,
        strokeDashArray: [5, 5],
        label: '', // No label by default
      };
      
      // Set parentId for all children
      svgNode.parentId = groupId;
      textNodes.forEach((tn) => {
        tn.parentId = groupId;
      });
      
      console.log(`📦 Created group with 1 SVG node + ${textNodes.length} text nodes`);
      
      // Return the group node (children will be added separately by the caller)
      // We need to return an array of nodes to add: [group, svg, ...texts]
      // But the function signature returns NodeModel | null
      // We'll need to modify this - for now, attach children info
      (groupNode as any)._children = [svgNode, ...textNodes];
      return groupNode;
    }

    // No text elements - return just the SVG node
    return svgNode;
  } catch (error) {
    console.error('Failed to parse SVG:', error);
    return null;
  }
}

/**
 * Sanitize SVG by removing dangerous elements and attributes
 */
function sanitizeSvg(svgElement: SVGSVGElement): void {
  // Remove script tags
  const scripts = svgElement.querySelectorAll('script');
  scripts.forEach((script) => script.remove());

  // Remove event handler attributes
  const allElements = svgElement.querySelectorAll('*');
  allElements.forEach((el) => {
    const attributes = el.attributes;
    for (let i = attributes.length - 1; i >= 0; i--) {
      const attr = attributes[i];
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // Remove external references (xlink:href, href)
  allElements.forEach((el) => {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href');
    if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || href.startsWith('data:'))) {
      el.removeAttribute('href');
      el.removeAttribute('xlink:href');
    }
  });
}

/**
 * Extract viewBox from SVG element
 */
function extractViewBox(
  svgElement: SVGSVGElement
): { x: number; y: number; w: number; h: number } | null {
  const viewBoxAttr = svgElement.getAttribute('viewBox');
  if (viewBoxAttr) {
    const parts = viewBoxAttr.trim().split(/\s+/);
    if (parts.length === 4) {
      return {
        x: parseFloat(parts[0]),
        y: parseFloat(parts[1]),
        w: parseFloat(parts[2]),
        h: parseFloat(parts[3]),
      };
    }
  }
  return null;
}

/**
 * Resolve color value, handling currentColor
 */
function resolveColor(color: string | null | undefined): string | undefined {
  if (!color || color === 'none') return undefined;
  // Map currentColor to a reasonable default (can be customized)
  if (color === 'currentColor') return '#000000'; // Or your theme's foreground color
  return color;
}

/**
 * True when an SVG uses paint that canvas Path2D fills can't reproduce —
 * gradients or patterns referenced via `fill="url(#…)"`. Such fills are kept
 * as the literal `url(#…)` string in svgPaths, but `ctx.fillStyle = "url(#…)"`
 * is a no-op on canvas, so the path renders with whatever fillStyle was last
 * set (black in the editor loop, white on export — the observed inconsistency).
 * These SVGs must be rasterized from their original markup instead.
 */
export function svgNeedsRasterFallback(svg: string | null | undefined): boolean {
  if (!svg || typeof svg !== 'string') return false;
  return /<(linear|radial)gradient|<pattern[\s>]|fill\s*=\s*["']url\(/i.test(svg);
}

/**
 * Encode an SVG string as a data URL for `<img>`/drawImage rendering, forcing a
 * crisp fixed intrinsic size (the original often uses width/height="1em" which
 * rasterizes at ~16px and looks blurry when scaled up). viewBox preserves aspect.
 */
export function svgStringToDataUrl(svg: string, size = 256): string {
  let s = svg.trim();
  // Strip any width/height on the root <svg> tag, then inject a fixed size.
  s = s.replace(/(<svg\b[^>]*?)\s+width\s*=\s*(["'])[^"']*\2/i, '$1');
  s = s.replace(/(<svg\b[^>]*?)\s+height\s*=\s*(["'])[^"']*\2/i, '$1');
  s = s.replace(/<svg\b/i, `<svg width="${size}" height="${size}"`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

/**
 * Get inherited styles from an element and its ancestors
 */
function getInheritedStyles(
  element: Element,
  rootDefaults: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }
): {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
} {
  // Start with root defaults
  let fill = rootDefaults.fill;
  let stroke = rootDefaults.stroke;
  let strokeWidth = rootDefaults.strokeWidth;

  // Walk up the parent chain to collect inherited styles
  let current: Element | null = element;
  while (current && current.tagName !== 'svg') {
    const parentFill = current.getAttribute('fill');
    const parentStroke = current.getAttribute('stroke');
    const parentStrokeWidth = current.getAttribute('stroke-width');

    // Closer ancestors override
    if (parentFill && !fill) fill = resolveColor(parentFill);
    if (parentStroke && !stroke) stroke = resolveColor(parentStroke);
    if (parentStrokeWidth && !strokeWidth) strokeWidth = parseFloat(parentStrokeWidth);

    current = current.parentElement;
  }

  return { fill, stroke, strokeWidth };
}

/**
 * Extract all path elements from SVG
 * Extracts path data with cascading style inheritance
 */
function extractPaths(
  svgElement: SVGSVGElement,
  rootDefaults: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }
): Array<{
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}> {
  const paths: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }> = [];

  // Find all path elements
  const pathElements = svgElement.querySelectorAll('path');
  
  pathElements.forEach((pathElement) => {
    const d = pathElement.getAttribute('d');
    if (!d) return;

    // Get inherited styles from parents (including <g> elements)
    const inherited = getInheritedStyles(pathElement.parentElement || svgElement, rootDefaults);

    // Element's own attributes override inherited ones
    const fill = resolveColor(pathElement.getAttribute('fill')) || inherited.fill;
    const stroke = resolveColor(pathElement.getAttribute('stroke')) || inherited.stroke;
    const strokeWidth = pathElement.getAttribute('stroke-width')
      ? parseFloat(pathElement.getAttribute('stroke-width')!)
      : inherited.strokeWidth;
    const opacity = pathElement.getAttribute('opacity');

    paths.push({
      d,
      fill,
      stroke,
      strokeWidth,
      opacity: opacity ? parseFloat(opacity) : undefined,
    });
  });

  // Also extract basic shapes and convert to paths
  extractShapesAsPaths(svgElement, paths, rootDefaults);

  return paths;
}

/**
 * Extract basic SVG shapes (rect, circle, ellipse, polygon, polyline, line) and convert to path data
 */
function extractShapesAsPaths(
  svgElement: SVGSVGElement,
  paths: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }>,
  rootDefaults: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }
): void {
  // Convert rectangles to paths
  const rects = svgElement.querySelectorAll('rect');
  rects.forEach((rect) => {
    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const w = parseFloat(rect.getAttribute('width') || '0');
    const h = parseFloat(rect.getAttribute('height') || '0');
    const rx = parseFloat(rect.getAttribute('rx') || '0');
    const ry = parseFloat(rect.getAttribute('ry') || rx.toString()) || rx;

    let d: string;
    if (rx > 0 || ry > 0) {
      // Rounded rectangle
      d = `M${x + rx},${y} L${x + w - rx},${y} Q${x + w},${y} ${x + w},${y + ry} L${x + w},${y + h - ry} Q${x + w},${y + h} ${x + w - rx},${y + h} L${x + rx},${y + h} Q${x},${y + h} ${x},${y + h - ry} L${x},${y + ry} Q${x},${y} ${x + rx},${y} Z`;
    } else {
      // Regular rectangle
      d = `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
    }

    const inherited = getInheritedStyles(rect.parentElement || svgElement, rootDefaults);
    paths.push({
      d,
      fill: resolveColor(rect.getAttribute('fill')) || inherited.fill,
      stroke: resolveColor(rect.getAttribute('stroke')) || inherited.stroke,
      strokeWidth: rect.getAttribute('stroke-width')
        ? parseFloat(rect.getAttribute('stroke-width')!)
        : inherited.strokeWidth,
      opacity: rect.getAttribute('opacity')
        ? parseFloat(rect.getAttribute('opacity')!)
        : undefined,
    });
  });

  // Convert circles to paths
  const circles = svgElement.querySelectorAll('circle');
  circles.forEach((circle) => {
    const cx = parseFloat(circle.getAttribute('cx') || '0');
    const cy = parseFloat(circle.getAttribute('cy') || '0');
    const r = parseFloat(circle.getAttribute('r') || '0');

    // Circle as path using arc commands
    const d = `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`;

    const inherited = getInheritedStyles(circle.parentElement || svgElement, rootDefaults);
    paths.push({
      d,
      fill: resolveColor(circle.getAttribute('fill')) || inherited.fill,
      stroke: resolveColor(circle.getAttribute('stroke')) || inherited.stroke,
      strokeWidth: circle.getAttribute('stroke-width')
        ? parseFloat(circle.getAttribute('stroke-width')!)
        : inherited.strokeWidth,
      opacity: circle.getAttribute('opacity')
        ? parseFloat(circle.getAttribute('opacity')!)
        : undefined,
    });
  });

  // Convert ellipses to paths
  const ellipses = svgElement.querySelectorAll('ellipse');
  ellipses.forEach((ellipse) => {
    const cx = parseFloat(ellipse.getAttribute('cx') || '0');
    const cy = parseFloat(ellipse.getAttribute('cy') || '0');
    const rx = parseFloat(ellipse.getAttribute('rx') || '0');
    const ry = parseFloat(ellipse.getAttribute('ry') || '0');

    const d = `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`;

    const inherited = getInheritedStyles(ellipse.parentElement || svgElement, rootDefaults);
    paths.push({
      d,
      fill: resolveColor(ellipse.getAttribute('fill')) || inherited.fill,
      stroke: resolveColor(ellipse.getAttribute('stroke')) || inherited.stroke,
      strokeWidth: ellipse.getAttribute('stroke-width')
        ? parseFloat(ellipse.getAttribute('stroke-width')!)
        : inherited.strokeWidth,
      opacity: ellipse.getAttribute('opacity')
        ? parseFloat(ellipse.getAttribute('opacity')!)
        : undefined,
    });
  });

  // Convert polygons to paths
  const polygons = svgElement.querySelectorAll('polygon');
  polygons.forEach((polygon) => {
    const points = polygon.getAttribute('points');
    if (!points) return;

    const coords = points.trim().split(/[\s,]+/);
    if (coords.length < 4) return; // Need at least 2 points

    let d = 'M';
    for (let i = 0; i < coords.length; i += 2) {
      if (i > 0) d += ' L';
      d += `${coords[i]},${coords[i + 1]}`;
    }
    d += ' Z';

    const inherited = getInheritedStyles(polygon.parentElement || svgElement, rootDefaults);
    paths.push({
      d,
      fill: resolveColor(polygon.getAttribute('fill')) || inherited.fill,
      stroke: resolveColor(polygon.getAttribute('stroke')) || inherited.stroke,
      strokeWidth: polygon.getAttribute('stroke-width')
        ? parseFloat(polygon.getAttribute('stroke-width')!)
        : inherited.strokeWidth,
      opacity: polygon.getAttribute('opacity')
        ? parseFloat(polygon.getAttribute('opacity')!)
        : undefined,
    });
  });

  // Convert polylines to paths (open, no Z)
  const polylines = svgElement.querySelectorAll('polyline');
  polylines.forEach((polyline) => {
    const points = polyline.getAttribute('points');
    if (!points) return;

    const coords = points.trim().split(/[\s,]+/);
    if (coords.length < 4) return;

    let d = 'M';
    for (let i = 0; i < coords.length; i += 2) {
      if (i > 0) d += ' L';
      d += `${coords[i]},${coords[i + 1]}`;
    }
    // note: no Z, polylines aren't closed by default

    const inherited = getInheritedStyles(polyline.parentElement || svgElement, rootDefaults);
    paths.push({
      d,
      fill: resolveColor(polyline.getAttribute('fill')) || inherited.fill,
      stroke: resolveColor(polyline.getAttribute('stroke')) || inherited.stroke,
      strokeWidth: polyline.getAttribute('stroke-width')
        ? parseFloat(polyline.getAttribute('stroke-width')!)
        : inherited.strokeWidth,
      opacity: polyline.getAttribute('opacity')
        ? parseFloat(polyline.getAttribute('opacity')!)
        : undefined,
    });
  });

  // Convert lines to paths
  const lines = svgElement.querySelectorAll('line');
  lines.forEach((line) => {
    const x1 = parseFloat(line.getAttribute('x1') || '0');
    const y1 = parseFloat(line.getAttribute('y1') || '0');
    const x2 = parseFloat(line.getAttribute('x2') || '0');
    const y2 = parseFloat(line.getAttribute('y2') || '0');

    const d = `M${x1},${y1} L${x2},${y2}`; // no Z; open path

    const inherited = getInheritedStyles(line.parentElement || svgElement, rootDefaults);
    paths.push({
      d,
      fill: undefined, // lines usually have no fill
      stroke: resolveColor(line.getAttribute('stroke')) || inherited.stroke,
      strokeWidth: line.getAttribute('stroke-width')
        ? parseFloat(line.getAttribute('stroke-width')!)
        : inherited.strokeWidth,
      opacity: line.getAttribute('opacity')
        ? parseFloat(line.getAttribute('opacity')!)
        : undefined,
    });
  });
}

/**
 * Parse all <text> elements from SVG
 */
function parseTextElements(svgElement: SVGSVGElement): ParsedText[] {
  const texts: ParsedText[] = [];
  const textElements = svgElement.querySelectorAll('text');

  textElements.forEach((textElement) => {
    const x = parseFloat(textElement.getAttribute('x') || '0');
    const y = parseFloat(textElement.getAttribute('y') || '0');
    
    // Get text content (including tspan children)
    let content = textElement.textContent || '';
    
    // Handle multiple tspan elements (multi-line text)
    const tspans = textElement.querySelectorAll('tspan');
    if (tspans.length > 0) {
      content = Array.from(tspans)
        .map((tspan) => tspan.textContent || '')
        .join('\n');
    }
    
    if (!content.trim()) return; // Skip empty text

    // Parse styling
    const fontFamily = textElement.getAttribute('font-family') || undefined;
    const fontSize = textElement.getAttribute('font-size')
      ? parseFloat(textElement.getAttribute('font-size')!)
      : undefined;
    const fontWeightStr = textElement.getAttribute('font-weight');
    let fontWeight: number | undefined;
    if (fontWeightStr) {
      if (fontWeightStr === 'normal') fontWeight = 400;
      else if (fontWeightStr === 'bold') fontWeight = 700;
      else fontWeight = parseFloat(fontWeightStr) || 400;
    }
    const fontStyle = textElement.getAttribute('font-style') as 'normal' | 'italic' | null;
    const fill = resolveColor(textElement.getAttribute('fill'));
    const textAnchor = textElement.getAttribute('text-anchor') as 'start' | 'middle' | 'end' | null;

    texts.push({
      x,
      y,
      content,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle: fontStyle || 'normal',
      fill,
      textAnchor: textAnchor || 'start',
    });
  });

  return texts;
}

/**
 * Convert parsed text elements into TextNode models
 */
function createTextNodes(
  texts: ParsedText[],
  svgX: number,
  svgY: number,
  viewBox: { x: number; y: number; w: number; h: number }
): NodeModel[] {
  return texts.map((text, index) => {
    // Map text-anchor to our textAlign
    let textAlign: 'left' | 'center' | 'right' = 'left';
    if (text.textAnchor === 'middle') textAlign = 'center';
    else if (text.textAnchor === 'end') textAlign = 'right';

    // Calculate position relative to SVG node
    // Text coordinates are in SVG viewBox space
    const relativeX = text.x - viewBox.x;
    const relativeY = text.y - viewBox.y;

    // Estimate text box size (will auto-fit anyway)
    const estimatedWidth = (text.content.length * (text.fontSize || 14)) * 0.6;
    const estimatedHeight = (text.fontSize || 14) * 1.5;

    const id = 'text' + Math.random().toString(36).slice(2, 7);
    return {
      id,
      kind: 'text' as const,
      x: svgX + relativeX - (textAlign === 'center' ? estimatedWidth / 2 : textAlign === 'right' ? estimatedWidth : 0),
      y: svgY + relativeY - estimatedHeight / 2, // Adjust for baseline
      w: estimatedWidth,
      h: estimatedHeight,
      text: text.content,
      fontFamily: text.fontFamily || 'Inter, Arial, Helvetica, sans-serif',
      fontSize: text.fontSize || 14,
      fontWeight: text.fontWeight || 400,
      fontStyle: text.fontStyle,
      color: text.fill || '#000',
      fill: 'transparent', // No background by default
      stroke: 'transparent',
      textAlign,
      verticalAlign: 'middle' as const,
      wrap: 'word' as const,
      label: '',
    };
  });
}

/**
 * Parse an SVG string and convert it to a NodeModel with SVG paths
 * This is similar to parseSvgToNode but takes a string instead of a File
 */
export function parseSvgStringToNode(
  svgString: string,
  x: number = 100,
  y: number = 100
): NodeModel | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    
    // Check for parse errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.error('SVG parse error:', parserError.textContent);
      return null;
    }

    const svgElement = doc.querySelector('svg');
    if (!svgElement) {
      console.error('No SVG element found');
      return null;
    }

    // Sanitize: remove scripts and suspicious attributes
    sanitizeSvg(svgElement);

    // Extract viewBox or use width/height
    let viewBox = extractViewBox(svgElement);
    if (!viewBox) {
      const width = parseFloat(svgElement.getAttribute('width') || '200');
      const height = parseFloat(svgElement.getAttribute('height') || '200');
      viewBox = { x: 0, y: 0, w: width, h: height };
    }

    // Extract root-level style attributes as defaults
    const rootDefaults = {
      fill: resolveColor(svgElement.getAttribute('fill')),
      stroke: resolveColor(svgElement.getAttribute('stroke')),
      strokeWidth: svgElement.getAttribute('stroke-width')
        ? parseFloat(svgElement.getAttribute('stroke-width')!)
        : undefined,
    };

    // Parse marker definitions from <defs>
    const markers = parseMarkers(svgElement);

    // Extract all shapes/paths
    const paths = extractPaths(svgElement, rootDefaults);

    // Inline markers from lines/paths into the paths array
    inlineMarkersFromElements(svgElement, paths, markers);

    if (paths.length === 0) {
      console.warn('No paths found in SVG');
      return null;
    }

    // Scale to reasonable size
    const maxSize = 200;
    let scale = 1;
    if (viewBox.w > maxSize || viewBox.h > maxSize) {
      scale = maxSize / Math.max(viewBox.w, viewBox.h);
    }

    const id = 'svg' + Math.random().toString(36).slice(2, 7);
    const node: NodeModel = {
      id,
      kind: 'svg',
      x,
      y,
      w: Math.round(viewBox.w * scale),
      h: Math.round(viewBox.h * scale),
      svgPaths: paths,
      svgViewBox: viewBox,
      fill: undefined, // No fill override by default
      stroke: undefined, // No stroke override by default
      iconStyle: undefined, // Preserve original colors (like direct upload)
    };

    return node;
  } catch (error) {
    console.error('Failed to parse SVG string:', error);
    return null;
  }
}


/**
 * Convert SVG paths and viewBox to a data URL for use in CropModal
 * Renders the SVG at a reasonable size for the crop preview
 */
export function svgPathsToDataUrl(
  paths: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }>,
  viewBox: { x: number; y: number; w: number; h: number },
  size: number = 800 // Target size for the longer dimension
): string {
  // Calculate dimensions maintaining aspect ratio
  const aspect = viewBox.w / viewBox.h;
  let width: number, height: number;
  if (aspect >= 1) {
    width = size;
    height = size / aspect;
  } else {
    height = size;
    width = size * aspect;
  }

  // Build SVG string
  const pathElements = paths.map((p) => {
    const attrs: string[] = [`d="${p.d}"`];
    if (p.fill) attrs.push(`fill="${p.fill}"`);
    else attrs.push('fill="none"');
    if (p.stroke) attrs.push(`stroke="${p.stroke}"`);
    if (p.strokeWidth !== undefined) attrs.push(`stroke-width="${p.strokeWidth}"`);
    if (p.opacity !== undefined) attrs.push(`opacity="${p.opacity}"`);
    return `<path ${attrs.join(' ')} />`;
  }).join('\n  ');

  // Add a white background rect so the SVG is visible in the dark crop modal
  const bgRect = `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.w}" height="${viewBox.h}" fill="white" />`;

  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}">
  ${bgRect}
  ${pathElements}
</svg>`;

  // Convert to data URL
  const encoded = encodeURIComponent(svgString)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  
  return `data:image/svg+xml,${encoded}`;
}
