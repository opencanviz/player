/* eslint-disable -- Migrated file */
/**
 * Entity Renderers (Layer 2)
 *
 * Core rendering functions for edges, nodes, and phantoms.
 * These are pure functions shared by both the editor (canvas-render.ts)
 * and export systems (rendering-utils.ts / scene-compositor.ts).
 */

import type {
  NodeModel,
  EdgeModel,
  SpriteCache,
  PhantomNode,
  Vec2,
} from '../types';
import { getDefaultLabelPadding } from '../types';
import { claimLabelRect, LABEL_T_CANDIDATES } from './label-collision';
import {
  roundRect,
  drawTriangle,
  drawPolygon,
  drawStar,
  drawArrow,
  drawWedge,
  drawChevron,
  drawDiamond,
  drawFunnel,
  drawProgressTrack,
  drawCallout,
  drawCylinder,
  drawCylinderTopArc,
  drawCylinderSegmentDividers,
  resolveCylinderOrientation,
  drawUmlActor,
  drawUmlLifeline,
  drawUmlClassBox,
  drawUmlNote,
  drawUmlNoteFold,
  drawSvgPaths,
  svgPointAtProgress,
  pathLen,
  clipToTrimmedRibbon,
  applyNodeTransform,
  localToWorld,
  getWorldTransform,
} from './geometry-utils';
import { computeContinuousMotion, applyMotionTransform } from './continuous-motion';
import { clamp, lerp } from './math-utils';
import { getGlobalSketchMode } from './sketch-mode';
import { getEdgePath, drawArrowhead } from './edge-utils';
import { getArrowGeometryForPolyline } from './arrow-utils';
import { isGradientString, applyFillStyle, getGradientBaseColor } from './gradient-utils';
import { getSpriteFrameAt } from './animation-utils';
import { drawTextNode, drawWrappedNodeLabel, drawIconLabel } from './text-utils';
import { drawWriteHand, isManagedHandSuppressed } from './write-hand-asset';
import { drawGlyph } from './glyph-render';
import { drawImageWithWipe } from './image-wipe';

/**
 * Size (px) at which hand-drawn illustration ink is drawn at its authored weight.
 *
 * A library plate is a 1024 px line-art doodle whose lines are about 4 px wide, i.e. the
 * authored 3.2 px ink is the plate's own weight only when the drawing is ~800 px tall. 450
 * keeps the ink a touch bolder than the plate (the marker look the paper board wants) while
 * a 156 px drawing gets ~1.1 px of ink instead of 2.5 px.
 */
const ILLU_INK_REF_PX = 450;
/** Thinnest illustration ink that still reads as a line rather than a hair. */
const ILLU_INK_MIN_PX = 1.0;

/**
 * Stroke weight for a line-art illustration at the size it is actually drawn.
 *
 * drawSvgPaths treats strokeWidth as SCREEN pixels (it divides by the viewBox scale), which is
 * right for a UI icon and wrong for a drawing: a 1,400-stroke illustration authored at 3.2px
 * keeps every line 3.2px wide whatever box a template places it in. In a 64px box the gaps
 * between lines vanish and the picture reads as a solid dark blob (the thrombosis scene,
 * 2026-10-01). In a 156px box the ink is still four times the plate's own line weight, so on a
 * dark board the near-white ink spills past the colour fills and reads as a thick white sticker
 * rim, and parallel lines (rope strands, cable lattices) merge into solid bars (the bridge
 * roadway scene, 2026-10-04). Below the reference size the ink thins in proportion to the
 * drawing, down to a floor that still reads as ink; at and above it the authored weight stands.
 * Anything that is not library line art keeps the node's own strokeWidth untouched.
 */
function illustrationStrokeWidth(node: NodeModel, drawSize: number): number | undefined {
  // Only library line art (a concept the bind resolved). A hand-drawn arrow is also traced by
  // the pen but is one stroke, and one stroke thinned to 1px is a hair, not an arrow.
  const n = node as NodeModel & { illustrationPrompt?: string; illuBound?: boolean };
  const isLineArt = !!n.illustrationPrompt || !!n.illuBound;
  if (!isLineArt) return node.strokeWidth;
  // The fill-only colour and shadow companions carry no width and keep drawing as they do.
  const authored = node.strokeWidth || node.svgPaths?.[0]?.strokeWidth;
  if (!authored) return node.strokeWidth;
  const scaled = authored * clamp(drawSize / ILLU_INK_REF_PX, 0, 1);
  return Math.min(authored, Math.max(ILLU_INK_MIN_PX, scaled));
}
import { drawMesh3d } from './mesh3d';
import { drawVector2d } from './vector2d';
import { drawPathMarker } from './pathmarker';
import { drawAlgoArray, drawAlgoPointer, drawAlgoGrid, drawAlgoVariable, drawAlgoTree, drawAlgoLinkedList, drawAlgoGraph, drawAlgoChart, drawAlgoChartLine, drawAlgoChartScatter } from './algo-utils';
import { renderLottieToCanvas, renderLottieFromData } from './lottie-utils';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import { drawRoughNode, drawRoughEdge, supportsRoughRendering } from './rough-renderer';
import { drawMarkerEdge } from './marker-renderer';

// ============================================================================
// Types
// ============================================================================

/** Deferred arrowhead/ball to draw on top of nodes */
export interface DeferredArrowhead {
  backPoint: { x: number; y: number };
  tip: { x: number; y: number };
  size: number;
  color: string;
  lineWidth: number;
  lineDash: number[];
  lineDashOffset: number;
  extensionLine?: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  };
  isBall?: boolean;
  ballRadius?: number;
}

/** Options for edge rendering */
export interface RenderEdgeOptions {
  flowOffset: number;
  flowEnabled: boolean;
  routeMode: Record<string, any>;
  /** Mutable array to collect deferred arrowheads for arrowOnTop feature */
  deferredArrowheads?: DeferredArrowhead[];
  /** Rough.js canvas for hand-drawn edge rendering */
  roughCanvas?: RoughCanvas;
}

/** Options for node rendering */
export interface RenderNodeOptions {
  currentTimeMs: number;
  spriteCache?: SpriteCache;
  imageCache?: Map<string, HTMLImageElement>;
  allNodes?: NodeModel[]; // All nodes for group hierarchy (local→world conversion)
  roughCanvas?: RoughCanvas; // Rough.js canvas for hand-drawn rendering
}

/** Options for phantom rendering */
export interface RenderPhantomOptions {
  currentTimeMs: number;
  imageCache?: Map<string, HTMLImageElement>;
}

// ============================================================================
// Helper: Check if color is transparent
// ============================================================================

function isTransparentColor(color: string | undefined): boolean {
  if (!color || color === 'transparent' || color === 'none') return true;
  // Gradients are never transparent
  if (isGradientString(color)) return false;
  // rgba with zero alpha
  if (color.includes('rgba') && /,\s*0(\.0+)?\)$/.test(color)) return true;
  // 8-digit hex with zero alpha (#RRGGBBAA where AA = 00)
  if (/^#[0-9a-fA-F]{6}00$/.test(color)) return true;
  return false;
}

/** Lighten a hex color by blending toward white. amount 0-1 (0=no change, 1=white). */
function lightenColor(hex: string, amount: number): string {
  // Parse hex (supports #RGB, #RRGGBB, #RRGGBBAA)
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

// ============================================================================
// Helper: Compute icon/svg node layout respecting verticalAlign & labelPadding
// ============================================================================

export function computeIconLayout(
  node: NodeModel,
  x: number,
  y: number,
  w: number,
  h: number
): { iconX: number; iconY: number; iconSize: number; labelY: number } {
  const iconLabelH = node.label ? (node.labelFontSize || 14) + 6 : 0;
  const gap = iconLabelH > 0 ? (node.labelPadding ?? getDefaultLabelPadding(node)) : 0;
  const iconSize = Math.min(w, Math.max(0, h - iconLabelH - gap));
  const contentH = iconSize + gap + iconLabelH;
  const iconX = x + (w - iconSize) / 2;
  // Always center icon+label as a unit
  const contentY = y + (h - contentH) / 2;
  return {
    iconX,
    iconY: contentY,
    iconSize,
    labelY: contentY + iconSize + gap + iconLabelH / 2,
  };
}

// ============================================================================
// Helper: Draw icon background shape (circle/rounded/square)
// ============================================================================

export function drawIconBackground(
  ctx: CanvasRenderingContext2D,
  node: NodeModel,
  layout: { iconX: number; iconY: number; iconSize: number }
): { drawX: number; drawY: number; drawSize: number } | null {
  if (!node.iconBg) return null;

  const bgSize = layout.iconSize;
  const bgPadding = node.iconBgPadding ?? 0.6;
  const drawSize = bgSize * bgPadding;
  const drawX = layout.iconX + (bgSize - drawSize) / 2;
  const drawY = layout.iconY + (bgSize - drawSize) / 2;

  ctx.save();
  ctx.fillStyle = node.iconBg;
  ctx.beginPath();

  const shape = node.iconBgShape ?? 'circle';
  if (shape === 'circle') {
    const r = bgSize / 2;
    ctx.arc(layout.iconX + r, layout.iconY + r, r, 0, Math.PI * 2);
  } else if (shape === 'rounded') {
    roundRect(ctx, layout.iconX, layout.iconY, bgSize, bgSize, bgSize * 0.15);
  } else {
    // square
    ctx.rect(layout.iconX, layout.iconY, bgSize, bgSize);
  }
  ctx.fill();
  ctx.restore();

  return { drawX, drawY, drawSize };
}

// Leading point for the write-on hand riding a gesture/icon stroke as it draws on.
//  - 'path'      : the icon's REAL outline (svgPaths[0].d via getPointAtLength) — hand-drawn icons
//  - 'underline' : left-to-right along the box
//  - 'circle'    : parametric ellipse around the box
function _handLeadingPoint(
  node: NodeModel, x: number, y: number, w: number, h: number, dp: number,
): { x: number; y: number } | null {
  const trace = (node as { handTrace?: string }).handTrace || (w > h * 1.8 ? 'underline' : 'circle');
  if (trace === 'path') {
    const d = node.svgPaths && node.svgPaths[0] && node.svgPaths[0].d;
    const vb = node.svgViewBox;
    if (!d || !vb || !vb.w || !vb.h) return { x: x + w / 2, y: y + h / 2 };
    const toNode = (p: { x: number; y: number }) =>
      ({ x: x + (p.x - vb.x) * (w / vb.w), y: y + (p.y - vb.y) * (h / vb.h) });
    // Pen-lift: near a big stroke-to-stroke gap the raw path point teleports. Within a small window
    // around each lift fraction, arc the hand from the pre-gap point to the post-gap point along a
    // raised curve so it reads as lifting the marker and setting it back down.
    const lifts = (node as { penLifts?: number[] }).penLifts;
    if (lifts && lifts.length) {
      const win = 0.028;
      for (const f of lifts) {
        if (dp > f - win && dp < f + win) {
          const a = svgPointAtProgress(d, Math.max(0, f - win));
          const b = svgPointAtProgress(d, Math.min(1, f + win));
          if (a && b) {
            const t = (dp - (f - win)) / (2 * win);          // 0..1 across the gap
            const pa = toNode(a), pb = toNode(b);
            const lift = 26 * Math.sin(Math.PI * t);          // px the nib rises at mid-hop
            return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t - lift };
          }
        }
      }
    }
    const pt = svgPointAtProgress(d, dp);
    return pt ? toNode(pt) : { x: x + w / 2, y: y + h / 2 };
  }
  if (trace === 'underline') {
    return { x: x + w * dp, y: y + h * 0.6 };
  }
  const ang = -Math.PI / 2 + Math.PI * 2 * dp; // top, clockwise
  return { x: x + w / 2 + w * 0.46 * Math.cos(ang), y: y + h / 2 + h * 0.45 * Math.sin(ang) };
}

// Write-on hand tracing a gesture stroke (circle/underline annotation) as it draws on: place the
// nib at the stroke's leading point (parametric on the node box — exact for svgStretch gestures)
// and record it as __penPt so a scene-level continuous hand can ride it. Draws the per-node hand
// only when NOT handManaged (the handTrack owns the hand for managed nodes). Shared by the two
// svgPaths-icon render branches below.
/** A picture slot the library never filled: a prompt, and nothing to show for it. */
export function _isEmptyPicture(node: NodeModel): boolean {
  const n = node as { illustrationPrompt?: string; svgPaths?: unknown[];
                      imageData?: string; imageUrl?: string };
  if (!n.illustrationPrompt) return false;
  return !(n.svgPaths && n.svgPaths.length) && !n.imageData && !n.imageUrl;
}

function _drawGestureHand(
  ctx: CanvasRenderingContext2D, node: NodeModel,
  x: number, y: number, w: number, h: number, currentTimeMs: number | undefined,
): void {
  const dp = (node as { drawProgress?: number }).drawProgress ?? 1;
  // dp <= 0: the element hasn't started drawing — don't PARK a hand at its start point (else every
  // not-yet-drawn writeHand node shows a stray hand → "hands everywhere" on a multi-element scene).
  if (!(node as { writeHand?: boolean }).writeHand || dp <= 0 || dp >= 1) return;
  // An empty picture slot gets no pen. See drawContinuousHand: a concept the library has never
  // drawn arrives as a promise and renders as nothing, and a hand miming strokes over nothing is
  // the worst of both — it advertises a drawing that is never going to appear.
  if (_isEmptyPicture(node)) return;
  const pt = _handLeadingPoint(node, x, y, w, h, dp);
  if (!pt) return;
  (node as { __penPt?: { x: number; y: number } }).__penPt = { x: pt.x, y: pt.y };
  if (!((node as { handManaged?: boolean }).handManaged && isManagedHandSuppressed())) {
    drawWriteHand(ctx, pt.x, pt.y, 32, currentTimeMs);
  }
}

// Write-on hand riding an IMAGE draw-on wipe. The wipe reveals the image TOP-TO-BOTTOM by
// drawProgress (a horizontal reveal line at y + h·dp), so the nib rides exactly ON that line and
// scrubs left-right across it (fast hatching sweeps) — ink always emerges right at the pen tip
// instead of a full slab popping in away from the hand. Records __penPt like the gesture hand.
// Call AFTER the image is drawn (on top). No-op unless writeHand and 0<drawProgress<1.
const WIPE_HAND_SWEEPS = 5; // horizontal scrubs across the height of the reveal
export function drawImageWipeHand(
  ctx: CanvasRenderingContext2D, node: NodeModel, currentTimeMs: number | undefined,
): void {
  const dp = (node as { drawProgress?: number }).drawProgress ?? 1;
  if (!(node as { writeHand?: boolean }).writeHand || dp <= 0 || dp >= 1) return;
  // The wipe hand is ONLY for imageData raster wipes. svgPaths / handTrace nodes get their hand from
  // _drawGestureHand (riding the real stroke front); firing here too would draw a SECOND hand.
  if ((node.svgPaths && node.svgPaths.length > 0) || (node as { handTrace?: string }).handTrace) return;
  // Along the reveal line, scrubbing across it. Which of the two is which depends on the axis the
  // wipe runs on: a left-to-right wipe uncovers a VERTICAL line, so the nib rides its x and scrubs
  // up and down it, exactly as a pen crosses its own line while writing.
  const ax = (node as { wipeAxis?: 'x' | 'y' | 'radial' }).wipeAxis ?? 'y';
  if (ax === 'radial') return;   // a spread has no pen front to ride
  const scrub = 0.5 + 0.42 * Math.sin(dp * Math.PI * 2 * WIPE_HAND_SWEEPS);
  const fx = ax === 'x' ? node.x + node.w * dp : node.x + node.w * scrub;
  const fy = ax === 'x' ? node.y + node.h * scrub : node.y + node.h * dp;
  (node as { __penPt?: { x: number; y: number } }).__penPt = { x: fx, y: fy };
  if (!((node as { handManaged?: boolean }).handManaged && isManagedHandSuppressed())) {
    drawWriteHand(ctx, fx, fy, 42, currentTimeMs);
  }
}

// ============================================================================
// renderNodeShape - Draw node shape based on kind
// ============================================================================

export function renderNodeShape(
  ctx: CanvasRenderingContext2D,
  node: NodeModel,
  currentTimeMs: number = 0
) {
  const { x, y, w, h, kind } = node;

  if ((node as any).mesh3d) {
    drawMesh3d(ctx, node);
    return;
  }
  if ((node as any).arrowTipX !== undefined) {
    drawVector2d(ctx, node);
    return;
  }
  if ((node as any).pathPts) {
    drawPathMarker(ctx, node);
    return;
  }

  // Hard offset drop-shadow — the "sticker card" depth (distinct from the blurred
  // `glow`): a SOLID silhouette offset down-right, drawn BEHIND the node's own fill.
  // Set via node.dropShadow = { dx, dy, color, radius }. Traces the REAL outline per
  // shape so a diamond casts a diamond shadow, a circle a circle, etc. Content kinds
  // (svg/icon/text/image/lottie/algo/mesh) are skipped — depth is for solid shapes.
  const _ds = (node as any).dropShadow as
    | { dx?: number; dy?: number; color?: string; radius?: number }
    | undefined;
  const _dsKinds = new Set([
    'rect', 'circle', 'diamond', 'triangle', 'polygon', 'star',
    'cylinder', 'chevron', 'funnel', 'wedge', 'progress', 'callout', 'uml-note',
  ]);
  if (_ds && _ds.color && _dsKinds.has(kind as string)) {
    const dsx = _ds.dx ?? 7;
    const dsy = _ds.dy ?? 7;
    const dsr = _ds.radius ?? (node.cornerRadius ?? 14);
    const cx = x + w / 2 + dsx;
    const cy = y + h / 2 + dsy;
    ctx.save();
    ctx.fillStyle = _ds.color;
    ctx.beginPath();
    if (kind === 'circle') {
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (kind === 'diamond') {
      ctx.moveTo(cx, y + dsy);
      ctx.lineTo(x + w + dsx, cy);
      ctx.lineTo(cx, y + h + dsy);
      ctx.lineTo(x + dsx, cy);
      ctx.closePath();
    } else if (kind === 'triangle') {
      ctx.moveTo(cx, y + dsy);
      ctx.lineTo(x + w + dsx, y + h + dsy);
      ctx.lineTo(x + dsx, y + h + dsy);
      ctx.closePath();
    } else {
      // rect / cylinder / polygon / star / chevron / funnel / wedge / callout / uml-note
      // → a rounded-rect silhouette (a faithful-enough offset for the sticker lift).
      roundRect(ctx, x + dsx, y + dsy, w, h, dsr);
    }
    ctx.fill();
    ctx.restore();
  }

  switch (kind) {
    case 'triangle':
      drawTriangle(ctx, x, y, w, h);
      break;
    case 'polygon':
      drawPolygon(ctx, x, y, w, h, node.points || 6);
      break;
    case 'star':
      drawStar(ctx, x, y, w, h, node.points || 5, node.innerRadius || 0.5);
      break;
    case 'arrow':
      drawArrow(ctx, x, y, w, h, node.cornerRadius ?? 0);
      break;
    case 'svg': {
      const svgLayout = computeIconLayout(node, x, y, w, h);
      const svgInkSw = illustrationStrokeWidth(node, Math.min(w, h));
      if (node.svgPaths && node.svgPaths.length > 0) {
        const svgHasCrop = node.imageCropX !== undefined ||
          node.imageCropY !== undefined ||
          node.imageCropW !== undefined ||
          node.imageCropH !== undefined;
        if (svgHasCrop) {
          // Node has been resized to crop area. Draw full SVG scaled up so
          // the crop region fills the node, then clip to node bounds.
          const cropX = node.imageCropX ?? 0;
          const cropY = node.imageCropY ?? 0;
          const cropW = node.imageCropW ?? 1;
          const cropH = node.imageCropH ?? 1;
          const svgLabelH = node.label ? (node.labelFontSize || 14) + 6 : 0;
          const svgDrawH = svgLabelH > 0 ? h - svgLabelH : h;
          const fullSize = Math.max(w / cropW, svgDrawH / cropH);
          const drawX = x - cropX * fullSize;
          const drawY = y - cropY * fullSize;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, svgDrawH);
          ctx.clip();
          drawSvgPaths(
            ctx, drawX, drawY, fullSize, fullSize,
            node.svgPaths, node.svgViewBox,
            node.fill, node.stroke, svgInkSw, node.iconStyle,
            (node as any).drawProgress ?? 1
          );
          ctx.restore();
        } else if ((node as any).svgStretch) {
          // Non-square svgPaths: draw at the node's TRUE w x h (no square icon box),
          // for math grids/overlays that span a wide region and must keep their own
          // aspect. The viewBox already maps 1:1 to the node, so cells stay correct.
          drawSvgPaths(
            ctx, x, y, w, h,
            node.svgPaths, node.svgViewBox,
            node.fill, node.stroke, svgInkSw, node.iconStyle,
            (node as any).drawProgress ?? 1
          );
        } else {
          // Normal uncropped: use layout for positioning
          const bg = drawIconBackground(ctx, node, svgLayout);
          if (bg) {
            drawSvgPaths(
              ctx, bg.drawX, bg.drawY, bg.drawSize, bg.drawSize,
              node.svgPaths, node.svgViewBox,
              node.fill, node.stroke, svgInkSw, node.iconStyle,
              (node as any).drawProgress ?? 1
            );
          } else {
            drawSvgPaths(
              ctx, svgLayout.iconX, svgLayout.iconY, svgLayout.iconSize, svgLayout.iconSize,
              node.svgPaths, node.svgViewBox,
              node.fill, node.stroke, svgInkSw, node.iconStyle,
              (node as any).drawProgress ?? 1
            );
          }
        }
        _drawGestureHand(ctx, node, x, y, w, h, currentTimeMs);
      } else {
        // No svgPaths: an async character awaiting its strokes shows the "generating" placeholder;
        // else draw the background shape (if iconBg) or a fallback rect.
        if ((node as { characterPrompt?: string; illustrationPrompt?: string }).characterPrompt
            || (node as { illustrationPrompt?: string }).illustrationPrompt) {
          drawImagePlaceholder(ctx, node, currentTimeMs);
        } else if (node.iconBg) {
          drawIconBackground(ctx, node, svgLayout);
        } else {
          const svgLabelH = node.label ? (node.labelFontSize || 14) + 6 : 0;
          const svgDrawH = svgLabelH > 0 ? h - svgLabelH : h;
          roundRect(ctx, x, y, w, svgDrawH, 12);
        }
      }
      break;
    }
    case 'lottie': {
      // Use centered layout (same as icon/svg)
      const lotLayout = computeIconLayout(node, x, y, w, h);
      if (node.lottieData) {
        try {
          const segment = node.lottieSegment || [0, -1];
          const speed = node.lottieSpeed || 1;
          const totalFrames = node.lottieData.op || 60;
          const startFrame = segment[0];
          const endFrame = segment[1] === -1 ? totalFrames : segment[1];
          const duration = ((endFrame - startFrame) / (node.lottieData.fr || 30)) * 1000;
          const adjustedTime = currentTimeMs * speed;
          const progress = ((adjustedTime % duration) / duration);
          const frame = startFrame + Math.floor(progress * (endFrame - startFrame));
          const clampedFrame = Math.max(startFrame, Math.min(endFrame - 1, frame));
          renderLottieToCanvas(ctx, { ...node, y: lotLayout.iconY, h: lotLayout.iconSize }, clampedFrame);
        } catch (error) {
          console.warn('Failed to render Lottie:', error);
          ctx.save();
          ctx.fillStyle = '#1a2332';
          ctx.strokeStyle = '#4a5568';
          ctx.lineWidth = 2;
          roundRect(ctx, lotLayout.iconX, lotLayout.iconY, lotLayout.iconSize, lotLayout.iconSize, 8);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#a0aec0';
          ctx.font = '24px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🎬', lotLayout.iconX + lotLayout.iconSize / 2, lotLayout.iconY + lotLayout.iconSize / 2);
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.fillStyle = '#1a2332';
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 2;
        roundRect(ctx, lotLayout.iconX, lotLayout.iconY, lotLayout.iconSize, lotLayout.iconSize, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#a0aec0';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎬', lotLayout.iconX + lotLayout.iconSize / 2, lotLayout.iconY + lotLayout.iconSize / 2);
        ctx.restore();
      }
      break;
    }
    case 'wedge':
      drawWedge(
        ctx, x, y, w, h,
        node.startAngle ?? 0,
        node.endAngle ?? 270,
        node.innerRadius ?? 0
      );
      break;
    case 'chevron':
      drawChevron(ctx, x, y, w, h, node.pointDepth ?? 0.2);
      break;
    case 'diamond':
      drawDiamond(ctx, x, y, w, h);
      break;
    case 'funnel':
      drawFunnel(
        ctx, x, y, w, h,
        node.topWidth ?? 1,
        node.bottomWidth ?? 0.3
      );
      break;
    case 'progress':
      drawProgressTrack(ctx, x, y, w, h, node.cornerRadius ?? Math.min(w, h) / 2);
      break;
    case 'callout':
      drawCallout(
        ctx, x, y, w, h,
        node.pointerSide ?? 'S',
        node.pointerPosition ?? 0.3,
        node.pointerSize ?? 0.12,
        node.cornerRadius ?? 12
      );
      break;
    case 'uml-actor':
      // Handled specially in renderNodeCore (stroke-only, no fill path)
      break;
    case 'uml-lifeline':
      // Handled specially in renderNodeCore
      break;
    case 'uml-class':
      // Handled specially in renderNodeCore
      break;
    case 'uml-note':
      drawUmlNote(ctx, x, y, w, h);
      break;
    case 'algo-array':
      // Handled specially in renderNodeCore (cells drawn directly, no fill path)
      break;
    case 'algo-grid':
      // Handled specially in renderNodeCore (cells drawn directly, no fill path)
      break;
    case 'algo-variable':
      // Handled specially in renderNodeCore (custom rounded rect + text)
      break;
    case 'algo-pointer':
      // Handled specially in renderNodeCore (derived position from target)
      break;
    case 'algo-tree':
      // Handled specially in renderNodeCore (auto-layout circles + edges)
      break;
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'icon': {
      // Icon nodes can have SVG paths (from Iconify) - render them if present
      const icoLayout = computeIconLayout(node, x, y, w, h);
      const icoInkSw = illustrationStrokeWidth(node, Math.min(w, h));
      if (node.svgPaths && node.svgPaths.length > 0) {
        const iconHasCrop = node.imageCropX !== undefined ||
          node.imageCropY !== undefined ||
          node.imageCropW !== undefined ||
          node.imageCropH !== undefined;
        if (iconHasCrop) {
          const cropX = node.imageCropX ?? 0;
          const cropY = node.imageCropY ?? 0;
          const cropW = node.imageCropW ?? 1;
          const cropH = node.imageCropH ?? 1;
          const iconLabelH = node.label ? (node.labelFontSize || 14) + 6 : 0;
          const iconDrawH = iconLabelH > 0 ? h - iconLabelH : h;
          const fullSize = Math.max(w / cropW, iconDrawH / cropH);
          const drawX = x - cropX * fullSize;
          const drawY = y - cropY * fullSize;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, iconDrawH);
          ctx.clip();
          drawSvgPaths(
            ctx, drawX, drawY, fullSize, fullSize,
            node.svgPaths, node.svgViewBox,
            node.fill, node.stroke, icoInkSw, node.iconStyle,
            (node as any).drawProgress ?? 1
          );
          ctx.restore();
        } else if ((node as any).svgStretch) {
          // Non-square svgPaths: draw at the node's TRUE w x h (math grids that fill a
          // wide region and must keep their own aspect, not be squished to a square).
          drawSvgPaths(
            ctx, x, y, w, h,
            node.svgPaths, node.svgViewBox,
            node.fill, node.stroke, icoInkSw, node.iconStyle,
            (node as any).drawProgress ?? 1
          );
        } else {
          // Normal uncropped: use layout for positioning
          const bg = drawIconBackground(ctx, node, icoLayout);
          if (bg) {
            drawSvgPaths(
              ctx, bg.drawX, bg.drawY, bg.drawSize, bg.drawSize,
              node.svgPaths, node.svgViewBox,
              node.fill, node.stroke, icoInkSw, node.iconStyle,
              (node as any).drawProgress ?? 1
            );
          } else {
            drawSvgPaths(
              ctx, icoLayout.iconX, icoLayout.iconY, icoLayout.iconSize, icoLayout.iconSize,
              node.svgPaths, node.svgViewBox,
              node.fill, node.stroke, icoInkSw, node.iconStyle,
              (node as any).drawProgress ?? 1
            );
          }
        }
        _drawGestureHand(ctx, node, x, y, w, h, currentTimeMs);
      } else {
        // No svgPaths: draw background shape alone if iconBg set, else fallback rect
        if (node.iconBg) {
          drawIconBackground(ctx, node, icoLayout);
        } else {
          const iconLabelH = node.label ? (node.labelFontSize || 14) + 6 : 0;
          const iconDrawH = iconLabelH > 0 ? h - iconLabelH : h;
          roundRect(ctx, x, y, w, iconDrawH, node.cornerRadius ?? 12);
        }
      }
      break;
    }
    case 'cylinder':
      drawCylinder(ctx, x, y, w, h, resolveCylinderOrientation(node.cylinderOrientation, w, h));
      break;
    case 'rect':
    default:
      roundRect(ctx, x, y, w, h, node.cornerRadius ?? 12);
      break;
  }
}

// ============================================================================
// _renderEdgeLabel - Shared edge label renderer
// ============================================================================

function _renderEdgeLabel(
  ctx: CanvasRenderingContext2D,
  edge: EdgeModel,
  pts: Vec2[],
  start: number,
  end: number
): void {
  // An edge that has not started drawing in (trim 0) shows nothing, so its
  // label must not float at the source port on its own either.
  if (end - start < 1) return;
  ctx.save();
  const labelColor = edge.labelColor || 'rgba(255,255,255,0.9)';
  const labelSize = edge.labelFontSize || 12;
  const labelWeight = edge.labelFontWeight === 'bold' ? '700' : '600';
  const labelStyle = edge.labelFontStyle === 'italic' ? 'italic ' : '';
  const labelFont = edge.labelFontFamily || 'system-ui';
  const labelPosition = edge.labelPosition || 'center';
  const labelOffsetVal = edge.labelOffset || 12;
  const labelPositionT = edge.labelPositionT ?? 0.5;

  ctx.fillStyle = labelColor;
  ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textAlign = 'center';

  // Placement is computed per candidate-t so a label whose pill collides with
  // an already-drawn one can slide along its OWN edge to the first free spot
  // (see label-collision.ts — the fix for two routed edges sharing a corridor).
  const _metrics = ctx.measureText(edge.label!);
  const _textH = labelSize * 1.2;
  const _pad = edge.labelBgPadding ?? 4;

  const placeAt = (t: number) => {
    const targetDist = start + (end - start) * t;
    let sacc = 0;
    let mid = pts[0];
    let tan = { x: 1, y: 0 };
    for (let i = 1; i < pts.length; i++) {
      const pa = pts[i - 1];
      const pb = pts[i];
      const seg = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (sacc + seg >= targetDist) {
        const k = (targetDist - sacc) / seg;
        mid = { x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k) };
        const len = seg || 1;
        tan = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len };
        break;
      }
      sacc += seg;
    }
    let lx = mid.x;
    let ly = mid.y;
    let baseline: CanvasTextBaseline = 'middle';
    const normalX = -tan.y;
    const normalY = tan.x;
    if (labelPosition === 'center') {
      const centerOffset = labelOffsetVal || 6;
      lx = mid.x + normalX * centerOffset;
      ly = mid.y + normalY * centerOffset;
      baseline = 'bottom';
    } else if (labelPosition === 'above') {
      lx = mid.x + normalX * labelOffsetVal;
      ly = mid.y + normalY * labelOffsetVal;
      baseline = 'bottom';
    } else if (labelPosition === 'below') {
      lx = mid.x - normalX * labelOffsetVal;
      ly = mid.y - normalY * labelOffsetVal;
      baseline = 'top';
    }
    if (edge.labelOffsetX) lx += edge.labelOffsetX;
    if (edge.labelOffsetY) ly += edge.labelOffsetY;
    const bo = baseline === 'bottom' ? -_textH : baseline === 'top' ? 0 : -_textH / 2;
    return {
      labelX: lx, labelY: ly, tangent: tan, baseline,
      rect: { x: lx - _metrics.width / 2 - _pad, y: ly + bo - _pad,
              w: _metrics.width + _pad * 2, h: _textH + _pad * 2 },
    };
  };

  // An explicit labelPositionT is an authored choice — honor it (but still
  // register its rect so OTHER labels dodge it). Defaults try the natural
  // midpoint first, then slide along the edge.
  const _explicitT = typeof edge.labelPositionT === 'number';
  const _cands = (_explicitT ? [labelPositionT] : LABEL_T_CANDIDATES).map(placeAt);
  const _pick = _cands[claimLabelRect(_cands.map((c) => c.rect))];
  const labelX = _pick.labelX;
  const labelY = _pick.labelY;
  const tangent = _pick.tangent;
  ctx.textBaseline = _pick.baseline;

  const labelBgColor = edge.labelBgColor;
  if (labelBgColor) {
    const bgPad = edge.labelBgPadding ?? 4;
    const metrics = ctx.measureText(edge.label!);
    const textH = labelSize * 1.2;
    const baselineOffset = ctx.textBaseline === 'bottom' ? -textH : ctx.textBaseline === 'top' ? 0 : -textH / 2;

    if (edge.labelFollowEdge) {
      let angle = Math.atan2(tangent.y, tangent.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      else if (angle < -Math.PI / 2) angle += Math.PI;
      ctx.save();
      ctx.translate(labelX, labelY);
      ctx.rotate(angle);
      ctx.fillStyle = labelBgColor;
      ctx.fillRect(-metrics.width / 2 - bgPad, baselineOffset - bgPad, metrics.width + bgPad * 2, textH + bgPad * 2);
      ctx.fillStyle = labelColor;
      ctx.fillText(edge.label!, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = labelBgColor;
      ctx.fillRect(labelX - metrics.width / 2 - bgPad, labelY + baselineOffset - bgPad, metrics.width + bgPad * 2, textH + bgPad * 2);
      ctx.fillStyle = labelColor;
      ctx.fillText(edge.label!, labelX, labelY);
    }
  } else if (edge.labelFollowEdge) {
    let angle = Math.atan2(tangent.y, tangent.x);
    if (angle > Math.PI / 2) {
      angle -= Math.PI;
    } else if (angle < -Math.PI / 2) {
      angle += Math.PI;
    }
    ctx.translate(labelX, labelY);
    ctx.rotate(angle);
    ctx.fillText(edge.label!, 0, 0);
  } else {
    ctx.fillText(edge.label!, labelX, labelY);
  }
  ctx.restore();
}

// ============================================================================
// renderEdgeCore - Core edge rendering logic
// ============================================================================

/**
 * Render a single edge to the canvas.
 * Returns true if the edge was rendered, false if skipped (no path).
 */
export function renderEdgeCore(
  ctx: CanvasRenderingContext2D,
  edge: EdgeModel,
  nodes: NodeModel[],
  options: RenderEdgeOptions
): boolean {
  const { flowOffset, flowEnabled, routeMode, deferredArrowheads, roughCanvas } = options;

  ctx.save();

  // Apply edge opacity
  ctx.globalAlpha = edge.opacity ?? 1;

  const pts = getEdgePath(edge, nodes, routeMode);
  if (!pts) {
    ctx.restore();
    return false;
  }

  // ROUGH MODE: Use Rough.js for hand-drawn edge rendering
  // The marker look wins over the sketch look, including the global sketch toggle.
  if ((edge.rough ?? getGlobalSketchMode()) && roughCanvas && edge.strokeTexture !== 'marker') {
    const L = pathLen(pts);
    const rs = clamp(edge.trimStart ?? 0, 0, 1);
    const rt = clamp(edge.trim ?? 1, rs, 1);
    if (rt > rs) {
      if (rs > 0 || rt < 1) {
        // Reveal the fixed full rough drawing through a trim-length clip mask
        // so the trim/draw-on animation works without re-jittering the line.
        ctx.save();
        if (clipToTrimmedRibbon(ctx, pts, L * rs, L * rt, (edge.width || 2) + 12)) {
          drawRoughEdge(roughCanvas, edge, pts, ctx);
        }
        ctx.restore();
      } else {
        drawRoughEdge(roughCanvas, edge, pts, ctx);
      }
    }

    // Still draw arrowheads with standard rendering for clarity
    const arrow = edge.arrow || 'end';
    const color = edge.stroke || '#9aa6bc';
    const arrowOffset = edge.arrowOffset ?? 2;
    const arrowSize = edge.arrowSize ?? Math.max(7, (edge.width || 2) * 3.2);

    // The end arrowhead only appears once the line has (almost) fully drawn.
    if ((arrow === 'end' || arrow === 'both') && L > 5 && rt >= 0.985) {
      const geom = getArrowGeometryForPolyline(pts, { endpoint: 'end', atT: clamp(edge.trim ?? 1, 0, 1), arrowOffset, arrowSize });
      if (geom) {
        if (edge.arrowOnTop && deferredArrowheads) {
          deferredArrowheads.push({ backPoint: geom.backPoint, tip: geom.tip, size: arrowSize, color, lineWidth: edge.width || 2, lineDash: [], lineDashOffset: 0, extensionLine: geom.extensionLine });
        } else {
          if (geom.extensionLine) { ctx.beginPath(); ctx.moveTo(geom.extensionLine.from.x, geom.extensionLine.from.y); ctx.lineTo(geom.extensionLine.to.x, geom.extensionLine.to.y); ctx.strokeStyle = color; ctx.stroke(); }
          drawArrowhead(ctx, geom.backPoint, geom.tip, arrowSize, color);
        }
      }
    }
    if ((arrow === 'start' || arrow === 'both') && L > 5) {
      const geom = getArrowGeometryForPolyline(pts, { endpoint: 'start', atT: clamp(edge.trimStart ?? 0, 0, 1), arrowOffset, arrowSize });
      if (geom) {
        if (edge.arrowOnTop && deferredArrowheads) {
          deferredArrowheads.push({ backPoint: geom.backPoint, tip: geom.tip, size: arrowSize, color, lineWidth: edge.width || 2, lineDash: [], lineDashOffset: 0, extensionLine: geom.extensionLine });
        } else {
          if (geom.extensionLine) { ctx.beginPath(); ctx.moveTo(geom.extensionLine.from.x, geom.extensionLine.from.y); ctx.lineTo(geom.extensionLine.to.x, geom.extensionLine.to.y); ctx.strokeStyle = color; ctx.stroke(); }
          drawArrowhead(ctx, geom.backPoint, geom.tip, arrowSize, color);
        }
      }
    }

    // Edge label (rendered with standard canvas even in rough mode)
    if (edge.label) {
      const L2 = L;
      const s2 = clamp(edge.trimStart ?? 0, 0, 1);
      const t2 = clamp(edge.trim ?? 1, s2, 1);
      const start2 = L2 * s2;
      const end2 = L2 * t2;
      _renderEdgeLabel(ctx, edge, pts, start2, end2);
    }

    ctx.restore();
    return true;
  }

  const L = pathLen(pts);
  const s = clamp(edge.trimStart ?? 0, 0, 1);
  const t = clamp(edge.trim ?? 1, s, 1);
  const arrow = edge.arrow || 'end';
  const color = edge.stroke || '#9aa6bc';
  const baseSize = Math.max(7, (edge.width || 2) * 3.2);

  let start = L * s;
  let end = L * t;

  const animStyle = edge.animationStyle || (flowEnabled ? 'flow' : 'none');

  ctx.lineWidth = edge.width || 2;
  ctx.strokeStyle = color;

  // Apply animation style to line
  if (animStyle === 'flow') {
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -flowOffset;
  } else if (animStyle === 'pulse') {
    const pulsePhase = (flowOffset / 30) % (Math.PI * 2);
    ctx.lineWidth = (edge.width || 2) * (1 + Math.sin(pulsePhase) * 0.8);
  }

  // Draw edge path. The MARKER look paints a filled ink ribbon in place of this stroke;
  // everything after it (ball, arrowheads, label) is shared.
  const markerMode = edge.strokeTexture === 'marker';
  if (markerMode) {
    const md = ctx.getLineDash();
    drawMarkerEdge(ctx, edge, pts, start, end,
      md.length >= 2 ? { on: md[0], off: md[1], offset: ctx.lineDashOffset } : null);
  } else {
  ctx.beginPath();
  let drawing = false;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const pa = pts[i - 1];
    const pb = pts[i];
    const seg = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const segStart = acc;
    const segEnd = acc + seg;
    const clipA = Math.max(start, segStart);
    const clipB = Math.min(end, segEnd);

    if (clipB > clipA) {
      const k1 = (clipA - segStart) / seg;
      const k2 = (clipB - segStart) / seg;
      const x1 = lerp(pa.x, pb.x, k1);
      const y1 = lerp(pa.y, pb.y, k1);
      const x2 = lerp(pa.x, pb.x, k2);
      const y2 = lerp(pa.y, pb.y, k2);
      if (!drawing) {
        ctx.moveTo(x1, y1);
        drawing = true;
      }
      ctx.lineTo(x2, y2);
    }
    acc += seg;
  }
  // Soft glow on the edge line in vector mode (matches the glowing nodes);
  // flat in sketch mode. Reset after so arrowheads/balls don't inherit it.
  if (!getGlobalSketchMode() && edge.glow !== false) { ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.stroke(); }
  ctx.stroke();
  ctx.shadowBlur = 0;
  }

  // Draw moving ball animation
  if (animStyle === 'ball' && L > 0) {
    const numBalls = edge.ballCount || 1;
    const ballArrowOffset = edge.arrowOffset ?? 2;
    const ballArrow = edge.arrow || 'end';
    const shouldDeferBall = edge.arrowOnTop === true;
    let extendedPts = [...pts];
    let extendedL = L;

    // Extend end of path if arrow at end
    if ((ballArrow === 'end' || ballArrow === 'both') && ballArrowOffset > 0 && pts.length >= 2) {
      const lastPt = pts[pts.length - 1];
      const secondLastPt = pts[pts.length - 2];
      const dx = lastPt.x - secondLastPt.x;
      const dy = lastPt.y - secondLastPt.y;
      const len = Math.hypot(dx, dy) || 1;
      const extendedEnd = {
        x: lastPt.x + (dx / len) * ballArrowOffset,
        y: lastPt.y + (dy / len) * ballArrowOffset,
      };
      extendedPts = [...extendedPts, extendedEnd];
      extendedL += ballArrowOffset;
    }

    for (let ballIdx = 0; ballIdx < numBalls; ballIdx++) {
      const offset = (ballIdx / numBalls) * extendedL;
      const ballProgress = (((flowOffset / (edge.flowSpeed || 1)) + offset) % extendedL) / extendedL;
      const ballDist = ballProgress * extendedL;

      let accDist = 0;
      for (let i = 1; i < extendedPts.length; i++) {
        const pa = extendedPts[i - 1];
        const pb = extendedPts[i];
        const segLen = Math.hypot(pb.x - pa.x, pb.y - pa.y);

        if (accDist + segLen >= ballDist) {
          const tt = (ballDist - accDist) / segLen;
          const ballX = lerp(pa.x, pb.x, tt);
          const ballY = lerp(pa.y, pb.y, tt);

          if (shouldDeferBall && deferredArrowheads) {
            deferredArrowheads.push({
              backPoint: { x: ballX, y: ballY },
              tip: { x: ballX, y: ballY },
              size: 0,
              color,
              lineWidth: edge.width || 2,
              lineDash: [],
              lineDashOffset: 0,
              isBall: true,
              ballRadius: (edge.width || 2) * 2,
            });
          } else {
            ctx.save();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(ballX, ballY, (edge.width || 2) * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          break;
        }
        accDist += segLen;
      }
    }
  }

  // Draw arrowheads
  const arrowOffset = edge.arrowOffset ?? 2;
  const arrowSizeMultiplier = edge.arrowSize ?? 1;
  const arrowSize = baseSize * arrowSizeMultiplier;
  const shouldDeferArrow = edge.arrowOnTop === true;
  const currentLineDash = animStyle === 'flow' ? [14, 10] : [];
  const currentLineDashOffset = animStyle === 'flow' ? -flowOffset : 0;
  const visibleLength = end - start;
  const minVisibleLength = 5;

  if ((arrow === 'end' || arrow === 'both') && visibleLength >= minVisibleLength) {
    const geom = getArrowGeometryForPolyline(pts, {
      endpoint: 'end',
      atT: t,
      arrowOffset,
      arrowSize,
    });
    if (geom) {
      const { backPoint, tip, extensionLine } = geom;
      if (shouldDeferArrow && deferredArrowheads) {
        deferredArrowheads.push({
          backPoint,
          tip,
          size: arrowSize,
          color,
          lineWidth: edge.width || 2,
          lineDash: currentLineDash,
          lineDashOffset: currentLineDashOffset,
          extensionLine,
        });
      } else {
        if (extensionLine) {
          ctx.beginPath();
          ctx.moveTo(extensionLine.from.x, extensionLine.from.y);
          ctx.lineTo(extensionLine.to.x, extensionLine.to.y);
          ctx.strokeStyle = color;
          ctx.setLineDash(currentLineDash);
          ctx.lineDashOffset = currentLineDashOffset;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        }
        drawArrowhead(ctx, backPoint, tip, arrowSize, color);
      }
    }
  }

  if ((arrow === 'start' || arrow === 'both') && visibleLength >= minVisibleLength) {
    const geom = getArrowGeometryForPolyline(pts, {
      endpoint: 'start',
      atT: s,
      arrowOffset,
      arrowSize,
    });
    if (geom) {
      const { backPoint, tip, extensionLine } = geom;
      if (shouldDeferArrow && deferredArrowheads) {
        deferredArrowheads.push({
          backPoint,
          tip,
          size: arrowSize,
          color,
          lineWidth: edge.width || 2,
          lineDash: currentLineDash,
          lineDashOffset: currentLineDashOffset,
          extensionLine,
        });
      } else {
        if (extensionLine) {
          ctx.beginPath();
          ctx.moveTo(extensionLine.from.x, extensionLine.from.y);
          ctx.lineTo(extensionLine.to.x, extensionLine.to.y);
          ctx.strokeStyle = color;
          ctx.setLineDash(currentLineDash);
          ctx.lineDashOffset = currentLineDashOffset;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        }
        drawArrowhead(ctx, backPoint, tip, arrowSize, color);
      }
    }
  }

  // Reset line dash
  if (animStyle === 'flow') {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // Edge label
  if (edge.label) {
    _renderEdgeLabel(ctx, edge, pts, start, end);
  }

  ctx.restore();
  return true;
}

/** Async-generated image placeholder (Gamma-style): a node that WILL hold a generated image
 *  (node.imagePrompt) but doesn't have one yet shows a soft "generating" card + picture glyph;
 *  the image appears once the client sets node.imageData. If generation failed (imageFailed),
 *  fall back to the brand initial in a colored circle. Shared by BOTH render paths — the editor
 *  (canvas-render.ts) and export/preview (renderNodeCore) — since they're separate renderers.
 *  Returns true if it drew a placeholder. */
export function drawImagePlaceholder(
  ctx: CanvasRenderingContext2D, node: NodeModel, timeMs?: number
): boolean {
  // Also covers an async draw-on CHARACTER awaiting its strokes: a node with characterPrompt but no
  // svgPaths yet shows the same "generating" card until the client patches svgPaths in.
  const charPending = !!((node as { characterPrompt?: string; illustrationPrompt?: string }).characterPrompt
      || (node as { illustrationPrompt?: string }).illustrationPrompt)
    && !(node.svgPaths && node.svgPaths.length > 0);
  const p = (node as { imagePrompt?: string }).imagePrompt
    || (charPending ? ((node as { characterPrompt?: string }).characterPrompt
                       || (node as { illustrationPrompt?: string }).illustrationPrompt) : undefined);
  if (!p || node.imageData || (node.opacity ?? 1) <= 0) return false;
  // A failed DRAWING draws nothing. The filled-circle fallback below is the BRAND fallback (a
  // company initial in its brand color); an illustration node has no letter to put in it, so it
  // renders as a featureless colored disc next to a caption naming what should have been drawn.
  // Its own caption is a separate text node and survives, which reads far better on its own.
  if ((node as { imageFailed?: boolean }).imageFailed
      && !(node as { imagePrompt?: string }).imagePrompt) return true;
  // An OPTIONAL drawing draws nothing until it lands. The hole-filler puts a small picture into
  // whatever paper a scene leaves empty; unlike every other slot, nobody composed the scene around
  // it, so a loading card there is strictly worse than the gap it was going to fill — it turns
  // spare paper into a thing that looks broken. It still streams in the moment it resolves.
  if ((node as { illuOptional?: boolean }).illuOptional && charPending) return true;
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  ctx.save();
  ctx.globalAlpha = node.opacity ?? 1;
  if ((node as { imageFailed?: boolean }).imageFailed) {
    const col = (node as { imageFallbackColor?: string }).imageFallbackColor || '#6366f1';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(node.w, node.h) / 2, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    const letter = (node as { imageFallbackLetter?: string }).imageFallbackLetter || '';
    if (letter) {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(node.h * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letter, cx, cy);
    }
  } else {
    // A LOADING card, not an empty one. The picture glyph this used to draw was indistinguishable
    // from a broken image: three slots on a whiteboard, two drawn and one showing a grey icon,
    // reads as "that one failed" when it is only "that one has not landed yet".
    const r = Math.min((node as { rx?: number }).rx ?? 20, node.w / 4, node.h / 4);
    roundRect(ctx, node.x, node.y, node.w, node.h, r);
    ctx.fillStyle = 'rgba(120,130,160,0.14)'; ctx.fill();
    // Dashed, because the edge of something still arriving should not look settled.
    const dash = Math.max(4, Math.min(node.w, node.h) * 0.05);
    ctx.setLineDash([dash, dash * 0.8]);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,130,160,0.34)'; ctx.stroke();
    ctx.setLineDash([]);
    // Spinner: a faint full track with a bright arc sweeping around it. `timeMs` is the caller's
    // own clock (scene time while playing, wall clock while idle), so the arc turns wherever
    // frames are actually being drawn and rests at a legible angle where they are not.
    const rad = Math.min(node.w, node.h) * 0.15;
    const lw = Math.max(2, rad * 0.22);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,130,160,0.28)'; ctx.stroke();
    const spin = ((timeMs ?? 0) / 900) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath(); ctx.arc(cx, cy, rad, spin, spin + Math.PI * 1.35);
    ctx.strokeStyle = 'rgba(90,100,130,0.62)'; ctx.stroke();
  }
  ctx.restore();
  return true;
}

// ============================================================================
// renderNodeCore - Core node rendering logic
// ============================================================================

/**
 * Render a single node to the canvas.
 * Handles shapes, images, sprites, text, groups, and labels.
 */
export function renderNodeCore(
  ctx: CanvasRenderingContext2D,
  inputNode: NodeModel,
  options: RenderNodeOptions
): void {
  const { currentTimeMs, spriteCache, imageCache, allNodes } = options;

  // Skip sub-2px degenerates and true specks (BOTH dims tiny), the same guard as
  // canvas-render.ts. The old `w < 10 || h < 10` dropped every thin part in preview and
  // export only: hairlines, and a character's eyes and mouth (34x6 svg switches), so
  // faces played blank while the editor canvas showed them.
  if (inputNode.kind !== 'algo-pointer' &&
      (inputNode.w < 2 || inputNode.h < 2 || (inputNode.w < 10 && inputNode.h < 10))) return;

  // ========================================================================
  // GROUP HIERARCHY RENDERING (matches canvas-render.ts approach)
  // ========================================================================
  // For nodes with parents, we use HIERARCHICAL CANVAS TRANSFORMS:
  // 1. Build ancestor chain from root to immediate parent
  // 2. Accumulate positions and store transforms
  // 3. Apply transforms to canvas context (not to position math)
  // 4. Draw node at cumulative position + local position
  // ========================================================================

  let node = inputNode;
  let ancestorTransforms: Array<{
    cx: number;
    cy: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    scX: number;
    scY: number;
  }> | null = null;

  if (inputNode.parentId && allNodes) {
    // Build ancestor chain from root to immediate parent
    const ancestors: NodeModel[] = [];
    let current: NodeModel | undefined = inputNode;
    while (current?.parentId) {
      const parent = allNodes.find((p) => p.id === current!.parentId);
      if (!parent) break;
      ancestors.unshift(parent); // Root first
      current = parent;
    }

    // Build transform list
    ancestorTransforms = [];

    // Track cumulative position as we go down the hierarchy
    let cumulativeX = 0;
    let cumulativeY = 0;

    for (const ancestor of ancestors) {
      const ax = cumulativeX + ancestor.x;
      const ay = cumulativeY + ancestor.y;

      const rotX = ancestor.rotationX ?? 0;
      const rotY = ancestor.rotationY ?? 0;
      const rotZ = ancestor.rotationZ ?? 0;
      const scX = ancestor.scaleX ?? 1;
      const scY = ancestor.scaleY ?? 1;

      // Calculate rotation center using pivot (default to center if not specified)
      const pivotX = ancestor.pivotX ?? 0.5;
      const pivotY = ancestor.pivotY ?? 0.5;
      const cx = ax + ancestor.w * pivotX;
      const cy = ay + ancestor.h * pivotY;

      // Include transform if any rotation or non-1 scale
      if (rotX !== 0 || rotY !== 0 || rotZ !== 0 || scX !== 1 || scY !== 1) {
        ancestorTransforms.push({
          cx,
          cy,
          rotX,
          rotY,
          rotZ,
          scX,
          scY,
        });
      }

      cumulativeX = ax;
      cumulativeY = ay;
    }

    // Compute draw position: cumulative ancestor position + node's local position
    const drawX = cumulativeX + inputNode.x;
    const drawY = cumulativeY + inputNode.y;

    node = {
      ...inputNode,
      x: drawX,
      y: drawY,
      // Keep node's own rotation/scale (not accumulated - ancestors handle their own)
      rotationX: inputNode.rotationX ?? 0,
      rotationY: inputNode.rotationY ?? 0,
      rotationZ: inputNode.rotationZ ?? 0,
      scaleX: inputNode.scaleX ?? 1,
      scaleY: inputNode.scaleY ?? 1,
    };
  }

  // Continuous motion (sway / nod / flip / ...) is the small endless movement a figure or prop
  // keeps up underneath whatever the step timeline is doing to it. It lives in a shared module
  // because the editor preview and the exported video are separate render paths, and a motion
  // implemented in only one of them is a motion the customer never sees. `pulse` is the one kind
  // that moves nothing: it fades, so it folds into opacity rather than the transform.
  const motion = computeContinuousMotion(node, currentTimeMs);
  if (motion?.alphaMul != null) {
    node = { ...node, opacity: (node.opacity ?? 1) * motion.alphaMul };
  }

  ctx.save();

  // Apply ancestor transforms AFTER ctx.save() so they're properly cleaned up
  if (ancestorTransforms) {
    for (const t of ancestorTransforms) {
      ctx.translate(t.cx, t.cy);

      // Apply Z rotation (2D rotation)
      if (t.rotZ !== 0) {
        ctx.rotate((t.rotZ * Math.PI) / 180);
      }

      // Apply 3D-style rotations via scale (foreshortening effect)
      if (t.rotY !== 0) {
        const radY = (t.rotY * Math.PI) / 180;
        const scaleXFrom3D = Math.abs(Math.cos(radY));
        ctx.scale(scaleXFrom3D * t.scX, t.scY);
      } else if (t.rotX !== 0) {
        const radX = (t.rotX * Math.PI) / 180;
        const scaleYFrom3D = Math.abs(Math.cos(radX));
        ctx.scale(t.scX, scaleYFrom3D * t.scY);
      } else if (t.scX !== 1 || t.scY !== 1) {
        ctx.scale(t.scX, t.scY);
      }

      ctx.translate(-t.cx, -t.cy);
    }
  }

  // Motion goes on BEFORE the node's own transform, so the two compose rather than contend for
  // the same pivot: a sway turns about the feet while a step-timeline scale still grows the
  // figure about its own centre.
  applyMotionTransform(ctx, motion);

  // Apply node's own transforms
  if (
    node.rotationX ||
    node.rotationY ||
    node.rotationZ ||
    node.pivotX !== undefined ||
    node.pivotY !== undefined ||
    node.scaleX !== undefined ||
    node.scaleY !== undefined
  ) {
    applyNodeTransform(ctx, node);
  }

  // Check for image overlay
  let hasImage = false;
  // Reserve label space below image (matches editor canvas-render.ts)
  let imgLabelH = 0;
  let imgDrawH = node.h;
  let imgContentY = node.y;
  drawImagePlaceholder(ctx, node, currentTimeMs);

  if (node.imageData && node.label) {
    const imgGap = node.labelPadding ?? getDefaultLabelPadding(node);
    imgLabelH = (node.labelFontSize || 14) + 6;
    imgDrawH = Math.max(0, node.h - imgLabelH - imgGap);
    const imgContentH = imgDrawH + imgGap + imgLabelH;
    imgContentY = node.y + (node.h - imgContentH) / 2;
  }
  // Image nodes must honor opacity like every other kind — without this an
  // opacity-0 (hidden) image still drew at full alpha in exports/headless.
  if (node.imageData && (node.opacity ?? 1) > 0) {
    ctx.globalAlpha = node.opacity ?? 1;
    // Try animated sprite first
    if (spriteCache) {
      const sprite = spriteCache.get(node.imageData);
      if (sprite) {
        const frame = getSpriteFrameAt(sprite, currentTimeMs);
        if (frame) {
          try {
            ctx.save();
            // Use a simple geometric clip path instead of renderNodeShape,
            // which draws SVG/Lottie content for those node kinds and leaves
            // no usable clip path.
            const clipShape = node.imageCropShape || (node.kind === 'circle' ? 'ellipse' : node.kind === 'rect' ? 'rectangle' : 'rounded');
            ctx.beginPath();
            if (clipShape === 'ellipse') {
              ctx.ellipse(node.x + node.w / 2, node.y + node.h / 2, node.w / 2, node.h / 2, 0, 0, Math.PI * 2);
            } else if (clipShape === 'rounded') {
              const radius = Math.min(node.cornerRadius ?? 24, node.w / 4, node.h / 4);
              roundRect(ctx, node.x, node.y, node.w, node.h, radius);
            } else {
              ctx.rect(node.x, node.y, node.w, node.h);
            }
            ctx.clip();
            // draw-on wipe (see static path): applied around the drawImage below

            // Apply crop if defined (same as static images)
            const cropX = node.imageCropX ?? 0;
            const cropY = node.imageCropY ?? 0;
            const cropW = node.imageCropW ?? 1;
            const cropH = node.imageCropH ?? 1;
            // VideoFrame uses displayWidth/displayHeight; ImageBitmap uses width/height
            const f = frame as any;
            const frameWidth = f.displayWidth ?? f.width ?? node.w;
            const frameHeight = f.displayHeight ?? f.height ?? node.h;
            const sx = cropX * frameWidth;
            const sy = cropY * frameHeight;
            const sw = cropW * frameWidth;
            const sh = cropH * frameHeight;

            drawImageWithWipe(ctx, node, () => ctx.drawImage(frame as any, sx, sy, sw, sh, node.x, imgContentY, node.w, imgDrawH));
            ctx.restore();
            ctx.beginPath();
            ctx.lineWidth = 0;
            ctx.strokeStyle = 'transparent';
            hasImage = true;

            // Draw border
            if (!isTransparentColor(node.stroke) && node.strokeWidth !== undefined && node.strokeWidth > 0) {
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
              ctx.setLineDash([]);
              ctx.beginPath();
              roundRect(ctx, node.x, node.y, node.w, node.h, node.cornerRadius ?? 8);
              ctx.lineWidth = node.strokeWidth;
              ctx.strokeStyle = node.stroke!;
              ctx.stroke();
            }
          } catch (error) {
            console.warn('Failed to draw sprite frame:', error);
            hasImage = false;
          }
        }
      }
    }

    // Try static image cache
    if (!hasImage && imageCache) {
      const img = imageCache.get(node.imageData);
      if (img && img.complete) {
        try {
          // Icon-with-background (rasterized gradient SVG icons): draw the iconBg
          // shape, then the image into its padded inner area — mirrors the editor
          // canvas so export keeps the background the plain image draw would skip.
          const iconBgLayout = node.iconBg ? computeIconLayout(node, node.x, node.y, node.w, node.h) : null;
          const iconBgArea = iconBgLayout ? drawIconBackground(ctx, node, iconBgLayout) : null;
          if (iconBgArea) {
            ctx.drawImage(img, iconBgArea.drawX, iconBgArea.drawY, iconBgArea.drawSize, iconBgArea.drawSize);
            hasImage = true;
          } else {
          ctx.save();
          const clipShape = node.imageCropShape || (node.kind === 'circle' ? 'ellipse' : node.kind === 'rect' ? 'rectangle' : 'rounded');
          ctx.beginPath();
          if (clipShape === 'ellipse') {
            const centerX = node.x + node.w / 2;
            const centerY = node.y + node.h / 2;
            ctx.ellipse(centerX, centerY, node.w / 2, node.h / 2, 0, 0, Math.PI * 2);
          } else if (clipShape === 'rounded') {
            const radius = Math.min(24, node.w / 4, node.h / 4);
            ctx.moveTo(node.x + radius, node.y);
            ctx.lineTo(node.x + node.w - radius, node.y);
            ctx.quadraticCurveTo(node.x + node.w, node.y, node.x + node.w, node.y + radius);
            ctx.lineTo(node.x + node.w, node.y + node.h - radius);
            ctx.quadraticCurveTo(node.x + node.w, node.y + node.h, node.x + node.w - radius, node.y + node.h);
            ctx.lineTo(node.x + radius, node.y + node.h);
            ctx.quadraticCurveTo(node.x, node.y + node.h, node.x, node.y + node.h - radius);
            ctx.lineTo(node.x, node.y + radius);
            ctx.quadraticCurveTo(node.x, node.y, node.x + radius, node.y);
          } else {
            ctx.rect(node.x, node.y, node.w, node.h);
          }
          ctx.clip();
          // Draw-on wipe: reveal the image top-to-bottom as drawProgress climbs 0 -> 1 (a "sketched
          // in" reveal, for whiteboard mode). The marker nib (drawImageWipeHand) rides this reveal
          // line. Intersects the shape clip; drawProgress defaults to 1. `wipeAxis: 'x'` runs it
          // left to right instead — see types.ts; a word uncovered downwards arrives as a row of
          // half-letters.
          // `wipeAxis: 'radial'` spreads it out from `wipeOrigin` with a soft front instead; see
          // image-wipe.ts. Applied around the drawImage below.

          const cropX = node.imageCropX ?? 0;
          const cropY = node.imageCropY ?? 0;
          const cropW = node.imageCropW ?? 1;
          const cropH = node.imageCropH ?? 1;
          const sx = cropX * img.width;
          const sy = cropY * img.height;
          const sw = cropW * img.width;
          const sh = cropH * img.height;
          drawImageWithWipe(ctx, node, () => ctx.drawImage(img, sx, sy, sw, sh, node.x, imgContentY, node.w, imgDrawH));
          ctx.restore();
          ctx.beginPath();
          ctx.lineWidth = 0;
          ctx.strokeStyle = 'transparent';
          hasImage = true;

          // Draw border
          if (!isTransparentColor(node.stroke) && node.strokeWidth !== undefined && node.strokeWidth > 0) {
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.setLineDash([]);
            renderNodeShape(ctx, node, currentTimeMs);
            ctx.lineWidth = node.strokeWidth;
            ctx.strokeStyle = node.stroke!;
            ctx.stroke();
          }
          } // end else (non-iconBg image draw)
        } catch (error) {
          console.warn('Failed to draw static image:', error);
          hasImage = false;
        }
      }
    }
  }

  // Marker hand riding an image draw-on wipe (drawn over the revealed image).
  drawImageWipeHand(ctx, node, currentTimeMs);

  // Image-rendered icon nodes still need their label. The label-drawing block below
  // only runs when !hasImage, so once a rasterized/gradient icon (imageData) is
  // drawn, its caption was silently dropped. Draw it here for icon kinds.
  if (hasImage && node.label && (node.kind === 'icon' || node.kind === 'svg' || node.kind === 'lottie')) {
    const imgIconLblColor = node.labelColor || '#334155';
    const imgIconLblSize = node.labelFontSize || 14;
    const imgIconLblWeight = node.labelFontWeight === 'bold' ? '700' : '600';
    const imgIconLblStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
    const imgIconLblFont = node.labelFontFamily || 'system-ui';
    const imgIconLblLayout = computeIconLayout(node, node.x, node.y, node.w, node.h);
    ctx.save();
    ctx.fillStyle = imgIconLblColor;
    ctx.font = `${imgIconLblStyle}${imgIconLblWeight} ${imgIconLblSize}px ${imgIconLblFont}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawIconLabel(ctx, node.label, node.x + node.w / 2, imgIconLblLayout.labelY, node.w - 4, imgIconLblSize + 4, node.labelOverflow ?? 'visible');
    ctx.restore();
  }

  // Draw regular node if no image
  if (!hasImage) {
    ctx.globalAlpha = node.opacity ?? 1;
    ctx.globalCompositeOperation = 'source-over';

    // ROUGH MODE: Use Rough.js for hand-drawn rendering.
    // An explicit `rough: false` is an OPT-OUT, not an absent opt-in: window chrome, a phone
    // body, a flat colour wash and a legend dot are all authored as "never hand-drawn", and a
    // sketch theme used to override every one of them because the flag was only ever OR'd in.
    if ((node.rough ?? getGlobalSketchMode()) && options.roughCanvas && supportsRoughRendering(node.kind)) {
      drawRoughNode(options.roughCanvas, node, ctx);
      // Labels should still be crisp — render with standard canvas
      if (node.label) {
        const isIconKindRough = node.kind === 'icon' || node.kind === 'svg' || node.kind === 'lottie';
        const labelColor = node.labelColor || (isIconKindRough ? '#334155' : '#e6edf3');
        const labelSize = node.labelFontSize || 14;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : '600';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';

        if (isIconKindRough) {
          const labelLayout = computeIconLayout(node, node.x, node.y, node.w, node.h);
          const textY = labelLayout.labelY;
          ctx.save();
          ctx.fillStyle = labelColor;
          ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          drawIconLabel(ctx, node.label, node.x + node.w / 2, textY, node.w - 4, labelSize + 4, node.labelOverflow ?? 'visible');
          ctx.restore();
        } else {
          drawWrappedNodeLabel(ctx, node.label, node.x, node.y, node.w, node.h, {
            labelColor,
            labelSize,
            labelWeight,
            labelStyle,
            labelFont,
            textAlign: node.textAlign,
            verticalAlign: node.verticalAlign,
            padding: node.labelPadding,
            labelTextAlign: node.labelTextAlign,
            labelRotation: node.labelRotation,
            // A diamond's usable interior is ~half its bounding box — wrap/shrink
            // the label to the inscribed rectangle so it doesn't spill past the points.
            insetScale: node.kind === 'diamond' ? 0.5 : 1,
          });
        }
      }
    } else if (node.kind === 'group') {
      roundRect(ctx, node.x, node.y, node.w, node.h, 12);
      // Don't fill if fill is 'transparent', 'none', or falsy
      if (node.fill && node.fill !== 'transparent' && node.fill !== 'none') {
        applyFillStyle(ctx, node.fill, node.x, node.y, node.w, node.h, 'transparent');
        ctx.fill();
      }
      if (!isTransparentColor(node.stroke) && node.strokeWidth !== undefined && node.strokeWidth > 0) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke!;
        if (node.strokeDashArray) {
          ctx.setLineDash(node.strokeDashArray);
          ctx.lineDashOffset = node.strokeDashOffset || 0;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (node.label) {
        const labelColor = node.labelColor || '#8ab4f8';
        const labelSize = node.labelFontSize || 12;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : '600';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';
        ctx.fillStyle = labelColor;
        ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, node.x + 8, node.y + 8);
      }
    } else if (node.kind === 'glyph') {
      drawGlyph(ctx, node as never, currentTimeMs);
    } else if (node.kind === 'text') {
      ctx.save();
      // Default to transparent (no background/border) for text nodes
      const textFill = node.fill || 'transparent';
      const textStroke = node.stroke || 'transparent';
      if (!isTransparentColor(textFill)) {
        roundRect(ctx, node.x, node.y, node.w, node.h, 8);
        applyFillStyle(ctx, textFill, node.x, node.y, node.w, node.h);
        ctx.fill();
      }
      if (!isTransparentColor(textStroke)) {
        ctx.beginPath();
        roundRect(ctx, node.x, node.y, node.w, node.h, 8);
        ctx.lineWidth = node.strokeWidth ?? 2;
        ctx.strokeStyle = textStroke;
        ctx.stroke();
      }
      // Clip text to the node box — EXCEPT write-on titles, whose marker hand
      // deliberately extends below/beside the (short) title box.
      if (!(node as { writeHand?: boolean }).writeHand) {
        ctx.beginPath();
        roundRect(ctx, node.x, node.y, node.w, node.h, 8);
        ctx.clip();
      }
      drawTextNode(ctx, node, currentTimeMs);
      ctx.restore();
    } else if (node.kind === 'algo-array') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoArray(ctx, node);
    } else if (node.kind === 'algo-grid') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoGrid(ctx, node);
    } else if (node.kind === 'algo-variable') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoVariable(ctx, node);
    } else if (node.kind === 'algo-pointer') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoPointer(ctx, node, allNodes || []);
    } else if (node.kind === 'algo-tree') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoTree(ctx, node);
    } else if (node.kind === 'algo-linked-list') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoLinkedList(ctx, node);
    } else if (node.kind === 'algo-graph') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoGraph(ctx, node);
    } else if (node.kind === 'algo-chart') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoChart(ctx, node);
    } else if (node.kind === 'algo-chart-line') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoChartLine(ctx, node);
    } else if (node.kind === 'algo-chart-scatter') {
      ctx.globalAlpha = node.opacity ?? 1;
      drawAlgoChartScatter(ctx, node);
    } else if (node.kind === 'uml-actor') {
      // UML stick figure — stroke-only, no fill path
      ctx.globalAlpha = node.opacity ?? 1;
      const effectiveStrokeWidth = node.strokeWidth ?? 2;
      ctx.lineWidth = effectiveStrokeWidth;
      ctx.strokeStyle = node.stroke || '#1e293b';
      drawUmlActor(ctx, node.x, node.y, node.w, node.h);
      // Label below the figure
      if (node.label) {
        const labelColor = node.labelColor || '#1e293b';
        const labelSize = node.labelFontSize || 14;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : '600';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';
        ctx.fillStyle = labelColor;
        ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(node.label, node.x + node.w / 2, node.y + node.h + labelSize + 4);
      }
    } else if (node.kind === 'uml-lifeline') {
      // UML lifeline — header rect + dashed vertical line + activation bars
      ctx.globalAlpha = node.opacity ?? 1;
      const effectiveStrokeWidth = node.strokeWidth ?? 2;
      ctx.lineWidth = effectiveStrokeWidth;
      ctx.strokeStyle = node.stroke || '#2563eb';
      applyFillStyle(ctx, node.fill, node.x, node.y, node.w, node.h);
      const llHead = (node as any).lifelineHead as ('box' | 'actor' | 'icon' | undefined);
      drawUmlLifeline(ctx, node.x, node.y, node.w, node.h, node.lifelineLength, node.activations, llHead || 'box', node.svgPaths as any, (node as any).svgViewBox, node.labelColor || '#cbd5e1');
      if (node.label) {
        const labelColor = node.labelColor || '#1e293b';
        const labelSize = node.labelFontSize || 14;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : '600';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';
        ctx.fillStyle = labelColor;
        ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        if (llHead === 'actor' || llHead === 'icon') { ctx.textBaseline = 'top'; ctx.fillText(node.label, node.x + node.w / 2, node.y + 50); }
        else { ctx.textBaseline = 'middle'; ctx.fillText(node.label, node.x + node.w / 2, node.y + 25); }
      }
    } else if (node.kind === 'uml-class') {
      // UML class box — 3 compartments
      ctx.globalAlpha = node.opacity ?? 1;
      const effectiveStrokeWidth = node.strokeWidth ?? 2;
      ctx.lineWidth = effectiveStrokeWidth;
      ctx.strokeStyle = node.stroke || '#ca8a04';
      applyFillStyle(ctx, node.fill, node.x, node.y, node.w, node.h);
      const textColor = node.labelColor || '#1e293b';
      drawUmlClassBox(ctx, node.x, node.y, node.w, node.h, node.attributes, node.methods, textColor, node.stereotype);
      // Label (class name) in the top compartment
      if (node.label) {
        const labelColor = node.labelColor || '#1e293b';
        const labelSize = node.labelFontSize || 14;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : 'bold';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';
        const nameH = Math.max(36, node.h * 0.25);
        ctx.fillStyle = labelColor;
        ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Shift label down when stereotype is present
        const labelY = node.stereotype ? node.y + nameH * 0.65 : node.y + nameH / 2;
        ctx.fillText(node.label, node.x + node.w / 2, labelY);
      }
    } else if (node.kind === 'uml-note') {
      // UML note — rectangle with folded top-right corner
      ctx.globalAlpha = node.opacity ?? 1;
      const effectiveStrokeWidth = node.strokeWidth ?? 2;
      ctx.lineWidth = effectiveStrokeWidth;
      ctx.strokeStyle = node.stroke || '#f59e0b';
      applyFillStyle(ctx, node.fill, node.x, node.y, node.w, node.h);
      drawUmlNote(ctx, node.x, node.y, node.w, node.h);
      ctx.fill();
      ctx.stroke();
      drawUmlNoteFold(ctx, node.x, node.y, node.w, node.h);
      // Label text inside the note
      if (node.label) {
        const labelColor = node.labelColor || '#1e293b';
        const labelSize = node.labelFontSize || 12;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : '400';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';
        const padding = node.labelPadding ?? getDefaultLabelPadding(node);
        const textAlign = node.labelTextAlign || 'left';
        ctx.fillStyle = labelColor;
        ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'top';
        const textX = textAlign === 'center' ? node.x + node.w / 2 : textAlign === 'right' ? node.x + node.w - padding : node.x + padding;
        const maxW = node.w - padding * 2;
        // Simple word-wrap for note text
        const words = node.label.split(' ');
        let line = '';
        let ty = node.y + 20 + padding; // below fold area
        for (const word of words) {
          const test = line ? line + ' ' + word : word;
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, textX, ty);
            line = word;
            ty += labelSize * 1.3;
          } else {
            line = test;
          }
        }
        if (line) ctx.fillText(line, textX, ty);
      }
    } else {
      // Apply opacity BEFORE rendering (affects SVG, Lottie, and all other shapes)
      ctx.globalAlpha = node.opacity ?? 1;
      ctx.globalCompositeOperation = 'source-over';

      renderNodeShape(ctx, node, currentTimeMs);

      // For icon nodes with SVG paths, renderNodeShape already handles drawing internally
      const isIconWithSvg = node.kind === 'icon' && node.svgPaths && node.svgPaths.length > 0;
      // mesh3d + vector2d nodes draw their own shape in renderNodeShape → skip the
      // outer fill/stroke, which would clobber it with the node's flat fill.
      if (node.kind !== 'svg' && node.kind !== 'lottie' && !isIconWithSvg && !(node as any).mesh3d && (node as any).arrowTipX === undefined && !(node as any).pathPts) {
        applyFillStyle(ctx, node.fill, node.x, node.y, node.w, node.h);
        ctx.fill();

        // Cylinder: fill cap face with a 3D gradient effect (top for vertical, left for horizontal)
        if (node.kind === 'cylinder') {
          const isHoriz = resolveCylinderOrientation(node.cylinderOrientation, node.w, node.h) === 'horizontal';
          let cx: number, cy: number, capRx: number, capRy: number, gradRadius: number;
          if (isHoriz) {
            capRx = Math.min(node.h * 0.32, node.w * 0.22);
            capRy = node.h / 2;
            cx = node.x + capRx;
            cy = node.y + node.h / 2;
            gradRadius = node.h / 2;
          } else {
            const ry = node.h * 0.12;
            capRx = node.w / 2;
            capRy = ry;
            cx = node.x + node.w / 2;
            cy = node.y + ry;
            gradRadius = node.w / 2;
          }
          ctx.beginPath();
          ctx.ellipse(cx, cy, capRx, capRy, 0, 0, Math.PI * 2, false);
          ctx.closePath();
          const baseFill = getGradientBaseColor(node.fill) || '#ffffff';
          if (node.cylinderTopFill) {
            ctx.fillStyle = node.cylinderTopFill;
          } else {
            // Radial gradient: lighter center fading to slightly lighter than body
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, gradRadius);
            grad.addColorStop(0, lightenColor(baseFill, 0.45));
            grad.addColorStop(1, lightenColor(baseFill, 0.2));
            ctx.fillStyle = grad;
          }
          ctx.fill();
          // Re-create body path so the stroke below applies to the body, not the cap ellipse
          renderNodeShape(ctx, node, currentTimeMs);
        }

        // Progress bar: draw colored fill portion on top of track
        if (node.kind === 'progress') {
          const pVal = Math.max(0, Math.min(1, node.value ?? 0.5));
          const pOrientation = node.progressOrientation ?? 'horizontal';
          ctx.save();
          renderNodeShape(ctx, node, currentTimeMs);
          ctx.clip();
          ctx.fillStyle = node.progressColor || '#3b82f6';
          if (pOrientation === 'horizontal') {
            ctx.fillRect(node.x, node.y, node.w * pVal, node.h);
          } else {
            ctx.fillRect(node.x, node.y + node.h * (1 - pVal), node.w, node.h * pVal);
          }
          ctx.restore();
          // Re-draw track path for stroke
          renderNodeShape(ctx, node, currentTimeMs);
        }

        const effectiveStrokeWidth = node.strokeWidth ?? 2;
        if (!isTransparentColor(node.stroke) && effectiveStrokeWidth > 0) {
          ctx.lineWidth = effectiveStrokeWidth;
          ctx.strokeStyle = node.stroke!;

          const trimStart = node.strokeTrimStart ?? 0;
          const trimEnd = node.strokeTrimEnd ?? 1;
          const hasTrim = trimStart > 0 || trimEnd < 1;

          if (hasTrim) {
            let pathLength: number;
            if (node.kind === 'circle') {
              const a = node.w / 2;
              const b = node.h / 2;
              pathLength = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
            } else {
              pathLength = 2 * (node.w + node.h);
            }
            const visibleLen = (trimEnd - trimStart) * pathLength;
            const gapLen = pathLength - visibleLen;
            ctx.setLineDash([visibleLen, gapLen]);
            ctx.lineDashOffset = -trimStart * pathLength + (node.strokeDashOffset || 0);
          } else if (node.strokeDashArray) {
            ctx.setLineDash(node.strokeDashArray);
            ctx.lineDashOffset = node.strokeDashOffset || 0;
          }

          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Cylinder: draw the back arc of the cap ellipse (3D depth line) + any segment dividers.
      if (node.kind === 'cylinder') {
        const cylOrient = resolveCylinderOrientation(node.cylinderOrientation, node.w, node.h);
        drawCylinderTopArc(ctx, node.x, node.y, node.w, node.h, cylOrient);
        const effectiveSW = node.strokeWidth ?? 2;
        if (!isTransparentColor(node.stroke) && effectiveSW > 0) {
          ctx.lineWidth = effectiveSW;
          ctx.strokeStyle = node.stroke!;
          ctx.stroke();
        }
        const segs = node.cylinderSegments ?? 1;
        if (segs > 1 && !isTransparentColor(node.stroke) && effectiveSW > 0) {
          drawCylinderSegmentDividers(ctx, node.x, node.y, node.w, node.h, segs, cylOrient);
          ctx.lineWidth = effectiveSW;
          ctx.strokeStyle = node.stroke!;
          ctx.stroke();
        }
      }

      if (node.label) {
        // Icon/SVG/Lottie nodes use a darker default — their labels sit below the icon,
        // often on light container backgrounds where #e6edf3 is invisible
        const isIconKind = node.kind === 'icon' || node.kind === 'svg' || node.kind === 'lottie';
        const labelColor = node.labelColor || (isIconKind ? '#334155' : '#e6edf3');
        const labelSize = node.labelFontSize || 14;
        const labelWeight = node.labelFontWeight === 'bold' ? '700' : '600';
        const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
        const labelFont = node.labelFontFamily || 'system-ui';

        if (isIconKind) {
          // For icon/svg/lottie nodes — overflow: visible wraps, ellipsis truncates.
          const labelLayout = computeIconLayout(node, node.x, node.y, node.w, node.h);
          const textY = labelLayout.labelY;

          ctx.save();
          ctx.fillStyle = labelColor;
          ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          drawIconLabel(ctx, node.label, node.x + node.w / 2, textY, node.w - 4, labelSize + 4, node.labelOverflow ?? 'visible');
          ctx.restore();
        } else {
          drawWrappedNodeLabel(ctx, node.label, node.x, node.y, node.w, node.h, {
            labelColor,
            labelSize,
            labelWeight,
            labelStyle,
            labelFont,
            textAlign: node.textAlign,
            verticalAlign: node.verticalAlign,
            padding: node.labelPadding,
            labelTextAlign: node.labelTextAlign,
            labelRotation: node.labelRotation,
            // A diamond's usable interior is ~half its bounding box — wrap/shrink
            // the label to the inscribed rectangle so it doesn't spill past the points.
            insetScale: node.kind === 'diamond' ? 0.5 : 1,
          });
        }
      }
    }
  }

  // Draw label below image (outside !hasImage block so it renders on top)
  if (hasImage && node.label && imgLabelH > 0) {
    const labelColor = node.labelColor || '#e6edf3';
    const labelSize = node.labelFontSize || 14;
    const labelWeight = node.labelFontWeight === 'bold' ? '700' : '600';
    const labelStyle = node.labelFontStyle === 'italic' ? 'italic ' : '';
    const labelFont = node.labelFontFamily || 'system-ui';
    const imgGap = node.labelPadding ?? getDefaultLabelPadding(node);
    const imgTextY = imgContentY + imgDrawH + imgGap + imgLabelH / 2;

    ctx.save();
    ctx.globalAlpha = node.opacity ?? 1;
    ctx.fillStyle = labelColor;
    ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    drawIconLabel(ctx, node.label, node.x + node.w / 2, imgTextY, node.w - 4, labelSize + 4, node.labelOverflow ?? 'visible');
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// renderPhantomCore - Core phantom node rendering logic
// ============================================================================

/**
 * Helper to draw phantom node label (always upright, readable)
 */
function drawPhantomLabel(
  ctx: CanvasRenderingContext2D,
  phantom: PhantomNode,
  cx: number,
  cy: number
) {
  const labelText = phantom.label || (phantom.kind === 'text' ? phantom.text : '') || '';
  if (!labelText) return;

  ctx.save();
  ctx.globalAlpha = phantom.opacity;
  ctx.fillStyle = '#e6edf3';

  const maxWidth = phantom.w * 0.9;
  const maxHeight = phantom.h * 0.8;
  let fontSize = Math.min(14 * phantom.scale, maxHeight * 0.6);

  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  const textWidth = ctx.measureText(labelText).width;

  if (textWidth > maxWidth && maxWidth > 0) {
    fontSize = fontSize * (maxWidth / textWidth);
    fontSize = Math.max(6, fontSize);
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, cx, cy);
  ctx.restore();
}

/**
 * Render a single phantom node to the canvas.
 */
export function renderPhantomCore(
  ctx: CanvasRenderingContext2D,
  phantom: PhantomNode,
  options: RenderPhantomOptions
): void {
  const { currentTimeMs, imageCache } = options;

  const cx = phantom.x + phantom.w / 2;
  const cy = phantom.y + phantom.h / 2;

  ctx.save();
  ctx.globalAlpha = phantom.opacity;

  // Lottie phantom
  if (phantom.lottieData && phantom.templateId) {
    const fps = 30;
    const frame = Math.floor((currentTimeMs / 1000) * fps) % 60;
    const rendered = renderLottieFromData(
      ctx,
      phantom.templateId,
      phantom.lottieData,
      phantom.x,
      phantom.y,
      phantom.w,
      phantom.h,
      phantom.opacity,
      frame
    );
    if (rendered) {
      ctx.restore();
      drawPhantomLabel(ctx, phantom, cx, cy);
      return;
    }
  }

  // SVG phantom
  if (phantom.svgPaths && phantom.svgPaths.length > 0) {
    drawSvgPaths(
      ctx,
      phantom.x,
      phantom.y,
      phantom.w,
      phantom.h,
      phantom.svgPaths,
      phantom.svgViewBox
    );
    ctx.restore();
    drawPhantomLabel(ctx, phantom, cx, cy);
    return;
  }

  // Image phantom
  if (phantom.imageData && imageCache) {
    const img = imageCache.get(phantom.imageData);
    if (img && img.complete) {
      ctx.save();
      ctx.beginPath();
      if (phantom.kind === 'circle') {
        ctx.ellipse(cx, cy, phantom.w / 2, phantom.h / 2, 0, 0, Math.PI * 2);
      } else {
        roundRect(ctx, phantom.x, phantom.y, phantom.w, phantom.h, 8 * phantom.scale);
      }
      ctx.clip();
      ctx.drawImage(img, phantom.x, phantom.y, phantom.w, phantom.h);
      ctx.restore();

      if (!isTransparentColor(phantom.stroke) && phantom.strokeWidth !== undefined && phantom.strokeWidth > 0) {
        ctx.beginPath();
        if (phantom.kind === 'circle') {
          ctx.ellipse(cx, cy, phantom.w / 2, phantom.h / 2, 0, 0, Math.PI * 2);
        } else {
          roundRect(ctx, phantom.x, phantom.y, phantom.w, phantom.h, 8 * phantom.scale);
        }
        ctx.strokeStyle = phantom.stroke!;
        ctx.lineWidth = phantom.strokeWidth;
        ctx.stroke();
      }
      ctx.restore();
      drawPhantomLabel(ctx, phantom, cx, cy);
      return;
    }
  }

  // Regular shape phantom with rotation
  if (phantom.rotation !== undefined) {
    ctx.translate(cx, cy);
    ctx.rotate((phantom.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  ctx.beginPath();
  if (phantom.kind === 'circle') {
    ctx.ellipse(cx, cy, phantom.w / 2, phantom.h / 2, 0, 0, Math.PI * 2);
    applyFillStyle(ctx, phantom.fill, phantom.x, phantom.y, phantom.w, phantom.h);
    ctx.fill();
    if (!isTransparentColor(phantom.stroke) && phantom.strokeWidth !== undefined && phantom.strokeWidth > 0) {
      ctx.strokeStyle = phantom.stroke!;
      ctx.lineWidth = phantom.strokeWidth;
      ctx.stroke();
    }
  } else if (phantom.kind === 'text' && phantom.text) {
    // Text nodes handled by label
  } else {
    roundRect(ctx, phantom.x, phantom.y, phantom.w, phantom.h, 8 * phantom.scale);
    applyFillStyle(ctx, phantom.fill, phantom.x, phantom.y, phantom.w, phantom.h);
    ctx.fill();
    if (!isTransparentColor(phantom.stroke) && phantom.strokeWidth !== undefined && phantom.strokeWidth > 0) {
      ctx.strokeStyle = phantom.stroke!;
      ctx.lineWidth = phantom.strokeWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
  drawPhantomLabel(ctx, phantom, cx, cy);
}

// ============================================================================
// renderDeferredArrowheads - Draw collected arrowheads on top of nodes
// ============================================================================

/**
 * Render deferred arrowheads and balls on top of all nodes.
 */
export function renderDeferredArrowheads(
  ctx: CanvasRenderingContext2D,
  deferredArrowheads: DeferredArrowhead[]
): void {
  for (const arrow of deferredArrowheads) {
    if (arrow.isBall && arrow.ballRadius) {
      ctx.save();
      ctx.fillStyle = arrow.color;
      ctx.shadowColor = arrow.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(arrow.backPoint.x, arrow.backPoint.y, arrow.ballRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.lineWidth = arrow.lineWidth;
    ctx.strokeStyle = arrow.color;

    if (arrow.extensionLine) {
      ctx.beginPath();
      ctx.moveTo(arrow.extensionLine.from.x, arrow.extensionLine.from.y);
      ctx.lineTo(arrow.extensionLine.to.x, arrow.extensionLine.to.y);
      ctx.setLineDash(arrow.lineDash);
      ctx.lineDashOffset = arrow.lineDashOffset;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    drawArrowhead(ctx, arrow.backPoint, arrow.tip, arrow.size, arrow.color);
    ctx.restore();
  }
}

