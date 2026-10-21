/* eslint-disable -- Migrated file */
import type { NodeModel, EdgeModel, Port, CustomPort, Vec2, Camera, Step } from '../types';
import { clamp } from './math-utils';
import { localToWorld, getWorldTransform, rotatePointAroundOrigin } from './geometry-utils';
import { getAlgoPointerBounds } from './algo-utils';

/**
 * Get the visual world position of a node using accumulated local coordinates.
 * This matches how canvas-render.ts positions nodes with hierarchical transforms.
 * 
 * For nodes with parents:
 * 1. Accumulate local positions from root ancestor to immediate parent
 * 2. Add the node's own local position
 * 3. Also accumulate rotation for hit testing
 * 
 * This differs from getWorldTransform which calculates orbited positions.
 */
export function getVisualWorldPosition(
  node: NodeModel,
  allNodes: readonly NodeModel[]
): { x: number; y: number; accumulatedRotation: number } {
  if (!node.parentId) {
    return { 
      x: node.x, 
      y: node.y, 
      accumulatedRotation: node.rotationZ ?? 0 
    };
  }
  
  // Build ancestor chain from root to immediate parent
  const ancestors: NodeModel[] = [];
  let current = node;
  while (current.parentId) {
    const parent = allNodes.find(p => p.id === current.parentId);
    if (!parent) break;
    ancestors.unshift(parent);  // Root first
    current = parent;
  }
  
  // Accumulate position and rotation through the hierarchy
  let cumulativeX = 0;
  let cumulativeY = 0;
  let accumulatedRotation = 0;
  
  for (const ancestor of ancestors) {
    const ax = cumulativeX + ancestor.x;
    const ay = cumulativeY + ancestor.y;
    
    // Accumulate rotation for hit testing
    accumulatedRotation += (ancestor.rotationZ ?? 0);
    
    cumulativeX = ax;
    cumulativeY = ay;
  }
  
  // Final position
  const drawX = cumulativeX + node.x;
  const drawY = cumulativeY + node.y;
  
  // Add node's own rotation
  accumulatedRotation += (node.rotationZ ?? 0);
  
  return { x: drawX, y: drawY, accumulatedRotation };
}

/**
 * Rotate a point around a center by an angle (in degrees)
 */
export function rotatePoint(px: number, py: number, cx: number, cy: number, angleDeg: number): Vec2 {
  if (!angleDeg) return { x: px, y: py };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/**
 * Get the effective 2D rotation for a node (combining rotation and rotationZ)
 */
export function getNodeEffectiveRotation(node: NodeModel): number {
  return (node.rotation ?? 0) + (node.rotationZ ?? 0);
}

/**
 * Transform world coordinates to a node's local coordinate system
 * (inverse of pointWithNodeTransform - handles rotation, scale, and pivot)
 * Operations are applied in REVERSE order of pointWithNodeTransform
 */
export function worldToLocalNode(wx: number, wy: number, node: NodeModel): Vec2 {
  // Check if node has any meaningful transforms
  const effectiveRotationZ = (node.rotationZ ?? 0) + (node.rotation ?? 0);
  
  const hasRotation = 
    (node.rotationX !== undefined && node.rotationX !== 0) ||
    (node.rotationY !== undefined && node.rotationY !== 0) ||
    effectiveRotationZ !== 0;
  
  const hasScale = 
    (node.scaleX !== undefined && node.scaleX !== 1) ||
    (node.scaleY !== undefined && node.scaleY !== 1);
  
  // Early return for untransformed nodes
  if (!hasRotation && !hasScale) {
    return { x: wx, y: wy };
  }

  const pivotX = node.x + (node.pivotX ?? 0.5) * node.w;
  const pivotY = node.y + (node.pivotY ?? 0.5) * node.h;

  // Translate to pivot
  let dx = wx - pivotX;
  let dy = wy - pivotY;

  // Inverse operations in correct order (reverse of canvas application):
  // Canvas applies: rotZ -> rotY(scaleX) -> rotX(scaleY) -> scale
  // Inverse: rotZ^-1 first, then rotY^-1, rotX^-1, scale^-1

  // 1. Inverse rotate Z (applied first in canvas)
  const ang = (effectiveRotationZ * Math.PI) / 180;
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  dx = rx;
  dy = ry;

  // 2. Inverse 3D Y rotation (horizontal flip/scale)
  if (node.rotationY) {
    const scaleXFrom3D = Math.abs(Math.cos((node.rotationY * Math.PI) / 180));
    if (scaleXFrom3D !== 0) dx /= scaleXFrom3D;
  }

  // 3. Inverse 3D X rotation (vertical flip/scale)
  if (node.rotationX) {
    const scaleYFrom3D = Math.abs(Math.cos((node.rotationX * Math.PI) / 180));
    if (scaleYFrom3D !== 0) dy /= scaleYFrom3D;
  }

  // 4. Inverse explicit scale (applied last in canvas)
  const scaleX = node.scaleX ?? 1;
  const scaleY = node.scaleY ?? 1;
  if (scaleX !== 0) dx /= scaleX;
  if (scaleY !== 0) dy /= scaleY;

  return { x: pivotX + dx, y: pivotY + dy };
}

/**
 * Check if a world point is inside a rotated node's bounding box
 * @param allNodes - All nodes (needed for group hierarchy support)
 * 
 * For nodes with parents, this uses the same hierarchical transform approach
 * as canvas-render.ts:
 * 1. Build ancestor chain
 * 2. Reverse-transform click point through all ancestor rotations
 * 3. Check if result is inside node's local bounds
 */
export function isPointInsideRotatedNode(
  wx: number,
  wy: number,
  node: NodeModel,
  tolerance: number = 0,
  allNodes?: NodeModel[],
  nodeMap?: Map<string, NodeModel>  // optional id->node index for O(1) parent walk
): boolean {
  // For nodes with parentId, we need to reverse the hierarchical canvas transforms
  if (node.parentId && allNodes) {
    // Build ancestor chain from root to immediate parent
    const ancestors: NodeModel[] = [];
    let current = node;
    while (current.parentId) {
      const parent = nodeMap
        ? nodeMap.get(current.parentId)
        : allNodes.find(p => p.id === current.parentId);
      if (!parent) break;
      ancestors.unshift(parent);  // Root first
      current = parent;
    }
    
    // Build transform data (same as canvas-render.ts)
    const transforms: Array<{ 
      cx: number; 
      cy: number; 
      rotX: number;
      rotY: number;
      rotZ: number;
      scX: number;
      scY: number;
    }> = [];
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
      
      if (rotX !== 0 || rotY !== 0 || rotZ !== 0 || scX !== 1 || scY !== 1) {
        transforms.push({
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
    
    // Node's position in the transformed coordinate system
    const drawX = cumulativeX + node.x;
    const drawY = cumulativeY + node.y;
    
    // Reverse-transform the click point through all ancestor transforms
    // Iterate forward (root to child) because inverse of M0·M1·...·Mn is
    // Mn^-1·...·M1^-1·M0^-1, applied as: first M0^-1, then M1^-1, etc.
    let testX = wx;
    let testY = wy;

    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];

      // Inverse transforms: canvas applies translate -> rotZ -> rotY(scaleX) -> rotX(scaleY) -> scale -> translate back
      // Inverse order per transform: rotZ^-1 first, then rotY^-1, rotX^-1, scale^-1

      const dx = testX - t.cx;
      const dy = testY - t.cy;

      // 1. Inverse rotZ (applied first in canvas, so inverted first)
      let ux = dx, uy = dy;
      if (t.rotZ !== 0) {
        const rad = (-t.rotZ * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rx = ux * cos - uy * sin;
        const ry = ux * sin + uy * cos;
        ux = rx;
        uy = ry;
      }

      // 2. Inverse rotY (affects X via scale foreshortening)
      if (t.rotY !== 0) {
        const scaleXFrom3D = Math.abs(Math.cos((t.rotY * Math.PI) / 180));
        if (scaleXFrom3D > 0.001) {
          ux = ux / scaleXFrom3D;
        }
      }

      // 3. Inverse rotX (affects Y via scale foreshortening)
      if (t.rotX !== 0) {
        const scaleYFrom3D = Math.abs(Math.cos((t.rotX * Math.PI) / 180));
        if (scaleYFrom3D > 0.001) {
          uy = uy / scaleYFrom3D;
        }
      }

      // 4. Inverse explicit scale (applied last in canvas, so inverted last)
      if (t.scX !== 1 || t.scY !== 1) {
        ux = ux / t.scX;
        uy = uy / t.scY;
      }

      testX = t.cx + ux;
      testY = t.cy + uy;
    }
    
    // Now check if the transformed point is inside the node's bounds
    // Also account for node's own rotation
    const nodeRotZ = node.rotationZ ?? 0;
    if (nodeRotZ !== 0) {
      const nodeCx = drawX + node.w / 2;
      const nodeCy = drawY + node.h / 2;
      const dx = testX - nodeCx;
      const dy = testY - nodeCy;
      const rad = (-nodeRotZ * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      testX = nodeCx + dx * cos - dy * sin;
      testY = nodeCy + dx * sin + dy * cos;
    }
    
    return (
      testX >= drawX - tolerance &&
      testX <= drawX + node.w + tolerance &&
      testY >= drawY - tolerance &&
      testY <= drawY + node.h + tolerance
    );
  }

  // For nodes without parents, use the original approach
  const local = worldToLocalNode(wx, wy, node);
  return (
    local.x >= node.x - tolerance &&
    local.x <= node.x + node.w + tolerance &&
    local.y >= node.y - tolerance &&
    local.y <= node.y + node.h + tolerance
  );
}

function isTransparentFill(fill: string | undefined): boolean {
  if (!fill) return true;
  const f = fill.toLowerCase().trim();
  if (f === 'transparent' || f === 'none') return true;
  const rgbaMatch = f.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  if (rgbaMatch && parseFloat(rgbaMatch[1]) === 0) return true;
  if (f.length === 9 && f.startsWith('#') && f.endsWith('00')) return true;
  return false;
}

/**
 * Hit test nodes at world coordinates
 * @param ns - Array of nodes to test
 * @param wx - World X coordinate
 * @param wy - World Y coordinate
 * @param tolerance - Optional tolerance in world units (use larger values when zoomed out)
 * @param options - Optional settings (skipLocked, allNodes for group hierarchy)
 * 
 * Nodes are tested in zIndex order (highest first) so that visually top nodes 
 * are selected before nodes behind them.
 */
// Per-array memo caches keyed by reference: during continuous mouse interaction
// the node array is stable between frames, so we avoid re-sorting + re-indexing
// the whole list on every mousemove/click. A new array (nodes changed) recomputes.
const _zSortCache = new WeakMap<NodeModel[], NodeModel[]>();
const _idMapCache = new WeakMap<NodeModel[], Map<string, NodeModel>>();

/**
 * A bound colour/shadow layer of a drawn illustration. It shares the ink node's box, is
 * invisible until the hand has finished the outline, and means nothing on its own, so the
 * editor never picks it: a click on the drawing always lands on the ink node, and the engine
 * moves the layers with it. The crowdfunding video of 2026-10-03 is why: the ink figure was
 * dragged in the editor and its colour stayed where the build had put it.
 */
export function isIllustrationCompanion(n: { illuOf?: string }): boolean {
  return typeof n.illuOf === 'string' && n.illuOf.length > 0;
}

/** Companion layers keyed by the ink node they belong to. */
export function indexIllustrationCompanions(nodes: readonly NodeModel[]): Map<string, NodeModel[]> {
  const out = new Map<string, NodeModel[]>();
  for (const n of nodes) {
    if (!isIllustrationCompanion(n)) continue;
    const list = out.get(n.illuOf!);
    if (list) list.push(n);
    else out.set(n.illuOf!, [n]);
  }
  return out;
}

/**
 * Carry a companion through the box change its ink node just made. Expressed as the
 * companion's position RELATIVE to the ink box, so a plain move keeps the offset and a
 * resize scales it, and a layer that sat exactly on the ink box stays exactly on it.
 */
export function followIllustrationBase(
  companion: NodeModel,
  before: { x: number; y: number; w: number; h: number },
  after: { x: number; y: number; w: number; h: number }
): void {
  const sx = before.w ? after.w / before.w : 1;
  const sy = before.h ? after.h / before.h : 1;
  companion.x = after.x + (companion.x - before.x) * sx;
  companion.y = after.y + (companion.y - before.y) * sy;
  companion.w = companion.w * sx;
  companion.h = companion.h * sy;
}

export function hitNodeWorld(
  ns: NodeModel[],
  wx: number,
  wy: number,
  tolerance: number = 0,
  options?: { skipLocked?: boolean; allNodes?: NodeModel[] }
) {
  // Sort by zIndex descending (highest/front first) to prioritize top nodes.
  // When zIndex is equal, prefer smaller nodes (more specific click targets)
  // so that a small icon inside a large background rect can be selected.
  let sortedNodes = _zSortCache.get(ns);
  if (!sortedNodes) {
    sortedNodes = [...ns].sort((a, b) => {
      const zDiff = (b.zIndex || 0) - (a.zIndex || 0);
      if (zDiff !== 0) return zDiff;
      return (a.w * a.h) - (b.w * b.h);
    });
    _zSortCache.set(ns, sortedNodes);
  }

  // Use ns as allNodes if not provided (for backward compatibility)
  const allNodes = options?.allNodes ?? ns;
  let nodeMap = _idMapCache.get(allNodes);
  if (!nodeMap) {
    nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    _idMapCache.set(allNodes, nodeMap);
  }
  
  for (const n of sortedNodes) {
    // Skip locked nodes if requested (for selection purposes)
    if (options?.skipLocked && n.locked) {
      continue;
    }
    // A drawing's colour layers are never the thing under the cursor; the ink node
    // underneath them (same box) is.
    if (isIllustrationCompanion(n)) {
      continue;
    }
    // algo-pointer rendered position is derived from its target — hit-test
    // against the visible glyph bounds rather than the static (often 0,0) bounds.
    if (n.kind === 'algo-pointer') {
      const derived = getAlgoPointerBounds(n, allNodes);
      if (derived) {
        const proxyNode = { ...n, x: derived.x, y: derived.y, w: derived.w, h: derived.h };
        if (isPointInsideRotatedNode(wx, wy, proxyNode, tolerance, allNodes, nodeMap)) {
          return n;
        }
        continue;
      }
    }
    // Use rotation-aware hit test with group hierarchy support
    if (isPointInsideRotatedNode(wx, wy, n, tolerance, allNodes, nodeMap)) {
      // For circle/ellipse nodes with transparent fill, only hit-test the stroke
      // outline so clicks in the interior pass through to edges/nodes behind.
      if (n.kind === 'circle' && isTransparentFill(n.fill) && !n.label) {
        const cx = n.x + n.w / 2;
        const cy = n.y + n.h / 2;
        const local = worldToLocalNode(wx, wy, n);
        const dx = local.x - cx;
        const dy = local.y - cy;
        const rx = n.w / 2;
        const ry = n.h / 2;
        const sw = n.strokeWidth ?? 2;
        const strokeTolerance = Math.max(sw, 8) + tolerance;
        const outerRx = rx + strokeTolerance / 2;
        const outerRy = ry + strokeTolerance / 2;
        const innerRx = Math.max(0, rx - strokeTolerance / 2);
        const innerRy = Math.max(0, ry - strokeTolerance / 2);
        const outerNorm = (dx * dx) / (outerRx * outerRx) + (dy * dy) / (outerRy * outerRy);
        const innerNorm = innerRx > 0 && innerRy > 0
          ? (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy)
          : Infinity;
        if (outerNorm <= 1 && innerNorm >= 1) {
          return n;
        }
        continue;
      }
      return n;
    }
  }
  return null;
}

export function sideAnchorFixed(n: NodeModel, port: Port): Vec2 {
  // Calculate local position (unrotated)
  const base =
    port === 'N' ? { x: n.x + n.w / 2, y: n.y } :
    port === 'E' ? { x: n.x + n.w,     y: n.y + n.h / 2 } :
    port === 'S' ? { x: n.x + n.w / 2, y: n.y + n.h } :
                   { x: n.x,           y: n.y + n.h / 2 };
  
  // Apply full node transform (rotation, scale, pivot) for consistency with edge drawing
  return pointWithNodeTransform(n, base);
}

export function sideAnchorAuto(n: NodeModel, px: number, py: number): Vec2 {
  // Local positions (unrotated)
  const localCandidates = [
    { x: n.x + n.w / 2, y: n.y },      // N
    { x: n.x + n.w, y: n.y + n.h / 2 }, // E
    { x: n.x + n.w / 2, y: n.y + n.h }, // S
    { x: n.x, y: n.y + n.h / 2 },       // W
  ];
  
  // Apply full node transform (rotation, scale, pivot) to get world positions
  const candidates = localCandidates.map(c => pointWithNodeTransform(n, c));
  
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Apply the node's transform (pivot, scale, rotationZ, and the X/Y "3D" squash)
 * to an arbitrary point expressed in world coords of the node's untransformed box.
 */
export function pointWithNodeTransform(n: NodeModel, p: Vec2): Vec2 {
  // Check if node has any meaningful transforms
  // Note: 'rotation' is the simple 2D rotation, 'rotationZ' is the 3D rotation (they should be combined)
  const effectiveRotationZ = (n.rotationZ ?? 0) + (n.rotation ?? 0);
  
  const hasRotation = 
    (n.rotationX !== undefined && n.rotationX !== 0) ||
    (n.rotationY !== undefined && n.rotationY !== 0) ||
    effectiveRotationZ !== 0;
  
  const hasScale = 
    (n.scaleX !== undefined && n.scaleX !== 1) ||
    (n.scaleY !== undefined && n.scaleY !== 1);
  
  // Early return for untransformed nodes (avoids floating-point errors)
  if (!hasRotation && !hasScale) {
    return p;
  }

  const pivotX = n.x + (n.pivotX ?? 0.5) * n.w;
  const pivotY = n.y + (n.pivotY ?? 0.5) * n.h;

  // translate to pivot
  let dx = p.x - pivotX;
  let dy = p.y - pivotY;

  // Apply in SAME ORDER as applyNodeTransform (canvas rendering):
  // 1. First rotate Z
  const ang = (effectiveRotationZ * Math.PI) / 180;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  let rx = dx * cos - dy * sin;
  let ry = dx * sin + dy * cos;

  // 2. Then apply 3D-style rotations (Y rotation = horizontal flip/scale)
  if (n.rotationY) {
    const scaleXFrom3D = Math.abs(Math.cos((n.rotationY * Math.PI) / 180));
    rx *= scaleXFrom3D;
  }

  // 3. Then apply 3D-style rotations (X rotation = vertical flip/scale)
  if (n.rotationX) {
    const scaleYFrom3D = Math.abs(Math.cos((n.rotationX * Math.PI) / 180));
    ry *= scaleYFrom3D;
  }

  // 4. Finally apply independent scale factors
  const scaleX = n.scaleX ?? 1;
  const scaleY = n.scaleY ?? 1;
  rx *= scaleX;
  ry *= scaleY;

  return { x: pivotX + rx, y: pivotY + ry };
}

/**
 * Get port position in world space, accounting for node transforms
 */
export function portWorld(n: NodeModel, port: Port): Vec2 {
  // uml-lifeline's anchor surface is the centered dashed line, not the bbox.
  // Map N→top of line, S→bottom of line, E/W→middle of line so any port
  // assignment lands on the line.
  if (n.kind === 'uml-lifeline') {
    const headerH = Math.min(50, n.h * 0.15);
    const lifelineLength = (n as any).lifelineLength ?? (n.h - headerH);
    const cx = n.x + n.w / 2;
    const lineTop = n.y + headerH;
    const y =
      port === 'N' ? lineTop :
      port === 'S' ? lineTop + lifelineLength :
                     lineTop + lifelineLength / 2;
    return pointWithNodeTransform(n, { x: cx, y });
  }

  const base =
    port === 'N' ? { x: n.x + n.w / 2, y: n.y } :
    port === 'E' ? { x: n.x + n.w,     y: n.y + n.h / 2 } :
    port === 'S' ? { x: n.x + n.w / 2, y: n.y + n.h } :
                   { x: n.x,           y: n.y + n.h / 2 };
  return pointWithNodeTransform(n, base);
}

/**
 * Get custom port position in world space, accounting for node transforms
 */
export function customPortWorld(n: NodeModel, c: CustomPort): Vec2 {
  // getCustomPortPosition now already applies transforms, so just return it directly
  return getCustomPortPosition(n, c);
}

/**
 * Find the intersection point of a ray from external point (px, py) to node center
 * with the node's rotated rectangle perimeter.
 * This is more accurate than picking from 4 fixed ports for rotated nodes.
 */
export function findRayRectIntersection(n: NodeModel, px: number, py: number): Vec2 | null {
  const rotation = getNodeEffectiveRotation(n);
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  
  // Transform the external point to node's local (unrotated) space
  const local = worldToLocalNode(px, py, n);
  const localCenterX = n.x + n.w / 2;
  const localCenterY = n.y + n.h / 2;
  
  // Direction from center to external point in local space
  const dx = local.x - localCenterX;
  const dy = local.y - localCenterY;
  
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    // Point is at center, default to top
    return pointWithNodeTransform(n, { x: n.x + n.w / 2, y: n.y });
  }
  
  // Find intersection with the rectangle edges
  // We need to find t such that center + t*(external - center) is on the rectangle boundary
  const halfW = n.w / 2;
  const halfH = n.h / 2;
  
  // Check intersection with each edge
  const tValues: number[] = [];
  
  // Right edge (x = n.x + n.w)
  if (dx > 0) {
    const t = halfW / dx;
    const yAtT = localCenterY + t * dy;
    if (yAtT >= n.y && yAtT <= n.y + n.h) {
      tValues.push(t);
    }
  }
  
  // Left edge (x = n.x)
  if (dx < 0) {
    const t = -halfW / dx;
    const yAtT = localCenterY + t * dy;
    if (yAtT >= n.y && yAtT <= n.y + n.h) {
      tValues.push(t);
    }
  }
  
  // Bottom edge (y = n.y + n.h)
  if (dy > 0) {
    const t = halfH / dy;
    const xAtT = localCenterX + t * dx;
    if (xAtT >= n.x && xAtT <= n.x + n.w) {
      tValues.push(t);
    }
  }
  
  // Top edge (y = n.y)
  if (dy < 0) {
    const t = -halfH / dy;
    const xAtT = localCenterX + t * dx;
    if (xAtT >= n.x && xAtT <= n.x + n.w) {
      tValues.push(t);
    }
  }
  
  if (tValues.length === 0) return null;
  
  // Use the smallest positive t (first intersection in the direction from center to external point)
  const t = Math.min(...tValues.filter(v => v > 0));
  if (!isFinite(t)) return null;
  
  // Calculate intersection point in local space
  const localIntersection = {
    x: localCenterX + t * dx,
    y: localCenterY + t * dy,
  };
  
  // Transform back to world space
  return pointWithNodeTransform(n, localIntersection);
}

/**
 * Choose closest port side in world space, accounting for node transforms.
 * For rotated nodes, uses ray-rectangle intersection for accurate positioning.
 */
export function sideAnchorAutoWorld(n: NodeModel, px: number, py: number): Vec2 {
  const rotation = getNodeEffectiveRotation(n);

  // uml-lifeline's visible "edge" isn't the bounding box — it's the dashed
  // line down the column center below the header. Snap edges to that line at
  // the target Y so manual edge dragging actually connects to the lifeline
  // instead of floating off to the bounding-box side.
  if (n.kind === 'uml-lifeline' && Math.abs(rotation % 90) <= 5) {
    const headerH = Math.min(50, n.h * 0.15);
    const lifelineLength = (n as any).lifelineLength ?? (n.h - headerH);
    const lineTop = n.y + headerH;
    const lineBottom = n.y + headerH + lifelineLength;
    const clampedY = Math.max(lineTop, Math.min(lineBottom, py));
    return pointWithNodeTransform(n, { x: n.x + n.w / 2, y: clampedY });
  }

  // For significantly rotated nodes, use ray intersection for accurate positioning
  if (Math.abs(rotation % 90) > 5) { // More than 5 degrees off from axis-aligned
    const intersection = findRayRectIntersection(n, px, py);
    if (intersection) return intersection;
  }

  // For axis-aligned or nearly axis-aligned nodes, use the original 4-port method
  const candidates: Vec2[] = (['N','E','S','W'] as Port[]).map(p => portWorld(n, p));
  let best = candidates[0], bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}

export function getResizeHandles(
  n: NodeModel
): Record<string, { x: number; y: number }> {
  // Add larger margin to position handles well outside the node bounds
  // This prevents overlap with ports (which are 5px outside the edge)
  // Using 20px ensures clear separation from port hitboxes
  const margin = 20;
  
  // Calculate local positions (unrotated)
  const localHandles = {
    nw: { x: n.x - margin, y: n.y - margin },
    n: { x: n.x + n.w / 2, y: n.y - margin },
    ne: { x: n.x + n.w + margin, y: n.y - margin },
    e: { x: n.x + n.w + margin, y: n.y + n.h / 2 },
    se: { x: n.x + n.w + margin, y: n.y + n.h + margin },
    s: { x: n.x + n.w / 2, y: n.y + n.h + margin },
    sw: { x: n.x - margin, y: n.y + n.h + margin },
    w: { x: n.x - margin, y: n.y + n.h / 2 },
  };
  
  // Apply node transform to each handle position
  const result: Record<string, { x: number; y: number }> = {};
  for (const [key, pos] of Object.entries(localHandles)) {
    const transformed = pointWithNodeTransform(n, pos);
    result[key] = { x: transformed.x, y: transformed.y };
  }
  return result;
}

export function hitResizeHandle(
  n: NodeModel,
  wx: number,
  wy: number,
  threshold: number = 10,
  allNodes?: NodeModel[]
): string | null {
  // For nodes inside groups, we need to:
  // 1. Build the accumulated world position (like canvas-render does)
  // 2. Compute handles from the world-position node
  // 3. Apply ancestor forward-transforms to get handle screen positions
  if (n.parentId && allNodes) {
    // Build ancestor chain
    const ancestors: NodeModel[] = [];
    let current: NodeModel = n;
    while (current.parentId) {
      const parent = allNodes.find(p => p.id === current.parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      current = parent;
    }

    // Accumulate world position and build transforms (same as canvas-render)
    let cumulativeX = 0;
    let cumulativeY = 0;
    const transforms: Array<{
      cx: number; cy: number;
      rotZ: number; rotY: number; rotX: number;
      scX: number; scY: number;
    }> = [];

    for (const ancestor of ancestors) {
      const ax = cumulativeX + ancestor.x;
      const ay = cumulativeY + ancestor.y;
      const rotX = ancestor.rotationX ?? 0;
      const rotY = ancestor.rotationY ?? 0;
      const rotZ = ancestor.rotationZ ?? 0;
      const scX = ancestor.scaleX ?? 1;
      const scY = ancestor.scaleY ?? 1;
      const pivotX = ancestor.pivotX ?? 0.5;
      const pivotY = ancestor.pivotY ?? 0.5;
      const cx = ax + ancestor.w * pivotX;
      const cy = ay + ancestor.h * pivotY;

      if (rotX !== 0 || rotY !== 0 || rotZ !== 0 || scX !== 1 || scY !== 1) {
        transforms.push({ cx, cy, rotX, rotY, rotZ, scX, scY });
      }
      cumulativeX = ax;
      cumulativeY = ay;
    }

    // Create a node with accumulated world position for handle computation
    const worldNode = { ...n, x: cumulativeX + n.x, y: cumulativeY + n.y };
    const handles = getResizeHandles(worldNode);

    // Apply forward ancestor transforms to each handle position
    for (const [key, pos] of Object.entries(handles)) {
      let px = pos.x, py = pos.y;
      for (const t of transforms) {
        let dx = px - t.cx, dy = py - t.cy;
        if (t.rotZ !== 0) {
          const rad = (t.rotZ * Math.PI) / 180;
          const c = Math.cos(rad), s = Math.sin(rad);
          const rx = dx * c - dy * s, ry = dx * s + dy * c;
          dx = rx; dy = ry;
        }
        if (t.rotY !== 0) {
          dx *= Math.abs(Math.cos((t.rotY * Math.PI) / 180));
        }
        if (t.rotX !== 0) {
          dy *= Math.abs(Math.cos((t.rotX * Math.PI) / 180));
        }
        if (t.scX !== 1 || t.scY !== 1) {
          dx *= t.scX; dy *= t.scY;
        }
        px = t.cx + dx; py = t.cy + dy;
      }
      if (Math.hypot(wx - px, wy - py) < threshold) {
        return key;
      }
    }
    return null;
  }

  // For top-level nodes, use simple approach
  const handles = getResizeHandles(n);
  for (const [key, pos] of Object.entries(handles)) {
    if (Math.hypot(wx - pos.x, wy - pos.y) < threshold) {
      return key;
    }
  }
  return null;
}


export function getCustomPortPosition(node: NodeModel, custom: CustomPort): Vec2 {
  const ratio = clamp(custom.ratio, 0, 1);
  let base: Vec2;

  // uml-lifeline's visible body is the centered dashed line below the header,
  // not the bounding box perimeter. Map every side to a point on that line so
  // edges anchored to a uml-lifeline (manually dragged or programmatic) snap
  // to the line instead of floating off to the bounding-box edge.
  if (node.kind === 'uml-lifeline') {
    const headerH = Math.min(50, node.h * 0.15);
    const lifelineLength = (node as any).lifelineLength ?? (node.h - headerH);
    const cx = node.x + node.w / 2;
    const lineTop = node.y + headerH;
    let y: number;
    if (custom.side === 'N') y = lineTop;
    else if (custom.side === 'S') y = lineTop + lifelineLength;
    else y = lineTop + lifelineLength * ratio;
    return pointWithNodeTransform(node, { x: cx, y });
  }

  switch (custom.side) {
    case 'N':
      base = { x: node.x + node.w * ratio, y: node.y };
      break;
    case 'E':
      base = { x: node.x + node.w, y: node.y + node.h * ratio };
      break;
    case 'S':
      base = { x: node.x + node.w * ratio, y: node.y + node.h };
      break;
    case 'W':
      base = { x: node.x, y: node.y + node.h * ratio };
      break;
  }

  // Apply full node transform (rotation, scale, pivot) for consistency with edge drawing
  return pointWithNodeTransform(node, base);
}

export function hitNodePerimeter(
  node: NodeModel,
  wx: number,
  wy: number,
  threshold: number
): { side: 'N' | 'E' | 'S' | 'W'; ratio: number; pos: Vec2 } | null {
  // Transform world coords to node's local coords (un-rotate)
  const local = worldToLocalNode(wx, wy, node);
  const lx = local.x;
  const ly = local.y;

  if (
    lx < node.x - threshold ||
    lx > node.x + node.w + threshold ||
    ly < node.y - threshold ||
    ly > node.y + node.h + threshold
  ) {
    return null;
  }

  const distToTop = Math.abs(ly - node.y);
  const distToBottom = Math.abs(ly - (node.y + node.h));
  const distToLeft = Math.abs(lx - node.x);
  const distToRight = Math.abs(lx - (node.x + node.w));

  const minDist = Math.min(distToTop, distToBottom, distToLeft, distToRight);

  if (minDist > threshold) return null;

  const rotation = getNodeEffectiveRotation(node);
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;

  if (minDist === distToTop && lx >= node.x && lx <= node.x + node.w) {
    const ratio = clamp((lx - node.x) / node.w, 0, 1);
    // Local position on perimeter, then rotate to world
    const localPos = { x: lx, y: node.y };
    const worldPos = rotation ? rotatePoint(localPos.x, localPos.y, cx, cy, rotation) : localPos;
    return { side: 'N', ratio, pos: worldPos };
  } else if (
    minDist === distToBottom &&
    lx >= node.x &&
    lx <= node.x + node.w
  ) {
    const ratio = clamp((lx - node.x) / node.w, 0, 1);
    const localPos = { x: lx, y: node.y + node.h };
    const worldPos = rotation ? rotatePoint(localPos.x, localPos.y, cx, cy, rotation) : localPos;
    return { side: 'S', ratio, pos: worldPos };
  } else if (
    minDist === distToLeft &&
    ly >= node.y &&
    ly <= node.y + node.h
  ) {
    const ratio = clamp((ly - node.y) / node.h, 0, 1);
    const localPos = { x: node.x, y: ly };
    const worldPos = rotation ? rotatePoint(localPos.x, localPos.y, cx, cy, rotation) : localPos;
    return { side: 'W', ratio, pos: worldPos };
  } else if (
    minDist === distToRight &&
    ly >= node.y &&
    ly <= node.y + node.h
  ) {
    const ratio = clamp((ly - node.y) / node.h, 0, 1);
    const localPos = { x: node.x + node.w, y: ly };
    const worldPos = rotation ? rotatePoint(localPos.x, localPos.y, cx, cy, rotation) : localPos;
    return { side: 'E', ratio, pos: worldPos };
  }

  return null;
}

export function getNodePorts(n: NodeModel, offset = 5): { port: Port; pos: Vec2 }[] {
  // Calculate local positions (unrotated) with offset applied in local space
  const localN = { x: n.x + n.w / 2, y: n.y - offset };
  const localE = { x: n.x + n.w + offset, y: n.y + n.h / 2 };
  const localS = { x: n.x + n.w / 2, y: n.y + n.h + offset };
  const localW = { x: n.x - offset, y: n.y + n.h / 2 };
  
  // Apply full node transform (rotation, scale, pivot) to get world positions
  return [
    { port: 'N' as Port, pos: pointWithNodeTransform(n, localN) },
    { port: 'E' as Port, pos: pointWithNodeTransform(n, localE) },
    { port: 'S' as Port, pos: pointWithNodeTransform(n, localS) },
    { port: 'W' as Port, pos: pointWithNodeTransform(n, localW) },
  ];
}

export function getNodesBBox(nodes: NodeModel[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

/**
 * Find the closest point on a node's perimeter to a given world position.
 * Returns the side and ratio along that side.
 *
 * @param node The node to check against
 * @param wx World X coordinate
 * @param wy World Y coordinate
 * @param showGrid Whether to snap to grid
 * @param grid Grid size for snapping
 */
export function findClosestPerimeterPoint(
  node: NodeModel,
  wx: number,
  wy: number,
  _showGrid?: boolean,
  _grid?: number
): { side: 'N' | 'S' | 'E' | 'W'; ratio: number } | null {
  // Transform world coords to node's local coords (un-rotate)
  const local = worldToLocalNode(wx, wy, node);
  const lx = local.x;
  const ly = local.y;

  // uml-lifeline's "perimeter" is the centered dashed line. Map any click on
  // the node to a (side='W', ratio=y_along_line) so getCustomPortPosition's
  // uml-lifeline branch lands the anchor exactly on the line at the click Y.
  if (node.kind === 'uml-lifeline') {
    const headerH = Math.min(50, node.h * 0.15);
    const lifelineLength = (node as any).lifelineLength ?? (node.h - headerH);
    const lineTop = node.y + headerH;
    const ratio = lifelineLength > 0
      ? clamp((ly - lineTop) / lifelineLength, 0, 1)
      : 0;
    return { side: 'W', ratio };
  }

  // Calculate distances to each side and find the closest point on each
  // Using local (unrotated) coordinates
  const sides: Array<{
    side: 'N' | 'S' | 'E' | 'W';
    point: Vec2;
    dist: number;
    ratio: number;
  }> = [];

  // North side (top edge)
  const northX = Math.max(node.x, Math.min(node.x + node.w, lx));
  const northY = node.y;
  const northRatio = node.w > 0 ? (northX - node.x) / node.w : 0.5;
  sides.push({
    side: 'N',
    point: { x: northX, y: northY },
    dist: Math.hypot(northX - lx, northY - ly),
    ratio: northRatio,
  });

  // South side (bottom edge)
  const southX = Math.max(node.x, Math.min(node.x + node.w, lx));
  const southY = node.y + node.h;
  const southRatio = node.w > 0 ? (southX - node.x) / node.w : 0.5;
  sides.push({
    side: 'S',
    point: { x: southX, y: southY },
    dist: Math.hypot(southX - lx, southY - ly),
    ratio: southRatio,
  });

  // East side (right edge)
  const eastX = node.x + node.w;
  const eastY = Math.max(node.y, Math.min(node.y + node.h, ly));
  const eastRatio = node.h > 0 ? (eastY - node.y) / node.h : 0.5;
  sides.push({
    side: 'E',
    point: { x: eastX, y: eastY },
    dist: Math.hypot(eastX - lx, eastY - ly),
    ratio: eastRatio,
  });

  // West side (left edge)
  const westX = node.x;
  const westY = Math.max(node.y, Math.min(node.y + node.h, ly));
  const westRatio = node.h > 0 ? (westY - node.y) / node.h : 0.5;
  sides.push({
    side: 'W',
    point: { x: westX, y: westY },
    dist: Math.hypot(westX - lx, westY - ly),
    ratio: westRatio,
  });

  // Find the closest side
  sides.sort((a, b) => a.dist - b.dist);
  const closest = sides[0];

  return { side: closest.side, ratio: closest.ratio };
}

/**
 * Hit test ports - ports are positioned OUTSIDE the node.
 * Returns the nodeId and port/customPort if a port is hit.
 *
 * @param wx World X coordinate
 * @param wy World Y coordinate
 * @param nodes Array of nodes to check
 * @param cameraZoom Current camera zoom level
 */
export function hitTestPort(
  wx: number,
  wy: number,
  nodes: NodeModel[],
  cameraZoom: number
): { nodeId: string; port?: Port; customPort?: CustomPort } | null {
  // Use SCREEN-PIXEL based threshold for consistent feel across zoom levels.
  // Target: 6 screen pixels hit area (small but clickable)
  // Convert to world units by dividing by zoom.
  // Cap at 3 world units max to prevent port hits from interfering with node selection when very zoomed out.
  const screenPixelThreshold = 6; // pixels on screen
  const worldThreshold = screenPixelThreshold / cameraZoom;
  const threshold = Math.min(3, worldThreshold);

  // Sort nodes by zIndex descending so we check topmost nodes first
  const sortedNodes = [...nodes].sort(
    (a, b) => (b.zIndex || 0) - (a.zIndex || 0)
  );

  for (const node of sortedNodes) {
    // Ports are outside the node - skip if click is inside the node body
    // Use rotation-aware check for rotated nodes
    if (isPointInsideRotatedNode(wx, wy, node)) {
      continue; // Click is inside node, don't check ports
    }

    const ports = getNodePorts(node);
    for (const { port, pos } of ports) {
      const dist = Math.hypot(pos.x - wx, pos.y - wy);
      if (dist < threshold) {
        return { nodeId: node.id, port };
      }
    }
  }

  // Also check for custom port (perimeter) hits - only outside node
  for (const node of sortedNodes) {
    // Use rotation-aware check for rotated nodes
    if (isPointInsideRotatedNode(wx, wy, node)) {
      continue;
    }

    const perimHit = hitNodePerimeter(node, wx, wy, threshold);
    if (perimHit) {
      return {
        nodeId: node.id,
        customPort: { side: perimHit.side, ratio: perimHit.ratio },
      };
    }
  }

  return null;
}

export function worldToScreen(wx: number, wy: number, camera: Camera, canvasRect: DOMRect) {
  // canvasRect contains CSS pixel dimensions
  // Need to account for DPR since canvas uses physical pixels internally
  const dpr = window.devicePixelRatio || 1;
  const cx = canvasRect.width / 2;
  const cy = canvasRect.height / 2;
  // Convert world coordinates to screen CSS pixels
  // The zoom is applied at physical pixel scale, so we need to scale down by DPR
  const sx = cx + (wx - camera.x) * (camera.zoom / dpr);
  const sy = cy + (wy - camera.y) * (camera.zoom / dpr);
  return { x: sx, y: sy };
}

export function screenToWorld(
  mx: number,
  my: number,
  camera: Camera,
  canvas: HTMLCanvasElement
): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const sx = mx * scaleX,
    sy = my * scaleY;
  const z = camera.zoom;
  return {
    x: (sx - canvas.width / 2) / z + camera.x,
    y: (sy - canvas.height / 2) / z + camera.y,
  };
}

/**
 * Remove edges whose `from` or `to` reference a node that doesn't exist.
 * Also cleans dangling edges inside steps and actions targeting those edges.
 * Returns { edges, steps, droppedCount }.
 */
export function sanitizeDanglingEdges(
  nodes: readonly NodeModel[],
  edges: readonly EdgeModel[],
  steps: readonly Step[],
): { edges: EdgeModel[]; steps: Step[]; droppedCount: number } {
  const nodeIds = new Set(nodes.map((n) => n.id));

  const isValid = (e: { from?: string; to?: string }) => {
    const fromOk = !e.from || nodeIds.has(e.from);
    const toOk = !e.to || nodeIds.has(e.to);
    return fromOk && toOk;
  };

  const validEdges = edges.filter(isValid) as EdgeModel[];
  const droppedCount = edges.length - validEdges.length;

  const cleanedSteps = steps.map((step) => {
    const stepNodeIds = new Set(nodeIds);
    if (step.nodes) {
      for (const n of step.nodes) stepNodeIds.add(n.id);
    }

    const stepIsValid = (e: { from?: string; to?: string }) => {
      const fromOk = !e.from || stepNodeIds.has(e.from);
      const toOk = !e.to || stepNodeIds.has(e.to);
      return fromOk && toOk;
    };

    if (!step.edges) return step;

    const validStepEdges = step.edges.filter(stepIsValid);
    if (validStepEdges.length === step.edges.length) return step;

    const removedEdgeIds = new Set(
      step.edges.filter((e) => !stepIsValid(e)).map((e) => e.id)
    );

    const cleanedActions = (step.actions || []).filter(
      (a) => !(a.target?.kind === 'edge' && removedEdgeIds.has(a.target.id))
    );

    return { ...step, edges: validStepEdges, actions: cleanedActions };
  }) as Step[];

  return { edges: validEdges, steps: cleanedSteps, droppedCount };
}

/**
 * Validate and sanitize parentId references on a set of nodes.
 * Clears parentId if it references a non-existent node or a non-group node.
 * Returns the sanitized array (mutates in place for efficiency).
 */
export function validateParentIds(nodes: readonly NodeModel[]): readonly NodeModel[] {
  const nodeMap = new Map<string, NodeModel>();
  for (const n of nodes) nodeMap.set(n.id, n);

  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = nodeMap.get(node.parentId);
    if (!parent || parent.kind !== 'group') {
      console.warn(
        `[validateParentIds] Node "${node.id}" has invalid parentId "${node.parentId}" — clearing`
      );
      // Safe: nodes are deep-cloned before reaching this function
      (node as NodeModel).parentId = undefined;
    }
  }
  return nodes;
}
