/* eslint-disable -- New utility file for SVG marker support */

/**
 * Marker definition extracted from SVG <marker> elements
 */
interface MarkerDef {
  id: string;
  viewBox: { x: number; y: number; w: number; h: number };
  refX: number;
  refY: number;
  markerWidth: number;
  markerHeight: number;
  orient: 'auto' | 'auto-start-reverse' | number;
  paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }>;
}

/**
 * Parse all <marker> definitions from an SVG element
 */
export function parseMarkers(svgElement: SVGSVGElement): Map<string, MarkerDef> {
  const markers = new Map<string, MarkerDef>();
  const markerElements = svgElement.querySelectorAll('marker');

  markerElements.forEach((marker) => {
    const id = marker.getAttribute('id');
    if (!id) return;

    const viewBoxStr = marker.getAttribute('viewBox');
    let viewBox = { x: 0, y: 0, w: 10, h: 10 }; // default
    if (viewBoxStr) {
      const parts = viewBoxStr.split(/[\s,]+/).map(parseFloat);
      if (parts.length === 4) {
        viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
      }
    }

    const refX = parseFloat(marker.getAttribute('refX') || '0');
    const refY = parseFloat(marker.getAttribute('refY') || '0');
    const markerWidth = parseFloat(marker.getAttribute('markerWidth') || '3');
    const markerHeight = parseFloat(marker.getAttribute('markerHeight') || '3');
    
    let orient: 'auto' | 'auto-start-reverse' | number = 'auto';
    const orientAttr = marker.getAttribute('orient');
    if (orientAttr === 'auto-start-reverse') {
      orient = 'auto-start-reverse';
    } else if (orientAttr && orientAttr !== 'auto') {
      orient = parseFloat(orientAttr);
    }

    // Extract paths from marker
    const paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }> = [];
    const pathElements = marker.querySelectorAll('path');
    pathElements.forEach((path) => {
      const d = path.getAttribute('d');
      if (!d) return;
      paths.push({
        d,
        fill: path.getAttribute('fill') || undefined,
        stroke: path.getAttribute('stroke') || undefined,
        strokeWidth: path.getAttribute('stroke-width')
          ? parseFloat(path.getAttribute('stroke-width')!)
          : undefined,
      });
    });

    markers.set(id, {
      id,
      viewBox,
      refX,
      refY,
      markerWidth,
      markerHeight,
      orient,
      paths,
    });
  });

  if (markers.size > 0) {
    console.log(`🎯 Parsed ${markers.size} marker definitions:`, Array.from(markers.keys()));
  }

  return markers;
}

/**
 * Calculate angle (in degrees) for a line segment
 */
function calculateAngle(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

/**
 * Transform a path data string by scale, rotation, and translation
 * Applies transformations in the correct order: scale -> rotate -> translate
 * Also handles refX/refY offset in marker's local coordinate space
 */
function transformPath(
  pathData: string,
  tx: number,
  ty: number,
  angle: number,
  scale: number,
  refX: number = 0,
  refY: number = 0
): string {
  // Parse the path into commands
  const commands = pathData.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];
  
  const angleRad = (angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return commands
    .map((cmd) => {
      const type = cmd[0];
      const coords = cmd
        .slice(1)
        .trim()
        .split(/[\s,]+/)
        .map(parseFloat)
        .filter((n) => !isNaN(n));

      // Transform each coordinate pair
      const transformedCoords = [];
      for (let i = 0; i < coords.length; i += 2) {
        if (i + 1 < coords.length) {
          // 1. Scale
          let x = coords[i] * scale;
          let y = coords[i + 1] * scale;
          
          // 2. Apply refX/refY offset (in local space, before rotation)
          x -= refX * scale;
          y -= refY * scale;
          
          // 3. Rotate around origin
          const rx = x * cos - y * sin;
          const ry = x * sin + y * cos;
          
          // 4. Translate to final position
          transformedCoords.push(rx + tx, ry + ty);
        }
      }

      // Reconstruct command
      if (type === 'Z' || type === 'z') {
        return 'Z';
      }
      return type + transformedCoords.join(',');
    })
    .join(' ');
}

/**
 * Get the start/end point of a line or path element
 */
function getLineEndpoints(element: Element): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} | null {
  if (element.tagName === 'line') {
    return {
      start: {
        x: parseFloat(element.getAttribute('x1') || '0'),
        y: parseFloat(element.getAttribute('y1') || '0'),
      },
      end: {
        x: parseFloat(element.getAttribute('x2') || '0'),
        y: parseFloat(element.getAttribute('y2') || '0'),
      },
    };
  }

  if (element.tagName === 'path') {
    const d = element.getAttribute('d');
    if (!d) return null;

    // Simple extraction: find first M and last coordinate
    const commands = d.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];
    if (commands.length === 0) return null;

    // Get start point from first M command
    const firstCmd = commands[0];
    if (!firstCmd) return null;
    const firstCoords = firstCmd.slice(1).trim().split(/[\s,]+/).map(parseFloat);
    if (firstCoords.length < 2) return null;

    // Get end point from last command
    let lastX = firstCoords[0];
    let lastY = firstCoords[1];
    for (const cmd of commands) {
      const type = cmd[0];
      if (type === 'Z' || type === 'z') continue;
      const coords = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat);
      if (coords.length >= 2) {
        lastX = coords[coords.length - 2];
        lastY = coords[coords.length - 1];
      }
    }

    return {
      start: { x: firstCoords[0], y: firstCoords[1] },
      end: { x: lastX, y: lastY },
    };
  }

  return null;
}

/**
 * Inline markers from line/path elements into the paths array
 */
export function inlineMarkersFromElements(
  svgElement: SVGSVGElement,
  paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }>,
  markers: Map<string, MarkerDef>
): void {
  if (markers.size === 0) return;

  let inlinedCount = 0;

  // Check all lines and paths for marker attributes
  const elements = svgElement.querySelectorAll('line, path');
  elements.forEach((element) => {
    const markerEnd = element.getAttribute('marker-end');
    const markerStart = element.getAttribute('marker-start');

    if (!markerEnd && !markerStart) return;

    const endpoints = getLineEndpoints(element);
    if (!endpoints) return;

    // Process marker-end
    if (markerEnd) {
      const markerId = markerEnd.match(/url\(#(.+?)\)/)?.[1];
      if (markerId && markers.has(markerId)) {
        const marker = markers.get(markerId)!;
        const angle = calculateAngle(
          endpoints.start.x,
          endpoints.start.y,
          endpoints.end.x,
          endpoints.end.y
        );
        
        // Calculate scale based on marker size vs viewBox
        const scale = marker.markerWidth / marker.viewBox.w;

        // Add each path in the marker
        marker.paths.forEach((markerPath) => {
          const transformedD = transformPath(
            markerPath.d,
            endpoints.end.x,
            endpoints.end.y,
            angle,
            scale,
            marker.refX,
            marker.refY
          );
          paths.push({
            d: transformedD,
            fill: markerPath.fill,
            stroke: markerPath.stroke,
            strokeWidth: markerPath.strokeWidth,
          });
          inlinedCount++;
        });
      }
    }

    // Process marker-start (similar but with reversed angle for auto-start-reverse)
    if (markerStart) {
      const markerId = markerStart.match(/url\(#(.+?)\)/)?.[1];
      if (markerId && markers.has(markerId)) {
        const marker = markers.get(markerId)!;
        let angle = calculateAngle(
          endpoints.end.x,
          endpoints.end.y,
          endpoints.start.x,
          endpoints.start.y
        );
        
        if (marker.orient === 'auto-start-reverse') {
          angle += 180;
        }

        const scale = marker.markerWidth / marker.viewBox.w;

        marker.paths.forEach((markerPath) => {
          const transformedD = transformPath(
            markerPath.d,
            endpoints.start.x,
            endpoints.start.y,
            angle,
            scale,
            marker.refX,
            marker.refY
          );
          paths.push({
            d: transformedD,
            fill: markerPath.fill,
            stroke: markerPath.stroke,
            strokeWidth: markerPath.strokeWidth,
          });
          inlinedCount++;
        });
      }
    }
  });

  if (inlinedCount > 0) {
    console.log(`✨ Inlined ${inlinedCount} marker instances into paths`);
  }
}

