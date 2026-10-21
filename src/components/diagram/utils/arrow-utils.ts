/* eslint-disable -- Migrated file */
import type { Vec2 } from '../types';

export type ArrowEndpoint = 'start' | 'end';

export type ArrowGeometry = {
  tip: Vec2;
  backPoint: Vec2;
  extensionLine?: { from: Vec2; to: Vec2 };
};

/**
 * Arrowhead geometry for a polyline, supporting trim-aware positioning.
 * 
 * When atT < 1 (end) or atT > 0 (start), positions the arrowhead at the
 * trimmed point along the path so it moves with the draw effect.
 * Includes a snap to cardinal for any floating-point imprecision.
 */
export function getArrowGeometryForPolyline(
  points: Vec2[],
  opts: {
    endpoint: ArrowEndpoint;
    atT: number; // 0-1 position along the path (from trim)
    arrowOffset: number; // negative = into node, positive = away from node
    arrowSize: number;
  }
): ArrowGeometry | null {
  if (!points || points.length < 2) return null;

  let pos: Vec2;
  let dir: Vec2;

  // Compute cumulative distances for position lookup
  const cumDist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    ));
  }
  const totalLen = cumDist[cumDist.length - 1];

  if (opts.endpoint === 'end') {
    const isFullEnd = opts.atT >= 0.999 || totalLen < 1;

    if (isFullEnd) {
      pos = points[points.length - 1];
      let dx = 0, dy = 0, len = 0;
      for (let i = points.length - 1; i >= 1; i--) {
        dx = points[i].x - points[i - 1].x;
        dy = points[i].y - points[i - 1].y;
        len = Math.hypot(dx, dy);
        if (len >= 1) break;
      }
      if (len < 1e-6) return null;
      dir = { x: dx / len, y: dy / len };
    } else {
      const targetDist = opts.atT * totalLen;
      let segIdx = 1;
      while (segIdx < cumDist.length && cumDist[segIdx] < targetDist) segIdx++;
      segIdx = Math.min(segIdx, points.length - 1);
      const segStart = cumDist[segIdx - 1];
      const segEnd = cumDist[segIdx];
      const segLen = segEnd - segStart;
      const segT = segLen > 0 ? (targetDist - segStart) / segLen : 0;
      const a = points[segIdx - 1], b = points[segIdx];
      pos = { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT };
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dir = { x: dx / len, y: dy / len };
    }
  } else {
    const isFullStart = opts.atT <= 0.001 || totalLen < 1;

    if (isFullStart) {
      pos = points[0];
      let dx = 0, dy = 0, len = 0;
      for (let i = 0; i < points.length - 1; i++) {
        dx = points[i].x - points[i + 1].x;
        dy = points[i].y - points[i + 1].y;
        len = Math.hypot(dx, dy);
        if (len >= 1) break;
      }
      if (len < 1e-6) return null;
      dir = { x: dx / len, y: dy / len };
    } else {
      const targetDist = opts.atT * totalLen;
      let segIdx = 1;
      while (segIdx < cumDist.length && cumDist[segIdx] < targetDist) segIdx++;
      segIdx = Math.min(segIdx, points.length - 1);
      const segStart = cumDist[segIdx - 1];
      const segEnd = cumDist[segIdx];
      const segLen = segEnd - segStart;
      const segT = segLen > 0 ? (targetDist - segStart) / segLen : 0;
      const a = points[segIdx - 1], b = points[segIdx];
      pos = { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT };
      const dx = a.x - b.x, dy = a.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      dir = { x: dx / len, y: dy / len };
    }
  }

  // Snap to cardinal direction ONLY when nearly cardinal (within ~5°)
  // This fixes floating-point imprecision in elbowed paths
  // but preserves diagonal directions for straight/curved lines
  const absX = Math.abs(dir.x);
  const absY = Math.abs(dir.y);
  const snapThreshold = 0.1; // ~5.7° - only snap if one component is very small
  if (absX < snapThreshold && absY > 0.9) {
    // Nearly vertical - snap to vertical
    dir = { x: 0, y: dir.y > 0 ? 1 : -1 };
  } else if (absY < snapThreshold && absX > 0.9) {
    // Nearly horizontal - snap to horizontal
    dir = { x: dir.x > 0 ? 1 : -1, y: 0 };
  }
  // Otherwise keep the original diagonal direction

  // Move arrowhead tip forward by arrowOffset
  const tip = {
    x: pos.x + dir.x * opts.arrowOffset,
    y: pos.y + dir.y * opts.arrowOffset,
  };

  const backPoint = {
    x: tip.x - dir.x * opts.arrowSize,
    y: tip.y - dir.y * opts.arrowSize,
  };

  // If arrowOffset > arrowSize, draw a short extension line from endpoint to arrow back
  const gapToBack = opts.arrowOffset - opts.arrowSize;
  const extensionLine =
    gapToBack > 0 ? { from: { ...pos }, to: { ...backPoint } } : undefined;

  return { tip, backPoint, extensionLine };
}


