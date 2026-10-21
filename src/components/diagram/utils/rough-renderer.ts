/* eslint-disable -- Migrated file */
/**
 * Rough.js Renderer
 *
 * Provides hand-drawn / sketchy rendering for nodes and edges using Rough.js.
 * Each shape function mirrors the geometry from geometry-utils.ts but uses
 * Rough.js primitives instead of native Canvas 2D path calls.
 */

import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type { Options } from 'roughjs/bin/core';
import type { NodeModel, EdgeModel, Vec2 } from '../types';
import { getGradientBaseColor } from './gradient-utils';
import { photoCardBacking } from './stage-background';

// ============================================================================
// Singleton RoughCanvas cache (one per HTMLCanvasElement)
// ============================================================================

const roughCanvasCache = new WeakMap<HTMLCanvasElement, RoughCanvas>();

export function getRoughCanvas(canvas: HTMLCanvasElement): RoughCanvas {
  let rc = roughCanvasCache.get(canvas);
  if (!rc) {
    rc = rough.canvas(canvas);
    roughCanvasCache.set(canvas, rc);
  }
  return rc;
}

// ============================================================================
// Stable seed from node/edge ID
// ============================================================================

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const ch = id.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash);
}

// ============================================================================
// Build Rough.js options from node properties
// ============================================================================

function buildNodeOptions(node: NodeModel): Options {
  // A fill-only shape asks for no outline by setting its stroke width to zero — the pie slice,
  // the bar, the chip all carry their colour in the fill. Rough spaces its hachure from the
  // STROKE width, so zero spaces the lines zero apart and the filler gives up: the shape comes
  // back as a bare hairline and nothing inside it. Honour the intent (no outline) by dropping
  // the stroke instead, and hand the filler a width it can actually work from.
  const sw = node.strokeWidth ?? 2;
  const outlined = sw > 0;
  return {
    roughness: node.roughness ?? 1,
    seed: node.roughSeed ?? hashId(node.id),
    fill: getGradientBaseColor(node.fill) || '#ffffff',
    fillStyle: node.roughFillStyle || 'hachure',
    fillWeight: node.roughFillWeight ?? 1,
    // Two shapes that touch and hatch in the same direction read as one shape. Authors can turn
    // the hatch per shape to keep neighbours apart (pie slices, stacked bands).
    ...(node.roughHachureAngle !== undefined ? { hachureAngle: node.roughHachureAngle } : {}),
    ...(outlined ? {} : { hachureGap: 7 }),
    stroke: outlined ? (node.stroke || '#2b3a55') : 'none',
    strokeWidth: outlined ? sw : 1,
    bowing: 1,
  };
}

/** A pie slice, or a ring segment when `innerRatio` is set — the shape the plain canvas
 * renderer draws. Rough has an `arc`, but it only ever closes to the centre, so a donut
 * comes back as a pie and the hole the chart was designed around disappears.
 *
 * Halved at the midpoint so no sweep ever needs the large-arc flag, which keeps a full
 * 360-degree wedge a legal path instead of a degenerate one. */
function getWedgePath(
  x: number, y: number, w: number, h: number,
  startDeg: number, endDeg: number, innerRatio: number
): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = (endDeg * Math.PI) / 180;
  const am = (a0 + a1) / 2;
  const sweepFlag = a1 >= a0 ? 1 : 0;
  const p = (r: number, a: number) =>
    `${cx + Math.cos(a) * rx * r} ${cy + Math.sin(a) * ry * r}`;
  const outer = `A ${rx} ${ry} 0 0 ${sweepFlag} ${p(1, am)}`
    + ` A ${rx} ${ry} 0 0 ${sweepFlag} ${p(1, a1)}`;
  if (!(innerRatio > 0)) return `M ${cx} ${cy} L ${p(1, a0)} ${outer} Z`;
  const irx = rx * innerRatio;
  const iry = ry * innerRatio;
  const back = 1 - sweepFlag;
  const inner = `A ${irx} ${iry} 0 0 ${back} ${p(innerRatio, am)}`
    + ` A ${irx} ${iry} 0 0 ${back} ${p(innerRatio, a0)}`;
  return `M ${p(1, a0)} ${outer} L ${p(innerRatio, a1)} ${inner} Z`;
}

function buildEdgeOptions(edge: EdgeModel): Options {
  return {
    roughness: edge.roughness ?? 1,
    seed: edge.roughSeed ?? hashId(edge.id),
    stroke: edge.stroke || '#9aa6bc',
    strokeWidth: edge.width || 2,
    bowing: edge.bowing ?? 1,
    fill: 'none',
  };
}

// ============================================================================
// Vertex computation helpers (mirrors geometry-utils.ts logic)
// ============================================================================

function getTrianglePoints(x: number, y: number, w: number, h: number): [number, number][] {
  return [
    [x + w / 2, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function getPolygonPoints(x: number, y: number, w: number, h: number, sides: number): [number, number][] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radiusX = w / 2;
  const radiusY = h / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY]);
  }
  return pts;
}

function getStarPoints(
  x: number, y: number, w: number, h: number,
  points: number, innerRadiusRatio: number
): [number, number][] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outerRx = w / 2;
  const outerRy = h / 2;
  const innerRx = outerRx * innerRadiusRatio;
  const innerRy = outerRy * innerRadiusRatio;
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const isOuter = i % 2 === 0;
    const rx = isOuter ? outerRx : innerRx;
    const ry = isOuter ? outerRy : innerRy;
    pts.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return pts;
}

function getArrowPoints(x: number, y: number, w: number, h: number): [number, number][] {
  const headWidth = Math.min(w * 0.3, h * 0.5);
  const bodyWidth = w - headWidth;
  return [
    [x, y + h * 0.25],
    [x + bodyWidth, y + h * 0.25],
    [x + bodyWidth, y],
    [x + w, y + h / 2],
    [x + bodyWidth, y + h],
    [x + bodyWidth, y + h * 0.75],
    [x, y + h * 0.75],
  ];
}

function getChevronPoints(x: number, y: number, w: number, h: number, pointDepth: number): [number, number][] {
  const notch = w * pointDepth;
  return [
    [x + notch, y],
    [x + w, y],
    [x + w - notch, y + h / 2],
    [x + w, y + h],
    [x + notch, y + h],
    [x, y + h / 2],
  ];
}

function getFunnelPoints(x: number, y: number, w: number, h: number, topWidth: number, bottomWidth: number): [number, number][] {
  const topOffset = w * (1 - topWidth) / 2;
  const bottomOffset = w * (1 - bottomWidth) / 2;
  return [
    [x + topOffset, y],
    [x + w - topOffset, y],
    [x + w - bottomOffset, y + h],
    [x + bottomOffset, y + h],
  ];
}

// ============================================================================
// drawRoughNode - Main shape renderer
// ============================================================================

/** A hatched shape over a creator's photo: hatching is mostly gaps, and on a busy picture the
 *  gaps are the picture, so the card stops reading as a card and its words sit on the photo.
 *  Under the hatch, lay the same shape filled solid with its own colour, mostly opaque (the
 *  ground's readability decides how much); the hatch still draws on top, so it keeps its look. */
function needsPhotoBacking(node: NodeModel): boolean {
  if (photoCardBacking() <= 0) return false;
  if (node.kind === 'group' || node.kind === 'text' || node.kind === 'svg' || node.kind === 'icon' || node.kind === 'lottie') return false;
  const style = node.roughFillStyle || 'hachure';
  if (style === 'solid') return false;
  const f = getGradientBaseColor(node.fill);
  return !!f && f !== 'transparent' && f !== 'none' && !/^rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(f);
}

export function drawRoughNode(
  rc: RoughCanvas,
  node: NodeModel,
  ctx: CanvasRenderingContext2D
): void {
  const { x, y, w, h, kind } = node;
  if (needsPhotoBacking(node)) {
    ctx.save();
    ctx.globalAlpha *= photoCardBacking();
    drawRoughNode(rc, { ...node, roughFillStyle: 'solid', strokeWidth: 0 }, ctx);
    ctx.restore();
  }
  const opts = buildNodeOptions(node);

  switch (kind) {
    case 'rect':
    case 'group': {
      const cr = node.cornerRadius ?? 12;
      // Rough.js doesn't natively support cornerRadius on rectangle,
      // but we can use a path with rounded corners
      if (cr > 0 && kind !== 'group') {
        const r = Math.min(cr, w / 2, h / 2);
        const d = `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
        rc.path(d, opts);
      } else {
        rc.rectangle(x, y, w, h, opts);
      }
      break;
    }

    case 'cylinder': {
      const cylOrient = node.cylinderOrientation
        ? node.cylinderOrientation
        : (w > h * 1.4 ? 'horizontal' : 'vertical');
      const segments = Math.max(1, Math.floor(node.cylinderSegments ?? 1));
      if (cylOrient === 'horizontal') {
        const rx = Math.min(h * 0.32, w * 0.22);
        const cyCyl = y + h / 2;
        const cx_left = x + rx;
        const cx_right = x + w - rx;
        const bodyOpts: Options = { ...opts, fill: opts.fill };
        rc.rectangle(cx_left, y, cx_right - cx_left, h, { ...bodyOpts, stroke: 'none' });
        // Right arc (front half only): from top → right → bottom
        rc.arc(cx_right, cyCyl, rx * 2, h, -Math.PI / 2, Math.PI / 2, false, opts);
        // Top and bottom side lines
        rc.line(cx_left, y, cx_right, y, opts);
        rc.line(cx_left, y + h, cx_right, y + h, opts);
        // Left ellipse (full) - drawn on top with optional cap fill
        const capFill = node.cylinderTopFill || opts.fill;
        rc.ellipse(cx_left, cyCyl, rx * 2, h, { ...opts, fill: capFill });
        // Segment dividers: vertical front-arcs (right half) matching the right cap
        if (segments > 1) {
          const bodyLen = cx_right - cx_left;
          for (let i = 1; i < segments; i++) {
            const dCx = cx_left + (bodyLen * i) / segments;
            rc.arc(dCx, cyCyl, rx * 2, h, -Math.PI / 2, Math.PI / 2, false, opts);
          }
        }
        break;
      }
      const ry = h * 0.12;
      const cxCyl = x + w / 2;
      const cy_top = y + ry;
      const cy_bot = y + h - ry;
      // Body: rectangle between ellipses + bottom arc
      const bodyOpts: Options = { ...opts, fill: opts.fill };
      rc.rectangle(x, cy_top, w, cy_bot - cy_top, { ...bodyOpts, stroke: 'none' });
      // Bottom arc (front half only)
      rc.arc(cxCyl, cy_bot, w, ry * 2, 0, Math.PI, false, opts);
      // Left and right side lines
      rc.line(x, cy_top, x, cy_bot, opts);
      rc.line(x + w, cy_top, x + w, cy_bot, opts);
      // Top ellipse (full) - drawn on top with optional top fill
      const topFill = node.cylinderTopFill || opts.fill;
      rc.ellipse(cxCyl, cy_top, w, ry * 2, { ...opts, fill: topFill });
      // Segment dividers: horizontal front-arcs down the body (match bottom cap)
      if (segments > 1) {
        const bodyLen = cy_bot - cy_top;
        for (let i = 1; i < segments; i++) {
          const dCy = cy_top + (bodyLen * i) / segments;
          rc.arc(cxCyl, dCy, w, ry * 2, 0, Math.PI, false, opts);
        }
      }
      break;
    }

    case 'circle':
      rc.ellipse(x + w / 2, y + h / 2, w, h, opts);
      break;

    case 'triangle':
      rc.polygon(getTrianglePoints(x, y, w, h), opts);
      break;

    case 'polygon':
      rc.polygon(getPolygonPoints(x, y, w, h, node.points || 6), opts);
      break;

    case 'star':
      rc.polygon(getStarPoints(x, y, w, h, node.points || 5, node.innerRadius || 0.5), opts);
      break;

    case 'arrow':
      rc.polygon(getArrowPoints(x, y, w, h), opts);
      break;

    case 'chevron':
      rc.polygon(getChevronPoints(x, y, w, h, node.pointDepth ?? 0.2), opts);
      break;

    case 'funnel':
      rc.polygon(getFunnelPoints(x, y, w, h, node.topWidth ?? 1, node.bottomWidth ?? 0.3), opts);
      break;

    case 'wedge': {
      const startDeg = node.startAngle ?? 0;
      const endDeg = node.endAngle ?? 270;
      // A wedge with no sweep has no ink, and every animated wedge legitimately starts there:
      // step 0 is the un-grown state. Rough sizes its arc step at half the sweep, so a sweep of
      // zero gives a step of zero and its walk never advances — the tab freezes rather than
      // throwing, which reads to the user as the app crashing on that scene.
      if (!(Math.abs(endDeg - startDeg) > 1e-4)) break;
      rc.path(getWedgePath(x, y, w, h, startDeg, endDeg, node.innerRadius ?? 0), opts);
      break;
    }

    case 'callout': {
      // Build SVG path for callout shape
      const d = buildCalloutPath(node);
      rc.path(d, opts);
      break;
    }

    case 'progress': {
      // Track
      const cr2 = node.cornerRadius ?? 0;
      const r = Math.min(cr2, w / 2, h / 2);
      if (r > 0) {
        const d = `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
        rc.path(d, opts);
      } else {
        rc.rectangle(x, y, w, h, opts);
      }

      // Filled portion
      const pVal = Math.max(0, Math.min(1, node.value ?? 0.5));
      const pOrientation = node.progressOrientation ?? 'horizontal';
      if (pVal > 0) {
        const fillOpts: Options = {
          ...opts,
          fill: node.progressColor || '#3b82f6',
          fillStyle: node.roughFillStyle || 'hachure',
        };
        if (pOrientation === 'horizontal') {
          const fw = w * pVal;
          if (fw > 4) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, fw, h);
            ctx.clip();
            if (r > 0) {
              const d2 = `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
              rc.path(d2, fillOpts);
            } else {
              rc.rectangle(x, y, w, h, fillOpts);
            }
            ctx.restore();
          }
        } else {
          const fh = h * pVal;
          if (fh > 4) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y + h - fh, w, fh);
            ctx.clip();
            if (r > 0) {
              const d2 = `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
              rc.path(d2, fillOpts);
            } else {
              rc.rectangle(x, y, w, h, fillOpts);
            }
            ctx.restore();
          }
        }
      }
      break;
    }

    // SVG, icon, lottie nodes: rough mode not applicable (pre-made assets)
    case 'svg':
    case 'icon':
    case 'lottie':
    case 'text':
      // Fall through — these are handled by their normal renderers
      break;

    default:
      // Fallback: draw a rough rectangle
      rc.rectangle(x, y, w, h, opts);
      break;
  }
}

// ============================================================================
// drawRoughEdge - Edge line renderer
// ============================================================================

export function drawRoughEdge(
  rc: RoughCanvas,
  edge: EdgeModel,
  pts: Vec2[],
  _ctx: CanvasRenderingContext2D
): void {
  if (pts.length < 2) return;
  const opts = buildEdgeOptions(edge);
  const points: [number, number][] = pts.map(p => [p.x, p.y]);
  rc.linearPath(points, opts);
}

// ============================================================================
// Callout path builder (mirrors geometry-utils.ts drawCallout)
// ============================================================================

function buildCalloutPath(node: NodeModel): string {
  const { x, y, w, h } = node;
  const pointerSide = node.pointerSide ?? 'S';
  const pointerPosition = node.pointerPosition ?? 0.3;
  const pointerSize = node.pointerSize ?? 0.12;
  const cornerRadius = node.cornerRadius ?? 12;

  const r = Math.min(cornerRadius, w / 4, h / 4);
  const pLen = (pointerSide === 'N' || pointerSide === 'S') ? h * 0.18 : w * 0.18;

  let bx = x, by = y, bw = w, bh = h;
  if (pointerSide === 'S') { bh = h - pLen; }
  else if (pointerSide === 'N') { by = y + pLen; bh = h - pLen; }
  else if (pointerSide === 'E') { bw = w - pLen; }
  else if (pointerSide === 'W') { bx = x + pLen; bw = w - pLen; }

  let d = `M ${bx + r} ${by} `;

  // Top side
  if (pointerSide === 'N') {
    const sideLen = bw;
    const pBase = sideLen * pointerSize;
    const pStart = bx + sideLen * pointerPosition;
    d += `L ${pStart} ${by} L ${pStart + pBase / 2} ${y} L ${pStart + pBase} ${by} `;
  }
  d += `L ${bx + bw - r} ${by} `;
  d += `Q ${bx + bw} ${by} ${bx + bw} ${by + r} `;

  // Right side
  if (pointerSide === 'E') {
    const sideLen = bh;
    const pBase = sideLen * pointerSize;
    const pStart = by + sideLen * pointerPosition;
    d += `L ${bx + bw} ${pStart} L ${x + w} ${pStart + pBase / 2} L ${bx + bw} ${pStart + pBase} `;
  }
  d += `L ${bx + bw} ${by + bh - r} `;
  d += `Q ${bx + bw} ${by + bh} ${bx + bw - r} ${by + bh} `;

  // Bottom side
  if (pointerSide === 'S') {
    const sideLen = bw;
    const pBase = sideLen * pointerSize;
    const pStart = bx + sideLen * (1 - pointerPosition) - pBase;
    d += `L ${pStart + pBase} ${by + bh} L ${pStart + pBase / 2} ${y + h} L ${pStart} ${by + bh} `;
  }
  d += `L ${bx + r} ${by + bh} `;
  d += `Q ${bx} ${by + bh} ${bx} ${by + bh - r} `;

  // Left side
  if (pointerSide === 'W') {
    const sideLen = bh;
    const pBase = sideLen * pointerSize;
    const pStart = by + sideLen * (1 - pointerPosition) - pBase;
    d += `L ${bx} ${pStart + pBase} L ${x} ${pStart + pBase / 2} L ${bx} ${pStart} `;
  }
  d += `L ${bx} ${by + r} `;
  d += `Q ${bx} ${by} ${bx + r} ${by} `;
  d += 'Z';

  return d;
}

// ============================================================================
// Helper: Check if a node kind supports rough rendering
// ============================================================================

export function supportsRoughRendering(kind: NodeModel['kind']): boolean {
  switch (kind) {
    case 'rect':
    case 'cylinder':
    case 'circle':
    case 'triangle':
    case 'polygon':
    case 'star':
    case 'arrow':
    case 'chevron':
    case 'funnel':
    case 'wedge':
    case 'callout':
    case 'progress':
    case 'group':
      return true;
    default:
      return false;
  }
}
