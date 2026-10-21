/* eslint-disable -- Migrated file */
/**
 * Scene Compositor (Layer 3)
 *
 * Composes the full scene by orchestrating entity renderers.
 * Handles z-ordering, layer interleaving, and deferred rendering.
 * 
 * This is the shared core used by both:
 * - renderCanvas() in canvas-render.ts (editor)
 * - drawScene() in rendering-utils.ts (exports)
 */

import type {
  NodeModel,
  EdgeModel,
  SpriteCache,
  PhantomNode,
  Camera,
} from '../types';

import {
  renderEdgeCore,
  renderNodeCore,
  renderPhantomCore,
  renderDeferredArrowheads,
  type DeferredArrowhead,
  type RenderEdgeOptions,
  type RenderNodeOptions,
} from './entity-renderers';
import { drawNodeGlowBehind, drawNodeGlowStroke } from './node-glow';
import { applyNodeTransform } from './geometry-utils';
import { computeContinuousMotion, applyMotionTransform } from './continuous-motion';
import { getRoughCanvas } from './rough-renderer';
import { prepareEdgeBundle } from './edge-bundle';
import { resetLabelCollisions } from './label-collision';

// ============================================================================
// Types
// ============================================================================

/** Options for scene rendering */
export interface RenderSceneCoreOptions {
  /** Camera transform (position and zoom) */
  camera: Camera;
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Show grid overlay */
  showGrid?: boolean;
  /** Grid cell size */
  gridSize?: number;
  /** Enable flow animation on edges without explicit animation style */
  flowEnabled?: boolean;
  /** Per-edge flow offsets (animation state) */
  flowOffsets?: Map<string, number>;
  /** Global flow offset for edges without per-edge state */
  globalFlowOffset?: number;
  /** Current animation time in milliseconds */
  currentTimeMs?: number;
  /** Sprite cache for animated images */
  spriteCache?: SpriteCache;
  /** Image cache for static images */
  imageCache?: Map<string, HTMLImageElement>;
  /** Route mode settings for edge routing */
  routeMode?: Record<string, any>;
  /** Background color (used for grid rendering) */
  backgroundColor?: string;
}

/** Result of scene rendering */
export interface RenderSceneCoreResult {
  /** Deferred arrowheads that were rendered on top of nodes */
  deferredArrowheadCount: number;
}

// ============================================================================
// Grid Helper
// ============================================================================

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  gridSize: number
) {
  const viewLeft = camera.x - width / (2 * camera.zoom);
  const viewRight = camera.x + width / (2 * camera.zoom);
  const viewTop = camera.y - height / (2 * camera.zoom);
  const viewBottom = camera.y + height / (2 * camera.zoom);

  const startX = Math.floor(viewLeft / gridSize) * gridSize;
  const endX = Math.ceil(viewRight / gridSize) * gridSize;
  const startY = Math.floor(viewTop / gridSize) * gridSize;
  const endY = Math.ceil(viewBottom / gridSize) * gridSize;

  ctx.strokeStyle = 'rgba(150, 150, 150, 0.15)';
  ctx.lineWidth = 1 / camera.zoom;
  ctx.beginPath();

  for (let x = startX; x <= endX; x += gridSize) {
    ctx.moveTo(x, viewTop);
    ctx.lineTo(x, viewBottom);
  }

  for (let y = startY; y <= endY; y += gridSize) {
    ctx.moveTo(viewLeft, y);
    ctx.lineTo(viewRight, y);
  }

  ctx.stroke();
}

// ============================================================================
// renderSceneCore - Main scene compositor
// ============================================================================

/**
 * Render the core scene (nodes, edges, phantoms) to the canvas.
 * 
 * This function handles:
 * - Z-order sorting
 * - Edge/node layer interleaving
 * - Deferred arrowhead rendering (arrowOnTop feature)
 * - Phantom node rendering
 * 
 * It does NOT handle:
 * - UI overlays (selection, ports, paths, etc.) - handled by renderCanvas
 * - Artboard clipping - handled by caller
 * - Background clearing - handled by caller
 */

/** Draw a node's glow at its true drawn position. renderNodeCore offsets grouped
 *  children (and applies the node's own transform) internally, but the glow is drawn
 *  from world space — so we re-apply the cumulative parent offset + the node's own
 *  transform here, or a grouped child's glow ghosts at the un-offset coords. */
function drawGlowOnNode(
  ctx: CanvasRenderingContext2D,
  node: NodeModel,
  allNodes: NodeModel[],
  draw: (ctx: CanvasRenderingContext2D, node: NodeModel) => void,
  currentTimeMs: number,
): void {
  let gx = 0;
  let gy = 0;
  let cur: NodeModel | undefined = node;
  while (cur?.parentId) {
    const p = allNodes.find((pp) => pp.id === cur!.parentId);
    if (!p) break;
    gx += p.x;
    gy += p.y;
    cur = p;
  }
  ctx.save();
  if (gx || gy) ctx.translate(gx, gy);
  // The glow has to ride the continuous motion too, or a swaying figure trails its own halo.
  applyMotionTransform(ctx, computeContinuousMotion(node, currentTimeMs));
  applyNodeTransform(ctx, node);
  draw(ctx, node);
  ctx.restore();
}

export function renderSceneCore(
  ctx: CanvasRenderingContext2D,
  nodes: NodeModel[],
  edges: EdgeModel[],
  phantomNodes: PhantomNode[] | undefined,
  options: RenderSceneCoreOptions
): RenderSceneCoreResult {
  const {
    camera,
    width,
    height,
    showGrid = false,
    gridSize = 40,
    flowEnabled = false,
    flowOffsets,
    globalFlowOffset = 0,
    currentTimeMs = 0,
    spriteCache,
    imageCache,
    routeMode = {},
  } = options;

  // Prep the (optional) edge-bundle for this frame; getEdgePath reads it per edge.
  prepareEdgeBundle(edges);
  // Fresh label-collision registry per frame — labels claim rects as they draw
  // and colliding ones slide along their own edge (see label-collision.ts).
  resetLabelCollisions();

  // Draw grid if enabled
  if (showGrid) {
    drawGrid(ctx, camera, width, height, gridSize);
  }

  // Sort nodes and edges by zIndex for proper interleaving
  const sortedNodes = [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const sortedEdges = [...edges].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  // Find zIndex boundaries for proper interleaving
  const firstNodeZ = sortedNodes.length > 0 ? sortedNodes[0].zIndex ?? 0 : 0;
  const lastNodeZ = sortedNodes.length > 0 ? sortedNodes[sortedNodes.length - 1].zIndex ?? 0 : 0;

  // Split edges into three groups:
  // 1. Back layer: edges behind ALL nodes (zIndex < firstNodeZ)
  // 2. Middle layer: edges interleaved with nodes (firstNodeZ <= zIndex <= lastNodeZ)
  // 3. Front layer: edges in front of ALL nodes (zIndex > lastNodeZ)
  const backLayerEdges = sortedEdges.filter((e) => (e.zIndex ?? 0) < firstNodeZ);
  const middleLayerEdges = sortedEdges.filter((e) => {
    const z = e.zIndex ?? 0;
    return z >= firstNodeZ && z <= lastNodeZ;
  });
  const frontLayerEdges = sortedEdges.filter((e) => (e.zIndex ?? 0) > lastNodeZ);

  // Track which middle-layer edges have been drawn
  const drawnMiddleEdgeIds = new Set<string>();

  // Collect deferred arrowheads for arrowOnTop feature
  const deferredArrowheads: DeferredArrowhead[] = [];

  // Helper to get flow offset for an edge
  const getFlowOffset = (edgeId: string): number => {
    return flowOffsets?.get(edgeId) ?? globalFlowOffset;
  };

  // Helper to draw a set of edges
  const drawEdgeSet = (edgeSet: EdgeModel[]) => {
    for (const edge of edgeSet) {
      const edgeOptions: RenderEdgeOptions = {
        flowOffset: getFlowOffset(edge.id),
        flowEnabled,
        routeMode,
        deferredArrowheads,
        roughCanvas,
      };
      renderEdgeCore(ctx, edge, nodes, edgeOptions);
    }
  };

  // Helper to draw middle-layer edges up to a certain zIndex
  const drawMiddleEdgesUpTo = (maxZ: number) => {
    const edgesToDraw = middleLayerEdges.filter((e) => {
      if (drawnMiddleEdgeIds.has(e.id)) return false;
      const z = e.zIndex ?? 0;
      if (z <= maxZ) {
        drawnMiddleEdgeIds.add(e.id);
        return true;
      }
      return false;
    });
    if (edgesToDraw.length > 0) {
      drawEdgeSet(edgesToDraw);
    }
  };

  // Create RoughCanvas for hand-drawn rendering (shared by nodes and edges)
  const roughCanvas = getRoughCanvas(ctx.canvas as HTMLCanvasElement);

  // Node render options
  const nodeOptions: RenderNodeOptions = {
    currentTimeMs,
    spriteCache,
    imageCache,
    allNodes: nodes, // Pass all nodes for group hierarchy (local→world conversion)
    roughCanvas,
  };

  // Assign zIndex to phantoms based on parent edge (prefix matching for UUID edge IDs)
  const edgeEntries = edges.map(e => ({ id: e.id, z: e.zIndex ?? 0 }));
  const allPhantoms = phantomNodes ? [...phantomNodes] : [];
  const phantomPrefix = 'phantom-';
  for (const p of allPhantoms) {
    if (p.zIndex === undefined) {
      if (p.id.startsWith(phantomPrefix)) {
        let matched = false;
        for (const entry of edgeEntries) {
          if (p.id.startsWith(phantomPrefix + entry.id)) {
            p.zIndex = entry.z;
            matched = true;
            break;
          }
        }
        if (!matched) p.zIndex = 0;
      } else {
        p.zIndex = 0;
      }
    }
  }

  // Split phantoms into layers (same as edges)
  const backPhantoms = allPhantoms.filter(p => (p.zIndex ?? 0) < firstNodeZ);
  const middlePhantoms = allPhantoms.filter(p => {
    const z = p.zIndex ?? 0;
    return z >= firstNodeZ && z <= lastNodeZ;
  });
  const frontPhantoms = allPhantoms.filter(p => (p.zIndex ?? 0) > lastNodeZ);

  // Helper to draw middle-layer phantoms up to a certain zIndex
  const drawnMiddlePhantomIds = new Set<string>();
  const drawMiddlePhantomsUpTo = (maxZ: number) => {
    const toDraw = middlePhantoms.filter(p => {
      if (drawnMiddlePhantomIds.has(p.id)) return false;
      if ((p.zIndex ?? 0) <= maxZ) {
        drawnMiddlePhantomIds.add(p.id);
        return true;
      }
      return false;
    });
    for (const phantom of toDraw) {
      renderPhantomCore(ctx, phantom, { currentTimeMs, imageCache });
    }
  };

  // 1. Draw back-layer edges (behind ALL nodes)
  if (backLayerEdges.length > 0) {
    drawEdgeSet(backLayerEdges);
  }

  // Draw back-layer phantoms (behind ALL nodes)
  for (const phantom of backPhantoms) {
    renderPhantomCore(ctx, phantom, { currentTimeMs, imageCache });
  }

  // 2. Draw nodes with proper edge and phantom interleaving
  for (const node of sortedNodes) {
    // Before drawing this node, draw any middle-layer edges and phantoms with zIndex <= this node's zIndex
    const nodeZ = node.zIndex ?? 0;
    drawMiddleEdgesUpTo(nodeZ);
    drawMiddlePhantomsUpTo(nodeZ);

    // Draw the node (with the optional glow treatment wrapped around it).
    // renderNodeCore applies the ancestor (group) + node transforms internally, but
    // the glow is drawn out here in world space — so for a grouped child it would
    // ghost at the un-offset coords (a phantom outline outside its group). Apply the
    // cumulative parent offset + the node's own transform around each glow so it lands
    // exactly on the drawn shape, matching the editor (canvas-render) fix.
    drawGlowOnNode(ctx, node, nodes, drawNodeGlowBehind, currentTimeMs);
    renderNodeCore(ctx, node, nodeOptions);
    drawGlowOnNode(ctx, node, nodes, drawNodeGlowStroke, currentTimeMs);
  }

  // 4. Draw any remaining middle-layer edges
  const remainingMiddleEdges = middleLayerEdges.filter((e) => !drawnMiddleEdgeIds.has(e.id));
  if (remainingMiddleEdges.length > 0) {
    drawEdgeSet(remainingMiddleEdges);
  }

  // Draw any remaining middle-layer phantoms
  const remainingMiddlePhantoms = middlePhantoms.filter(p => !drawnMiddlePhantomIds.has(p.id));
  for (const phantom of remainingMiddlePhantoms) {
    renderPhantomCore(ctx, phantom, { currentTimeMs, imageCache });
  }

  // 5. Draw front-layer edges (on top of ALL nodes)
  if (frontLayerEdges.length > 0) {
    drawEdgeSet(frontLayerEdges);
  }

  // Draw front-layer phantoms (on top of ALL nodes)
  for (const phantom of frontPhantoms) {
    renderPhantomCore(ctx, phantom, { currentTimeMs, imageCache });
  }

  // 6. Draw deferred arrowheads (arrowOnTop feature)
  if (deferredArrowheads.length > 0) {
    renderDeferredArrowheads(ctx, deferredArrowheads);
  }

  return {
    deferredArrowheadCount: deferredArrowheads.length,
  };
}

