/* eslint-disable -- Migrated file */
import type { CustomPort, EdgeModel, NodeModel, Port, Vec2 } from '../types';
import { bundledWaypointsFor } from './edge-bundle';
import { 
  sideAnchorFixed, 
  sideAnchorAuto, 
  getCustomPortPosition,
  pointWithNodeTransform,
  portWorld,
  customPortWorld,
  sideAnchorAutoWorld,
  findRayRectIntersection,
} from './node-utils';
import {
  straightPath,
  curvedPath,
  getDefaultCurveControlPoint,
  orthoPathVHV,
  orthoPathHVH,
  roundedPathVHV,
  roundedPathHVH,
  pathLen,
  distPtSeg,
  getWorldTransform,
  rotatePointAroundOrigin,
} from './geometry-utils';

/**
 * Transform a point from a node's local coordinate space to world space.
 * This properly handles the hierarchical transform chain including:
 * - 2D scale (scaleX, scaleY)
 * - 3D rotations (rotationX, rotationY) which cause foreshortening
 * - 2D rotation (rotationZ)
 * 
 * The formula follows how canvas transforms compose:
 *   final = transform(point - center) + center + worldPos
 * 
 * Where 'center' is added back WITHOUT any transforms applied to it.
 * 
 * @param localPoint - Point in the node's local space (relative to parent's top-left)
 * @param node - The node containing the point
 * @param allNodes - All nodes for hierarchy traversal
 */
function transformPointToWorld(localPoint: Vec2, node: NodeModel, allNodes: NodeModel[]): Vec2 {
  if (!node.parentId) {
    // No parent, local = world
    return localPoint;
  }

  const parent = allNodes.find((n) => n.id === node.parentId);
  if (!parent) {
    return localPoint;
  }

  // Get parent's world transform
  const parentWorld = getWorldTransform(parent, allNodes);

  // Parent's center (rotation/scale pivot) in parent's local space
  const parentCenterLocal = {
    x: parent.w / 2,
    y: parent.h / 2,
  };

  // Convert point to be relative to parent's center (in parent's local space)
  const relToCenter = {
    x: localPoint.x - parentCenterLocal.x,
    y: localPoint.y - parentCenterLocal.y,
  };

  // Apply transforms in REVERSE order of canvas calls
  // (since canvas transforms compose such that last-called is first-applied to points)
  // Canvas order: translate(center) -> rotateZ -> scale3D -> scale2D -> translate(-center)
  // Point order: scale2D -> scale3D -> rotateZ (then add back center)
  
  let transformed = { ...relToCenter };
  
  // 1. Apply parent's 2D scale first
  transformed = {
    x: transformed.x * parentWorld.scaleX,
    y: transformed.y * parentWorld.scaleY,
  };
  
  // 2. Apply 3D foreshortening (rotationY affects X, rotationX affects Y)
  if (parentWorld.rotationY !== 0) {
    const radY = (parentWorld.rotationY * Math.PI) / 180;
    const scaleXFrom3D = Math.abs(Math.cos(radY));
    transformed.x *= scaleXFrom3D;
  }
  
  if (parentWorld.rotationX !== 0) {
    const radX = (parentWorld.rotationX * Math.PI) / 180;
    const scaleYFrom3D = Math.abs(Math.cos(radX));
    transformed.y *= scaleYFrom3D;
  }

  // 3. Apply 2D rotation (rotationZ) last
  if (parentWorld.rotationZ !== 0) {
    transformed = rotatePointAroundOrigin(transformed.x, transformed.y, parentWorld.rotationZ);
  }

  // Final position: transformed offset + center (NOT transformed) + world position
  // The center offset is added back WITHOUT any transforms, matching canvas behavior
  return {
    x: transformed.x + parentCenterLocal.x + parentWorld.x,
    y: transformed.y + parentCenterLocal.y + parentWorld.y,
  };
}

/**
 * Calculate a port's world position for a node, properly handling group hierarchy.
 * For grouped nodes, calculates port in local space then transforms to world.
 */
function getPortWorldPosition(
  node: NodeModel,
  port: Port,
  allNodes: NodeModel[]
): Vec2 {
  // First calculate port in node's local coordinate system
  // using the node's OWN rotation (not accumulated)
  const localPortPos = portWorld(node, port);

  if (!node.parentId) {
    // No parent, already in world space
    return localPortPos;
  }

  // Transform the local port position to world space through hierarchy
  return transformPointToWorld(localPortPos, node, allNodes);
}

/**
 * Calculate custom port's world position for a node, properly handling group hierarchy.
 */
function getCustomPortWorldPosition(
  node: NodeModel,
  customPort: CustomPort,
  allNodes: NodeModel[]
): Vec2 {
  // First calculate port in node's local coordinate system
  const localPortPos = customPortWorld(node, customPort);

  if (!node.parentId) {
    return localPortPos;
  }

  return transformPointToWorld(localPortPos, node, allNodes);
}

/**
 * Calculate auto anchor position for a node targeting a world point.
 * Properly handles group hierarchy.
 */
function getAutoAnchorWorldPosition(
  node: NodeModel,
  targetWorldX: number,
  targetWorldY: number,
  allNodes: NodeModel[]
): Vec2 {
  if (!node.parentId) {
    // No parent, use existing function directly
    return sideAnchorAutoWorld(node, targetWorldX, targetWorldY);
  }

  // For grouped nodes, we need to find where the target is in node's local space,
  // calculate the anchor in local space, then transform back to world

  // Get the node's world transform to understand where it is
  const nodeWorld = getWorldTransform(node, allNodes);

  // The node's center in world space
  const nodeCenterWorld = {
    x: nodeWorld.x + (node.w / 2) * nodeWorld.scaleX,
    y: nodeWorld.y + (node.h / 2) * nodeWorld.scaleY,
  };

  // Use the existing ray intersection or side anchor calculation
  // but we need to work in a space where the node is axis-aligned
  // For simplicity, use the local node position and apply node's own rotation
  const localAnchor = sideAnchorAutoWorld(node, targetWorldX, targetWorldY);

  // Transform to world
  return transformPointToWorld(localAnchor, node, allNodes);
}

/**
 * Get node's center in world coordinates.
 * 
 * For nodes with parentId, this uses transformPointToWorld to properly
 * convert the center point through the hierarchy.
 * 
 * For top-level nodes, we compute the center directly from the node's
 * position and size with its own transforms applied.
 */
function getNodeCenterWorld(node: NodeModel, allNodes: NodeModel[]): Vec2 {
  if (node.parentId) {
    // For grouped nodes, transform the local center point to world
    const localCenter = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
    // Apply node's own rotation to get the center in parent's local space
    const centerWithNodeTransform = pointWithNodeTransform(node, localCenter);
    // Then transform through parent hierarchy
    return transformPointToWorld(centerWithNodeTransform, node, allNodes);
  }
  
  // For top-level nodes, use pointWithNodeTransform which handles the node's own rotation
  return pointWithNodeTransform(node, { x: node.x + node.w / 2, y: node.y + node.h / 2 });
}

export function getEdgeEndpoints(
  e: EdgeModel,
  nodes: NodeModel[]
): { a: Vec2; b: Vec2 } | null {
  let a: Vec2, b: Vec2;
  const spacing = e.edgeSpacing ?? 8;
  const anchorMode = e.anchorMode || 'follow';
  const frozen = e.frozenEndpoints;

  // Determine start point (a)
  const hasFromNode = !!e.from;
  const hasToNode = !!e.to;
  const hasFromXY = !!e.fromXY;
  const hasToXY = !!e.toXY;

  // Need at least one valid endpoint for each end
  if (!hasFromNode && !hasFromXY) return null;
  if (!hasToNode && !hasToXY) return null;

  // Find the actual node objects (in their LOCAL coordinate space)
  const nA = hasFromNode ? nodes.find((n) => n.id === e.from) : null;
  const nB = hasToNode ? nodes.find((n) => n.id === e.to) : null;

  // If node reference exists but node not found, edge is invalid
  if (hasFromNode && !nA) return null;
  if (hasToNode && !nB) return null;

  // Check if we should use frozen endpoints based on anchor mode
  const useStartFrozen = frozen?.start && (anchorMode === 'freezeStart' || anchorMode === 'freezeBoth');
  const useEndFrozen = frozen?.end && (anchorMode === 'freezeEnd' || anchorMode === 'freezeBoth');

  // Calculate centers in world coordinates (properly handles hierarchy)
  const centerA = nA ? getNodeCenterWorld(nA, nodes) : null;
  const centerB = nB ? getNodeCenterWorld(nB, nodes) : null;

  // For hybrid edges, use the XY coordinate as the "target" for anchor calculation
  const targetForA = centerB || e.toXY!;
  const targetForB = centerA || e.fromXY!;

  // Pass 1: raw anchors on the node boundary (pre-spacing-push).
  // fromXY/toXY take priority when present — this only co-exists with from/to
  // when the modification pipeline explicitly pins an edge to exact
  // coordinates (e.g., to separate overlapping sequence-diagram arrows).
  let aRaw: Vec2;
  let bRaw: Vec2;
  let aIsFrozenOrXY = false;
  let bIsFrozenOrXY = false;

  if (hasFromXY) {
    aRaw = e.fromXY!;
    aIsFrozenOrXY = true;
  } else if (hasFromNode && nA) {
    if (useStartFrozen && frozen?.start) {
      aRaw = frozen.start;
      aIsFrozenOrXY = true;
    } else if (e.fromPortCustom) {
      aRaw = getCustomPortWorldPosition(nA, e.fromPortCustom, nodes);
    } else if (e.fromPort) {
      aRaw = getPortWorldPosition(nA, e.fromPort, nodes);
    } else {
      aRaw = getAutoAnchorWorldPosition(nA, targetForA.x, targetForA.y, nodes);
    }
  } else {
    return null;
  }

  if (hasToXY) {
    bRaw = e.toXY!;
    bIsFrozenOrXY = true;
  } else if (hasToNode && nB) {
    if (useEndFrozen && frozen?.end) {
      bRaw = frozen.end;
      bIsFrozenOrXY = true;
    } else if (e.toPortCustom) {
      bRaw = getCustomPortWorldPosition(nB, e.toPortCustom, nodes);
    } else if (e.toPort) {
      bRaw = getPortWorldPosition(nB, e.toPort, nodes);
    } else {
      bRaw = getAutoAnchorWorldPosition(nB, targetForB.x, targetForB.y, nodes);
    }
  } else {
    return null;
  }

  // Pass 2: spacing-push each endpoint away from its node center.
  // Cap each push so the two pushes can't cross past each other AND so we
  // always leave room for a visible arrowhead. When nodes sit closer than
  // 2*spacing apart, an unclamped push flips the endpoint order (arrow
  // points backward); when even tighter, the post-push edge becomes shorter
  // than the arrowhead glyph and renders invisibly. Reserve at least
  // MIN_VISIBLE_EDGE px of edge length and shrink (or skip) the spacing push
  // to fit.
  const MIN_VISIBLE_EDGE = 8;
  const rawDx = bRaw.x - aRaw.x;
  const rawDy = bRaw.y - aRaw.y;
  const rawDist = Math.hypot(rawDx, rawDy);
  const pushBudget = Math.max(0, (rawDist - MIN_VISIBLE_EDGE) / 2);
  let cappedSpacing = Math.min(spacing, pushBudget);

  // Component-wise cap: the push must also never flip the endpoints' relative
  // order on EITHER axis. The euclidean cap above misses this — two facing
  // anchors 14px apart horizontally but 130px apart vertically pass the
  // distance check, yet an 8px push on each side crosses them on x, the
  // elbow's final stub points backward into its node, and the arrowhead
  // renders reversed (floating chevron on generated swimlane flows).
  const aDir = (!aIsFrozenOrXY && centerA)
    ? (() => { const dx = aRaw.x - centerA.x, dy = aRaw.y - centerA.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; })()
    : { x: 0, y: 0 };
  const bDir = (!bIsFrozenOrXY && centerB)
    ? (() => { const dx = bRaw.x - centerB.x, dy = bRaw.y - centerB.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; })()
    : { x: 0, y: 0 };
  const AXIS_KEEP = 4;
  for (const [gap, rate] of [
    [rawDx, bDir.x - aDir.x],
    [rawDy, bDir.y - aDir.y],
  ] as Array<[number, number]>) {
    // `rate` is how fast the gap on this axis changes per px of push; only a
    // shrinking gap (opposite signs) constrains the push.
    if (gap > AXIS_KEEP && rate < 0) {
      cappedSpacing = Math.min(cappedSpacing, (gap - AXIS_KEEP) / -rate);
    } else if (gap < -AXIS_KEEP && rate > 0) {
      cappedSpacing = Math.min(cappedSpacing, (-gap - AXIS_KEEP) / rate);
    }
  }

  a = aRaw;
  if (!aIsFrozenOrXY && cappedSpacing > 0 && centerA) {
    const ax = aRaw.x - centerA.x, ay = aRaw.y - centerA.y;
    const al = Math.hypot(ax, ay) || 1;
    a = { x: aRaw.x + (ax / al) * cappedSpacing, y: aRaw.y + (ay / al) * cappedSpacing };
  }

  b = bRaw;
  if (!bIsFrozenOrXY && cappedSpacing > 0 && centerB) {
    const bx = bRaw.x - centerB.x, by = bRaw.y - centerB.y;
    const bl = Math.hypot(bx, by) || 1;
    b = { x: bRaw.x + (bx / bl) * cappedSpacing, y: bRaw.y + (by / bl) * cappedSpacing };
  }

  return { a, b };
}

export function chooseRoute(
  id: string,
  a: Vec2,
  b: Vec2,
  requested: 'AUTO' | 'VHV' | 'HVH',
  fromPort: Port | undefined,
  toPort: Port | undefined,
  edgeObj: EdgeModel | undefined,
  nodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): 'STRAIGHT' | 'VHV' | 'HVH' {
  const cur = routeModeRef[id];

  // Respect explicit request
  if (requested === 'VHV' || requested === 'HVH') {
    routeModeRef[id] = requested;
    return requested;
  }

  // Try to allow straight, but only if it won't cross node spans
  const alignThreshold = 10;
  const dxAbs = Math.abs(b.x - a.x);
  const dyAbs = Math.abs(b.y - a.y);

  if ((!edgeObj?.waypoints || edgeObj.waypoints.length === 0) && (dxAbs < alignThreshold || dyAbs < alignThreshold)) {
    let canBeStraight = true;
    if (edgeObj?.from && edgeObj?.to) {
      const nA = nodes.find(n => n.id === edgeObj.from);
      const nB = nodes.find(n => n.id === edgeObj.to);
      if (nA && nB) {
        const pad = (edgeObj.edgeSpacing ?? 8) + 4;
        const aL = nA.x - pad, aR = nA.x + nA.w + pad;
        const aT = nA.y - pad, aB = nA.y + nA.h + pad;
        const bL = nB.x - pad, bR = nB.x + nB.w + pad;
        const bT = nB.y - pad, bB = nB.y + nB.h + pad;
        const overlap1D = (p: number, q: number, r: number, s: number) => Math.min(q, s) - Math.max(p, r);
        if (dxAbs < alignThreshold && overlap1D(aL, aR, bL, bR) > 0) canBeStraight = false;
        if (dyAbs < alignThreshold && overlap1D(aT, aB, bT, bB) > 0) canBeStraight = false;
      }
    }
    if (canBeStraight) {
      routeModeRef[id] = 'STRAIGHT';
      return 'STRAIGHT';
    }
  }

  // Pick best route based on port orientation
  let best: 'VHV' | 'HVH';
  const effectivePort = edgeObj?.fromPortCustom?.side || fromPort;

  if (effectivePort === 'W' || effectivePort === 'E') {
    best = 'HVH';
  } else if (effectivePort === 'N' || effectivePort === 'S') {
    best = 'VHV';
  } else {
    if (edgeObj?.from) {
      const n = nodes.find((x) => x.id === edgeObj.from);
      if (n) {
        const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
        best = Math.abs(a.x - c.x) > Math.abs(a.y - c.y) ? 'HVH' : 'VHV';
      } else {
        best = 'VHV';
      }
    } else {
      best = 'VHV';
    }
  }

  if (!cur || cur === 'STRAIGHT') {
    routeModeRef[id] = best;
    return best;
  }

  // Keep length-based inertia for normal jitter
  const margin = 24;
  const vhvLen = pathLen(orthoPathVHV(a, b));
  const hvhLen = pathLen(orthoPathHVH(a, b));
  const curLen = cur === 'VHV' ? vhvLen : hvhLen;
  const newLen = best === 'VHV' ? vhvLen : hvhLen;
  if (newLen + margin < curLen) {
    routeModeRef[id] = best;
    return best;
  }
  return cur;
}

type Rect = { left: number; right: number; top: number; bottom: number };

function nodeWorldAABB(n: NodeModel, pad = 12): Rect {
  // account for transforms
  const cs = [
    pointWithNodeTransform(n, { x: n.x,         y: n.y }),
    pointWithNodeTransform(n, { x: n.x + n.w,   y: n.y }),
    pointWithNodeTransform(n, { x: n.x + n.w,   y: n.y + n.h }),
    pointWithNodeTransform(n, { x: n.x,         y: n.y + n.h }),
  ];
  const xs = cs.map(p => p.x), ys = cs.map(p => p.y);
  return {
    left:   Math.min(...xs) - pad,
    right:  Math.max(...xs) + pad,
    top:    Math.min(...ys) - pad,
    bottom: Math.max(...ys) + pad,
  };
}

function segsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const orient = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = orient(p1, p2, p3), o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1), o4 = orient(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;

  const on = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.min(a.x,b.x) <= c.x && c.x <= Math.max(a.x,b.x) &&
    Math.min(a.y,b.y) <= c.y && c.y <= Math.max(a.y,b.y);

  if (o1 === 0 && on(p1,p2,p3)) return true;
  if (o2 === 0 && on(p1,p2,p4)) return true;
  if (o3 === 0 && on(p3,p4,p1)) return true;
  if (o4 === 0 && on(p3,p4,p2)) return true;
  return false;
}

function segHitsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  // bbox reject
  if (Math.max(a.x,b.x) < r.left || Math.min(a.x,b.x) > r.right ||
      Math.max(a.y,b.y) < r.top  || Math.min(a.y,b.y) > r.bottom) return false;

  // either endpoint inside
  const inside = (p: Vec2) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  if (inside(a) || inside(b)) return true;

  // check against rectangle edges
  const edges = [
    [{x:r.left, y:r.top},     {x:r.right, y:r.top}],
    [{x:r.right,y:r.top},     {x:r.right, y:r.bottom}],
    [{x:r.right,y:r.bottom},  {x:r.left,  y:r.bottom}],
    [{x:r.left, y:r.bottom},  {x:r.left,  y:r.top}],
  ] as const;
  return edges.some(([p,q]) => segsIntersect(a,b,p,q));
}

/**
 * Infer port direction from endpoint position relative to node
 */
function inferPortFromPosition(point: Vec2, node: NodeModel): Port {
  const centerX = node.x + node.w / 2;
  const centerY = node.y + node.h / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  
  // Normalize by dimensions to handle non-square nodes correctly
  // This prevents a point on the top face of a wide node from being seen as 'East'
  const ndx = dx / (node.w / 2);
  const ndy = dy / (node.h / 2);
  
  if (Math.abs(ndx) > Math.abs(ndy)) {
    return ndx > 0 ? 'E' : 'W';
  } else {
    return ndy > 0 ? 'S' : 'N';
  }
}

/**
 * Check if a horizontal or vertical line segment intersects any obstacle
 */
function isOrthogonalSegmentClear(
  p1: Vec2, 
  p2: Vec2, 
  obstacles: Rect[]
): boolean {
  // Determine if segment is horizontal or vertical
  const isHorizontal = Math.abs(p1.y - p2.y) < 0.1;
  const isVertical = Math.abs(p1.x - p2.x) < 0.1;
  
  if (!isHorizontal && !isVertical) {
    console.warn('Non-orthogonal segment in pathfinding');
    return false;
  }
  
  for (const rect of obstacles) {
    if (segHitsRect(p1, p2, rect)) {
      return false;
    }
  }
  
  return true;
}

/**
 * A* Pathfinding on a Hanan Grid
 * Guarantees a valid orthogonal path if one exists
 */
function findOrthogonalPath(
  start: Vec2,
  goal: Vec2,
  obstacles: Rect[],
  mode: 'HVH' | 'VHV' // Used for heuristic bias
): Vec2[] | undefined {
  // 1. Generate Grid Coordinates
  // Include start, goal, and obstacle boundaries with clearance
  const margin = 20;
  const rawX = new Set<number>([start.x, goal.x]);
  const rawY = new Set<number>([start.y, goal.y]);

  obstacles.forEach(r => {
    rawX.add(r.left - margin);
    rawX.add(r.right + margin);
    rawY.add(r.top - margin);
    rawY.add(r.bottom + margin);
  });

  // Sort and deduplicate close coordinates (snap to grid)
  const SNAP_DIST = 5;
  const processCoords = (coords: Set<number>) => {
    const sorted = Array.from(coords).sort((a, b) => a - b);
    const result: number[] = [];
    if (sorted.length === 0) return result;
    
    result.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - result[result.length - 1] > SNAP_DIST) {
        result.push(sorted[i]);
      } else {
        // If snapping, prefer the obstacle clearance value (likely more useful for long runs)
        // But actually, preserving the start/end alignment might be better visually?
        // Let's just keep the first one for stability
      }
    }
    return result;
  };

  const X = processCoords(rawX);
  const Y = processCoords(rawY);

  // 2. A* Setup
  interface Node {
    x: number;
    y: number; // Indices in X/Y arrays
    g: number; // Cost from start
    f: number; // Estimated total cost
    parent?: Node;
  }

  // Find start and goal indices
  const startNode = { 
    x: X.indexOf(start.x), 
    y: Y.indexOf(start.y), 
    g: 0, 
    f: 0 
  };
  const goalNode = { 
    x: X.indexOf(goal.x), 
    y: Y.indexOf(goal.y) 
  };

  const openList: Node[] = [startNode];
  const closedSet = new Set<string>();

  const getNodeKey = (n: {x: number, y: number}) => `${n.x},${n.y}`;

  while (openList.length > 0) {
    // Pop node with lowest f
    openList.sort((a, b) => a.f - b.f);
    const current = openList.shift()!;

    // Check goal
    if (current.x === goalNode.x && current.y === goalNode.y) {
      return reconstructPath(current, X, Y);
    }

    const key = getNodeKey(current);
    if (closedSet.has(key)) continue;
    closedSet.add(key);

    // Explore neighbors (Up, Down, Left, Right)
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ];

    for (const neighbor of neighbors) {
      // Check bounds
      if (neighbor.x < 0 || neighbor.x >= X.length || 
          neighbor.y < 0 || neighbor.y >= Y.length) continue;

      if (closedSet.has(getNodeKey(neighbor))) continue;

      // Check collision for the segment
      const p1 = { x: X[current.x], y: Y[current.y] };
      const p2 = { x: X[neighbor.x], y: Y[neighbor.y] };
      
      // Strict collision check against obstacles
      // We check the segment + a small buffer to ensure we don't graze obstacles
      if (!isOrthogonalSegmentClear(p1, p2, obstacles)) continue;

      // Calculate cost
      const dist = Math.abs(X[neighbor.x] - X[current.x]) + 
                   Math.abs(Y[neighbor.y] - Y[current.y]);
      
      // Penalize turns to prefer straight lines
      const turnPenalty = current.parent && 
        (current.x !== current.parent.x && neighbor.x !== current.x || 
         current.y !== current.parent.y && neighbor.y !== current.y) ? 10 : 0;

      const g = current.g + dist + turnPenalty;
      const h = Math.abs(X[goalNode.x] - X[neighbor.x]) + 
                Math.abs(Y[goalNode.y] - Y[neighbor.y]);
      
      // Check if better path exists
      const existing = openList.find(n => n.x === neighbor.x && n.y === neighbor.y);
      if (existing && existing.g <= g) continue;
      
      if (existing) {
        existing.g = g;
        existing.f = g + h;
        existing.parent = current;
      } else {
        openList.push({
          x: neighbor.x,
          y: neighbor.y,
          g,
          f: g + h,
          parent: current
        });
      }
    }
  }

  return undefined; // No path found
}

function reconstructPath(node: any, X: number[], Y: number[]): Vec2[] {
  const path: Vec2[] = [];
  let curr = node;
  while (curr) {
    path.unshift({ x: X[curr.x], y: Y[curr.y] });
    curr = curr.parent;
  }
  
  // Optimize: remove collinear points
  if (path.length <= 2) return path;
  
  const optimized: Vec2[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i-1];
    const curr = path[i];
    const next = path[i+1];
    
    const isCollinearX = Math.abs(prev.x - curr.x) < 0.1 && Math.abs(curr.x - next.x) < 0.1;
    const isCollinearY = Math.abs(prev.y - curr.y) < 0.1 && Math.abs(curr.y - next.y) < 0.1;
    
    if (!isCollinearX && !isCollinearY) {
      optimized.push(curr);
    }
  }
  optimized.push(path[path.length - 1]);
  
  return optimized;
}

export function autoHVH(
  a: Vec2, b: Vec2, 
  A: NodeModel, B: NodeModel,
  fromPort: Port | undefined,
  toPort: Port | undefined,
  clear = 24
): Vec2[] | undefined {
  // Use minimal padding since we check segments carefully
  const obstaclePad = 8;
  const ra = nodeWorldAABB(A, obstaclePad);
  const rb = nodeWorldAABB(B, obstaclePad);

  // Build obstacle list (both nodes)
  const obstacles: Rect[] = [ra, rb];

  // OPTIMIZATION: Check if a simple HVH path (3 segments) would work without collisions
  // Only use A* pathfinding if the simple path fails.
  // For same-direction side ports (E→E or W→W), endpoint midX sits between the
  // two ports, which cuts through the wider node. Route past both bounds, with U
  // depth scaled by node size so big nodes get a proportionally deeper detour.
  const portFrom = fromPort || inferPortFromPosition(a, A);
  const portTo = toPort || inferPortFromPosition(b, B);
  const sameDirSide = (portFrom === 'E' && portTo === 'E') || (portFrom === 'W' && portTo === 'W');
  let midX: number;
  if (portFrom === 'E' && portTo === 'E') {
    midX = Math.max(ra.right, rb.right) + clear;
  } else if (portFrom === 'W' && portTo === 'W') {
    midX = Math.min(ra.left, rb.left) - clear;
  } else {
    midX = (a.x + b.x) / 2;
  }
  const simpleWaypoints = [
    { x: midX, y: a.y },
    { x: midX, y: b.y }
  ];
  
  // Use minimally padded obstacles for the simple path check to allow routing through tight gaps
  const tightPad = 2;
  const raTight = nodeWorldAABB(A, tightPad);
  const rbTight = nodeWorldAABB(B, tightPad);
  
  // Use "inner" bounds (negative padding) for the self-node checks
  // Increased to -5 to robustly allow start/end points that might be slightly inside the visual node boundary
  const innerPad = -5;
  const raInner = nodeWorldAABB(A, innerPad);
  const rbInner = nodeWorldAABB(B, innerPad);
  
  // Check if all three segments of the simple path are clear using smart padding
  const checkSeg = (p1: Vec2, p2: Vec2, obstacles: Rect[]) => {
    return isOrthogonalSegmentClear(p1, p2, obstacles);
  };

  const seg1Clear = checkSeg(a, simpleWaypoints[0], [rbTight, raInner]);
  const seg2Clear = checkSeg(simpleWaypoints[0], simpleWaypoints[1], [raTight, rbTight]);
  const seg3Clear = checkSeg(simpleWaypoints[1], b, [raTight, rbInner]);
  
  if (seg1Clear && seg2Clear && seg3Clear) {
    // Check if we need an approach segment based on port direction
    // HVH ends Horizontally.
    // If target is Top/Bottom (N/S), we prefer Vertical entry -> need HVHV
    const inferredToPort = toPort || inferPortFromPosition(b, B);
    if (inferredToPort === 'N' || inferredToPort === 'S') {
       // Add vertical approach segment
       const approachDist = 20;
       const backY = b.y > a.y ? b.y - approachDist : b.y + approachDist;
       // Check if approach segment fits geometry
       if (Math.abs(b.x - midX) > approachDist && Math.abs(b.y - a.y) > 5) {
         return [
           { x: midX, y: a.y },
           { x: midX, y: backY },
           { x: b.x, y: backY }
         ];
       }
    }

    // Same-direction side ports: keep the smart midX so the U routes past both
    // nodes. Returning undefined here would fall back to the default midpoint
    // which cuts through the wider node.
    if (sameDirSide) return simpleWaypoints;

    return undefined; // Return undefined to use default HVH path
  }
  
  // 1. Calculate safe breakout points based on ports
  const inferredFromPort = fromPort || inferPortFromPosition(a, A);
  const inferredToPort = toPort || inferPortFromPosition(b, B);
  
  // Exit point: move out from source in port direction
  // Push out significantly to ensure we are clearly outside the obstacle
  const breakout = 5;
  let pStart = { ...a };
  if (inferredFromPort === 'E') pStart.x = ra.right + breakout;
  else if (inferredFromPort === 'W') pStart.x = ra.left - breakout;
  else if (inferredFromPort === 'S') pStart.y = ra.bottom + breakout;
  else if (inferredFromPort === 'N') pStart.y = ra.top - breakout;
  
  // Entry point: move out from dest in port direction
  let pEnd = { ...b };
  if (inferredToPort === 'E') pEnd.x = rb.right + breakout;
  else if (inferredToPort === 'W') pEnd.x = rb.left - breakout;
  else if (inferredToPort === 'S') pEnd.y = rb.bottom + breakout;
  else if (inferredToPort === 'N') pEnd.y = rb.top - breakout;

  // 2. Run pathfinding between safe points
  // This avoids the "start/end inside obstacle" issue while allowing full collision checks
  const path = findOrthogonalPath(pStart, pEnd, obstacles, 'HVH');
  
  if (path) {
    return path;
  }
  
  return undefined;
}

export function autoVHV(
  a: Vec2, b: Vec2, 
  A: NodeModel, B: NodeModel,
  fromPort: Port | undefined,
  toPort: Port | undefined,
  clear = 24
): Vec2[] | undefined {
  // Use minimal padding since we check segments carefully
  const obstaclePad = 8;
  const ra = nodeWorldAABB(A, obstaclePad);
  const rb = nodeWorldAABB(B, obstaclePad);

  // Build obstacle list (both nodes)
  const obstacles: Rect[] = [ra, rb];

  // OPTIMIZATION: Check if a simple VHV path (3 segments) would work without collisions
  // Only use A* pathfinding if the simple path fails.
  // For same-direction top/bottom ports (S→S or N→N), endpoint midY sits between
  // the two ports, which cuts through the taller node. Route past both bounds, with
  // U depth scaled by node size so big nodes get a proportionally deeper detour.
  const portFrom = fromPort || inferPortFromPosition(a, A);
  const portTo = toPort || inferPortFromPosition(b, B);
  const sameDirTopBottom = (portFrom === 'S' && portTo === 'S') || (portFrom === 'N' && portTo === 'N');
  let midY: number;
  if (portFrom === 'S' && portTo === 'S') {
    midY = Math.max(ra.bottom, rb.bottom) + clear;
  } else if (portFrom === 'N' && portTo === 'N') {
    midY = Math.min(ra.top, rb.top) - clear;
  } else {
    midY = (a.y + b.y) / 2;
  }
  const simpleWaypoints = [
    { x: a.x, y: midY },
    { x: b.x, y: midY }
  ];
  
  // Use minimally padded obstacles for the simple path check to allow routing through tight gaps
  const tightPad = 2;
  const raTight = nodeWorldAABB(A, tightPad);
  const rbTight = nodeWorldAABB(B, tightPad);
  
  // Use "inner" bounds (negative padding) for the self-node checks
  // Increased to -5 to robustly allow start/end points that might be slightly inside the visual node boundary
  const innerPad = -5;
  const raInner = nodeWorldAABB(A, innerPad);
  const rbInner = nodeWorldAABB(B, innerPad);
  
  // Check if all three segments of the simple path are clear using smart padding
  // Segment 1 (Start -> Mid): Check Dest (tight) and Source (inner)
  const seg1Clear = isOrthogonalSegmentClear(a, simpleWaypoints[0], [rbTight, raInner]);
  
  // Segment 2 (Mid -> Mid): Check Both (tight)
  const seg2Clear = isOrthogonalSegmentClear(simpleWaypoints[0], simpleWaypoints[1], [raTight, rbTight]);
  
  // Segment 3 (Mid -> End): Check Source (tight) and Dest (inner)
  const seg3Clear = isOrthogonalSegmentClear(simpleWaypoints[1], b, [raTight, rbInner]);
  
  if (seg1Clear && seg2Clear && seg3Clear) {
    
    // Check if we need an approach segment based on port direction
    // VHV ends Vertically.
    // If target is Side (E/W), we prefer Horizontal entry -> need VHVH
    const inferredToPort = toPort || inferPortFromPosition(b, B);
    if (inferredToPort === 'E' || inferredToPort === 'W') {
       // Add horizontal approach segment
       const approachDist = 20;
       const backX = b.x > a.x ? b.x - approachDist : b.x + approachDist;
       // Check if approach segment fits geometry
       if (Math.abs(b.y - midY) > approachDist && Math.abs(b.x - a.x) > 5) {
         return [
           { x: a.x, y: midY },
           { x: backX, y: midY },
           { x: backX, y: b.y }
         ];
       }
    }

    // Same-direction top/bottom ports: keep the smart midY so the U routes past
    // both nodes. Returning undefined here would fall back to the default midpoint
    // which cuts through the taller node.
    if (sameDirTopBottom) return simpleWaypoints;

    return undefined; // Return undefined to use default VHV path
  }
  
  // 1. Calculate safe breakout points based on ports
  const inferredFromPort = fromPort || inferPortFromPosition(a, A);
  const inferredToPort = toPort || inferPortFromPosition(b, B);
  
  // Exit point: move out from source in port direction
  // Push out significantly to ensure we are clearly outside the obstacle
  const breakout = 5;
  let pStart = { ...a };
  if (inferredFromPort === 'E') pStart.x = ra.right + breakout;
  else if (inferredFromPort === 'W') pStart.x = ra.left - breakout;
  else if (inferredFromPort === 'S') pStart.y = ra.bottom + breakout;
  else if (inferredFromPort === 'N') pStart.y = ra.top - breakout;
  
  // Entry point: move out from dest in port direction
  let pEnd = { ...b };
  if (inferredToPort === 'E') pEnd.x = rb.right + breakout;
  else if (inferredToPort === 'W') pEnd.x = rb.left - breakout;
  else if (inferredToPort === 'S') pEnd.y = rb.bottom + breakout;
  else if (inferredToPort === 'N') pEnd.y = rb.top - breakout;

  // 2. Run pathfinding between safe points
  const path = findOrthogonalPath(pStart, pEnd, obstacles, 'VHV');
  
  if (path) {
    return path;
  }
  
  return undefined;
}

// Minimum clear space (px) between two node RECTS on the axis an elbowed route
// enters through. Below this, the mid-jog of an HVH/VHV path is a stub shorter
// than the arrowhead and one dash period — the dashes swallow the jog and the
// arrowhead renders as a tiny chevron floating perpendicular to the visible run.
const MIN_ELBOW_CLEARANCE = 28;

/**
 * chooseRoute picks HVH vs VHV from center-to-center deltas, which for two
 * nearly-diagonal nodes can select an entry axis with almost no clearance
 * between the rects (observed: swimlane cards 14px apart horizontally but
 * 130px vertically → HVH with invisible 7px stubs). When exactly one axis has
 * room for a visible stub, route through THAT axis and put the auto anchors
 * on the matching sides. Recomputes deterministically every call (routeModeRef
 * persistence would otherwise pair a flipped mode with stale side anchors).
 * Only applies to plain auto-anchored edges — ports, pinned XY endpoints,
 * frozen anchors, and rotated/grouped/lifeline nodes keep existing behavior.
 */
function reconcileElbowAxis(
  e: EdgeModel,
  fromNode: NodeModel | undefined,
  toNode: NodeModel | undefined,
  mode: 'STRAIGHT' | 'VHV' | 'HVH',
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): { mode: 'VHV' | 'HVH'; a: Vec2; b: Vec2 } | null {
  if (mode !== 'VHV' && mode !== 'HVH') return null;
  if (!fromNode || !toNode) return null;
  if (e.router && e.router !== 'AUTO') return null;
  if (e.fromPort || e.toPort || e.fromPortCustom || e.toPortCustom || e.fromXY || e.toXY) return null;
  if (e.frozenEndpoints && (e.anchorMode || 'follow') !== 'follow') return null;
  const plain = (n: NodeModel) =>
    !n.parentId && !((n.rotation ?? 0) + (n.rotationZ ?? 0))
    && n.kind !== 'uml-lifeline' && n.w > 0 && n.h > 0;
  if (!plain(fromNode) || !plain(toNode)) return null;

  const hGap = Math.max(toNode.x - (fromNode.x + fromNode.w),
                        fromNode.x - (toNode.x + toNode.w));
  const vGap = Math.max(toNode.y - (fromNode.y + fromNode.h),
                        fromNode.y - (toNode.y + toNode.h));
  let want: 'VHV' | 'HVH';
  if (hGap >= MIN_ELBOW_CLEARANCE && vGap < MIN_ELBOW_CLEARANCE) want = 'HVH';
  else if (vGap >= MIN_ELBOW_CLEARANCE && hGap < MIN_ELBOW_CLEARANCE) want = 'VHV';
  else return null; // both clear or both tight — keep existing behavior

  let a: Vec2;
  let b: Vec2;
  if (want === 'VHV') {
    const push = Math.min(e.edgeSpacing ?? 8, Math.max(0, (vGap - 8) / 2));
    const targetAbove = toNode.y < fromNode.y;
    a = portWorld(fromNode, targetAbove ? 'N' : 'S');
    b = portWorld(toNode, targetAbove ? 'S' : 'N');
    a = { x: a.x, y: a.y + (targetAbove ? -push : push) };
    b = { x: b.x, y: b.y + (targetAbove ? push : -push) };
  } else {
    const push = Math.min(e.edgeSpacing ?? 8, Math.max(0, (hGap - 8) / 2));
    const targetLeft = toNode.x < fromNode.x;
    a = portWorld(fromNode, targetLeft ? 'W' : 'E');
    b = portWorld(toNode, targetLeft ? 'E' : 'W');
    a = { x: a.x + (targetLeft ? -push : push), y: a.y };
    b = { x: b.x + (targetLeft ? push : -push), y: b.y };
  }
  if (routeModeRef[e.id] !== want) routeModeRef[e.id] = want;
  return { mode: want, a, b };
}

export function getEdgePath(
  e: EdgeModel,
  nodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): Vec2[] | null {
  const ends = getEdgeEndpoints(e, nodes);
  if (!ends) return null;
  let { a, b } = ends;

  const fromNode = e.from ? nodes.find(n => n.id === e.from) : undefined;
  const toNode   = e.to   ? nodes.find(n => n.id === e.to)   : undefined;

  const lineType = e.lineType || 'elbowed';
  if (lineType === 'straight') return straightPath(a, b);
  if (lineType === 'curved')   return curvedPath(a, b, e.curveControlPoint);

  // Decide router FIRST
  let mode = chooseRoute(
    e.id, a, b, e.router || 'AUTO', e.fromPort, e.toPort, e, nodes, routeModeRef
  );

  // Correct the entry axis when the chosen one has no rect clearance
  // (skip when explicit or bundled waypoints pin the shape).
  const _pinned = bundledWaypointsFor(e.id) ?? e.waypoints;
  if (!_pinned || _pinned.length < 2) {
    const fixed = reconcileElbowAxis(e, fromNode, toNode, mode, routeModeRef);
    if (fixed) { mode = fixed.mode; a = fixed.a; b = fixed.b; }
  }

  const pathStyle = e.pathStyle || 'rounded';
  const radius    = e.cornerRadius ?? 20;

  // Prefer explicit waypoints (bundled if the "Bundle edges" view option is on);
  // otherwise compute auto-waypoints by intersection test.
  const _ewps = bundledWaypointsFor(e.id) ?? e.waypoints;
  let waypoints = (_ewps && _ewps.length >= 2) ? _ewps : undefined;

  if (!waypoints && fromNode && toNode) {
    const clear = Math.max(24, (e.edgeSpacing ?? 8) + (radius / 2));
    waypoints = mode === 'HVH'
      ? autoHVH(a, b, fromNode, toNode, e.fromPort, e.toPort, clear)
      : autoVHV(a, b, fromNode, toNode, e.fromPort, e.toPort, clear);
  }

  if (mode === 'STRAIGHT') return straightPath(a, b);

  if (pathStyle === 'rounded') {
    return mode === 'VHV'
      ? roundedPathVHV(a, b, radius, waypoints)
      : roundedPathHVH(a, b, radius, waypoints);
  }
  return mode === 'VHV'
    ? orthoPathVHV(a, b, waypoints)
    : orthoPathHVH(a, b, waypoints);
}

export function getEdgeWaypointHandles(
  e: EdgeModel,
  nodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): Array<{ position: Vec2; segmentIndex: number; mode: 'VHV' | 'HVH' | 'CURVE' }> {
  const ends = getEdgeEndpoints(e, nodes);
  if (!ends) return [];

  let { a, b } = ends;
  const lineType = e.lineType || 'elbowed';
  
  // Handle curved line type - return midpoint on the curve as handle
  if (lineType === 'curved') {
    const controlPoint = e.curveControlPoint || getDefaultCurveControlPoint(a, b);
    
    // Calculate the point on the curve at t=0.5 (midpoint)
    // Quadratic Bezier formula at t=0.5: B(0.5) = 0.25*a + 0.5*controlPoint + 0.25*b
    const t = 0.5;
    const t1 = 1 - t;
    const t1Sq = t1 * t1;
    const tSq = t * t;
    const t1t2 = 2 * t1 * t;
    
    const handlePosition = {
      x: t1Sq * a.x + t1t2 * controlPoint.x + tSq * b.x,
      y: t1Sq * a.y + t1t2 * controlPoint.y + tSq * b.y,
    };
    
    return [{
      position: handlePosition,
      segmentIndex: 0,
      mode: 'CURVE',
    }];
  }
  
  // No handles for straight line type
  if (lineType === 'straight') {
    return [];
  }
  let mode = chooseRoute(
    e.id,
    a,
    b,
    e.router || 'AUTO',
    e.fromPort,
    e.toPort,
    e,
    nodes,
    routeModeRef
  );

  // Keep handles on the same corrected path getEdgePath draws.
  if (!e.waypoints || e.waypoints.length === 0) {
    const fromNode = e.from ? nodes.find(n => n.id === e.from) : undefined;
    const toNode   = e.to   ? nodes.find(n => n.id === e.to)   : undefined;
    const fixed = reconcileElbowAxis(e, fromNode, toNode, mode, routeModeRef);
    if (fixed) { mode = fixed.mode; a = fixed.a; b = fixed.b; }
  }

  if (mode === 'STRAIGHT') return [];
  
  const handles: Array<{ position: Vec2; segmentIndex: number; mode: 'VHV' | 'HVH' }> = [];
  
  // Always use orthogonal path for handle calculation (not rounded)
  // This ensures handles are placed at logical segment midpoints, not curve points
  let waypoints = e.waypoints;
  
  // If no explicit waypoints, we must use the SAME auto-routing logic as getEdgePath
  // to ensure handles match the visible path
  if ((!waypoints || waypoints.length < 2) && e.from && e.to) {
    const fromNode = nodes.find(n => n.id === e.from);
    const toNode = nodes.find(n => n.id === e.to);
    
    if (fromNode && toNode) {
      const radius = e.cornerRadius ?? 20;
      const clear = Math.max(24, (e.edgeSpacing ?? 8) + (radius / 2));
      
      waypoints = mode === 'HVH'
        ? autoHVH(a, b, fromNode, toNode, e.fromPort, e.toPort, clear)
        : autoVHV(a, b, fromNode, toNode, e.fromPort, e.toPort, clear);
    }
  }

  const path = mode === 'VHV' 
    ? orthoPathVHV(a, b, waypoints) 
    : orthoPathHVH(a, b, waypoints);
  if (!path || path.length < 2) return [];
  
  // Create handles for each segment
  // path = [a, wp0, wp1, ..., wpN, b]
  // segments are indexed: 0: a→wp0, 1: wp0→wp1, ..., n: wpN→b
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    
    // Calculate segment length
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segmentLength = Math.hypot(dx, dy);
    
    // Skip very short segments (< 15 units) to avoid clutter
    if (segmentLength < 15) continue;
    
    // Skip segments too close to nodes to avoid conflicts with ports
    const MIN_DISTANCE_FROM_NODE = 25;
    if (i === 0 && segmentLength < MIN_DISTANCE_FROM_NODE) continue;
    if (i === path.length - 2 && segmentLength < MIN_DISTANCE_FROM_NODE) continue;
    
    // Place handle at midpoint
    const midpoint = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };
    
    // Determine handle mode based on segment orientation
    // Horizontal segment (dx > dy) -> Drag Vertically to adjust Y -> 'VHV' mode
    // Vertical segment (dy > dx) -> Drag Horizontally to adjust X -> 'HVH' mode
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const isHorizontal = absDx > absDy;
    const segmentMode = isHorizontal ? 'VHV' : 'HVH';
    
    handles.push({
      position: midpoint,
      segmentIndex: i,
      mode: segmentMode,
    });
  }
  
  return handles;
}

export function hitTestEdgeWaypointHandle(
  e: EdgeModel,
  nodes: NodeModel[],
  wx: number,
  wy: number,
  threshold: number,
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): { segmentIndex: number; mode: 'VHV' | 'HVH' | 'CURVE' } | null {
  const handles = getEdgeWaypointHandles(e, nodes, routeModeRef);
  
  for (const handle of handles) {
    const dist = Math.hypot(handle.position.x - wx, handle.position.y - wy);
    if (dist < threshold) {
      return { segmentIndex: handle.segmentIndex, mode: handle.mode };
    }
  }
  
  return null;
}

export function hitTestEdges(
  edges: EdgeModel[],
  nodes: NodeModel[],
  wx: number,
  wy: number,
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): string | null {
  const p = { x: wx, y: wy };
  let bestId: string | null = null;
  let bestD = 8;
  
  for (const e of edges) {
    const pts = getEdgePath(e, nodes, routeModeRef);
    if (!pts) continue;

    for (let i = 1; i < pts.length; i++) {
      const d = distPtSeg(p, pts[i - 1], pts[i]);
      if (d < bestD) {
        bestD = d;
        bestId = e.id;
      }
    }
  }
  return bestId;
}

export type ArrowType = 'triangle' | 'open-triangle' | 'diamond-filled' | 'diamond-hollow' | 'circle' | 'bar';

function drawTriangleArrow(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  size: number,
  color: string,
  filled: boolean
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const baseX = to.x - ux * size;
  const baseY = to.y - uy * size;
  const px = -uy,
    py = ux;
  const w = size * 0.6;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  if (filled) {
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(baseX + px * w, baseY + py * w);
    ctx.lineTo(baseX - px * w, baseY - py * w);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, size * 0.25);
    ctx.stroke();
    ctx.fill();
  } else {
    // V-shape (chevron): two strokes meeting at the tip, no back edge, no fill
    const vw = size * 1.0;
    ctx.beginPath();
    ctx.moveTo(baseX + px * vw, baseY + py * vw);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(baseX - px * vw, baseY - py * vw);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, size * 0.25);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function drawDiamondArrow(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  size: number,
  color: string,
  filled: boolean
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const px = -uy,
    py = ux;
  const halfLen = size * 0.7;
  const halfW = size * 0.4;
  const midX = to.x - ux * halfLen;
  const midY = to.y - uy * halfLen;
  const backX = to.x - ux * halfLen * 2;
  const backY = to.y - uy * halfLen * 2;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(midX + px * halfW, midY + py * halfW);
  ctx.lineTo(backX, backY);
  ctx.lineTo(midX - px * halfW, midY - py * halfW);
  ctx.closePath();
  ctx.fillStyle = filled ? color : '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawCircleArrow(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  size: number,
  color: string
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const r = size * 0.35;
  const cx = to.x - ux * r;
  const cy = to.y - uy * r;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawBarArrow(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  size: number,
  color: string
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const px = -uy,
    py = ux;
  const halfW = size * 0.6;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(to.x + px * halfW, to.y + py * halfW);
  ctx.lineTo(to.x - px * halfW, to.y - py * halfW);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.3);
  ctx.stroke();
  ctx.restore();
}

export function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  size: number,
  color: string,
  type?: ArrowType
) {
  const t = type || 'open-triangle';
  switch (t) {
    case 'triangle':       drawTriangleArrow(ctx, from, to, size, color, true); break;
    case 'open-triangle':  drawTriangleArrow(ctx, from, to, size, color, false); break;
    case 'diamond-filled': drawDiamondArrow(ctx, from, to, size, color, true); break;
    case 'diamond-hollow': drawDiamondArrow(ctx, from, to, size, color, false); break;
    case 'circle':         drawCircleArrow(ctx, from, to, size, color); break;
    case 'bar':            drawBarArrow(ctx, from, to, size, color); break;
    default:               drawTriangleArrow(ctx, from, to, size, color, false); break;
  }
}

/**
 * Normalize waypoints by removing collinear points and duplicates
 */
export function normalizeWaypoints(pts: Vec2[], eps = 0.001): Vec2[] {
  if (pts.length < 2) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1],
      b = pts[i],
      c = pts[i + 1];
    const collinear =
      (Math.abs(a.x - b.x) < eps && Math.abs(b.x - c.x) < eps) ||
      (Math.abs(a.y - b.y) < eps && Math.abs(b.y - c.y) < eps);
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  // drop accidental duplicates
  return out.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p.x - out[i - 1].x) > eps ||
      Math.abs(p.y - out[i - 1].y) > eps
  );
}

/**
 * Initialize ports on edges that don't have them based on node positions
 */
export function initializeEdgePorts(
  edges: EdgeModel[],
  nodes: NodeModel[]
): EdgeModel[] {
  return edges.map((edge) => {
    // Skip if already has ports or is a custom connection
    if (edge.fromPort || edge.toPort || edge.fromXY || edge.toXY) return edge;

    // Calculate initial ports based on relative position
    const fromNode = nodes.find((n) => n.id === edge.from);
    const toNode = nodes.find((n) => n.id === edge.to);
    if (!fromNode || !toNode) return edge;

    const fromCenter = {
      x: fromNode.x + fromNode.w / 2,
      y: fromNode.y + fromNode.h / 2,
    };
    const toCenter = { x: toNode.x + toNode.w / 2, y: toNode.y + toNode.h / 2 };

    // Determine fromPort
    const dx1 = toCenter.x - fromCenter.x;
    const dy1 = toCenter.y - fromCenter.y;
    const absDx1 = Math.abs(dx1);
    const absDy1 = Math.abs(dy1);
    const fromPort: Port =
      absDx1 > absDy1 ? (dx1 > 0 ? 'E' : 'W') : dy1 > 0 ? 'S' : 'N';

    // Determine toPort
    const dx2 = fromCenter.x - toCenter.x;
    const dy2 = fromCenter.y - toCenter.y;
    const absDx2 = Math.abs(dx2);
    const absDy2 = Math.abs(dy2);
    const toPort: Port =
      absDx2 > absDy2 ? (dx2 > 0 ? 'E' : 'W') : dy2 > 0 ? 'S' : 'N';

    return { ...edge, fromPort, toPort };
  });
}

/**
 * Convert an edge to a Path object for use with pointAndTangentAt
 * This allows nodes to flow along edges using the same interpolation as paths
 */
export function edgeToPath(
  edge: EdgeModel,
  nodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): { points: Vec2[]; length: number; cum: number[] } | null {
  const pts = getEdgePath(edge, nodes, routeModeRef);
  if (!pts || pts.length < 2) return null;

  // Calculate cumulative lengths for constant-speed interpolation
  const cum: number[] = [0];
  let totalLength = 0;

  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
    cum.push(totalLength);
  }

  return {
    points: pts,
    length: totalLength,
    cum,
  };
}

/**
 * Get the path for node flow animation.
 * Handles the followEdge vs cachedPath logic in ONE place.
 * 
 * @param configEdge - Edge with nodeFlow config (for cachedPath, followEdge settings)
 * @param geometryEdge - Edge for geometry/path calculation (may be from current step)
 * @param nodes - Current nodes for live path calculation
 * @param routeModeRef - Route mode reference for path calculation
 * @returns Path data or null if edge has no valid path
 */
export function getNodeFlowPath(
  configEdge: EdgeModel,
  geometryEdge: EdgeModel,
  nodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): { points: Vec2[]; length: number; cum: number[] } | null {
  const flow = configEdge.nodeFlow;
  if (!flow) return null;

  const shouldFollowEdge = flow.followEdge ?? false;

  // Priority 1: Follow edge = use live path (dynamic, follows node movement)
  if (shouldFollowEdge) {
    return edgeToPath(geometryEdge, nodes, routeModeRef);
  }

  // Priority 2: Cached path exists = use it (stable, step-independent)
  if (flow.cachedPath && flow.cachedPath.points.length >= 2) {
    return {
      points: flow.cachedPath.points,
      length: flow.cachedPath.length,
      cum: flow.cachedPath.cum,
    };
  }

  // Fallback: Calculate live path
  return edgeToPath(geometryEdge, nodes, routeModeRef);
}

/**
 * Get individual edge paths for multi-edge node flow
 * Returns an array of paths, one per edge, for segmented traversal with fade transitions
 */
export function getMultiEdgePaths(
  edgeSequence: string[],
  edges: EdgeModel[],
  nodes: NodeModel[],
  routeModeRef: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): Array<{ edgeId: string; points: Vec2[]; length: number; cum: number[] }> | null {
  if (!edgeSequence || edgeSequence.length === 0) return null;

  const paths: Array<{ edgeId: string; points: Vec2[]; length: number; cum: number[] }> = [];

  for (const edgeId of edgeSequence) {
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) continue;

    const edgePath = edgeToPath(edge, nodes, routeModeRef);
    if (!edgePath || edgePath.points.length < 2) continue;

    paths.push({
      edgeId,
      points: edgePath.points,
      length: edgePath.length,
      cum: edgePath.cum,
    });
  }

  return paths.length > 0 ? paths : null;
}

/**
 * Hit test edge endpoints - returns edge and which endpoint ('start' or 'end') if hit.
 * This is primarily used for edge repointing.
 *
 * @param wx World X coordinate
 * @param wy World Y coordinate
 * @param edge The edge to check
 * @param nodes Array of nodes (for endpoint calculation)
 * @param camera Camera object with zoom
 * @param routeMode Optional route mode record
 */
export function hitTestEdgeEndpoint(
  wx: number,
  wy: number,
  edge: EdgeModel,
  nodes: NodeModel[],
  camera: { zoom: number },
  routeMode?: Record<string, 'VHV' | 'HVH' | 'STRAIGHT'>
): { edgeId: string; endpoint: 'start' | 'end' } | null {
  const pts = getEdgePath(edge, nodes, routeMode ?? {});
  if (!pts || pts.length < 2) return null;

  const threshold = Math.min(15, Math.max(8, 10 / camera.zoom));

  // Check start point
  const startPt = pts[0];
  const startDist = Math.hypot(startPt.x - wx, startPt.y - wy);
  if (startDist < threshold) {
    return { edgeId: edge.id, endpoint: 'start' };
  }

  // Check end point
  const endPt = pts[pts.length - 1];
  const endDist = Math.hypot(endPt.x - wx, endPt.y - wy);
  if (endDist < threshold) {
    return { edgeId: edge.id, endpoint: 'end' };
  }

  return null;
}
