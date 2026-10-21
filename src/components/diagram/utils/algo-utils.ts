/**
 * Algorithm Visualization Primitives
 *
 * Renderers and helpers for algorithm-specific node kinds:
 *  - algo-array: row/column of equal-sized cells with values
 *  - algo-pointer: labeled marker that points at a target node or array cell
 *
 * These renderers are pure (no UI chrome) and are called from both
 * canvas-render.ts (editor) and entity-renderers.ts (export pipeline).
 */

import type { ChartBar, ChartSeries, GraphEdge, GraphNode, LinkedListNode, NodeModel, ScatterPoint, TreeNode, Vec2 } from '../types';
import { pointWithNodeTransform } from './node-utils';

/**
 * Compute the EFFECTIVE cell width and height for an algo-array node.
 *
 * The cell dimensions are derived from the node's bounding box (w/h) so that
 * dragging the resize handles scales the cells. The cellWidth/cellHeight props
 * are honored as initial values (set by the panel sliders, which write through
 * w/h to keep them in sync) but if w/h has been changed independently — e.g.
 * via drag — the renderer uses w/h as the source of truth.
 *
 * Returns null if the array has no cells.
 */
export function getEffectiveCellSize(
  arrayNode: NodeModel
): { cellW: number; cellH: number; indexSpace: number } | null {
  if (arrayNode.kind !== 'algo-array') return null;
  const values = arrayNode.cellValues || [];
  if (values.length === 0) return null;

  const orientation = arrayNode.cellOrientation ?? 'horizontal';
  const gap = arrayNode.cellGap ?? 0;
  const showIndices = arrayNode.cellShowIndices ?? true;
  const indexFontSize = arrayNode.cellIndexFontSize ?? 11;
  const indexSpace = showIndices ? indexFontSize + 6 : 0;

  let cellW: number;
  let cellH: number;
  if (orientation === 'horizontal') {
    // Total width = N * cellW + (N-1) * gap → cellW = (w - (N-1)*gap) / N
    cellW = Math.max(
      4,
      (arrayNode.w - Math.max(0, values.length - 1) * gap) / values.length
    );
    // Total height = cellH + indexSpace → cellH = h - indexSpace
    cellH = Math.max(4, arrayNode.h - indexSpace);
  } else {
    cellW = Math.max(4, arrayNode.w - indexSpace);
    cellH = Math.max(
      4,
      (arrayNode.h - Math.max(0, values.length - 1) * gap) / values.length
    );
  }

  return { cellW, cellH, indexSpace };
}

/**
 * Compute the world-space rectangle of a single cell within an algo-array node.
 * Returns null if the index is out of bounds or the node is not an algo-array.
 *
 * The index may be fractional — e.g. 1.5 means halfway between cell 1 and cell 2.
 * This supports smooth pointer slide animations between cells.
 *
 * Cell dimensions are derived from the node's bounding box, so dragging resize
 * handles correctly scales the cells (and the pointer hit-test stays accurate).
 */
export function getAlgoArrayCellRect(
  arrayNode: NodeModel,
  index: number
): { x: number; y: number; w: number; h: number } | null {
  const sizes = getEffectiveCellSize(arrayNode);
  if (!sizes) return null;
  const values = arrayNode.cellValues || [];
  // Allow fractional indices for animation; clamp to valid range
  const clamped = Math.max(0, Math.min(values.length - 1, index));

  const orientation = arrayNode.cellOrientation ?? 'horizontal';
  const gap = arrayNode.cellGap ?? 0;

  if (orientation === 'horizontal') {
    return {
      x: arrayNode.x + clamped * (sizes.cellW + gap),
      y: arrayNode.y,
      w: sizes.cellW,
      h: sizes.cellH,
    };
  } else {
    return {
      x: arrayNode.x,
      y: arrayNode.y + clamped * (sizes.cellH + gap),
      w: sizes.cellW,
      h: sizes.cellH,
    };
  }
}

/**
 * Compute the natural bounding box of an algo-array node based on its
 * cell count, dimensions, and orientation. This includes space reserved
 * for index labels when cellShowIndices is true.
 */
export function getAlgoArrayNaturalSize(
  arrayNode: NodeModel
): { w: number; h: number } {
  const values = arrayNode.cellValues || [];
  const orientation = arrayNode.cellOrientation ?? 'horizontal';
  const cellW = arrayNode.cellWidth ?? 50;
  const cellH = arrayNode.cellHeight ?? 50;
  const gap = arrayNode.cellGap ?? 0;
  const showIndices = arrayNode.cellShowIndices ?? true;
  const indexFontSize = arrayNode.cellIndexFontSize ?? 11;
  const indexSpace = showIndices ? indexFontSize + 6 : 0;

  if (orientation === 'horizontal') {
    return {
      w: Math.max(1, values.length) * cellW + Math.max(0, values.length - 1) * gap,
      h: cellH + indexSpace,
    };
  } else {
    return {
      w: cellW + indexSpace,
      h: Math.max(1, values.length) * cellH + Math.max(0, values.length - 1) * gap,
    };
  }
}

/**
 * Render an algo-array node directly to a canvas context.
 * Caller is responsible for ctx.save()/restore() if needed.
 */
export function drawAlgoArray(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-array') return;

  const values = n.cellValues || [];
  if (values.length === 0) return;

  const sizes = getEffectiveCellSize(n);
  if (!sizes) return;
  const { cellW, cellH } = sizes;

  const orientation = n.cellOrientation ?? 'horizontal';
  const gap = n.cellGap ?? 0;
  const showIndices = n.cellShowIndices ?? true;
  const fontSize = n.cellFontSize ?? 16;
  const indexFontSize = n.cellIndexFontSize ?? 11;
  const fillColor = n.fill || '#1e293b';
  const strokeColor = n.stroke || '#94a3b8';
  const strokeWidth = n.strokeWidth ?? 1;
  const textColor = n.labelColor || '#e6edf3';
  const indexColor = n.cellIndexColor || textColor;
  const cellTextColor = n.cellColor || textColor;
  const fontFamily = n.labelFontFamily || 'system-ui';
  const cellColors = n.cellColors || [];
  const cellLabels = n.cellLabels || [];

  // Read swap animation metadata (set by applyCollectionCrossFade when two
  // cellValues trade places between snapshots, or by an explicit AlgoSwapAction).
  // Each swap carries its own `t` so explicit actions can have independent timing.
  const swaps = (n as any)._algoSwaps as
    | Array<{ a: number; b: number; valueA: string; valueB: string; t: number }>
    | undefined;
  const swappingIndices = new Set<number>();
  if (swaps) {
    for (const s of swaps) {
      if (s.t < 1) {
        swappingIndices.add(s.a);
        swappingIndices.add(s.b);
      }
    }
  }

  ctx.save();

  for (let i = 0; i < values.length; i++) {
    let cx: number;
    let cy: number;
    if (orientation === 'horizontal') {
      cx = n.x + i * (cellW + gap);
      cy = n.y;
    } else {
      cx = n.x;
      cy = n.y + i * (cellH + gap);
    }

    // Cell background
    const cellFill = cellColors[i] || fillColor;
    ctx.fillStyle = cellFill;
    ctx.fillRect(cx, cy, cellW, cellH);

    // Cell border
    if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none') {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(cx, cy, cellW, cellH);
    }

    // Cell value text — empty string in cellLabels means "use default cellValues[i]".
    // Skip if this cell is part of an active swap; the flying ghost will cover it.
    if (!swappingIndices.has(i)) {
      const text = cellLabels[i] || values[i];
      if (text) {
        ctx.fillStyle = cellTextColor;
        ctx.font = `600 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx + cellW / 2, cy + cellH / 2);
      }
    }

    // Index label
    if (showIndices) {
      ctx.fillStyle = indexColor;
      // If user explicitly set a color, use full opacity. Otherwise dim the
      // inherited text color so it visually recedes from the cell values.
      ctx.globalAlpha = n.cellIndexColor ? 1 : 0.6;
      ctx.font = `400 ${indexFontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      if (orientation === 'horizontal') {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(i), cx + cellW / 2, cy + cellH + 3);
      } else {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i), cx + cellW + 4, cy + cellH / 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Render flying ghost values for active swaps. Each pair animates two
  // values trading places along an arc — value A goes a→b above the cells,
  // value B goes b→a below, so they don't visually overlap mid-flight.
  // Each swap uses its own per-swap `t` so explicit AlgoSwapActions can
  // animate with independent timing.
  if (swaps && swaps.some((s) => s.t < 1)) {
    ctx.font = `700 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cellTextColor;
    const arcHeight = Math.min(cellH * 0.8, 30);
    const cellCenterAt = (i: number): { cx: number; cy: number } => {
      if (orientation === 'horizontal') {
        return { cx: n.x + i * (cellW + gap) + cellW / 2, cy: n.y + cellH / 2 };
      }
      return { cx: n.x + cellW / 2, cy: n.y + i * (cellH + gap) + cellH / 2 };
    };
    for (const s of swaps) {
      if (s.t >= 1) continue;
      // sin arc — peaks at t=0.5, 0 at endpoints
      const arc = Math.sin(s.t * Math.PI) * arcHeight;
      const fromA = cellCenterAt(s.a);
      const toA = cellCenterAt(s.b);
      const fromB = cellCenterAt(s.b);
      const toB = cellCenterAt(s.a);
      // Value A flies a→b. Horizontal arrays: arch UP (negative y).
      const ax = fromA.cx + (toA.cx - fromA.cx) * s.t;
      const ay = fromA.cy + (toA.cy - fromA.cy) * s.t - (orientation === 'horizontal' ? arc : 0);
      // Value B flies b→a, arching the OTHER way so they don't collide.
      const bx = fromB.cx + (toB.cx - fromB.cx) * s.t;
      const by = fromB.cy + (toB.cy - fromB.cy) * s.t + (orientation === 'horizontal' ? arc : 0);
      // For vertical orientation, arc sideways instead of up/down.
      const axOff = orientation === 'horizontal' ? 0 : -arc;
      const bxOff = orientation === 'horizontal' ? 0 : arc;
      ctx.fillText(s.valueA, ax + axOff, ay);
      ctx.fillText(s.valueB, bx + bxOff, by);
    }
  }

  // Range marker — colored bracket spanning [rangeStart, rangeEnd] inclusive.
  // Used for sliding window, binary search range halving, two-pointer ranges.
  // Endpoints are independently animatable via transformTween (numeric type)
  // so the AI can slide either side smoothly.
  if (n.rangeStart !== undefined && n.rangeEnd !== undefined) {
    const rs = Math.max(0, Math.min(values.length - 1, n.rangeStart));
    const re = Math.max(0, Math.min(values.length - 1, n.rangeEnd));
    const lo = Math.min(rs, re);
    const hi = Math.max(rs, re);
    const rangeColor = n.rangeColor || '#3b82f6';
    const bracketWidth = Math.max(2, strokeWidth * 1.5);
    const bracketTickH = Math.min(cellH * 0.25, 8);
    const offset = 4;

    ctx.save();
    ctx.strokeStyle = rangeColor;
    ctx.lineWidth = bracketWidth;
    ctx.lineCap = 'round';

    if (orientation === 'horizontal') {
      // Bracket below the cells
      const xStart = n.x + lo * (cellW + gap);
      const xEnd = n.x + hi * (cellW + gap) + cellW;
      const indexSpace = (n.cellShowIndices ?? true) ? (n.cellIndexFontSize ?? 11) + 6 : 0;
      const y = n.y + cellH + indexSpace + offset;
      ctx.beginPath();
      ctx.moveTo(xStart, y);
      ctx.lineTo(xStart, y + bracketTickH);
      ctx.moveTo(xStart, y + bracketTickH);
      ctx.lineTo(xEnd, y + bracketTickH);
      ctx.moveTo(xEnd, y + bracketTickH);
      ctx.lineTo(xEnd, y);
      ctx.stroke();
      // Optional label centered below the bracket
      if (n.rangeLabel) {
        ctx.fillStyle = rangeColor;
        ctx.font = `600 11px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.rangeLabel, (xStart + xEnd) / 2, y + bracketTickH + 2);
      }
    } else {
      // Vertical: bracket to the right of the cells
      const yStart = n.y + lo * (cellH + gap);
      const yEnd = n.y + hi * (cellH + gap) + cellH;
      const indexSpace = (n.cellShowIndices ?? true) ? (n.cellIndexFontSize ?? 11) + 6 : 0;
      const x = n.x + cellW + indexSpace + offset;
      ctx.beginPath();
      ctx.moveTo(x, yStart);
      ctx.lineTo(x + bracketTickH, yStart);
      ctx.moveTo(x + bracketTickH, yStart);
      ctx.lineTo(x + bracketTickH, yEnd);
      ctx.moveTo(x + bracketTickH, yEnd);
      ctx.lineTo(x, yEnd);
      ctx.stroke();
      if (n.rangeLabel) {
        ctx.fillStyle = rangeColor;
        ctx.font = `600 11px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.rangeLabel, x + bracketTickH + 4, (yStart + yEnd) / 2);
      }
    }
    ctx.restore();
  }

  // Optional outer label (e.g. variable name like "arr")
  if (n.label) {
    const labelSize = n.labelFontSize || 13;
    ctx.fillStyle = textColor;
    ctx.font = `600 ${labelSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }

  ctx.restore();
}

/**
 * Compute the anchor point an algo-pointer should point at.
 * Returns world-space {x, y} of the target's edge plus the side direction.
 *
 * If the target is an algo-array and pointerTargetIndex is set, anchors to
 * the cell at that index. Otherwise anchors to the target node's bounds.
 */
export function getAlgoPointerAnchor(
  pointer: NodeModel,
  allNodes: readonly NodeModel[]
): { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' } | null {
  if (pointer.kind !== 'algo-pointer') return null;
  if (!pointer.pointerTargetId) return null;

  const target = allNodes.find((nn) => nn.id === pointer.pointerTargetId);
  if (!target) return null;

  const side = pointer.pointerSidePosition ?? 'top';

  // Determine target rectangle (a cell, or the whole target node)
  let rect: { x: number; y: number; w: number; h: number };
  // Track which side(s) of `rect` are occupied by index labels — the pointer
  // anchor should sit BEYOND those labels so the arrow+label don't collide.
  let indexSpaceTop = 0;
  let indexSpaceBottom = 0;
  let indexSpaceLeft = 0;
  let indexSpaceRight = 0;
  if (
    target.kind === 'algo-array' &&
    pointer.pointerTargetIndex !== undefined &&
    pointer.pointerTargetIndex !== null
  ) {
    const cellRect = getAlgoArrayCellRect(target, pointer.pointerTargetIndex);
    if (cellRect) {
      rect = cellRect;
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
    // Compute index-label space when indices are shown
    const showIndices = target.cellShowIndices ?? true;
    if (showIndices) {
      const orientation = target.cellOrientation ?? 'horizontal';
      const indexFontSize = target.cellIndexFontSize ?? 11;
      const space = indexFontSize + 6;
      // Horizontal arrays: indices are drawn BELOW each cell → block 'bottom'
      // Vertical arrays: indices are drawn to the RIGHT of each cell → block 'right'
      if (orientation === 'horizontal') indexSpaceBottom = space;
      else indexSpaceRight = space;
    }
  } else if (
    target.kind === 'algo-grid' &&
    pointer.pointerTargetRow !== undefined &&
    pointer.pointerTargetRow !== null &&
    pointer.pointerTargetCol !== undefined &&
    pointer.pointerTargetCol !== null
  ) {
    const cellRect = getAlgoGridCellRect(target, pointer.pointerTargetRow, pointer.pointerTargetCol);
    if (cellRect) {
      rect = cellRect;
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
    // Reserve space so a 'top' pointer sits ABOVE the column-index row
    // (C1/C2/C3 headers) and a 'left' pointer sits LEFT of the row-index
    // column (R1/R2/R3). Without this the pointer's arrow label overlaps
    // whichever header is adjacent to the targeted cell.
    const showRow = target.gridShowRowIndices ?? true;
    const showCol = target.gridShowColIndices ?? true;
    const idxFontSize = target.gridIndexFontSize ?? 11;
    if (showCol) {
      indexSpaceTop = idxFontSize + 6;
    }
    if (showRow) {
      const rowLabels = target.gridRowLabels ?? [];
      const gRows = target.gridRows ?? 0;
      let longestRow = String(Math.max(0, gRows - 1)).length;
      for (const lbl of rowLabels) {
        if (lbl && lbl.length > longestRow) longestRow = lbl.length;
      }
      indexSpaceLeft = Math.max(20, Math.floor(longestRow * idxFontSize * 0.6) + 12);
    }
  } else if (
    target.kind === 'algo-tree' &&
    pointer.pointerTreeNodeId !== undefined &&
    pointer.pointerTreeNodeId !== ''
  ) {
    // Tree pointer: anchor to the specific tree node by ID. The fitted
    // layout has world-space positions for each tree node, so we just
    // wrap the circle in a square rect for the anchor calculation.
    const fitted = getFittedTreeLayout(target);
    const pos = fitted.positions.get(pointer.pointerTreeNodeId);
    if (pos) {
      const r = fitted.scaledRadius;
      rect = { x: pos.x - r, y: pos.y - r, w: r * 2, h: r * 2 };
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
  } else if (
    target.kind === 'algo-linked-list' &&
    normalizeLinkedListNext(pointer.pointerLinkedListNodeId) !== undefined
  ) {
    // Linked-list pointer: anchor to the specific list node by ID. The
    // fitted layout walks `next` from the head, so the position is always
    // current — even if the chain has been rewired since the last step.
    // We normalize "null"/"" to undefined so pointers with no current
    // target (e.g. prev=null at the start of reversal) fall through to
    // the bounding-box fallback rather than trying to look up a
    // non-existent node.
    const ptrNodeId = normalizeLinkedListNext(pointer.pointerLinkedListNodeId)!;
    const fitted = getFittedLinkedListLayout(target);
    const pos = fitted.positions.get(ptrNodeId);
    if (pos) {
      rect = { x: pos.x, y: pos.y, w: fitted.cellW, h: fitted.cellH };
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
  } else if (
    target.kind === 'algo-graph' &&
    pointer.pointerGraphNodeId !== undefined &&
    pointer.pointerGraphNodeId !== ''
  ) {
    const fitted = getFittedGraphLayout(target);
    const pos = fitted.positions.get(pointer.pointerGraphNodeId);
    if (pos) {
      const r = fitted.scaledRadius;
      rect = { x: pos.x - r, y: pos.y - r, w: r * 2, h: r * 2 };
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
  } else if (
    target.kind === 'algo-chart' &&
    pointer.pointerChartBarId !== undefined &&
    pointer.pointerChartBarId !== ''
  ) {
    // Chart pointer: anchor to the specific bar by ID.
    const fitted = getFittedChartLayout(target);
    const found = fitted.bars.find((bl) => bl.bar.id === pointer.pointerChartBarId);
    if (found) {
      rect = { x: found.x, y: found.y, w: found.w, h: found.h };
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
  } else if (
    target.kind === 'algo-chart-line' &&
    pointer.pointerChartSeriesId !== undefined &&
    pointer.pointerChartSeriesId !== '' &&
    pointer.pointerChartPointIndex !== undefined
  ) {
    // Line chart pointer: anchor to a specific point on a specific series.
    const series = target.chartSeries ?? [];
    const s = series.find((ss) => ss.id === pointer.pointerChartSeriesId);
    const idx = Math.floor(pointer.pointerChartPointIndex);
    if (s && s.points && idx >= 0 && idx < s.points.length) {
      const allX: number[] = [];
      const allY: number[] = [];
      for (const ss of series) {
        for (const pp of ss.points ?? []) {
          if (typeof pp.x === 'number') allX.push(pp.x);
          if (typeof pp.y === 'number') allY.push(pp.y);
        }
      }
      const axis = getChartAxisLayout(target, allX, allY);
      const { px, py } = axis.toPx(s.points[idx].x, s.points[idx].y);
      const r = 8;
      rect = { x: px - r, y: py - r, w: r * 2, h: r * 2 };
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
  } else if (
    target.kind === 'algo-chart-scatter' &&
    pointer.pointerChartPointId !== undefined &&
    pointer.pointerChartPointId !== ''
  ) {
    // Scatter pointer: anchor to a specific point by ID.
    const points = target.chartPoints ?? [];
    const p = points.find((pp) => pp.id === pointer.pointerChartPointId);
    if (p) {
      const allX = points.map((pp) => pp.x);
      const allY = points.map((pp) => pp.y);
      const axis = getChartAxisLayout(target, allX, allY);
      const { px, py } = axis.toPx(p.x, p.y);
      const r = (p.size ?? 5) + 3;
      rect = { x: px - r, y: py - r, w: r * 2, h: r * 2 };
    } else {
      rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    }
  } else {
    rect = { x: target.x, y: target.y, w: target.w, h: target.h };
  }

  // Compute the un-scaled anchor point on the cell rect.
  let unscaled: Vec2;
  switch (side) {
    case 'top':
      unscaled = { x: rect.x + rect.w / 2, y: rect.y - indexSpaceTop };
      break;
    case 'bottom':
      unscaled = { x: rect.x + rect.w / 2, y: rect.y + rect.h + indexSpaceBottom };
      break;
    case 'left':
      unscaled = { x: rect.x - indexSpaceLeft, y: rect.y + rect.h / 2 };
      break;
    case 'right':
      unscaled = { x: rect.x + rect.w + indexSpaceRight, y: rect.y + rect.h / 2 };
      break;
  }

  // If the target node has its own scale/rotation transform (e.g. an "accent
  // pulse" transformTween animating scaleX/scaleY), the cells are visually
  // moved by that transform. Apply the same transform to the anchor so the
  // pointer tracks the visually-displaced cells instead of the un-scaled
  // logical position.
  const transformed = pointWithNodeTransform(target, unscaled);
  return { x: transformed.x, y: transformed.y, side };
}

/**
 * Render an algo-pointer node. Looks up the target node from `allNodes`
 * and draws an arrow + label pointing at it. If the target is missing,
 * falls back to drawing at the pointer's own (x, y).
 *
 * For grid targets, ALSO draws a colored border on the targeted cell so
 * the user can see exactly which cell is selected — the arrow alone is
 * ambiguous in stacked-cell layouts because it visually sits in the
 * adjacent cell.
 */
export function drawAlgoPointer(
  ctx: CanvasRenderingContext2D,
  n: NodeModel,
  allNodes: readonly NodeModel[]
): void {
  if (n.kind !== 'algo-pointer') return;

  const label = n.pointerLabel || '';
  const color = n.pointerColor || '#f59e0b';
  // Treat 0 / undefined as "use default" — AI sometimes emits 0 as a defensive
  // default for every property, which would render the arrow invisible.
  const offset = n.pointerOffset && n.pointerOffset > 0 ? n.pointerOffset : 18;
  const arrowSize = n.pointerArrowSize && n.pointerArrowSize > 0 ? n.pointerArrowSize : 10;
  const fontSize = n.labelFontSize || 14;
  const fontFamily = n.labelFontFamily || 'system-ui';

  // Helper: stroke a rect through the target node's transform (so the border
  // tracks the scaled/rotated cell instead of sitting in un-scaled space).
  const strokeTransformedRect = (
    target: NodeModel,
    cellX: number, cellY: number, cellW: number, cellH: number
  ) => {
    ctx.save();
    // Apply the same transform as canvas-render.ts uses for the target node.
    const hasTransform =
      (target.scaleX !== undefined && target.scaleX !== 1) ||
      (target.scaleY !== undefined && target.scaleY !== 1) ||
      (target.rotationZ !== undefined && target.rotationZ !== 0) ||
      (target.rotation !== undefined && target.rotation !== 0);
    if (hasTransform) {
      const pivotX = target.x + (target.pivotX ?? 0.5) * target.w;
      const pivotY = target.y + (target.pivotY ?? 0.5) * target.h;
      ctx.translate(pivotX, pivotY);
      const rotZ = (target.rotationZ ?? 0) + (target.rotation ?? 0);
      if (rotZ !== 0) ctx.rotate((rotZ * Math.PI) / 180);
      ctx.scale(target.scaleX ?? 1, target.scaleY ?? 1);
      ctx.translate(-pivotX, -pivotY);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(cellX + 1, cellY + 1, cellW - 2, cellH - 2);
    ctx.restore();
  };

  // If targeting a grid cell, draw a highlight border on that cell first
  // so the arrow + label render on top of it.
  if (n.pointerTargetId && n.pointerTargetRow !== undefined && n.pointerTargetCol !== undefined) {
    const target = allNodes.find((nn) => nn.id === n.pointerTargetId);
    if (target?.kind === 'algo-grid') {
      const cellRect = getAlgoGridCellRect(target, n.pointerTargetRow, n.pointerTargetCol);
      if (cellRect) {
        strokeTransformedRect(target, cellRect.x, cellRect.y, cellRect.w, cellRect.h);
      }
    }
  }

  // Same for algo-array cells: highlight the targeted cell with a colored
  // border so it's unambiguous which cell the pointer is at. Use the
  // FRACTIONAL index so the border slides smoothly with the pointer
  // animation between snapshots (don't floor — that would snap).
  if (n.pointerTargetId && n.pointerTargetIndex !== undefined && n.pointerTargetIndex !== null) {
    const target = allNodes.find((nn) => nn.id === n.pointerTargetId);
    if (target?.kind === 'algo-array') {
      const cellRect = getAlgoArrayCellRect(target, n.pointerTargetIndex);
      if (cellRect) {
        strokeTransformedRect(target, cellRect.x, cellRect.y, cellRect.w, cellRect.h);
      }
    }
  }

  const anchor = getAlgoPointerAnchor(n, allNodes);

  // Resolve tip + direction
  let tipX: number;
  let tipY: number;
  let side: 'top' | 'bottom' | 'left' | 'right';
  if (anchor) {
    tipX = anchor.x;
    tipY = anchor.y;
    side = anchor.side;
  } else {
    // Untethered fallback: draw at the node's own position pointing down
    tipX = n.x + n.w / 2;
    tipY = n.y + n.h;
    side = 'top';
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  const showArrow = n.pointerShowArrow !== false;

  // Arrow triangle (tip touches anchor, base offset away from target).
  // When showArrow is false, skip the triangle and place the label closer
  // to the target (just outside the cell edge).
  switch (side) {
    case 'top': {
      const baseY = showArrow ? tipY - offset : tipY - 2;
      if (showArrow) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY); // tip
        ctx.lineTo(tipX - arrowSize, baseY);
        ctx.lineTo(tipX + arrowSize, baseY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.font = `700 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      if (label) ctx.fillText(label, tipX, baseY - 2);
      break;
    }
    case 'bottom': {
      const baseY = showArrow ? tipY + offset : tipY + 2;
      if (showArrow) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - arrowSize, baseY);
        ctx.lineTo(tipX + arrowSize, baseY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.font = `700 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (label) ctx.fillText(label, tipX, baseY + 2);
      break;
    }
    case 'left': {
      const baseX = showArrow ? tipX - offset : tipX - 2;
      if (showArrow) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX, tipY - arrowSize);
        ctx.lineTo(baseX, tipY + arrowSize);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.font = `700 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      if (label) ctx.fillText(label, baseX - 4, tipY);
      break;
    }
    case 'right': {
      const baseX = showArrow ? tipX + offset : tipX + 2;
      if (showArrow) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX, tipY - arrowSize);
        ctx.lineTo(baseX, tipY + arrowSize);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.font = `700 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (label) ctx.fillText(label, baseX + 4, tipY);
      break;
    }
  }

  ctx.restore();
}

/**
 * Find the algo-grid (and row/col within it) at a given world point. Used for
 * the drag-pointer-onto-grid gesture.
 */
export function findAlgoGridCellAt(
  worldX: number,
  worldY: number,
  allNodes: readonly NodeModel[]
): { grid: NodeModel; row: number; col: number } | null {
  const grids = allNodes
    .filter((n) => n.kind === 'algo-grid' && (n.gridValues || []).length > 0)
    .slice()
    .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

  for (const grid of grids) {
    if (
      worldX < grid.x ||
      worldY < grid.y ||
      worldX > grid.x + grid.w ||
      worldY > grid.y + grid.h
    ) {
      continue;
    }
    const sizes = getEffectiveGridCellSize(grid);
    if (!sizes) continue;
    const rows = grid.gridRows ?? (grid.gridValues || []).length;
    const cols =
      grid.gridCols ?? ((grid.gridValues || [])[0] || []).length;
    // Project (subtract index gutters first), then clamp
    const relX = worldX - grid.x - sizes.rowIndexSpace;
    const relY = worldY - grid.y - sizes.colIndexSpace;
    let row = Math.floor(relY / sizes.cellH);
    let col = Math.floor(relX / sizes.cellW);
    row = Math.max(0, Math.min(rows - 1, row));
    col = Math.max(0, Math.min(cols - 1, col));
    return { grid, row, col };
  }
  return null;
}

/**
 * Project a world point onto a specific algo-grid, returning the closest cell.
 * Always returns a valid (clamped) row/col — used during drag when the cursor
 * may have wandered outside the grid bounds but is still semantically over it.
 */
export function projectPointToAlgoGridCell(
  worldX: number,
  worldY: number,
  grid: NodeModel
): { row: number; col: number } | null {
  if (grid.kind !== 'algo-grid') return null;
  const sizes = getEffectiveGridCellSize(grid);
  if (!sizes) return null;
  const rows = grid.gridRows ?? (grid.gridValues || []).length;
  const cols = grid.gridCols ?? ((grid.gridValues || [])[0] || []).length;
  if (rows <= 0 || cols <= 0) return null;
  const relX = worldX - grid.x - sizes.rowIndexSpace;
  const relY = worldY - grid.y - sizes.colIndexSpace;
  let row = Math.floor(relY / sizes.cellH);
  let col = Math.floor(relX / sizes.cellW);
  row = Math.max(0, Math.min(rows - 1, row));
  col = Math.max(0, Math.min(cols - 1, col));
  return { row, col };
}

/**
 * Project a world point onto a specific algo-array, returning the cell index
 * the point most closely corresponds to. Used during drag when the cursor may
 * be outside the array bounding box (e.g. hovering above the cells where the
 * pointer label sits).
 *
 * For horizontal arrays, only the X coordinate matters; for vertical arrays,
 * only Y. The result is always clamped to a valid cell index.
 */
export function projectPointToAlgoArrayCell(
  worldX: number,
  worldY: number,
  array: NodeModel
): number | null {
  if (array.kind !== 'algo-array') return null;
  const sizes = getEffectiveCellSize(array);
  if (!sizes) return null;
  const values = array.cellValues || [];
  if (values.length === 0) return null;
  const orientation = array.cellOrientation ?? 'horizontal';
  const gap = array.cellGap ?? 0;
  if (orientation === 'horizontal') {
    const rel = worldX - array.x;
    const stride = sizes.cellW + gap;
    const idx = Math.floor(rel / stride);
    return Math.max(0, Math.min(values.length - 1, idx));
  } else {
    const rel = worldY - array.y;
    const stride = sizes.cellH + gap;
    const idx = Math.floor(rel / stride);
    return Math.max(0, Math.min(values.length - 1, idx));
  }
}

/**
 * Find the algo-array (and cell index within it) at a given world point.
 * Returns null if no algo-array contains the point.
 *
 * Used for the drag-pointer-onto-array gesture: while dragging an
 * algo-pointer, we look up which cell the cursor is over and update
 * pointerTargetIndex (and possibly pointerTargetId) instead of the
 * pointer's own x/y.
 */
export function findAlgoArrayCellAt(
  worldX: number,
  worldY: number,
  allNodes: readonly NodeModel[]
): { array: NodeModel; index: number } | null {
  // Iterate in reverse zIndex order so top-most arrays win
  const arrays = allNodes
    .filter((n) => n.kind === 'algo-array' && (n.cellValues || []).length > 0)
    .slice()
    .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

  for (const array of arrays) {
    // Quick reject: outside bounding box
    if (
      worldX < array.x ||
      worldY < array.y ||
      worldX > array.x + array.w ||
      worldY > array.y + array.h
    ) {
      continue;
    }
    const sizes = getEffectiveCellSize(array);
    if (!sizes) continue;
    const values = array.cellValues || [];
    const orientation = array.cellOrientation ?? 'horizontal';
    const gap = array.cellGap ?? 0;

    // Find which cell contains the point
    for (let i = 0; i < values.length; i++) {
      let cellX: number;
      let cellY: number;
      if (orientation === 'horizontal') {
        cellX = array.x + i * (sizes.cellW + gap);
        cellY = array.y;
      } else {
        cellX = array.x;
        cellY = array.y + i * (sizes.cellH + gap);
      }
      if (
        worldX >= cellX &&
        worldX <= cellX + sizes.cellW &&
        worldY >= cellY &&
        worldY <= cellY + sizes.cellH
      ) {
        return { array, index: i };
      }
    }
    // Inside the array's bounding box but not on a cell — clamp to nearest cell index
    if (orientation === 'horizontal') {
      const rel = worldX - array.x;
      const idx = Math.max(0, Math.min(values.length - 1, Math.floor(rel / (sizes.cellW + gap))));
      return { array, index: idx };
    } else {
      const rel = worldY - array.y;
      const idx = Math.max(0, Math.min(values.length - 1, Math.floor(rel / (sizes.cellH + gap))));
      return { array, index: idx };
    }
  }
  return null;
}

// ============================================================================
// algo-grid: 2D table of cells
// ============================================================================

/**
 * Compute the effective cell width / height for an algo-grid node, derived
 * from the node's bounding box. The bounding box is the source of truth so
 * resizing the node scales the cells.
 */
export function getEffectiveGridCellSize(
  gridNode: NodeModel
): { cellW: number; cellH: number; rowIndexSpace: number; colIndexSpace: number } | null {
  if (gridNode.kind !== 'algo-grid') return null;
  const rows = gridNode.gridRows ?? (gridNode.gridValues || []).length;
  const cols =
    gridNode.gridCols ?? (gridNode.gridValues && gridNode.gridValues[0] ? gridNode.gridValues[0].length : 0);
  if (rows <= 0 || cols <= 0) return null;

  const showRow = gridNode.gridShowRowIndices ?? true;
  const showCol = gridNode.gridShowColIndices ?? true;
  const idxFontSize = gridNode.gridIndexFontSize ?? 11;
  // Estimate label space based on the longest custom label, falling back to a
  // sensible default for numeric indices. Width estimate uses ~0.6em per char
  // — close enough without measuring text.
  const estimateLabelWidth = (labels: string[] | undefined, fallbackMaxIndex: number): number => {
    let longest = String(fallbackMaxIndex).length;
    if (labels) {
      for (const l of labels) {
        if (l && l.length > longest) longest = l.length;
      }
    }
    return Math.ceil(longest * idxFontSize * 0.6) + 12;
  };
  const rowIndexSpace = showRow
    ? Math.max(20, estimateLabelWidth(gridNode.gridRowLabels, rows - 1))
    : 0;
  // Column labels are above each cell, so they only need vertical room — width
  // scaling is handled by cellW. But if the longest col label is wider than a
  // single cell, we'd want extra horizontal padding (the cells stay the same size).
  const colIndexSpace = showCol ? idxFontSize + 6 : 0;

  const cellW = Math.max(4, (gridNode.w - rowIndexSpace) / cols);
  const cellH = Math.max(4, (gridNode.h - colIndexSpace) / rows);
  return { cellW, cellH, rowIndexSpace, colIndexSpace };
}

/**
 * World-space rectangle for cell (row, col) in an algo-grid. Supports
 * fractional row/col for smooth pointer animations.
 */
export function getAlgoGridCellRect(
  gridNode: NodeModel,
  row: number,
  col: number
): { x: number; y: number; w: number; h: number } | null {
  const sizes = getEffectiveGridCellSize(gridNode);
  if (!sizes) return null;
  const rows = gridNode.gridRows ?? (gridNode.gridValues || []).length;
  const cols =
    gridNode.gridCols ?? (gridNode.gridValues && gridNode.gridValues[0] ? gridNode.gridValues[0].length : 0);
  const cr = Math.max(0, Math.min(rows - 1, row));
  const cc = Math.max(0, Math.min(cols - 1, col));
  return {
    x: gridNode.x + sizes.rowIndexSpace + cc * sizes.cellW,
    y: gridNode.y + sizes.colIndexSpace + cr * sizes.cellH,
    w: sizes.cellW,
    h: sizes.cellH,
  };
}

/**
 * Render an algo-grid node directly to a canvas context.
 */
export function drawAlgoGrid(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-grid') return;
  const values = n.gridValues || [];
  const rows = n.gridRows ?? values.length;
  const cols = n.gridCols ?? (values[0] ? values[0].length : 0);
  if (rows <= 0 || cols <= 0) return;

  const sizes = getEffectiveGridCellSize(n);
  if (!sizes) return;
  const { cellW, cellH, rowIndexSpace, colIndexSpace } = sizes;

  const fillColor = n.fill || '#1e293b';
  const strokeColor = n.stroke || '#94a3b8';
  const strokeWidth = n.strokeWidth ?? 1;
  const textColor = n.labelColor || '#e6edf3';
  const indexColor = n.gridIndexColor || textColor;
  const cellColor = n.gridCellColor || textColor;
  const fontFamily = n.labelFontFamily || 'system-ui';
  const cellFontSize = n.gridCellFontSize ?? 14;
  const indexFontSize = n.gridIndexFontSize ?? 11;
  const showRow = n.gridShowRowIndices ?? true;
  const showCol = n.gridShowColIndices ?? true;
  const colors = n.gridColors || [];
  const rowLabels = n.gridRowLabels || [];
  const colLabels = n.gridColLabels || [];

  // Heatmap mode: auto-compute cell fill from numeric gridValues via a colormap.
  // Explicit gridColors entries still win (useful for highlighting a cell).
  const colormap = n.gridColormap;
  let cmMin = n.gridMinValue;
  let cmMax = n.gridMaxValue;
  if (colormap) {
    const numericVals: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = values[r] && values[r][c];
        if (v !== undefined) {
          const num = typeof v === 'number' ? v : Number(v);
          if (!Number.isNaN(num)) numericVals.push(num);
        }
      }
    }
    if (cmMin === undefined) cmMin = numericVals.length ? Math.min(...numericVals) : 0;
    if (cmMax === undefined) cmMax = numericVals.length ? Math.max(...numericVals) : 1;
    if (cmMax <= cmMin) cmMax = cmMin + 1;
  }

  ctx.save();

  // Cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = n.x + rowIndexSpace + c * cellW;
      const cy = n.y + colIndexSpace + r * cellH;

      let cellFill: string = fillColor;
      if (colors[r] && colors[r][c]) {
        cellFill = colors[r][c]!;
      } else if (colormap && values[r] && values[r][c] !== undefined) {
        const raw = values[r][c];
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isNaN(num)) {
          const t = (num - (cmMin as number)) / ((cmMax as number) - (cmMin as number));
          cellFill = colormapValue(colormap, t);
        }
      }
      ctx.fillStyle = cellFill;
      ctx.fillRect(cx, cy, cellW, cellH);

      if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none') {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = strokeColor;
        ctx.strokeRect(cx, cy, cellW, cellH);
      }

      // Cell value text
      const text = values[r] && values[r][c];
      if (text) {
        ctx.fillStyle = cellColor;
        ctx.font = `600 ${cellFontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(text), cx + cellW / 2, cy + cellH / 2);
      }
    }
  }

  // Column index labels (top)
  if (showCol) {
    ctx.fillStyle = indexColor;
    ctx.font = `400 ${indexFontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < cols; c++) {
      const cx = n.x + rowIndexSpace + c * cellW + cellW / 2;
      const cy = n.y + colIndexSpace / 2;
      const label = colLabels[c] || String(c);
      ctx.fillText(label, cx, cy);
    }
  }

  // Row index labels (left)
  if (showRow) {
    ctx.fillStyle = indexColor;
    ctx.font = `400 ${indexFontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      const cx = n.x + rowIndexSpace / 2;
      const cy = n.y + colIndexSpace + r * cellH + cellH / 2;
      const label = rowLabels[r] || String(r);
      ctx.fillText(label, cx, cy);
    }
  }

  // Optional outer label
  if (n.label) {
    const labelSize = n.labelFontSize || 13;
    ctx.fillStyle = textColor;
    ctx.font = `600 ${labelSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }

  ctx.restore();
}

// ============================================================================
// algo-variable: small labeled value box
// ============================================================================

/**
 * Render an algo-variable node directly to a canvas context.
 * Renders a rounded rect with "name: value" or stacked layout.
 */
export function drawAlgoVariable(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-variable') return;
  const name = n.varName || '';
  const value = n.varValue || '';
  const fontFamily = n.labelFontFamily || 'system-ui';
  const fontSize = n.labelFontSize || 14;
  const fillColor = n.fill || '#0f172a';
  const strokeColor = n.stroke || '#475569';
  const strokeWidth = n.strokeWidth ?? 1;
  const nameColor = n.varNameColor || n.labelColor || '#94a3b8';
  const valueColor = n.varColor || n.labelColor || '#e6edf3';
  const orientation = n.varOrientation ?? 'horizontal';
  const cornerRadius = Math.min(8, n.w / 4, n.h / 4);

  ctx.save();

  // Background
  ctx.beginPath();
  if (cornerRadius > 0) {
    const r = cornerRadius;
    ctx.moveTo(n.x + r, n.y);
    ctx.lineTo(n.x + n.w - r, n.y);
    ctx.quadraticCurveTo(n.x + n.w, n.y, n.x + n.w, n.y + r);
    ctx.lineTo(n.x + n.w, n.y + n.h - r);
    ctx.quadraticCurveTo(n.x + n.w, n.y + n.h, n.x + n.w - r, n.y + n.h);
    ctx.lineTo(n.x + r, n.y + n.h);
    ctx.quadraticCurveTo(n.x, n.y + n.h, n.x, n.y + n.h - r);
    ctx.lineTo(n.x, n.y + r);
    ctx.quadraticCurveTo(n.x, n.y, n.x + r, n.y);
  } else {
    ctx.rect(n.x, n.y, n.w, n.h);
  }
  ctx.closePath();
  if (fillColor && fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none') {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }

  // Text
  if (orientation === 'horizontal') {
    // "name: value" — name in muted color on the left, value in accent on the right
    const padding = 8;
    ctx.font = `500 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textBaseline = 'middle';
    const cy = n.y + n.h / 2;
    if (name) {
      ctx.fillStyle = nameColor;
      ctx.textAlign = 'left';
      ctx.fillText(`${name} =`, n.x + padding, cy);
    }
    if (value) {
      ctx.fillStyle = valueColor;
      ctx.textAlign = 'right';
      ctx.font = `700 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.fillText(value, n.x + n.w - padding, cy);
    }
  } else {
    // Stacked: name on top, value below
    const cx = n.x + n.w / 2;
    const nameY = n.y + n.h * 0.35;
    const valueY = n.y + n.h * 0.7;
    if (name) {
      ctx.fillStyle = nameColor;
      ctx.font = `500 ${Math.max(10, fontSize - 2)}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, cx, nameY);
    }
    if (value) {
      ctx.fillStyle = valueColor;
      ctx.font = `700 ${fontSize + 2}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(value, cx, valueY);
    }
  }

  ctx.restore();
}

/**
 * Sync an algo-pointer node's (x, y, w, h) bounds to follow its target.
 * This keeps hit-testing and selection bounds aligned with the rendered
 * arrow position even though rendering is derived from the target.
 *
 * Returns a partial NodeModel with updated bounds, or null if no target.
 */
export function getAlgoPointerBounds(
  pointer: NodeModel,
  allNodes: readonly NodeModel[]
): { x: number; y: number; w: number; h: number } | null {
  const anchor = getAlgoPointerAnchor(pointer, allNodes);
  if (!anchor) return null;

  // Same "0 = use default" fallback as drawAlgoPointer — keeps the bounds in
  // sync with the rendered glyph when the AI emits zeros defensively.
  const offset = pointer.pointerOffset && pointer.pointerOffset > 0 ? pointer.pointerOffset : 18;
  const arrowSize = pointer.pointerArrowSize && pointer.pointerArrowSize > 0 ? pointer.pointerArrowSize : 10;
  const labelExtent = (pointer.labelFontSize || 14) + 4;
  // When the arrow is hidden, the bounds shrink to just the label (positioned
  // at offset 2 from the cell edge, matching drawAlgoPointer's `tipY - 2`).
  const showArrow = pointer.pointerShowArrow !== false;
  const effectiveOffset = showArrow ? offset : 2;
  const effectiveArrowSize = showArrow ? arrowSize : Math.max(8, (pointer.pointerLabel || '').length * 5);

  switch (anchor.side) {
    case 'top':
      return {
        x: anchor.x - effectiveArrowSize,
        y: anchor.y - effectiveOffset - labelExtent,
        w: effectiveArrowSize * 2,
        h: effectiveOffset + labelExtent,
      };
    case 'bottom':
      return {
        x: anchor.x - effectiveArrowSize,
        y: anchor.y,
        w: effectiveArrowSize * 2,
        h: effectiveOffset + labelExtent,
      };
    case 'left':
      return {
        x: anchor.x - effectiveOffset - labelExtent,
        y: anchor.y - effectiveArrowSize,
        w: effectiveOffset + labelExtent,
        h: effectiveArrowSize * 2,
      };
    case 'right':
      return {
        x: anchor.x,
        y: anchor.y - effectiveArrowSize,
        w: effectiveOffset + labelExtent,
        h: effectiveArrowSize * 2,
      };
  }
}

// =====================================================================
// algo-tree primitive
// =====================================================================

/**
 * Get all child slot IDs of a tree node, INCLUDING phantom slots (empty
 * strings). Used by the layout algorithm to compute slot positions.
 */
function getChildSlots(node: TreeNode): string[] {
  return node.children ?? [];
}

/**
 * Get only the REAL child IDs of a tree node (filters out phantom slots).
 * Used for traversal, drawing edges, and cycle/descendant computation.
 */
function getChildIds(node: TreeNode): string[] {
  return (node.children ?? []).filter((c) => c && c !== '');
}

/**
 * Find the implicit root: the first node in the array that is not referenced
 * as anyone's child. Returns undefined for an empty/cyclic tree.
 */
function findRoot(nodes: TreeNode[]): TreeNode | undefined {
  if (nodes.length === 0) return undefined;
  const childIds = new Set<string>();
  for (const n of nodes) {
    for (const c of getChildIds(n)) childIds.add(c);
  }
  return nodes.find((n) => !childIds.has(n.id)) ?? nodes[0];
}

/**
 * Compute layout positions for an algo-tree node. Returns a map from
 * nodeId → { x, y } in WORLD coordinates (relative to the tree node's x/y).
 *
 * Algorithm: a simple recursive layout that handles n-ary trees. Each subtree
 * gets a "logical width" measured in slot-equivalents; the renderer multiplies
 * this by `nodeSpacing` for actual horizontal spacing. Nodes at the same depth
 * share the same y.
 *
 * **Phantom slots:** entries in `children` that are empty strings (`""`) are
 * "phantom" slots that reserve layout space (1 unit each) but aren't drawn or
 * recursed into. This is how binary trees express "left only" or "right only"
 * children — `children: ["leftId", ""]` puts the real child on the left with
 * a reserved (empty) right slot, so the parent sits visually centered over
 * the [real, phantom] pair instead of directly above the lone child.
 */
export function computeTreeLayout(
  treeNode: NodeModel
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (treeNode.kind !== 'algo-tree') return out;
  const nodes = treeNode.treeNodes ?? [];
  if (nodes.length === 0) return out;

  const radius = treeNode.nodeRadius ?? 24;
  const spacing = treeNode.nodeSpacing ?? 60;
  const levelH = treeNode.levelHeight ?? 80;

  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, n);

  const root = findRoot(nodes);
  if (!root) return out;

  // Compute logical width (in slot-equivalents) for each subtree.
  // A leaf or phantom slot has width 1; an internal node has width = sum of
  // its slot widths (real children recurse, phantoms count as 1 each).
  const widthCache = new Map<string, number>();
  const computeWidth = (id: string, visited: Set<string>): number => {
    if (visited.has(id)) return 1; // cycle guard
    visited.add(id);
    if (widthCache.has(id)) return widthCache.get(id)!;
    const node = byId.get(id);
    if (!node) return 1;
    const slots = getChildSlots(node);
    if (slots.length === 0) {
      widthCache.set(id, 1);
      return 1;
    }
    let total = 0;
    for (const slot of slots) {
      if (slot === '' || !byId.has(slot)) {
        total += 1; // phantom slot
      } else {
        total += computeWidth(slot, visited);
      }
    }
    const w = Math.max(1, total);
    widthCache.set(id, w);
    return w;
  };

  // Recursively assign x positions starting from a left edge offset.
  // Each node sits at the horizontal center of its slots (real + phantom).
  const assign = (id: string, leftEdge: number, depth: number, visited: Set<string>) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    const slots = getChildSlots(node);

    if (slots.length === 0) {
      out.set(id, { x: leftEdge + 0.5 * spacing, y: depth * levelH });
      return;
    }

    // Walk slots in order, allocating horizontal space for each.
    // Real slots recurse and contribute their x position to the parent's
    // centering. Phantom slots just consume 1 unit of width so the
    // remaining real children stay positioned correctly.
    let cursor = leftEdge;
    const slotCenters: number[] = [];
    for (const slot of slots) {
      if (slot === '' || !byId.has(slot)) {
        // Phantom: occupy 1 unit centered at cursor + 0.5
        slotCenters.push(cursor + 0.5 * spacing);
        cursor += 1 * spacing;
      } else {
        const cw = computeWidth(slot, new Set());
        assign(slot, cursor, depth + 1, visited);
        const placed = out.get(slot);
        if (placed) slotCenters.push(placed.x);
        cursor += cw * spacing;
      }
    }
    // Center this node over the leftmost-to-rightmost slot centers
    const xMin = Math.min(...slotCenters);
    const xMax = Math.max(...slotCenters);
    out.set(id, { x: (xMin + xMax) / 2, y: depth * levelH });
  };

  computeWidth(root.id, new Set());
  assign(root.id, 0, 0, new Set());

  // Translate so the layout starts at (radius + padding, radius + padding)
  // within the tree node's bounding box. This way (0,0) of the layout maps
  // to a sensible top-left after adding tree.x/tree.y.
  let minX = Infinity;
  let minY = Infinity;
  out.forEach((pos) => {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
  });
  const padding = radius + 8;
  const ids = Array.from(out.keys());
  for (const id of ids) {
    const pos = out.get(id)!;
    out.set(id, {
      x: pos.x - minX + padding,
      y: pos.y - minY + padding,
    });
  }

  return out;
}

/**
 * Compute the natural bounding box of an algo-tree based on its layout.
 * Returns the {w, h} large enough to contain all nodes plus padding.
 */
export function getAlgoTreeNaturalSize(
  treeNode: NodeModel
): { w: number; h: number } {
  if (treeNode.kind !== 'algo-tree') return { w: 200, h: 200 };
  const positions = computeTreeLayout(treeNode);
  const radius = treeNode.nodeRadius ?? 24;
  if (positions.size === 0) return { w: 200, h: 200 };
  let maxX = 0;
  let maxY = 0;
  positions.forEach((pos) => {
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y > maxY) maxY = pos.y;
  });
  return {
    w: maxX + radius + 8,
    h: maxY + radius + 8,
  };
}

/**
 * Compute a "fitted" tree layout that scales the natural layout to fill
 * the tree node's bounding box (n.w × n.h). This is what makes dragging
 * the resize handles actually grow/shrink the tree.
 *
 * Returns:
 *   positions: layout positions in WORLD-relative coordinates (already
 *              translated to n.x/n.y), so the renderer just uses them
 *              directly without further offsetting.
 *   scaledRadius: the node radius after scaling
 *   scale: the uniform scale factor applied (useful for stroke-width,
 *          font-size, etc. that should also scale)
 *
 * Layout is uniformly scaled (preserves aspect ratio) and centered inside
 * the bounding box, so circles never become ellipses.
 */
export function getFittedTreeLayout(treeNode: NodeModel): {
  positions: Map<string, { x: number; y: number }>;
  scaledRadius: number;
  scale: number;
} {
  const empty = {
    positions: new Map<string, { x: number; y: number }>(),
    scaledRadius: 24,
    scale: 1,
  };
  if (treeNode.kind !== 'algo-tree') return empty;

  const natural = computeTreeLayout(treeNode);
  if (natural.size === 0) return empty;

  const baseRadius = treeNode.nodeRadius ?? 24;

  // Find natural extent (the layout already starts at radius+8 padding)
  let maxX = 0;
  let maxY = 0;
  natural.forEach((pos) => {
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y > maxY) maxY = pos.y;
  });
  const naturalW = maxX + baseRadius + 8;
  const naturalH = maxY + baseRadius + 8;

  // Uniform scale to fit the bounding box, with sensible fallbacks if
  // w/h are tiny or missing.
  const boxW = treeNode.w > 0 ? treeNode.w : naturalW;
  const boxH = treeNode.h > 0 ? treeNode.h : naturalH;
  const scale = Math.min(boxW / naturalW, boxH / naturalH);

  // Center the scaled layout inside the box
  const offsetX = (boxW - naturalW * scale) / 2;
  const offsetY = (boxH - naturalH * scale) / 2;

  const positions = new Map<string, { x: number; y: number }>();
  natural.forEach((pos, id) => {
    positions.set(id, {
      x: treeNode.x + offsetX + pos.x * scale,
      y: treeNode.y + offsetY + pos.y * scale,
    });
  });

  return {
    positions,
    scaledRadius: baseRadius * scale,
    scale,
  };
}

/**
 * Normalize `nodeColors` from either shape into a plain map keyed by nodeId.
 *
 * The renderer's natural shape is a map `{nodeId: color}`, but Gemini's strict
 * schema validator can't express arbitrary-key objects, so the AI emits an
 * array of `{nodeId, color}` pairs in the JSON. This helper accepts either
 * shape so the renderer doesn't care which form it received. Empty/missing
 * entries are normalized to `null`.
 */
export function normalizeNodeColors(
  raw: unknown
): { [nodeId: string]: string | null } {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: { [nodeId: string]: string | null } = {};
    for (const item of raw) {
      if (item && typeof item === 'object' && 'nodeId' in item) {
        const nodeId = (item as { nodeId?: string }).nodeId;
        const color = (item as { color?: string }).color;
        if (typeof nodeId === 'string') {
          out[nodeId] = color && color !== '' ? color : null;
        }
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    const src = raw as Record<string, unknown>;
    const out: { [nodeId: string]: string | null } = {};
    for (const k of Object.keys(src)) {
      const v = src[k];
      out[k] = typeof v === 'string' && v !== '' ? v : null;
    }
    return out;
  }
  return {};
}

/**
 * Render an algo-tree node directly to a canvas context.
 * Caller is responsible for ctx.save()/restore() if needed.
 */
export function drawAlgoTree(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-tree') return;
  const nodes = n.treeNodes ?? [];
  if (nodes.length === 0) return;

  const baseFontSize = n.nodeFontSize ?? 14;
  const fontFamily = n.fontFamily || 'system-ui';
  const fillColor = n.fill || '#1e293b';
  const strokeColor = n.treeNodeStrokeColor || n.stroke || '#94a3b8';
  const baseStrokeWidth = n.strokeWidth ?? 2;
  const textColor = n.labelColor || '#e6edf3';
  const edgeColor = n.treeEdgeColor || '#475569';
  const baseEdgeWidth = n.treeEdgeWidth ?? 2;
  const nodeColors = normalizeNodeColors(n.nodeColors);

  // Use the fitted layout so dragging the bounding box scales the tree.
  const fitted = getFittedTreeLayout(n);
  if (fitted.positions.size === 0) return;
  const radius = fitted.scaledRadius;
  const scale = fitted.scale;
  const fontSize = baseFontSize * scale;
  const strokeWidth = baseStrokeWidth * scale;
  const edgeWidth = baseEdgeWidth * scale;

  ctx.save();

  // Draw edges first so circles render on top
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = edgeWidth;
  ctx.lineCap = 'round';
  for (const tn of nodes) {
    const parentPos = fitted.positions.get(tn.id);
    if (!parentPos) continue;
    const childIds = getChildIds(tn);
    for (const cid of childIds) {
      const childPos = fitted.positions.get(cid);
      if (!childPos) continue;
      // Stop short of the node circles so the line doesn't enter them
      const dx = childPos.x - parentPos.x;
      const dy = childPos.y - parentPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;
      const ux = dx / dist;
      const uy = dy / dist;
      const startX = parentPos.x + ux * radius;
      const startY = parentPos.y + uy * radius;
      const endX = childPos.x - ux * radius;
      const endY = childPos.y - uy * radius;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  }

  // Draw nodes (circles + values) on top of edges
  for (const tn of nodes) {
    const pos = fitted.positions.get(tn.id);
    if (!pos) continue;
    const fill = nodeColors[tn.id] ?? fillColor;

    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, radius, radius, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none') {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }

    if (tn.value) {
      ctx.fillStyle = textColor;
      ctx.font = `600 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tn.value, pos.x, pos.y);
    }
  }

  // Optional outer label (e.g. variable name like "tree")
  if (n.label) {
    const labelSize = n.labelFontSize || 13;
    ctx.fillStyle = textColor;
    ctx.font = `600 ${labelSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }

  ctx.restore();
}

// =============================================================================
// algo-linked-list helpers and renderer
// =============================================================================

/**
 * Normalize a `next` value: treat empty/undefined and the literal strings
 * 'null'/'NULL'/'None'/'nil' as missing. The AI sometimes emits
 * `"next": "null"` (literal string) for the tail node instead of omitting
 * the field; without this, the renderer would treat "null" as a real node
 * ID, fail to find it, and skip the null terminator.
 */
function normalizeLinkedListNext(nxt: string | undefined): string | undefined {
  if (nxt === undefined || nxt === null) return undefined;
  if (typeof nxt !== 'string') return undefined;
  const s = nxt.trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'none' || lower === 'nil') return undefined;
  return s;
}

/**
 * The head is the first node not referenced by any other node's `next`.
 * During partial reversals there can be multiple "candidate heads" because
 * the chain has split temporarily; we pick the first one in declaration
 * order so the visual stays stable across snapshots.
 */
function findLinkedListHead(nodes: LinkedListNode[]): LinkedListNode | undefined {
  if (nodes.length === 0) return undefined;
  const referenced = new Set<string>();
  for (const n of nodes) {
    const nxt = normalizeLinkedListNext(n.next);
    if (nxt) referenced.add(nxt);
  }
  return nodes.find((n) => !referenced.has(n.id)) ?? nodes[0];
}

/**
 * Walk the chain from head following `next`, returning visit order.
 * Caps at len(nodes) iterations so cycles don't infinite-loop. If there
 * are orphan/fragment nodes (e.g. mid-reversal), they're appended in
 * declaration order so they still render somewhere instead of vanishing.
 */
function walkLinkedListChain(nodes: LinkedListNode[]): LinkedListNode[] {
  if (nodes.length === 0) return [];
  const byId = new Map<string, LinkedListNode>();
  for (const n of nodes) byId.set(n.id, n);
  const visited = new Set<string>();
  const out: LinkedListNode[] = [];
  const head = findLinkedListHead(nodes);
  if (head) {
    let cur: LinkedListNode | undefined = head;
    for (let i = 0; i < nodes.length && cur; i++) {
      if (visited.has(cur.id)) break;  // cycle detected
      visited.add(cur.id);
      out.push(cur);
      const nxt = normalizeLinkedListNext(cur.next);
      cur = nxt ? byId.get(nxt) : undefined;
    }
  }
  // Append orphans / fragment heads in declaration order
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      out.push(n);
      visited.add(n.id);
    }
  }
  return out;
}

/**
 * Compute the natural bounding box of an algo-linked-list based on its
 * declared cell dimensions, spacing, and node count. Used by the
 * properties panel to auto-resize when the user changes layout settings.
 */
export function getAlgoLinkedListNaturalSize(
  listNode: NodeModel
): { w: number; h: number } {
  if (listNode.kind !== 'algo-linked-list') return { w: 200, h: 80 };
  const nodes = listNode.linkedListNodes ?? [];
  if (nodes.length === 0) return { w: 200, h: 80 };
  const cellW = listNode.linkedListNodeWidth ?? 60;
  const cellH = listNode.linkedListNodeHeight ?? 50;
  const spacing = listNode.linkedListSpacing ?? 24;
  const showNull = listNode.linkedListShowNull !== false;
  const nullExtra = showNull ? 60 : 24;
  const orientation = listNode.linkedListOrientation ?? 'horizontal';
  if (orientation === 'vertical') {
    return {
      w: cellW + 16,
      h: nodes.length * cellH + Math.max(0, nodes.length - 1) * spacing + nullExtra,
    };
  }
  return {
    w: nodes.length * cellW + Math.max(0, nodes.length - 1) * spacing + nullExtra,
    h: cellH + 16,
  };
}

/**
 * Compute a "fitted" linked-list layout that scales the natural layout to
 * fill the node's bounding box. Mirrors `getFittedTreeLayout` for the
 * tree primitive — uniform scale, centered, returns world-space positions.
 *
 * Returns:
 *   positions: top-left of each node box, in WORLD-relative coordinates
 *   cellW / cellH: scaled box dimensions
 *   spacing: scaled gap
 *   scale: uniform scale factor (use for stroke/font scaling)
 *   chain: ordered LinkedListNode[] in visual chain order (head first)
 *   orientation: 'horizontal' | 'vertical'
 */
export function getFittedLinkedListLayout(listNode: NodeModel): {
  positions: Map<string, { x: number; y: number }>;
  cellW: number;
  cellH: number;
  spacing: number;
  scale: number;
  chain: LinkedListNode[];
  orientation: 'horizontal' | 'vertical';
} {
  const baseCellW = listNode.linkedListNodeWidth ?? 60;
  const baseCellH = listNode.linkedListNodeHeight ?? 50;
  const baseSpacing = listNode.linkedListSpacing ?? 24;
  const orientation: 'horizontal' | 'vertical' =
    listNode.linkedListOrientation === 'vertical' ? 'vertical' : 'horizontal';
  const showNull = listNode.linkedListShowNull !== false;

  const empty = {
    positions: new Map<string, { x: number; y: number }>(),
    cellW: baseCellW,
    cellH: baseCellH,
    spacing: baseSpacing,
    scale: 1,
    chain: [] as LinkedListNode[],
    orientation,
  };
  if (listNode.kind !== 'algo-linked-list') return empty;
  const nodes = listNode.linkedListNodes ?? [];
  if (nodes.length === 0) return empty;

  const chain = walkLinkedListChain(nodes);
  const nCount = chain.length;
  const nullExtra = showNull ? 60 : 24;

  let naturalW: number;
  let naturalH: number;
  if (orientation === 'vertical') {
    naturalW = baseCellW + 16;
    naturalH = nCount * baseCellH + Math.max(0, nCount - 1) * baseSpacing + nullExtra;
  } else {
    naturalW = nCount * baseCellW + Math.max(0, nCount - 1) * baseSpacing + nullExtra;
    naturalH = baseCellH + 16;
  }

  const boxW = listNode.w > 0 ? listNode.w : naturalW;
  const boxH = listNode.h > 0 ? listNode.h : naturalH;
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const safeScale = scale > 0 ? scale : 1;

  const cellW = baseCellW * safeScale;
  const cellH = baseCellH * safeScale;
  const spacing = baseSpacing * safeScale;

  let usedW: number;
  let usedH: number;
  if (orientation === 'vertical') {
    usedW = cellW + 16 * safeScale;
    usedH = nCount * cellH + Math.max(0, nCount - 1) * spacing + nullExtra * safeScale;
  } else {
    usedW = nCount * cellW + Math.max(0, nCount - 1) * spacing + nullExtra * safeScale;
    usedH = cellH + 16 * safeScale;
  }

  const offsetX = (boxW - usedW) / 2;
  const offsetY = (boxH - usedH) / 2;

  const positions = new Map<string, { x: number; y: number }>();
  chain.forEach((n, i) => {
    if (orientation === 'vertical') {
      positions.set(n.id, {
        x: listNode.x + offsetX + 8 * safeScale,
        y: listNode.y + offsetY + 8 * safeScale + i * (cellH + spacing),
      });
    } else {
      positions.set(n.id, {
        x: listNode.x + offsetX + 8 * safeScale + i * (cellW + spacing),
        y: listNode.y + offsetY + 8 * safeScale,
      });
    }
  });

  return { positions, cellW, cellH, spacing, scale: safeScale, chain, orientation };
}

/**
 * Render an algo-linked-list node directly to a canvas context.
 * Caller is responsible for ctx.save()/restore() if needed.
 */
export function drawAlgoLinkedList(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-linked-list') return;
  const nodes = n.linkedListNodes ?? [];
  if (nodes.length === 0) return;

  const baseFontSize = n.nodeFontSize ?? 14;
  const fontFamily = (n as { fontFamily?: string }).fontFamily || 'system-ui';
  const fillColor = n.fill || '#1e293b';
  const strokeColor = n.stroke || '#94a3b8';
  const baseStrokeWidth = n.strokeWidth ?? 2;
  const textColor = n.labelColor || '#e6edf3';
  const edgeColor = n.linkedListEdgeColor || '#475569';
  const nodeColors = normalizeNodeColors(n.nodeColors);
  const showNull = n.linkedListShowNull !== false;

  const fitted = getFittedLinkedListLayout(n);
  if (fitted.positions.size === 0) return;
  const { positions, cellW, cellH, spacing, scale, chain, orientation } = fitted;
  const fontSize = baseFontSize * scale;
  const strokeWidth = baseStrokeWidth * scale;
  const cornerRadius = 6 * scale;
  const arrowHead = 6 * scale;

  ctx.save();

  const drawArrow = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * arrowHead - px * arrowHead * 0.5, y2 - uy * arrowHead - py * arrowHead * 0.5);
    ctx.lineTo(x2 - ux * arrowHead + px * arrowHead * 0.5, y2 - uy * arrowHead + py * arrowHead * 0.5);
    ctx.closePath();
    ctx.fillStyle = edgeColor;
    ctx.fill();
  };

  // Draw `next` arrows first so the boxes render on top
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 2 * scale;
  ctx.lineCap = 'round';
  for (const ln of chain) {
    const nxtId = normalizeLinkedListNext(ln.next);
    if (!nxtId) continue;
    const src = positions.get(ln.id);
    const tgt = positions.get(nxtId);
    if (!src || !tgt) continue;
    let x1: number, y1: number, x2: number, y2: number;
    if (orientation === 'vertical') {
      x1 = src.x + cellW / 2;
      y1 = src.y + cellH;
      x2 = tgt.x + cellW / 2;
      y2 = tgt.y;
    } else {
      x1 = src.x + cellW;
      y1 = src.y + cellH / 2;
      x2 = tgt.x;
      y2 = tgt.y + cellH / 2;
    }
    drawArrow(x1, y1, x2, y2);
  }

  // Draw boxes (rounded rects with values) on top
  for (const ln of chain) {
    const pos = positions.get(ln.id);
    if (!pos) continue;
    const fill = nodeColors[ln.id] ?? fillColor;

    ctx.beginPath();
    ctx.roundRect(pos.x, pos.y, cellW, cellH, cornerRadius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none') {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }

    if (ln.value) {
      ctx.fillStyle = textColor;
      ctx.font = `600 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ln.value, pos.x + cellW / 2, pos.y + cellH / 2);
    }
  }

  // Null terminator after the actual tail (last node in chain whose `next` is empty)
  if (showNull && chain.length > 0) {
    let tail: LinkedListNode | undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (!normalizeLinkedListNext(chain[i].next)) {
        tail = chain[i];
        break;
      }
    }
    if (tail) {
      const tpos = positions.get(tail.id);
      if (tpos) {
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 2 * scale;
        let x1: number, y1: number, x2: number, y2: number;
        let nullX: number, nullY: number;
        let nullAlign: CanvasTextAlign;
        if (orientation === 'vertical') {
          x1 = tpos.x + cellW / 2;
          y1 = tpos.y + cellH;
          x2 = tpos.x + cellW / 2;
          y2 = tpos.y + cellH + 30 * scale;
          nullX = tpos.x + cellW / 2;
          nullY = y2 + 12 * scale;
          nullAlign = 'center';
        } else {
          x1 = tpos.x + cellW;
          y1 = tpos.y + cellH / 2;
          x2 = tpos.x + cellW + 30 * scale;
          y2 = tpos.y + cellH / 2;
          nullX = x2 + 6 * scale;
          nullY = tpos.y + cellH / 2;
          nullAlign = 'left';
        }
        drawArrow(x1, y1, x2, y2);
        ctx.fillStyle = edgeColor;
        ctx.font = `italic ${fontSize * 0.85}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = nullAlign;
        ctx.textBaseline = 'middle';
        ctx.fillText('null', nullX, nullY);
      }
    }
  }

  // Optional outer label
  if (n.label) {
    const labelSize = n.labelFontSize || 13;
    ctx.fillStyle = textColor;
    ctx.font = `600 ${labelSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }

  ctx.restore();
}

// =============================================================================
// algo-graph helpers and renderer
// =============================================================================

/**
 * Normalize `edgeColors` from either shape into a plain map keyed by edgeId.
 * Mirrors normalizeNodeColors but for graph edges.
 */
export function normalizeEdgeColors(
  raw: unknown
): { [edgeId: string]: string | null } {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: { [edgeId: string]: string | null } = {};
    for (const item of raw) {
      if (item && typeof item === 'object' && 'edgeId' in item) {
        const edgeId = (item as { edgeId?: string }).edgeId;
        const color = (item as { color?: string }).color;
        if (typeof edgeId === 'string') {
          out[edgeId] = color && color !== '' ? color : null;
        }
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    const src = raw as Record<string, unknown>;
    const out: { [edgeId: string]: string | null } = {};
    for (const k of Object.keys(src)) {
      const v = src[k];
      out[k] = typeof v === 'string' && v !== '' ? v : null;
    }
    return out;
  }
  return {};
}

export function getFittedGraphLayout(graphNode: NodeModel): {
  positions: Map<string, { x: number; y: number }>;
  scaledRadius: number;
  scale: number;
} {
  const baseRadius = graphNode.graphNodeRadius ?? 24;
  const empty = {
    positions: new Map<string, { x: number; y: number }>(),
    scaledRadius: baseRadius,
    scale: 1,
  };
  if (graphNode.kind !== 'algo-graph') return empty;
  const nodes = graphNode.graphNodes ?? [];
  if (nodes.length === 0) return empty;

  const natural = new Map<string, { x: number; y: number }>();
  for (const gn of nodes) {
    if (gn.x !== undefined && gn.y !== undefined) {
      natural.set(gn.id, { x: gn.x, y: gn.y });
    }
  }
  if (natural.size === 0) return empty;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  natural.forEach((pos) => {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y > maxY) maxY = pos.y;
  });

  const padding = baseRadius + 16;
  let naturalW = (maxX - minX) + padding * 2;
  let naturalH = (maxY - minY) + padding * 2;
  naturalW = Math.max(naturalW, padding * 3);
  naturalH = Math.max(naturalH, padding * 3);

  const boxW = graphNode.w > 0 ? graphNode.w : naturalW;
  const boxH = graphNode.h > 0 ? graphNode.h : naturalH;
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const safeScale = scale > 0 ? scale : 1;

  const offsetX = (boxW - naturalW * safeScale) / 2;
  const offsetY = (boxH - naturalH * safeScale) / 2;

  const positions = new Map<string, { x: number; y: number }>();
  natural.forEach((pos, id) => {
    positions.set(id, {
      x: graphNode.x + offsetX + (pos.x - minX + padding) * safeScale,
      y: graphNode.y + offsetY + (pos.y - minY + padding) * safeScale,
    });
  });

  return { positions, scaledRadius: baseRadius * safeScale, scale: safeScale };
}

export function getAlgoGraphNaturalSize(
  graphNode: NodeModel
): { w: number; h: number } {
  if (graphNode.kind !== 'algo-graph') return { w: 300, h: 300 };
  const nodes = graphNode.graphNodes ?? [];
  if (nodes.length === 0) return { w: 300, h: 300 };
  const radius = graphNode.graphNodeRadius ?? 24;
  const padding = radius + 16;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const gn of nodes) {
    if (gn.x < minX) minX = gn.x;
    if (gn.y < minY) minY = gn.y;
    if (gn.x > maxX) maxX = gn.x;
    if (gn.y > maxY) maxY = gn.y;
  }
  return {
    w: Math.max((maxX - minX) + padding * 2, padding * 3),
    h: Math.max((maxY - minY) + padding * 2, padding * 3),
  };
}

export function drawAlgoGraph(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-graph') return;
  const nodes = n.graphNodes ?? [];
  if (nodes.length === 0) return;

  const baseFontSize = n.nodeFontSize ?? 14;
  const fontFamily = (n as { fontFamily?: string }).fontFamily || 'system-ui';
  // Defensive defaults: the AI sometimes sets fill/stroke to "transparent"
  // on the wrapper, which would make all circles invisible. Fall back to
  // sensible defaults so the graph still renders.
  const fillColor = (n.fill && n.fill !== 'transparent') ? n.fill : '#1e293b';
  const strokeColor = (n.stroke && n.stroke !== 'transparent' && n.stroke !== 'none') ? n.stroke : '#94a3b8';
  const baseStrokeWidth = n.strokeWidth ?? 2;
  const textColor = (n.labelColor && n.labelColor !== 'transparent') ? n.labelColor : '#e6edf3';
  const defaultEdgeColor = n.graphEdgeColor || '#475569';
  const baseEdgeWidth = n.graphEdgeWidth ?? 2;
  const directed = n.graphDirected ?? false;
  const edges = n.graphEdges ?? [];
  const showWeights = n.graphShowWeights ?? edges.some((e: GraphEdge) => e.weight !== undefined);
  const nodeColors = normalizeNodeColors(n.nodeColors);
  const edgeColorMap = normalizeEdgeColors(n.edgeColors);

  const fitted = getFittedGraphLayout(n);
  if (fitted.positions.size === 0) return;
  const { positions, scaledRadius: radius, scale } = fitted;
  const fontSize = baseFontSize * scale;
  const strokeWidth = baseStrokeWidth * scale;
  const edgeWidth = baseEdgeWidth * scale;
  const arrowHead = 8 * scale;

  ctx.save();

  // Draw edges first (under nodes)
  ctx.lineCap = 'round';
  for (const edge of edges) {
    const srcPos = positions.get(edge.source);
    const tgtPos = positions.get(edge.target);
    if (!srcPos || !tgtPos) continue;

    const dx = tgtPos.x - srcPos.x;
    const dy = tgtPos.y - srcPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;
    const ux = dx / dist;
    const uy = dy / dist;

    const x1 = srcPos.x + ux * radius;
    const y1 = srcPos.y + uy * radius;
    const x2 = tgtPos.x - ux * radius;
    const y2 = tgtPos.y - uy * radius;

    const ec = edgeColorMap[edge.id] ?? defaultEdgeColor;
    ctx.strokeStyle = ec;
    ctx.lineWidth = edgeWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (directed) {
      const px = -uy;
      const py = ux;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * arrowHead - px * arrowHead * 0.5, y2 - uy * arrowHead - py * arrowHead * 0.5);
      ctx.lineTo(x2 - ux * arrowHead + px * arrowHead * 0.5, y2 - uy * arrowHead + py * arrowHead * 0.5);
      ctx.closePath();
      ctx.fillStyle = ec;
      ctx.fill();
    }

    if (showWeights && edge.weight !== undefined) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const px = -uy * 12 * scale;
      const py = ux * 12 * scale;
      ctx.fillStyle = ec;
      ctx.font = `600 ${fontSize * 0.8}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(edge.weight), mx + px, my + py);
    }
  }

  // Draw nodes (circles + values) on top
  for (const gn of nodes) {
    const pos = positions.get(gn.id);
    if (!pos) continue;
    const fill = nodeColors[gn.id] ?? fillColor;

    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, radius, radius, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none') {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }

    if (gn.value) {
      ctx.fillStyle = textColor;
      ctx.font = `600 ${fontSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(gn.value, pos.x, pos.y);
    }
  }

  if (n.label) {
    const labelSize = n.labelFontSize || 13;
    ctx.fillStyle = textColor;
    ctx.font = `600 ${labelSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }

  ctx.restore();
}

// =============================================================================
// algo-chart helpers and renderer
// =============================================================================

/** Normalize barColors from either map or array form into a map. */
export function normalizeBarColors(
  raw: unknown
): { [barId: string]: string | null } {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: { [barId: string]: string | null } = {};
    for (const item of raw) {
      if (item && typeof item === 'object' && 'barId' in item) {
        const barId = (item as { barId?: string }).barId;
        const color = (item as { color?: string }).color;
        if (typeof barId === 'string') {
          out[barId] = color && color !== '' ? color : null;
        }
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    const src = raw as Record<string, unknown>;
    const out: { [barId: string]: string | null } = {};
    for (const k of Object.keys(src)) {
      const v = src[k];
      out[k] = typeof v === 'string' && v !== '' ? v : null;
    }
    return out;
  }
  return {};
}

export type ChartBarLayout = {
  bar: ChartBar;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function getFittedChartLayout(chartNode: NodeModel): {
  bars: ChartBarLayout[];
  orientation: 'vertical' | 'horizontal';
  labelPositions: Array<{ text: string; x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline }>;
  valuePositions: Array<{ text: string; x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline }>;
} {
  const bars: ChartBar[] = chartNode.chartBars ?? [];
  const orientation: 'vertical' | 'horizontal' =
    chartNode.chartOrientation === 'horizontal' ? 'horizontal' : 'vertical';
  type LabelPos = { text: string; x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline };
  const empty: {
    bars: ChartBarLayout[];
    orientation: 'vertical' | 'horizontal';
    labelPositions: LabelPos[];
    valuePositions: LabelPos[];
  } = {
    bars: [],
    orientation,
    labelPositions: [],
    valuePositions: [],
  };
  if (chartNode.kind !== 'algo-chart' || bars.length === 0) return empty;

  const spacing = chartNode.chartBarSpacing ?? 8;
  const showValues = chartNode.chartShowValues ?? false;
  const cx = chartNode.x;
  const cy = chartNode.y;
  const cw = chartNode.w;
  const ch = chartNode.h;

  const values = bars.map((b) => Math.max(0, Number(b.value ?? 0)));
  const actualMax = values.length > 0 ? Math.max(...values) : 1;
  const safeActualMax = actualMax > 0 ? actualMax : 1;
  const overrideMax = chartNode.chartMaxValue;
  const scaleMax = overrideMax !== undefined && overrideMax > 0 ? overrideMax : safeActualMax;

  const n = bars.length;
  const labelSpace = 18;
  const valueSpace = showValues ? 14 : 0;

  const out: ChartBarLayout[] = [];
  const labelPositions: typeof empty.labelPositions = [];
  const valuePositions: typeof empty.valuePositions = [];

  if (orientation === 'vertical') {
    const chartAreaH = Math.max(10, ch - labelSpace - valueSpace);
    const baselineY = cy + valueSpace + chartAreaH;
    const barW = Math.max(2, (cw - Math.max(0, n - 1) * spacing) / n);
    for (let i = 0; i < n; i++) {
      const v = values[i];
      const barH = scaleMax > 0 ? (v / scaleMax) * chartAreaH : 0;
      const bx = cx + i * (barW + spacing);
      const by = baselineY - barH;
      out.push({ bar: bars[i], x: bx, y: by, w: barW, h: barH });
      if (bars[i].label) {
        labelPositions.push({
          text: bars[i].label!,
          x: bx + barW / 2,
          y: baselineY + 4,
          align: 'center',
          baseline: 'top',
        });
      }
      if (showValues) {
        const printed = v === Math.floor(v) ? String(v) : v.toFixed(1);
        valuePositions.push({
          text: printed,
          x: bx + barW / 2,
          y: by - 2,
          align: 'center',
          baseline: 'alphabetic',
        });
      }
    }
  } else {
    const chartAreaW = Math.max(10, cw - labelSpace - valueSpace);
    const baselineX = cx + labelSpace;
    const barH = Math.max(2, (ch - Math.max(0, n - 1) * spacing) / n);
    for (let i = 0; i < n; i++) {
      const v = values[i];
      const barW = scaleMax > 0 ? (v / scaleMax) * chartAreaW : 0;
      const bx = baselineX;
      const by = cy + i * (barH + spacing);
      out.push({ bar: bars[i], x: bx, y: by, w: barW, h: barH });
      if (bars[i].label) {
        labelPositions.push({
          text: bars[i].label!,
          x: baselineX - 4,
          y: by + barH / 2,
          align: 'right',
          baseline: 'middle',
        });
      }
      if (showValues) {
        const printed = v === Math.floor(v) ? String(v) : v.toFixed(1);
        valuePositions.push({
          text: printed,
          x: bx + barW + 4,
          y: by + barH / 2,
          align: 'left',
          baseline: 'middle',
        });
      }
    }
  }

  return { bars: out, orientation, labelPositions, valuePositions };
}

export function getAlgoChartNaturalSize(
  chartNode: NodeModel
): { w: number; h: number } {
  if (chartNode.kind !== 'algo-chart') return { w: 320, h: 200 };
  const n = (chartNode.chartBars ?? []).length;
  const spacing = chartNode.chartBarSpacing ?? 8;
  const orientation = chartNode.chartOrientation ?? 'vertical';
  if (orientation === 'vertical') {
    // ~32px per bar + spacing, 200px tall
    return { w: Math.max(120, n * 40 + (n - 1) * spacing), h: 200 };
  }
  return { w: 320, h: Math.max(120, n * 30 + (n - 1) * spacing) };
}

export function drawAlgoChart(
  ctx: CanvasRenderingContext2D,
  n: NodeModel
): void {
  if (n.kind !== 'algo-chart') return;
  const bars = n.chartBars ?? [];
  if (bars.length === 0) return;

  const fontFamily = (n as { fontFamily?: string }).fontFamily || 'system-ui';
  const defaultBarColor = n.chartBarColor || '#7c3aed';
  const textColor =
    n.labelColor && n.labelColor !== 'transparent' ? n.labelColor : '#1e293b';
  const barColorMap = normalizeBarColors(n.barColors);
  const cornerRadius = 4;

  const fitted = getFittedChartLayout(n);

  ctx.save();
  // Bars
  for (const layout of fitted.bars) {
    const fillColor = barColorMap[layout.bar.id] ?? defaultBarColor;
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.roundRect(layout.x, layout.y, layout.w, layout.h, cornerRadius);
    ctx.fill();
  }
  // Bar labels
  ctx.fillStyle = textColor;
  ctx.font = `400 11px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
  for (const lp of fitted.labelPositions) {
    ctx.textAlign = lp.align;
    ctx.textBaseline = lp.baseline;
    ctx.fillText(lp.text, lp.x, lp.y);
  }
  // Value labels
  ctx.font = `600 10px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
  for (const vp of fitted.valuePositions) {
    ctx.textAlign = vp.align;
    ctx.textBaseline = vp.baseline;
    ctx.fillText(vp.text, vp.x, vp.y);
  }

  // Optional outer label
  if (n.label) {
    const labelSize = n.labelFontSize || 13;
    ctx.fillStyle = textColor;
    ctx.font = `600 ${labelSize}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }

  ctx.restore();
}

// =============================================================================
// algo-chart-line / algo-chart-scatter helpers and renderers
// =============================================================================

const _DEFAULT_SERIES_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4'];

export function normalizeSeriesColors(raw: unknown): { [id: string]: string | null } {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: { [id: string]: string | null } = {};
    for (const item of raw) {
      if (item && typeof item === 'object' && 'seriesId' in item) {
        const sid = (item as { seriesId?: string }).seriesId;
        const color = (item as { color?: string }).color;
        if (typeof sid === 'string') out[sid] = color && color !== '' ? color : null;
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    const src = raw as Record<string, unknown>;
    const out: { [id: string]: string | null } = {};
    for (const k of Object.keys(src)) {
      const v = src[k];
      out[k] = typeof v === 'string' && v !== '' ? v : null;
    }
    return out;
  }
  return {};
}

export function normalizePointColors(raw: unknown): { [id: string]: string | null } {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: { [id: string]: string | null } = {};
    for (const item of raw) {
      if (item && typeof item === 'object' && 'pointId' in item) {
        const pid = (item as { pointId?: string }).pointId;
        const color = (item as { color?: string }).color;
        if (typeof pid === 'string') out[pid] = color && color !== '' ? color : null;
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    const src = raw as Record<string, unknown>;
    const out: { [id: string]: string | null } = {};
    for (const k of Object.keys(src)) {
      const v = src[k];
      out[k] = typeof v === 'string' && v !== '' ? v : null;
    }
    return out;
  }
  return {};
}

/** Nice-looking round tick values between lo and hi. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo];
  const step = (hi - lo) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
  const n = step / magnitude;
  const niceStep = n < 1.5 ? magnitude : n < 3 ? 2 * magnitude : n < 7 ? 5 * magnitude : 10 * magnitude;
  const start = Math.ceil(lo / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let t = start; t <= hi + niceStep * 0.01; t += niceStep) ticks.push(t);
  return ticks;
}

function fmtTick(v: number): string {
  if (v === Math.floor(v)) return String(v);
  if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(1);
  return v.toFixed(2);
}

/** Compute the axis layout common to line and scatter charts. */
export function getChartAxisLayout(
  n: NodeModel,
  allX: number[],
  allY: number[]
): {
  plotX0: number;
  plotY0: number;
  plotX1: number;
  plotY1: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  toPx: (x: number, y: number) => { px: number; py: number };
  showAxes: boolean;
  xLabel: string;
  yLabel: string;
} {
  const showAxes = n.chartShowAxes ?? true;
  const xLabel = n.chartXLabel ?? '';
  const yLabel = n.chartYLabel ?? '';
  const padLeft = (showAxes ? 40 : 10) + (yLabel ? 14 : 0);
  const padRight = 12;
  const padTop = 14;
  const padBottom = (showAxes ? 30 : 10) + (xLabel ? 14 : 0);

  const plotX0 = n.x + padLeft;
  const plotY0 = n.y + padTop;
  const plotX1 = n.x + n.w - padRight;
  const plotY1 = n.y + n.h - padBottom;
  const plotW = Math.max(10, plotX1 - plotX0);
  const plotH = Math.max(10, plotY1 - plotY0);

  let [xmin, xmax] = n.chartXRange ?? [
    allX.length ? Math.min(...allX) : 0,
    allX.length ? Math.max(...allX) : 1,
  ];
  let [ymin, ymax] = n.chartYRange ?? [
    allY.length ? Math.min(...allY) : 0,
    allY.length ? Math.max(...allY) : 1,
  ];
  if (xmax <= xmin) xmax = xmin + 1;
  if (ymax <= ymin) ymax = ymin + 1;
  const dy = (ymax - ymin) * 0.05;
  ymax += dy;
  ymin -= dy;

  return {
    plotX0, plotY0, plotX1, plotY1, xmin, xmax, ymin, ymax,
    toPx: (x: number, y: number) => ({
      px: plotX0 + ((x - xmin) / (xmax - xmin)) * plotW,
      py: plotY1 - ((y - ymin) / (ymax - ymin)) * plotH,
    }),
    showAxes,
    xLabel,
    yLabel,
  };
}

function drawChartAxes(
  ctx: CanvasRenderingContext2D,
  axis: ReturnType<typeof getChartAxisLayout>,
  textColor: string,
  fontFamily: string,
  showGridLines: boolean
) {
  const { plotX0, plotY0, plotX1, plotY1, xmin, xmax, ymin, ymax, toPx, xLabel, yLabel } = axis;
  const axisColor = '#94a3b8';

  if (showGridLines) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (const tx of niceTicks(xmin, xmax)) {
      const { px } = toPx(tx, ymin);
      ctx.beginPath();
      ctx.moveTo(px, plotY0);
      ctx.lineTo(px, plotY1);
      ctx.stroke();
    }
    for (const ty of niceTicks(ymin, ymax)) {
      const { py } = toPx(xmin, ty);
      ctx.beginPath();
      ctx.moveTo(plotX0, py);
      ctx.lineTo(plotX1, py);
      ctx.stroke();
    }
  }

  if (!axis.showAxes) return;

  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plotX0, plotY1);
  ctx.lineTo(plotX1, plotY1);
  ctx.moveTo(plotX0, plotY0);
  ctx.lineTo(plotX0, plotY1);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.fillStyle = textColor;
  ctx.font = `400 10px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;

  for (const tx of niceTicks(xmin, xmax)) {
    const { px } = toPx(tx, ymin);
    ctx.beginPath();
    ctx.moveTo(px, plotY1);
    ctx.lineTo(px, plotY1 + 4);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtTick(tx), px, plotY1 + 6);
  }
  for (const ty of niceTicks(ymin, ymax)) {
    const { py } = toPx(xmin, ty);
    ctx.beginPath();
    ctx.moveTo(plotX0 - 4, py);
    ctx.lineTo(plotX0, py);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtTick(ty), plotX0 - 6, py);
  }

  ctx.font = `500 11px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
  if (xLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(xLabel, (plotX0 + plotX1) / 2, plotY1 + 22);
  }
  if (yLabel) {
    ctx.save();
    const cyLbl = (plotY0 + plotY1) / 2;
    ctx.translate(plotX0 - 28, cyLbl);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
}

export function drawAlgoChartLine(ctx: CanvasRenderingContext2D, n: NodeModel): void {
  if (n.kind !== 'algo-chart-line') return;
  const series: ChartSeries[] = n.chartSeries ?? [];
  const seriesColors = normalizeSeriesColors(n.seriesColors);
  const fontFamily = n.labelFontFamily || 'system-ui';
  const textColor = n.labelColor && n.labelColor !== 'transparent' ? n.labelColor : '#1e293b';

  const allX: number[] = [];
  const allY: number[] = [];
  for (const s of series) {
    for (const p of s.points ?? []) {
      if (typeof p.x === 'number') allX.push(p.x);
      if (typeof p.y === 'number') allY.push(p.y);
    }
  }
  const axis = getChartAxisLayout(n, allX, allY);

  ctx.save();
  if (n.fill && n.fill !== 'transparent') {
    ctx.fillStyle = n.fill;
    ctx.fillRect(n.x, n.y, n.w, n.h);
  }

  drawChartAxes(ctx, axis, textColor, fontFamily, n.chartGridLines ?? false);

  // Series as polylines
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const sid = s.id;
    const defaultColor = s.color || _DEFAULT_SERIES_COLORS[i % _DEFAULT_SERIES_COLORS.length];
    const color = seriesColors[sid] ?? defaultColor;
    const pts = s.points ?? [];
    if (pts.length === 0) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let j = 0; j < pts.length; j++) {
      const { px, py } = axis.toPx(pts[j].x, pts[j].y);
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (pts.length === 1) {
      const { px, py } = axis.toPx(pts[0].x, pts[0].y);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }

  // Legend
  const labelled = series
    .map((s, i) => ({
      sid: s.id,
      lbl: s.label,
      color:
        seriesColors[s.id] ??
        s.color ??
        _DEFAULT_SERIES_COLORS[i % _DEFAULT_SERIES_COLORS.length],
    }))
    .filter((e) => e.lbl);
  if (labelled.length > 0) {
    const legendX = axis.plotX1 - 120;
    const legendY = axis.plotY0 + 6;
    ctx.font = `400 10px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    labelled.forEach((e, i) => {
      const ly = legendY + i * 16;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX, ly);
      ctx.lineTo(legendX + 18, ly);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.fillText(e.lbl!, legendX + 22, ly);
    });
  }

  if (n.label) {
    ctx.fillStyle = textColor;
    ctx.font = `600 ${n.labelFontSize || 13}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }
  ctx.restore();
}

export function drawAlgoChartScatter(ctx: CanvasRenderingContext2D, n: NodeModel): void {
  if (n.kind !== 'algo-chart-scatter') return;
  const points: ScatterPoint[] = n.chartPoints ?? [];
  const pointColors = normalizePointColors(n.pointColors);
  const fontFamily = n.labelFontFamily || 'system-ui';
  const textColor = n.labelColor && n.labelColor !== 'transparent' ? n.labelColor : '#1e293b';
  const defaultColor = n.chartBarColor || '#3b82f6';

  const allX = points.map((p) => p.x);
  const allY = points.map((p) => p.y);
  const axis = getChartAxisLayout(n, allX, allY);

  ctx.save();
  if (n.fill && n.fill !== 'transparent') {
    ctx.fillStyle = n.fill;
    ctx.fillRect(n.x, n.y, n.w, n.h);
  }

  drawChartAxes(ctx, axis, textColor, fontFamily, n.chartGridLines ?? false);

  ctx.font = `400 9px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
  for (const p of points) {
    const { px, py } = axis.toPx(p.x, p.y);
    const r = p.size ?? 5;
    const color = pointColors[p.id] ?? p.color ?? defaultColor;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.label) {
      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.8;
      ctx.fillText(p.label, px + r + 3, py);
      ctx.globalAlpha = 1;
    }
  }

  if (n.label) {
    ctx.fillStyle = textColor;
    ctx.font = `600 ${n.labelFontSize || 13}px ${fontFamily}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(n.label, n.x, n.y - 4);
  }
  ctx.restore();
}

export function getAlgoChartLineNaturalSize(_n: NodeModel): { w: number; h: number } {
  return { w: 440, h: 280 };
}

export function getAlgoChartScatterNaturalSize(_n: NodeModel): { w: number; h: number } {
  return { w: 320, h: 280 };
}

// =============================================================================
// Colormap for algo-grid heatmap mode
// =============================================================================

type Stop = { t: number; rgb: [number, number, number] };
const _COLORMAP_STOPS: Record<string, Stop[]> = {
  heat: [
    { t: 0.0, rgb: [0xfe, 0xf3, 0xc7] },
    { t: 0.5, rgb: [0xfb, 0x92, 0x3c] },
    { t: 1.0, rgb: [0xdc, 0x26, 0x26] },
  ],
  cool: [
    { t: 0.0, rgb: [0x1e, 0x3a, 0x8a] },
    { t: 0.5, rgb: [0x3b, 0x82, 0xf6] },
    { t: 1.0, rgb: [0x22, 0xd3, 0xee] },
  ],
  viridis: [
    { t: 0.0, rgb: [0x44, 0x01, 0x54] },
    { t: 0.25, rgb: [0x41, 0x44, 0x87] },
    { t: 0.5, rgb: [0x26, 0x82, 0x8e] },
    { t: 0.75, rgb: [0x35, 0xb7, 0x79] },
    { t: 1.0, rgb: [0xfd, 0xe7, 0x25] },
  ],
  rdbu: [
    { t: 0.0, rgb: [0xdc, 0x26, 0x26] },
    { t: 0.5, rgb: [0xff, 0xff, 0xff] },
    { t: 1.0, rgb: [0x1e, 0x40, 0xaf] },
  ],
};

export function colormapValue(name: string, t: number): string {
  const stops = _COLORMAP_STOPS[name] || _COLORMAP_STOPS.viridis;
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const f = (clamped - a.t) / (b.t - a.t || 1);
      const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f);
      const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f);
      const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
    }
  }
  return '#000000';
}
