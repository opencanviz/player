/**
 * Step Resolution Utilities
 * 
 * Resolves delta-based step snapshots into complete node/edge state.
 * 
 * Delta Format:
 * - Step 0: Full snapshot (all nodes/edges with complete properties)
 * - Step 1+: Only include nodes/edges that changed, with only changed properties
 * 
 * Benefits:
 * - 70-90% smaller JSON for steps after step 0
 * - AI only needs to specify what changes
 * - Human editing: easier to see what changed between steps
 */

import type { NodeModel, EdgeModel, Step } from '../types';

/**
 * Resolves a step's delta-based data into a complete snapshot
 * by accumulating deltas from step 0 through the target step.
 * 
 * @param steps - All steps in the diagram
 * @param targetStepIndex - The step index to resolve (0-based)
 * @returns Complete nodes and edges for that step
 */
export function resolveStepSnapshot(
    steps: readonly Step[],
    targetStepIndex: number
): { nodes: NodeModel[]; edges: EdgeModel[] } {
    if (steps.length === 0) {
        return { nodes: [], edges: [] };
    }

    // Clamp to valid range
    const stepIndex = Math.max(0, Math.min(targetStepIndex, steps.length - 1));
    const step0 = steps[0];

    // Step 0 is always the base snapshot - must have complete nodes/edges
    const nodeMap = new Map<string, NodeModel>();
    const edgeMap = new Map<string, EdgeModel>();

    // Initialize from step 0
    for (const node of step0.nodes || []) {
        nodeMap.set(node.id, { ...node } as NodeModel);
    }
    for (const edge of step0.edges || []) {
        edgeMap.set(edge.id, { ...edge } as EdgeModel);
    }

    // Apply deltas from step 1 through target step
    for (let i = 1; i <= stepIndex; i++) {
        const step = steps[i];

        // Handle node additions (new nodes this step)
        if ((step as any).addNodes) {
            for (const newNode of (step as any).addNodes as NodeModel[]) {
                nodeMap.set(newNode.id, { ...newNode });
            }
        }

        // Handle node removals
        if ((step as any).removeNodeIds) {
            for (const nodeId of (step as any).removeNodeIds as string[]) {
                nodeMap.delete(nodeId);
            }
        }

        // Apply node property deltas
        for (const nodeDelta of step.nodes || []) {
            const existing = nodeMap.get(nodeDelta.id);
            if (existing) {
                // Merge delta properties into existing node
                nodeMap.set(nodeDelta.id, { ...existing, ...nodeDelta });
            } else {
                // Node doesn't exist in base - treat as full definition (backwards compat)
                nodeMap.set(nodeDelta.id, { ...nodeDelta } as NodeModel);
            }
        }

        // Handle edge additions
        if ((step as any).addEdges) {
            for (const newEdge of (step as any).addEdges as EdgeModel[]) {
                edgeMap.set(newEdge.id, { ...newEdge });
            }
        }

        // Handle edge removals
        if ((step as any).removeEdgeIds) {
            for (const edgeId of (step as any).removeEdgeIds as string[]) {
                edgeMap.delete(edgeId);
            }
        }

        // Apply edge property deltas
        for (const edgeDelta of step.edges || []) {
            const existing = edgeMap.get(edgeDelta.id);
            if (existing) {
                // Merge delta properties into existing edge
                edgeMap.set(edgeDelta.id, { ...existing, ...edgeDelta });
            } else {
                // Edge doesn't exist in base - treat as full definition (backwards compat)
                edgeMap.set(edgeDelta.id, { ...edgeDelta } as EdgeModel);
            }
        }
    }

    return {
        nodes: Array.from(nodeMap.values()),
        edges: Array.from(edgeMap.values()),
    };
}

/**
 * Checks if a step is in delta format (has addNodes/removeNodeIds or sparse nodes)
 */
export function isStepDeltaFormat(step: Step, baseNodeCount: number): boolean {
    // If step has add/remove arrays, it's definitely delta format
    if ((step as any).addNodes || (step as any).removeNodeIds) {
        return true;
    }
    if ((step as any).addEdges || (step as any).removeEdgeIds) {
        return true;
    }
    // If node count is significantly less than base, likely delta format
    if ((step.nodes || []).length < baseNodeCount * 0.5) {
        return true;
    }
    // Sparse-property delta: a step may list EVERY node id (count === base) but
    // carry only the changed props per node. A full snapshot always includes
    // kind + position, so a node missing those means this step is a delta that
    // still needs resolving (otherwise nodes render with no y/geometry — the
    // "fine on canvas, teleport on export" bug). See also hasDeltaFormatSteps.
    if ((step.nodes || []).some(
        (n) => n.kind === undefined || (n as any).x === undefined || (n as any).y === undefined,
    )) {
        return true;
    }
    return false;
}

/**
 * Deep equality check for comparing property values
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((item, i) => deepEqual(item, b[i]));
        }

        const aKeys = Object.keys(a as object);
        const bKeys = Object.keys(b as object);
        if (aKeys.length !== bKeys.length) return false;

        return aKeys.every(key =>
            deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
        );
    }

    return false;
}

/**
 * Computes the delta between two node states.
 * Returns only the properties that changed.
 */
export function computeNodeDelta(
    prevNode: NodeModel,
    currentNode: NodeModel
): Partial<NodeModel> & { id: string } | null {
    const delta: Partial<NodeModel> & { id: string } = { id: currentNode.id };
    let hasChanges = false;

    const keysToCheck: (keyof NodeModel)[] = [
        'x', 'y', 'w', 'h',
        'rotationZ', 'rotationX', 'rotationY',
        'scaleX', 'scaleY',
        'opacity',
        'typeProgress',
        'blur' as keyof NodeModel,
        'fill', 'stroke', 'strokeWidth',
        'label', 'labelColor', 'labelFontSize',
        'text', 'fontSize', 'fontFamily', 'fontWeight', 'color',
        'cornerRadius',
        'locked',
        'parentId',
        'pivotX', 'pivotY',
        'zIndex',
        // Tier 1 shape properties
        'value', 'progressOrientation', 'progressColor',
        'startAngle', 'endAngle', 'innerRadius',
        'pointDepth',
        'topWidth', 'bottomWidth',
        'pointerSide', 'pointerPosition', 'pointerSize',
        // UML properties
        'lifelineLength', 'activations', 'attributes', 'methods', 'stereotype',
    ];

    for (const key of keysToCheck) {
        if (!deepEqual(prevNode[key], currentNode[key])) {
            (delta as any)[key] = currentNode[key];
            hasChanges = true;
        }
    }

    return hasChanges ? delta : null;
}

/**
 * Computes the delta between two edge states.
 * Returns only the properties that changed.
 */
export function computeEdgeDelta(
    prevEdge: EdgeModel,
    currentEdge: EdgeModel
): Partial<EdgeModel> & { id: string } | null {
    const delta: Partial<EdgeModel> & { id: string } = { id: currentEdge.id };
    let hasChanges = false;

    const keysToCheck: (keyof EdgeModel)[] = [
        'from', 'to',
        'fromXY', 'toXY',
        'fromPort', 'toPort',
        'stroke', 'width',
        'label', 'labelColor', 'labelFontSize',
        'lineType', 'arrow',
        'trim', 'trimStart',
        'curveControlPoint',
        'waypoints',
        'zIndex',
    ];

    for (const key of keysToCheck) {
        if (!deepEqual((prevEdge as any)[key], (currentEdge as any)[key])) {
            (delta as any)[key] = (currentEdge as any)[key];
            hasChanges = true;
        }
    }

    return hasChanges ? delta : null;
}

/**
 * Computes the delta for a step compared to the resolved state of the previous step.
 * Used when saving diagrams in delta format.
 * 
 * @param currentNodes - Complete nodes for this step
 * @param currentEdges - Complete edges for this step  
 * @param prevResolvedNodes - Resolved nodes from previous step
 * @param prevResolvedEdges - Resolved edges from previous step
 * @returns Delta step data
 */
export function computeStepDelta(
    currentNodes: NodeModel[],
    currentEdges: EdgeModel[],
    prevResolvedNodes: NodeModel[],
    prevResolvedEdges: EdgeModel[]
): {
    nodes: Array<Partial<NodeModel> & { id: string }>;
    edges: Array<Partial<EdgeModel> & { id: string }>;
    addNodes?: NodeModel[];
    removeNodeIds?: string[];
    addEdges?: EdgeModel[];
    removeEdgeIds?: string[];
} {
    const prevNodeMap = new Map(prevResolvedNodes.map(n => [n.id, n]));
    const prevEdgeMap = new Map(prevResolvedEdges.map(e => [e.id, e]));
    const currentNodeMap = new Map(currentNodes.map(n => [n.id, n]));
    const currentEdgeMap = new Map(currentEdges.map(e => [e.id, e]));

    const nodeDeltas: Array<Partial<NodeModel> & { id: string }> = [];
    const addNodes: NodeModel[] = [];
    const removeNodeIds: string[] = [];

    const edgeDeltas: Array<Partial<EdgeModel> & { id: string }> = [];
    const addEdges: EdgeModel[] = [];
    const removeEdgeIds: string[] = [];

    // Find added and changed nodes
    Array.from(currentNodeMap.entries()).forEach(([id, currentNode]) => {
        const prevNode = prevNodeMap.get(id);
        if (!prevNode) {
            // New node
            addNodes.push(currentNode);
        } else {
            // Check for changes
            const delta = computeNodeDelta(prevNode, currentNode);
            if (delta) {
                nodeDeltas.push(delta);
            }
        }
    });

    // Find removed nodes
    Array.from(prevNodeMap.keys()).forEach(id => {
        if (!currentNodeMap.has(id)) {
            removeNodeIds.push(id);
        }
    });

    // Find added and changed edges
    Array.from(currentEdgeMap.entries()).forEach(([id, currentEdge]) => {
        const prevEdge = prevEdgeMap.get(id);
        if (!prevEdge) {
            // New edge
            addEdges.push(currentEdge);
        } else {
            // Check for changes
            const delta = computeEdgeDelta(prevEdge, currentEdge);
            if (delta) {
                edgeDeltas.push(delta);
            }
        }
    });

    // Find removed edges
    Array.from(prevEdgeMap.keys()).forEach(id => {
        if (!currentEdgeMap.has(id)) {
            removeEdgeIds.push(id);
        }
    });

    const result: ReturnType<typeof computeStepDelta> = {
        nodes: nodeDeltas,
        edges: edgeDeltas,
    };

    if (addNodes.length > 0) result.addNodes = addNodes;
    if (removeNodeIds.length > 0) result.removeNodeIds = removeNodeIds;
    if (addEdges.length > 0) result.addEdges = addEdges;
    if (removeEdgeIds.length > 0) result.removeEdgeIds = removeEdgeIds;

    return result;
}

/**
 * Cache for resolved step snapshots to avoid recomputation.
 * Key: "steps_hash:stepIndex"
 */
const resolvedCache = new Map<string, { nodes: NodeModel[]; edges: EdgeModel[] }>();

/**
 * Resolves a step snapshot with caching for performance.
 */
export function resolveStepSnapshotCached(
    steps: readonly Step[],
    targetStepIndex: number,
    stepsVersion?: number
): { nodes: NodeModel[]; edges: EdgeModel[] } {
    // Simple cache key based on steps length and version
    const cacheKey = `${steps.length}:${stepsVersion ?? 0}:${targetStepIndex}`;

    const cached = resolvedCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const result = resolveStepSnapshot(steps, targetStepIndex);

    // Limit cache size
    if (resolvedCache.size > 100) {
        const firstKey = resolvedCache.keys().next().value;
        if (firstKey) resolvedCache.delete(firstKey);
    }

    resolvedCache.set(cacheKey, result);
    return result;
}

/**
 * Clears the resolution cache (call when steps are modified)
 */
export function clearResolutionCache(): void {
    resolvedCache.clear();
}

/**
 * Normalizes delta-format steps to full snapshots for internal engine use.
 * Call this when loading a diagram to ensure all steps have complete node/edge data.
 * 
 * This enables the "normalize on load, delta on export" architecture:
 * - Load: Delta → Full snapshots (this function)
 * - Edit: Work with full snapshots (simple, no resolution needed)
 * - Export: Full → Delta (convertStepsToDeltaFormat)
 * 
 * IMPORTANT: Only applies delta resolution if the input is in delta format.
 * If steps are already full snapshots, they are returned unchanged.
 */
/**
 * Ensures all actions in a step have unique IDs.
 * AI-generated diagrams often omit action IDs, which causes issues during editing.
 */
function ensureActionIds(step: Step, stepIndex: number): Step {
    if (!step.actions || step.actions.length === 0) {
        return step;
    }

    let hasUnidentifiedActions = false;
    for (const action of step.actions) {
        if (!action.id) {
            hasUnidentifiedActions = true;
            break;
        }
    }

    if (!hasUnidentifiedActions) {
        return step;
    }

    // Clone actions and assign IDs to those that don't have them
    const actionsWithIds = step.actions.map((action, actionIndex) => {
        if (action.id) {
            return action;
        }
        // Generate a unique ID based on type, target, step index, and action index
        const targetId = action.target?.id || 'unknown';
        const generatedId = `${action.type}_${targetId}_s${stepIndex}_a${actionIndex}_${Date.now().toString(36)}`;
        return { ...action, id: generatedId };
    });

    return { ...step, actions: actionsWithIds };
}

export function normalizeStepsToFullSnapshots(steps: readonly Step[]): Step[] {
    if (steps.length === 0) return [];

    // Check if this is delta format or already full snapshots
    const isDeltaFormat = hasDeltaFormatSteps(steps);

    let normalizedSteps: Step[];

    if (!isDeltaFormat) {
        // Already full snapshots - return deep clone to avoid mutations
        // Also ensure all actions have IDs
        normalizedSteps = steps.map((step, stepIndex) => {
            const clonedStep = {
                ...step,
                nodes: (step.nodes || []).map(n => ({ ...n })),
                edges: (step.edges || []).map(e => ({ ...e })),
            };
            return ensureActionIds(clonedStep as Step, stepIndex);
        }) as Step[];
    } else {
        // Frontend delta format - resolve each step
        normalizedSteps = [];

        for (let i = 0; i < steps.length; i++) {
            const originalStep = steps[i];
            const resolved = resolveStepSnapshot(steps, i);

            // Preserve added/removed IDs before deleting delta fields
            const addedNodeIds = ((originalStep as any).addNodes || []).map((n: any) => n.id);
            const removedNodeIds = ((originalStep as any).removeNodeIds || []) as string[];
            const addedEdgeIds = ((originalStep as any).addEdges || []).map((e: any) => e.id);
            const removedEdgeIds = ((originalStep as any).removeEdgeIds || []) as string[];

            // For removed nodes/edges: keep them in this step's snapshot so evaluateAt
            // can animate their exit. Pull their last state from the previous step.
            if (removedNodeIds.length > 0 && i > 0) {
                const prevResolved = resolveStepSnapshot(steps, i - 1);
                for (const nodeId of removedNodeIds) {
                    const prevNode = prevResolved.nodes.find(n => n.id === nodeId);
                    if (prevNode && !resolved.nodes.find(n => n.id === nodeId)) {
                        resolved.nodes.push({ ...prevNode });
                    }
                }
            }
            if (removedEdgeIds.length > 0 && i > 0) {
                const prevResolved = resolveStepSnapshot(steps, i - 1);
                for (const edgeId of removedEdgeIds) {
                    const prevEdge = prevResolved.edges.find(e => e.id === edgeId);
                    if (prevEdge && !resolved.edges.find(e => e.id === edgeId)) {
                        resolved.edges.push({ ...prevEdge });
                    }
                }
            }

            // Create a new step with full node/edge data, preserving other properties
            let normalizedStep: Step = {
                ...originalStep,
                nodes: resolved.nodes,
                edges: resolved.edges,
            };

            // Remove delta-only fields (they're now resolved into nodes/edges)
            delete (normalizedStep as any).addNodes;
            delete (normalizedStep as any).removeNodeIds;
            delete (normalizedStep as any).addEdges;
            delete (normalizedStep as any).removeEdgeIds;
            // ...including the explicit marker. Leaving it on a step whose nodes are now FULL
            // makes hasDeltaFormatSteps answer "already delta" on the save path, which skips
            // deltaEncodeStepsLossless and writes the expanded snapshots straight back. A
            // backend-compacted 10MB video reopened in the editor saved at 14MB that way, and
            // the next build hit the 12MB runaway cap and gutted scenes to grey title cards.
            delete (normalizedStep as any).delta;

            // Store metadata for implicit animation
            if (addedNodeIds.length > 0) normalizedStep._addedNodeIds = addedNodeIds;
            if (removedNodeIds.length > 0) normalizedStep._removedNodeIds = removedNodeIds;
            if (addedEdgeIds.length > 0) normalizedStep._addedEdgeIds = addedEdgeIds;
            if (removedEdgeIds.length > 0) normalizedStep._removedEdgeIds = removedEdgeIds;

            // Ensure all actions have IDs
            normalizedStep = ensureActionIds(normalizedStep, i);

            normalizedSteps.push(normalizedStep);
        }
    }

    // Post-pass: detect added/removed nodes by comparing consecutive snapshots.
    // This catches full-snapshot format where addNodes/removeNodeIds aren't used.
    // Also re-inserts removed nodes/edges into the snapshot for exit animation.
    // Track cumulative removals to prevent ghosts from cascading into later steps.
    const removedNodesSoFar = new Set<string>();
    const removedEdgesSoFar = new Set<string>();
    for (let i = 1; i < normalizedSteps.length; i++) {
        const prevNodes = normalizedSteps[i - 1].nodes || [];
        const curNodes = normalizedSteps[i].nodes || [];
        const prevEdges = normalizedSteps[i - 1].edges || [];
        const curEdges = normalizedSteps[i].edges || [];
        // Exclude already-removed ghosts from prev when diffing
        const prevAuthoredNodeIds = new Set(prevNodes.map(n => n.id).filter(id => !removedNodesSoFar.has(id)));
        const curNodeIdSet = new Set(curNodes.map(n => n.id));
        const prevAuthoredEdgeIds = new Set(prevEdges.map(e => e.id).filter(id => !removedEdgesSoFar.has(id)));
        const curEdgeIdSet = new Set(curEdges.map(e => e.id));

        // Nodes in cur but not prev = added (re-added nodes come back from removal)
        if (!normalizedSteps[i]._addedNodeIds) {
            const added = curNodes.map(n => n.id).filter(id => !prevAuthoredNodeIds.has(id));
            if (added.length > 0) normalizedSteps[i]._addedNodeIds = added;
            // If a previously-removed node reappears, stop tracking it as removed
            for (const id of added) removedNodesSoFar.delete(id);
        }
        // Nodes in prev but not cur = removed (only from authored prev, not ghosts)
        if (!normalizedSteps[i]._removedNodeIds) {
            const removed = Array.from(prevAuthoredNodeIds).filter(id => !curNodeIdSet.has(id));
            if (removed.length > 0) {
                normalizedSteps[i]._removedNodeIds = removed;
                for (const id of removed) removedNodesSoFar.add(id);
                // Re-insert removed nodes so evaluateAt can animate exit
                const mutableNodes = [...curNodes];
                for (const nodeId of removed) {
                    const prevNode = prevNodes.find(n => n.id === nodeId);
                    if (prevNode) mutableNodes.push({ ...prevNode });
                }
                normalizedSteps[i] = { ...normalizedSteps[i], nodes: mutableNodes };
            }
        } else {
            // Delta-format already set _removedNodeIds; track them
            for (const id of normalizedSteps[i]._removedNodeIds!) removedNodesSoFar.add(id);
        }
        // Same for edges
        if (!normalizedSteps[i]._addedEdgeIds) {
            const added = curEdges.map(e => e.id).filter(id => !prevAuthoredEdgeIds.has(id));
            if (added.length > 0) normalizedSteps[i]._addedEdgeIds = added;
            for (const id of added) removedEdgesSoFar.delete(id);
        }
        if (!normalizedSteps[i]._removedEdgeIds) {
            const removed = Array.from(prevAuthoredEdgeIds).filter(id => !curEdgeIdSet.has(id));
            if (removed.length > 0) {
                normalizedSteps[i]._removedEdgeIds = removed;
                for (const id of removed) removedEdgesSoFar.add(id);
                // Re-insert removed edges so evaluateAt can animate exit
                const mutableEdges = [...(normalizedSteps[i].edges || [])];
                for (const edgeId of removed) {
                    const prevEdge = prevEdges.find(e => e.id === edgeId);
                    if (prevEdge) mutableEdges.push({ ...prevEdge });
                }
                normalizedSteps[i] = { ...normalizedSteps[i], edges: mutableEdges };
            }
        } else {
            for (const id of normalizedSteps[i]._removedEdgeIds!) removedEdgesSoFar.add(id);
        }
    }

    return normalizedSteps;
}


/**
 * Checks if steps array contains any delta-format steps.
 * Used to determine if normalization is needed.
 */
export function hasDeltaFormatSteps(steps: readonly Step[]): boolean {
    return steps.some((step, index) => {
        if (index === 0) return false; // Step 0 is always full
        // Explicit marker, set by whoever encoded the step (the backend stamps it when it
        // delta-compacts an oversized doc). Everything below it is inference from shape, which
        // is right often enough but cannot be right always: a delta that happens to touch every
        // node AND carries kind/x/y looks exactly like a full snapshot.
        if ((step as any).delta === true) return true;
        // Check for delta indicators
        if ((step as any).addNodes?.length > 0) return true;
        if ((step as any).removeNodeIds?.length > 0) return true;
        if ((step as any).addEdges?.length > 0) return true;
        if ((step as any).removeEdgeIds?.length > 0) return true;
        // Check if nodes array is sparse (fewer nodes than step 0)
        if (steps[0].nodes && step.nodes && step.nodes.length < steps[0].nodes.length * 0.5) {
            return true;
        }
        // Sparse-property delta: the step lists every node id (count === base)
        // but only the changed props per node. A full snapshot always carries
        // kind + position, so a node missing those is a delta that must be
        // resolved — otherwise it renders with no y/geometry (the title_card
        // "teleport on MP4 export" bug, where step 1 touches all N nodes).
        if (step.nodes && step.nodes.some(
            (n) => n.kind === undefined || (n as any).x === undefined || (n as any).y === undefined,
        )) {
            return true;
        }
        // Check if edges array is sparse (fewer edges than step 0)
        if (steps[0].edges && step.edges && step.edges.length < steps[0].edges.length * 0.5) {
            return true;
        }
        return false;
    });
}

/**
 * Converts full-snapshot steps to delta format for smaller JSON export.
 * Step 0 remains full, Step 1+ become deltas with only changed properties.
 * 
 * IMPORTANT: Assumes input steps are full snapshots (not delta format).
 * Use the step's nodes/edges directly, not resolveStepSnapshot.
 */
export function convertStepsToDeltaFormat(steps: readonly Step[]): Step[] {
    if (steps.length === 0) return [];

    const step0 = { ...steps[0] };
    delete (step0 as any)._addedNodeIds;
    delete (step0 as any)._removedNodeIds;
    delete (step0 as any)._addedEdgeIds;
    delete (step0 as any)._removedEdgeIds;
    const deltaSteps: Step[] = [step0]; // Step 0 = full snapshot

    for (let i = 1; i < steps.length; i++) {
        const currentStep = steps[i];

        // Removed nodes/edges were re-inserted into the full snapshot for exit
        // animation. Strip them before computing the delta so they correctly
        // appear in removeNodeIds/removeEdgeIds instead of leaking through.
        const removedNodeIdSet = new Set(currentStep._removedNodeIds || []);
        const removedEdgeIdSet = new Set(currentStep._removedEdgeIds || []);

        // Strip ghosts from both sides so deltas compare authored state only
        const prevRemovedNodeIdSet = new Set(steps[i - 1]._removedNodeIds || []);
        const prevRemovedEdgeIdSet = new Set(steps[i - 1]._removedEdgeIds || []);
        const prevNodes = ((steps[i - 1].nodes || []) as NodeModel[])
            .filter(n => !prevRemovedNodeIdSet.has(n.id));
        const prevEdges = ((steps[i - 1].edges || []) as EdgeModel[])
            .filter(e => !prevRemovedEdgeIdSet.has(e.id));
        const currentNodes = ((currentStep.nodes || []) as NodeModel[])
            .filter(n => !removedNodeIdSet.has(n.id));
        const currentEdges = ((currentStep.edges || []) as EdgeModel[])
            .filter(e => !removedEdgeIdSet.has(e.id));

        const deltaData = computeStepDelta(
            currentNodes,
            currentEdges,
            prevNodes,
            prevEdges
        );

        const deltaStep: Step = {
            ...currentStep,
            nodes: deltaData.nodes,
            edges: deltaData.edges,
        };

        // Strip internal metadata from export
        delete (deltaStep as any)._addedNodeIds;
        delete (deltaStep as any)._removedNodeIds;
        delete (deltaStep as any)._addedEdgeIds;
        delete (deltaStep as any)._removedEdgeIds;

        if (deltaData.addNodes?.length) deltaStep.addNodes = deltaData.addNodes;
        if (deltaData.removeNodeIds?.length) deltaStep.removeNodeIds = deltaData.removeNodeIds;
        if (deltaData.addEdges?.length) deltaStep.addEdges = deltaData.addEdges;
        if (deltaData.removeEdgeIds?.length) deltaStep.removeEdgeIds = deltaData.removeEdgeIds;

        deltaSteps.push(deltaStep);
    }

    return deltaSteps;
}

/**
 * Lossless all-key delta encoder for PERSISTENCE.
 *
 * Same shape as convertStepsToDeltaFormat (step 0 = full snapshot; steps 1+ carry only
 * what changed vs the previous step, plus add/removeNodeIds), but it diffs EVERY property
 * instead of computeNodeDelta's fixed whitelist. That whitelist omits the affine matrix
 * (m11..m22, mPivotX/Y) and other tween targets, so the canonical encoder silently
 * flattens matrix-driven morphs (circle→ellipse, shear, 3D, linear_transform) on save.
 * This variant preserves them — it round-trips byte-for-byte through resolveStepSnapshot /
 * normalizeStepsToFullSnapshots. Use on the save path to keep large multi-scene videos
 * under Mongo's 16MB document limit without degrading any animation.
 */
function allKeyDelta<T extends { id: string }>(prev: T, cur: T): (Partial<T> & { id: string }) | null {
    const d: any = { id: cur.id };
    let changed = false;
    const keys = Array.from(new Set([...Object.keys(prev as object), ...Object.keys(cur as object)]));
    for (const k of keys) {
        if (k === 'id') continue;
        if (!deepEqual((prev as any)[k], (cur as any)[k])) {
            d[k] = (cur as any)[k];
            changed = true;
        }
    }
    return changed ? d : null;
}

export function deltaEncodeStepsLossless(steps: readonly Step[]): Step[] {
    if (steps.length === 0) return [];
    const out: Step[] = [{
        ...steps[0],
        nodes: (steps[0].nodes || []).map(n => ({ ...n })),
        edges: (steps[0].edges || []).map(e => ({ ...e })),
    }];
    for (let i = 1; i < steps.length; i++) {
        const cur = steps[i];
        const prevNodes = new Map((steps[i - 1].nodes || []).map(n => [n.id, n] as const));
        const prevEdges = new Map((steps[i - 1].edges || []).map(e => [e.id, e] as const));
        const curNodes = cur.nodes || [];
        const curEdges = cur.edges || [];
        const curNodeIds = new Set(curNodes.map(n => n.id));
        const curEdgeIds = new Set(curEdges.map(e => e.id));

        const nodeDeltas: any[] = []; const addNodes: any[] = [];
        for (const n of curNodes) {
            const p = prevNodes.get(n.id);
            if (!p) { addNodes.push({ ...n }); continue; }
            const d = allKeyDelta(p as any, n as any);
            if (d) nodeDeltas.push(d);
        }
        const removeNodeIds = Array.from(prevNodes.keys()).filter(id => !curNodeIds.has(id));

        const edgeDeltas: any[] = []; const addEdges: any[] = [];
        for (const e of curEdges) {
            const p = prevEdges.get(e.id);
            if (!p) { addEdges.push({ ...e }); continue; }
            const d = allKeyDelta(p as any, e as any);
            if (d) edgeDeltas.push(d);
        }
        const removeEdgeIds = Array.from(prevEdges.keys()).filter(id => !curEdgeIds.has(id));

        const ds: any = { ...cur, nodes: nodeDeltas, edges: edgeDeltas };
        if (addNodes.length) ds.addNodes = addNodes;
        if (removeNodeIds.length) ds.removeNodeIds = removeNodeIds;
        if (addEdges.length) ds.addEdges = addEdges;
        if (removeEdgeIds.length) ds.removeEdgeIds = removeEdgeIds;
        out.push(ds);
    }
    return out;
}
