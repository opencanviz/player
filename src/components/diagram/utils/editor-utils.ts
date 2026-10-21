/* eslint-disable -- Migrated file */
/**
 * Editor Utility Functions
 *
 * Pure utility functions extracted from diagram-editor.tsx.
 * These functions have no dependencies on React state or closures.
 */

import type { NodeModel, EdgeModel, Step } from '../types';

// ============================================================================
// Default Colors & Style Constants
// ============================================================================

/** Default fill color for new nodes */
export const DEFAULT_NODE_FILL = '#16233a';

/** Default stroke color for new nodes */
export const DEFAULT_NODE_STROKE = '#2b3a55';

/** Default stroke color for new edges */
export const DEFAULT_EDGE_STROKE = '#9aa6bc';

/** Default alternate node fill (for leaf nodes, etc.) */
export const DEFAULT_NODE_FILL_ALT = '#0e2a47';

/** Default alternate node stroke (for leaf nodes, etc.) */
export const DEFAULT_NODE_STROKE_ALT = '#3a4b69';

/** Properties that are animated by default */
export const DEFAULT_ANIMATED_PROPERTIES = ['x', 'y', 'w', 'h', 'opacity'] as const;

// ============================================================================
// Animation Property Helpers
// ============================================================================

/**
 * Check if a property should be animated for a node
 * Returns true if animated, false if static
 */
export function isPropertyAnimated(
  node: NodeModel,
  propName: keyof NodeModel['_animatedProps']
): boolean {
  // If _animatedProps is defined, use it
  if (node._animatedProps && propName in node._animatedProps) {
    return node._animatedProps[propName] !== false;
  }

  // Otherwise use defaults
  return DEFAULT_ANIMATED_PROPERTIES.includes(propName as any);
}

// ============================================================================
// Z-Index Utilities
// ============================================================================

/**
 * Get the highest z-index from all nodes and edges
 * Used for bringing new elements to front
 */
export function calculateMaxZIndex(nodes: NodeModel[], edges: EdgeModel[]): number {
  const maxNodeZ = Math.max(...nodes.map((n) => n.zIndex || 0), 0);
  const maxEdgeZ = Math.max(...edges.map((e) => e.zIndex || 0), 0);
  return Math.max(maxNodeZ, maxEdgeZ);
}

// ============================================================================
// Duration Calculations
// ============================================================================

/**
 * Calculate total animation duration from steps and edge node flows
 * Returns the maximum of step durations or node flow durations
 */
export function calculateTotalDuration(steps: readonly Step[], edges: readonly EdgeModel[]): number {
  // NEW MODEL: Total animation duration = sum of ALL step durations
  // Each step's actions run during that step's duration
  // ALSO consider node flow durations to ensure complete animation cycles
  if (steps.length <= 1) return 0;

  // Simple: sum of all step durations
  const stepsDuration = steps.reduce((s, st) => s + (st.durationMs || 0), 0);

  // Also consider node flow durations
  // Find the maximum node flow duration to ensure at least one complete cycle
  let maxNodeFlowDuration = 0;
  for (const edge of edges) {
    if (edge.nodeFlow?.enabled && edge.nodeFlow.speed) {
      const flow = edge.nodeFlow;
      const speed = flow.speed || 1000;
      const count = flow.count || 1;
      const spacing = flow.spacing || 200;

      // Calculate total travel duration
      let travelDuration = speed;

      // For multi-edge sequences, sum all edge durations
      if (flow.edgeSequence && flow.edgeSequence.length > 1) {
        const numEdges = flow.edgeSequence.length;
        if (flow.edgeSpeeds && flow.edgeSpeeds.length > 0) {
          // Use per-edge speeds
          travelDuration = flow.edgeSpeeds.reduce(
            (sum, s) => sum + (s || speed),
            0
          );
        } else {
          // Default: speed * number of edges
          travelDuration = speed * numEdges;
        }
      }

      // Full wave duration: time for last clone to complete its journey
      const waveDuration = travelDuration + (count - 1) * spacing;
      maxNodeFlowDuration = Math.max(maxNodeFlowDuration, waveDuration);
    }
  }

  // Return the maximum of step duration or node flow duration
  return Math.max(stepsDuration, maxNodeFlowDuration);
}

// ============================================================================
// ID Generation
// ============================================================================

/** Generate a random suffix for IDs */
function randomSuffix(length = 5): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Generate a unique ID for actions
 */
export function generateActionId(): string {
  return `action_${Date.now()}_${randomSuffix(9)}`;
}

/**
 * Generate a unique ID for steps
 */
export function generateStepId(): string {
  return `step_${Date.now()}_${randomSuffix(9)}`;
}

/**
 * Generate a unique ID for nodes
 */
export function generateNodeId(prefix = 'n'): string {
  return `${prefix}${randomSuffix(5)}`;
}

/**
 * Generate a unique ID for edges
 */
export function generateEdgeId(prefix = 'e'): string {
  return `${prefix}${randomSuffix(5)}`;
}

/**
 * Generate a unique ID for text nodes
 */
export function generateTextId(): string {
  return `txt${randomSuffix(5)}`;
}

/**
 * Generate a unique ID for image nodes
 */
export function generateImageId(): string {
  return `img${randomSuffix(5)}`;
}

/**
 * Generate a unique ID for groups
 */
export function generateGroupId(): string {
  return `grp${randomSuffix(5)}`;
}

/**
 * Generate a unique ID for lines (standalone edges)
 */
export function generateLineId(): string {
  return `line_${randomSuffix(5)}`;
}

// ============================================================================
// Geometry Utilities
// ============================================================================

/**
 * Calculate distance from a point to a line segment
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // Segment is a point
    return Math.hypot(px - x1, py - y1);
  }

  // Project point onto line, clamped to segment
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq)
  );
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY);
}

/**
 * Check if a point is near any segment of a path
 */
export function isPointNearPath(
  px: number,
  py: number,
  points: { x: number; y: number }[],
  threshold: number
): boolean {
  if (points.length < 2) return false;

  for (let i = 0; i < points.length - 1; i++) {
    const dist = pointToSegmentDistance(
      px,
      py,
      points[i].x,
      points[i].y,
      points[i + 1].x,
      points[i + 1].y
    );
    if (dist < threshold) return true;
  }
  return false;
}

// ============================================================================
// Initial Data (Default diagram when starting fresh)
// ============================================================================

// A fresh editor starts BLANK — no demo diagram. (Generation, project load, and
// import all replace these anyway; a blank canvas is the honest empty state.)
export const INITIAL_NODES: NodeModel[] = [];

export const INITIAL_EDGES: EdgeModel[] = [];

