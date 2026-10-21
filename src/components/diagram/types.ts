/* eslint-disable -- Migrated file */
export type Vec2 = { x: number; y: number };
export type NodeKind =
  | 'rect'
  | 'cylinder'
  | 'circle'
  | 'icon'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'arrow'
  | 'svg'
  | 'lottie' // Animated Lottie/Bodymovin JSON
  | 'text'
  | 'glyph' // Procedural animated glyph (check/x/dot/arrow) — see glyph-render.ts
  | 'group' // Container for grouping nodes
  | 'wedge' // Pie/donut slice, gauge arc
  | 'chevron' // Process pipeline step
  | 'funnel' // Sales/marketing funnel segment
  | 'progress' // Progress/percentage bar
  | 'callout' // Speech bubble / tooltip annotation
  | 'diamond' // Decision/branch diamond shape
  | 'uml-actor' // UML stick figure actor
  | 'uml-lifeline' // Sequence diagram lifeline (header + dashed line)
  | 'uml-class' // Class diagram box (name/attributes/methods)
  | 'uml-note' // UML note (folded corner rectangle for annotations)
  | 'algo-array' // Algorithm visualization: row/column of equal-sized cells with values
  | 'algo-pointer' // Algorithm visualization: labeled marker that points at a target node or array cell
  | 'algo-grid' // Algorithm visualization: 2D grid/table of cells (DP tables, matrices, boards)
  | 'algo-variable' // Algorithm visualization: small labeled box showing a variable's current value
  | 'algo-tree' // Algorithm visualization: tree (binary or n-ary) with auto-layout, for BFS/DFS/BST/heap/trie
  | 'algo-linked-list' // Algorithm visualization: singly linked list with auto-layout, for reversal/cycle/merge
  | 'algo-graph' // Algorithm visualization: general graph with manual node placement, for Dijkstra/BFS/MST/etc.
  | 'algo-chart' // Algorithm visualization: bar chart for value distributions (SVD decay, sort viz, histograms)
  | 'algo-chart-line' // Algorithm visualization: line/curve plot (loss curves, learning rate, accuracy)
  | 'algo-chart-scatter'; // Algorithm visualization: scatter plot (embeddings, clusters, decision boundaries)

export type Port = 'N' | 'E' | 'S' | 'W';

export type Artboard = {
  x: number; // top-left in world coords (center at 0,0 means -width/2)
  y: number; // top-left in world coords (center at 0,0 means -height/2)
  width: number; // pixels
  height: number; // pixels
  background: string; // fill color for export and preview
  bg?: import('./utils/stage-background').BackgroundSpec; // per-user atmosphere (gradient + particles)
  atmosphere?: boolean; // false = the THEME owns the ground; do not stamp a generated bg over it
  showBounds: boolean; // show dashed boundary overlay
  shadeOutside: boolean; // dim outside-of-artboard area during preview
  cropPreview: boolean; // clip preview to artboard bounds
  handStyle?: import('./utils/write-hand-styles').WriteHandStyle; // whiteboard write-on hand style
  carryHand?: string; // which hand carries finished pictures in; see hand-registry
};

export type PathId = string;
export type Path = {
  id: PathId;
  name?: string;
  points: Vec2[];
  closed?: boolean;
  // Cached for performance
  length?: number;
  cum?: number[]; // cumulative lengths
};

export type Easing =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'spring'
  | 'bounce'      // Bouncy landing effect
  | 'elastic'     // Elastic overshoot
  | 'back'        // Overshoot then settle
  | 'back-in'     // Pull back before moving
  | 'step';       // Cut — hold, then snap to the target (no interpolation)

export type TransitionType =
  | 'morph' // Standard linear interpolation
  | 'instant' // Jump at t=0
  | 'fade' // Fade out A, Fade in B (static position)
  | 'flip-x' // Rotate 180 deg around X (top-to-bottom)
  | 'flip-y'; // Rotate 180 deg around Y (left-to-right)

export type AttachMode = 'alignToNode' | 'snapToPath' | 'resetStart';

export type ActionKind = 'entrance' | 'exit' | 'emphasis';

export type PathFollowAction = {
  id: string; // Stable unique identifier for this action
  type: 'pathFollow';
  target: { kind: 'node' | 'edge'; id: string };
  pathId: PathId;
  from: number; // 0..1 start progress
  to: number; // 0..1 end progress
  ease?: Easing;
  rotateToTangent?: boolean;
  offsetMs?: number; // start delay inside this step
  durationMs?: number; // animation duration (defaults to step duration minus offsetMs)
  attachMode?: AttachMode; // How path is attached to element (default: alignToNode)
  instanceTransform?: { dx: number; dy: number }; // Per-action offset, doesn't mutate path asset
  actionKind?: ActionKind; // Classification for UI/logic
  disabled?: boolean; // If true, action is skipped during playback (still visible in timeline)
};

export type PositionTweenAction = {
  id: string; // Stable unique identifier for this action
  type: 'positionTween';
  target: { kind: 'node'; id: string };
  from: { x: number; y: number }; // Start position (world coordinates) - used when isRelative is false
  to: { x: number; y: number }; // End position (world coordinates) - used when isRelative is false
  durationMs: number; // How long the tween takes (e.g., 150ms)
  ease?: Easing;
  easeIntensity?: number; // 0.1-3.0, multiplier for easing curve strength (default: 1.0)
  actionKind?: ActionKind; // Classification for UI/logic
  // Relative motion support (recommended - survives node moves in earlier steps)
  isRelative?: boolean; // If true, use dx/dy instead of absolute from/to
  dx?: number; // Horizontal offset (positive = right)
  dy?: number; // Vertical offset (positive = down)
  disabled?: boolean; // If true, action is skipped during playback (still visible in timeline)
};

export type TransformTweenAction = {
  id: string; // Stable unique identifier for this action
  type: 'transformTween';
  target: { kind: 'node'; id: string };
  from?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    scaleX?: number;
    scaleY?: number;
    m11?: number; // affine matrix [[m11,m12],[m21,m22]] about pivot (plane deform)
    m12?: number;
    m21?: number;
    m22?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    opacity?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeTrimStart?: number; // 0-1, for node stroke "draw" effect
    strokeTrimEnd?: number; // 0-1, for node stroke "draw" effect
    typeProgress?: number; // 0-1, typewriter text reveal for text nodes
    blur?: number; // px gaussian blur (tweenable) — depth-of-field / soft focus
    drawProgress?: number; // 0-1, progressive svgPaths stroke reveal ("draw-on")
    rot3dX?: number; // mesh3d intrinsic rotation (degrees) — tween for 3D spin
    rot3dY?: number;
    rot3dZ?: number;
    markerX?: number; markerY?: number; markerZ?: number; // mesh3d marker ball position
    arrowTailX?: number; arrowTailY?: number; arrowTipX?: number; arrowTipY?: number; // movable 2D vector
    pathT?: number; // pathMarker parameter along its polyline
    meshScaleX?: number; // mesh3d per-axis 3D scale — tween for a scaling matrix
    meshScaleY?: number;
    meshScaleZ?: number;
    tm11?: number; tm12?: number; tm13?: number; // mesh3d full 3x3 linear map (identity default)
    tm21?: number; tm22?: number; tm23?: number;
    tm31?: number; tm32?: number; tm33?: number;
    // (mesh3d transforms above)
    // Tier 1 shape properties
    value?: number; // progress bar value 0-1
    progressColor?: string; // progress bar fill color
    startAngle?: number; // wedge start angle
    endAngle?: number; // wedge end angle
    innerRadius?: number; // wedge/star inner radius
    pointDepth?: number; // chevron depth
    topWidth?: number; // funnel top width
    bottomWidth?: number; // funnel bottom width
    pointerPosition?: number; // callout pointer position
    pointerSize?: number; // callout pointer size
    // Rough.js properties
    roughness?: number; // hand-drawn roughness 0-3
    roughFillWeight?: number; // hand-drawn fill weight
    // Algorithm primitives — pointer movement
    pointerTargetIndex?: number; // algo-pointer with array target
    pointerTargetRow?: number;   // algo-pointer with grid target
    pointerTargetCol?: number;   // algo-pointer with grid target
    // Algorithm primitives — collection-shaped properties.
    // The renderer cross-fades these arrays automatically using the step
    // duration by default. Including the property in a transformTween.to lets
    // you OVERRIDE the timing (durationMs/offsetMs/ease) for the cross-fade.
    // The actual values come from the snapshot, NOT from this field — the
    // values here are just markers that an action exists for this property.
    cellColors?: (string | null)[];
    gridColors?: (string | null)[][];
    highlightedLines?: number[];
    // cellValues is a swap-animation marker. When two cellValues trade places
    // between snapshots, the renderer arcs the values past each other. The
    // action's value is unused — only its timing applies.
    cellValues?: string[];
    gridValues?: string[][];
  };
  to: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    scaleX?: number;
    scaleY?: number;
    m11?: number; // affine matrix [[m11,m12],[m21,m22]] about pivot (plane deform)
    m12?: number;
    m21?: number;
    m22?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    opacity?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeTrimStart?: number; // 0-1, for node stroke "draw" effect
    strokeTrimEnd?: number; // 0-1, for node stroke "draw" effect
    typeProgress?: number; // 0-1, typewriter text reveal for text nodes
    blur?: number; // px gaussian blur (tweenable) — depth-of-field / soft focus
    drawProgress?: number; // 0-1, progressive svgPaths stroke reveal ("draw-on")
    rot3dX?: number; // mesh3d intrinsic rotation (degrees) — tween for 3D spin
    rot3dY?: number;
    rot3dZ?: number;
    markerX?: number; markerY?: number; markerZ?: number; // mesh3d marker ball position
    arrowTailX?: number; arrowTailY?: number; arrowTipX?: number; arrowTipY?: number; // movable 2D vector
    pathT?: number; // pathMarker parameter along its polyline
    meshScaleX?: number; // mesh3d per-axis 3D scale — tween for a scaling matrix
    meshScaleY?: number;
    meshScaleZ?: number;
    tm11?: number; tm12?: number; tm13?: number; // mesh3d full 3x3 linear map (identity default)
    tm21?: number; tm22?: number; tm23?: number;
    tm31?: number; tm32?: number; tm33?: number;
    // (mesh3d transforms above)
    // Tier 1 shape properties
    value?: number; // progress bar value 0-1
    progressColor?: string; // progress bar fill color
    startAngle?: number; // wedge start angle
    endAngle?: number; // wedge end angle
    innerRadius?: number; // wedge/star inner radius
    pointDepth?: number; // chevron depth
    topWidth?: number; // funnel top width
    bottomWidth?: number; // funnel bottom width
    pointerPosition?: number; // callout pointer position
    pointerSize?: number; // callout pointer size
    // Rough.js properties
    roughness?: number; // hand-drawn roughness 0-3
    roughFillWeight?: number; // hand-drawn fill weight
    // Algorithm primitives — pointer movement
    pointerTargetIndex?: number; // algo-pointer with array target
    pointerTargetRow?: number;   // algo-pointer with grid target
    pointerTargetCol?: number;   // algo-pointer with grid target
    // Algorithm primitives — collection-shaped properties (timing override only).
    // See the matching `from` comment above.
    cellColors?: (string | null)[];
    gridColors?: (string | null)[][];
    highlightedLines?: number[];
    // cellValues / gridValues — swap-animation timing markers (values unused)
    cellValues?: string[];
    gridValues?: string[][];
  };
  durationMs?: number; // Default: use step duration
  offsetMs?: number; // Delay inside step (default: 0)
  ease?: Easing; // Default: inherit from step
  easeIntensity?: number; // 0.1-3.0, multiplier for easing curve strength (default: 1.0)
  iterations?: number; // Number of times to repeat the animation (default: 1, range: 1-10)
  actionKind?: ActionKind; // Classification for UI/logic ('entrance' for Slide In presets)
  _category?: string; // Property category for independent timing (e.g., 'position', 'scale', 'rotationZ', 'opacity')
  // Relative motion support (for position category only - survives node moves in earlier steps)
  isRelative?: boolean; // If true, use dx/dy for position instead of absolute from.x/from.y/to.x/to.y
  dx?: number; // Horizontal offset (positive = right) - only used when isRelative && _category === 'position'
  dy?: number; // Vertical offset (positive = down) - only used when isRelative && _category === 'position'
  disabled?: boolean; // If true, action is skipped during playback (still visible in timeline)
};

export type VisibilityMode =
  | 'show' | 'hide' | 'fadeIn' | 'fadeOut'
  | 'slideInLeft' | 'slideInRight' | 'slideInUp' | 'slideInDown'
  | 'slideOutLeft' | 'slideOutRight' | 'slideOutUp' | 'slideOutDown';

export type VisibilityAction = {
  id: string; // Stable unique identifier for this action
  type: 'visibility';
  target: { kind: 'node'; id: string };
  mode: VisibilityMode;
  durationMs?: number; // For fadeIn/fadeOut/slide (default: 200ms)
  offsetMs?: number; // Delay inside step (default: 0)
  iterations?: number; // Number of times to pulse (for fadeIn/fadeOut, default: 1)
  slideDistance?: number; // Pixels to slide (default: 150)
  ease?: string; // Easing function (default: 'ease-out' for slideIn, 'ease-in' for slideOut)
  actionKind?: ActionKind; // Classification for UI/logic
  disabled?: boolean; // If true, action is skipped during playback (still visible in timeline)
};

// EdgeTweenAction - For animating edge properties (trim, stroke, width)
export type EdgeTweenAction = {
  id: string; // Stable unique identifier for this action
  type: 'edgeTween';
  target: { kind: 'edge'; id: string };
  from?: {
    trim?: number; // 0-1, where stroke ends (for "draw" effect)
    trimStart?: number; // 0-1, where stroke begins
    stroke?: string;
    width?: number;
    opacity?: number;
    // Rough.js properties
    roughness?: number; // hand-drawn roughness 0-3
    bowing?: number; // how much lines bow outward 0-10
  };
  to: {
    trim?: number; // 0-1, where stroke ends (for "draw" effect)
    trimStart?: number; // 0-1, where stroke begins
    stroke?: string;
    width?: number;
    opacity?: number;
    // Rough.js properties
    roughness?: number; // hand-drawn roughness 0-3
    bowing?: number; // how much lines bow outward 0-10
  };
  durationMs?: number;
  offsetMs?: number;
  ease?: Easing;
  _category?: string; // Property category for independent timing
  disabled?: boolean; // If true, action is skipped during playback (still visible in timeline)
};

// Phantom node rendered during edge flow animation (not stored, computed at runtime)
export type PhantomNode = {
  id: string; // Unique ID for this phantom instance
  templateId: string; // ID of the source node being cloned
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  scale: number;
  rotation?: number; // Rotation to match edge tangent
  zIndex?: number; // Inherited from parent edge for proper layering
  // Copy visual properties from template
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  kind: NodeModel['kind'];
  label?: string; // Node label
  // For complex nodes
  text?: string;
  imageData?: string;
  svgPaths?: NodeModel['svgPaths'];
  svgViewBox?: NodeModel['svgViewBox'];
  lottieData?: any;
};

/**
 * PathAnimateAction - Timeline-controlled node animation along an edge
 * 
 * Unlike nodeFlow (continuous, step-independent), this is:
 * - Finite duration (has start and end)
 * - Single clone traveling the path
 * - Fully controlled by timeline (draggable bars)
 * - Uses global time for smooth step transitions
 */
export type PathAnimateAction = {
  id: string;
  type: 'pathAnimate';
  target: { kind: 'edge'; id: string }; // The edge to animate along
  
  // Which node to clone and animate
  nodeTemplateId: string;
  // Snapshot of the node at creation time (so it doesn't change)
  nodeSnapshot?: {
    id: string;
    kind: NodeKind;
    w: number;
    h: number;
    label?: string;
    text?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    imageData?: string;
    svgPaths?: NodeModel['svgPaths'];
    svgViewBox?: NodeModel['svgViewBox'];
    lottieData?: any;
  };
  
  // Timing (integrates with timeline)
  offsetMs: number;    // When to start (relative to step start)
  durationMs: number;  // How long the animation takes
  ease?: Easing;       // Speed curve (default: ease)
  
  // Direction
  reverse?: boolean;   // If true, animate from end to start (default: false)
  
  // Appearance
  scale?: number;      // Clone scale (default: 0.5)
  opacity?: number;    // Clone opacity (default: 0.8)
  fadeIn?: boolean;    // Fade in at start (default: true)
  fadeOut?: boolean;   // Fade out at end (default: true)
  rotateWithPath?: boolean; // Rotate to follow edge tangent (default: true)
  disabled?: boolean;  // If true, action is skipped during playback (still visible in timeline)
};

// TTS Provider types. 'recording' tags clips captured from the user's
// microphone (not synthesized) — see the note in utils/tts/types.ts.
export type TTSProvider = 'browser' | 'openai' | 'elevenlabs' | 'google' | 'recording';

/**
 * One spoken word and the window it is said in, in ms from its clip's own start.
 * Comes back from the voice service alongside the audio, so a caption can light up
 * the word actually being spoken rather than guessing from character counts.
 */
export type WordTiming = { t: string; s: number; e: number };

// VoiceOverAction - For AI-generated voice narration synced with steps
export type VoiceOverAction = {
  id: string;
  type: 'voiceOver';
  target: { kind: 'node'; id: string }; // Text node to read
  text?: string;                         // Override text (or use node's text)
  voice: {
    provider: TTSProvider;
    voiceId: string;
    voiceName: string;
  };
  speed?: number;                        // 0.25 - 4.0 (default 1.0)
  offsetMs?: number;                     // Delay within step
  // Generated/cached:
  audioData?: string;                    // Base64 audio data URL
  audioUrl?: string;                     // offloaded audio in object storage (resolved -> audioData on load)
  audioDurationMs?: number;              // Auto-detected duration
  disabled?: boolean;                    // If true, action is skipped during playback (still visible in timeline)
  /**
   * What the build's voice pass did with this line: "voiced" when a recording was made with
   * the voice above, "failed" when the voice service refused it and the clip has no audio.
   * Absent on clips recorded from the editor. The build no longer swaps in another provider's
   * voice silently, so a failed clip is the only way a line ends up silent.
   */
  voiceStatus?: 'voiced' | 'failed';
};

// AlgoSwapAction — explicit swap of two algo-array cells over time.
//
// The default swap-animation behavior in applyCollectionCrossFade is a
// HEURISTIC that detects "two cells trade values between snapshots" and
// arcs them past each other. The heuristic is correct for sorting algorithms
// but can produce false positives if two cells coincidentally trade values
// without an algorithmic swap.
//
// AlgoSwapAction is the EXPLICIT alternative: the AI / user marks the swap
// directly, which:
//   - Guarantees intent (no false positives)
//   - Allows custom durationMs / offsetMs / ease per swap
//   - Coexists with the heuristic — if both an explicit action and a
//     heuristic detection cover the same indices, the explicit one wins.
//   - Works ALONGSIDE the heuristic — explicit + heuristic swaps merge.
export type AlgoSwapAction = {
  id: string;
  type: 'algoSwap';
  target: { kind: 'node'; id: string }; // the algo-array node
  indices: [number, number]; // the two cell indices being swapped
  durationMs?: number; // how long the arc lasts (default: step duration)
  offsetMs?: number; // delay inside the step (default: 0)
  ease?: Easing;
  disabled?: boolean;
};

export type ContainerTransformAction = {
  id: string;
  type: 'containerTransform';
  target: { kind: 'node'; id: string };
  variant?: 'expand' | 'fadeThrough' | 'hero' | 'shapeMorph';
  childIds: string[];
  outgoingChildIds?: string[];
  heroTargetId?: string;
  targetCornerRadius?: number;
  durationMs?: number;
  offsetMs?: number;
  ease?: string;
  childReveal?: 'fade' | 'slideUp' | 'slideDown' | 'slideIn';
  childStaggerMs?: number;
  disabled?: boolean;
  actionKind?: ActionKind;
};

export type StepAction = PathFollowAction | PositionTweenAction | TransformTweenAction | VisibilityAction | PathAnimateAction | EdgeTweenAction | VoiceOverAction | AlgoSwapAction | ContainerTransformAction;

/**
 * Single node within an algo-tree primitive. Nodes are referenced by ID,
 * with parent→child relationships expressed via the ordered `children`
 * array. Layout positions are auto-computed by the renderer; you don't
 * set per-node coordinates.
 *
 * **Binary trees** are represented by ordering: `children: [leftId, rightId]`.
 * For a node with only one child, use an empty string `""` as a phantom
 * slot to preserve left/right positioning:
 *
 *   `children: ["leftId", ""]`  → left only (right slot reserved as phantom)
 *   `children: ["", "rightId"]` → right only (left slot reserved as phantom)
 *
 * Empty-string entries reserve layout space (so the remaining child stays
 * visually on its correct side) but aren't drawn or recursed into. For
 * general n-ary trees (tries, parse trees), just list real child IDs.
 */
export type TreeNode = {
  id: string; // Unique within the tree (used by pointers, nodeColors, etc.)
  value: string; // Text shown inside the node circle
  children?: string[]; // Ordered child IDs; "" entries are phantom slots
};

/**
 * algo-linked-list node. The chain is determined by `next` pointers, NOT
 * by array order — that's what makes reversal animations work, since the
 * AI can rewire `next` between steps and the renderer follows the new
 * chain. The head is the first node nobody else points to via `next`.
 * The tail has `next` omitted or empty string.
 */
export type LinkedListNode = {
  id: string; // Unique within the list (used by pointers, nodeColors, etc.)
  value: string; // Text shown inside the node box
  next?: string; // ID of the next node, or undefined/empty for the tail
};

/**
 * algo-graph node. The AI places each node at an (x, y) position in
 * "natural" coordinates — the renderer scale-fits them into the bounding
 * box, identical to how algo-tree works. Edges are separate (graphEdges).
 */
export type GraphNode = {
  id: string; // Unique within the graph (used by edges, pointers, nodeColors)
  value: string; // Text shown inside the node circle (e.g. "A", "1", "src")
  x: number; // Position in natural coordinates (scale-fitted by renderer)
  y: number;
};

/** algo-graph edge. source/target are GraphNode IDs. */
export type GraphEdge = {
  id: string; // Unique edge ID (used by edgeColors for per-edge highlighting)
  source: string; // Source node ID
  target: string; // Target node ID
  weight?: number; // Optional weight displayed at edge midpoint
};

/**
 * algo-chart bar. Heights are scaled to the largest value (or chartMaxValue)
 * to fit the bounding box. The optional `label` is shown below (vertical) or
 * beside (horizontal) the bar.
 */
export type ChartBar = {
  id: string; // Unique within the chart (used by barColors and pointerChartBarId)
  value: number; // Bar height as a positive number
  label?: string; // Optional label shown below/beside the bar
};

/** algo-chart-line series. Points render in declaration order. */
export type ChartSeriesPoint = { x: number; y: number };
export type ChartSeries = {
  id: string;
  label?: string;
  color?: string;
  points: ChartSeriesPoint[];
};

/** algo-chart-scatter point. Can be added/moved across steps. */
export type ScatterPoint = {
  id: string;
  x: number;
  y: number;
  label?: string;
  color?: string;
  size?: number;
};

export type NodeModel = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  labelColor?: string; // Label text color
  labelFontSize?: number; // Label font size in pixels
  labelFontWeight?: 'normal' | 'bold'; // Label font weight
  labelFontStyle?: 'normal' | 'italic'; // Label font style (italic)
  labelFontFamily?: string; // Label font family
  labelPadding?: number; // Label padding from node edges in pixels
  labelTextAlign?: 'left' | 'center' | 'right'; // Text alignment within label (for multi-line)
  labelOverflow?: 'visible' | 'ellipsis'; // Label overflow behavior for icon/svg/lottie/image nodes (default 'visible')
  labelRotation?: number; // Rotation of the label in degrees, around the node center. 0 (default), 90, 180, 270 supported. For 90/270 the wrap width uses the node's height so vertical text reads cleanly in tall narrow rects.
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDashArray?: number[]; // e.g., [5, 3] for dashed lines
  strokeDashOffset?: number; // for animated dashes
  strokeTrimStart?: number; // 0-1, where stroke begins (for "draw" effect)
  strokeTrimEnd?: number; // 0-1, where stroke ends (for "draw" effect)
  typeProgress?: number; // 0-1, typewriter reveal of a text node's text (1 = full)
  hideCaret?: boolean; // suppress the typewriter block caret (e.g. whiteboard write-on)
  writeHand?: boolean; // draw the marker hand at the type-on leading edge (title write-in)
  // Carried in by the hand rather than drawn: a finished picture rises from below the frame in
  // the hand, is set down, and the hand drops away. For pictures we cannot draw stroke by
  // stroke, which until now could only fade up with no hand anywhere near them.
  carryHand?: boolean;
  // Where the DRAWING sits inside this node's box, as fractions of the box. A generated plate is a
  // square with a picture somewhere in the middle and transparent margin all round, so the hand
  // needs to be told which part of the box is the actual picture: without it the fingers grip the
  // bottom of the margin, which on a thought bubble is a visible gap of air below what is being
  // held, and the hand is also sized off the whole plate rather than off the picture. Absent means
  // the whole box, which is right for a photograph and for anything drawn edge to edge.
  carryGrip?: { x: number; y: number; w: number; h: number };
  // Which carrying pose holds THIS picture, overriding the artboard's. A bag of coins pinched by a
  // corner, a thought bubble hooked by two fingers: the grip is part of what the thing is, and one
  // pose for a whole video reads as the same sticker being reused.
  carryPose?: string;
  imagePrompt?: string; // subject for an async-generated image; shows a loading placeholder until imageData lands
  // What KIND of picture this is: 'flat' (the default illustrated look), 'photo' (a real
  // photograph) or 'screen' (a real interface capture). The scene decides it when it composes
  // the panel; the browser has to ask for the SAME kind when it generates the picture, or every
  // streamed image comes back flat regardless of what the beat was built for.
  imageStyle?: string;
  characterPrompt?: string; // library name or prompt for an async draw-on character; the client fills svgPaths/svgViewBox/penLifts when it lands
  imageFallbackLetter?: string; // initial to show in a circle if image generation is off/fails
  imageFallbackColor?: string; // circle color for the fallback initial
  imageFailed?: boolean; // set by the client when image generation returned nothing → draw the fallback
  imageCutout?: boolean; // the picture stands on a painted backdrop, so a regenerate asks for it with the paper removed
  morphKey?: string; // shared-element key for 'morph' scene transitions — nodes in
  // adjacent scenes with the same morphKey tween across the boundary (ids are
  // scene-prefixed, so an explicit key is how authors pair elements)
  opacity?: number;
  imageData?: string;
  zIndex?: number; // Layer order (higher = front, lower = back)
  locked?: boolean; // When true, node cannot be selected, moved, or resized (like Canva's lock feature)
  _selected?: boolean;
  
  // Image crop properties (source rectangle in normalized coordinates 0-1)
  imageCropX?: number; // Left edge of crop in normalized coordinates (0-1)
  imageCropY?: number; // Top edge of crop in normalized coordinates (0-1)
  imageCropW?: number; // Width of crop in normalized coordinates (0-1, default 1 = full width)
  imageCropH?: number; // Height of crop in normalized coordinates (0-1, default 1 = full height)
  imageCropShape?: 'rectangle' | 'rounded' | 'ellipse'; // Crop shape (default: matches node kind)
  // Which way the drawProgress wipe travels across an image node. Default 'y' (top-to-bottom),
  // which is what a picture wants. 'x' is for a WORD: type is uncovered along its own line, left
  // to right, the way it would be written.
  // 'radial' is a SPREAD: the picture grows out of `wipeOrigin` in a widening circle with a soft
  // front, for a change moving through a scene already on screen (image-wipe.ts).
  wipeAxis?: 'x' | 'y' | 'radial';
  // Where a radial wipe starts, as fractions of the node box. Default [0.5, 0.5].
  wipeOrigin?: [number, number];
  // Radial wipe only: the soft front's width, as a share of the distance to the farthest corner (default 0.22).
  wipeSoft?: number;
  
  // Animation control: tracks which properties should be animated (stored in steps)
  // If undefined or property is true, it will be animated. If false, it will be static.
  _animatedProps?: {
    x?: boolean;
    y?: boolean;
    w?: boolean;
    h?: boolean;
    opacity?: boolean;
    fill?: boolean;
    stroke?: boolean;
    strokeWidth?: boolean;
    cornerRadius?: boolean;
    rotation?: boolean;
    scale?: boolean;
    rotationX?: boolean;
    rotationY?: boolean;
    rotationZ?: boolean;
    pivotX?: boolean;
    pivotY?: boolean;
    scaleX?: boolean;
    scaleY?: boolean;
    // Tier 1 shape properties
    startAngle?: boolean;
    endAngle?: boolean;
    pointDepth?: boolean;
    topWidth?: boolean;
    bottomWidth?: boolean;
    value?: boolean;
    progressColor?: boolean;
    pointerPosition?: boolean;
    pointerSize?: boolean;
    // Algorithm primitives
    cellValues?: boolean;
    cellColors?: boolean;
    cellLabels?: boolean;
    pointerTargetIndex?: boolean;
    pointerTargetRow?: boolean;
    pointerTargetCol?: boolean;
    pointerLabel?: boolean;
    highlightedLines?: boolean;
    gridValues?: boolean;
    gridColors?: boolean;
    varValue?: boolean;
    nodeColors?: boolean; // algo-tree/linked-list/graph per-node fill cross-fade
    edgeColors?: boolean; // algo-graph per-edge color cross-fade
    barColors?: boolean; // algo-chart per-bar color cross-fade
    chartBars?: boolean; // algo-chart per-bar height (value) tween
    seriesColors?: boolean; // algo-chart-line per-series color cross-fade
    chartSeries?: boolean; // algo-chart-line per-point y tween (draw-in effect)
    pointColors?: boolean; // algo-chart-scatter per-point color cross-fade
    chartPoints?: boolean; // algo-chart-scatter per-point x/y tween
    gridColormap?: boolean; // algo-grid colormap cross-fade (on value changes)
    rangeStart?: boolean;
    rangeEnd?: boolean;
  };

  // Continuous animation: always-on effects rendered in draw loop (independent of steps)
  // These run continuously using performance.now(), like edge flow animations
  //
  // The four original kinds (bounce / pulse / shake / breathe) are a slide or a scale of the whole
  // node box. The DRAWN vocabulary added after them (sway / wobble / tremble / bob / nod / jiggle /
  // throb / drift / flip) is for figures and props in a drawn scene: it turns about a pivot inside
  // the picture, and it measures the picture rather than the box around it. See MOTION_PRESETS.
  continuousAnimation?: {
    type: 'bounce' | 'pulse' | 'shake' | 'breathe' | 'none'
        | 'sway' | 'wobble' | 'tremble' | 'bob' | 'nod' | 'jiggle' | 'throb' | 'drift' | 'flip';
    intensity: number; // 0.1 to 1 (how strong the effect is)
    speed: number; // Duration of one cycle in ms (e.g., 500 = 2 cycles per second)
    // Fraction of a cycle this node starts at. Two figures given the same motion with the same
    // phase move as ONE object, which reads as a rendering fault rather than as two people; the
    // author stamps a different phase on each of them.
    phase?: number;
  };

  // Opt this node out of the ambient "Float nodes" bob (e.g. a node that must stay put).
  floatExclude?: boolean;

  // A drawn illustration is a STACK: the ink node the user sees and selects, plus bound
  // companion layers (`<id>_shadow`, `<id>_regionN`, `<id>_accent`) that carry its colour.
  // `illuOf` on a companion names the ink node it belongs to. Companions are never picked
  // on their own and follow the ink node through every move, resize and delete (the engine
  // enforces this), so a drawing can never end up with its colour left behind.
  illuOf?: string;
  // Stamped on ink and companions whose strokes came from the line-art library.
  illuBound?: boolean;
  // Opt this node IN to the float bob even when the scene/global toggle is off
  // (float a single element while the rest stay still). Takes precedence over
  // floatExclude. Text nodes never float regardless.
  floatInclude?: boolean;

  // Draw this node in SCREEN space instead of world space: after the camera
  // transform is restored, so pan and zoom leave it exactly where it is. Its
  // x/y/w/h are then read against the artboard rather than the document.
  //
  // This is what a HUD needs — a persistent readout strip, a watermark, a
  // running clock. Pinning by position alone does not work: the moment a scene
  // zooms in or centres somewhere other than the artboard middle, a
  // world-space overlay slides across the frame and can leave it entirely.
  // The on-screen captions have always been drawn this way; this makes the
  // same treatment available to an authored node.
  screenPin?: boolean;

  // Shape-specific properties
  cornerRadius?: number; // for rect, arrow
  points?: number; // for polygon/star (number of points)
  innerRadius?: number; // for star (0-1, ratio of inner to outer radius), also for wedge (0-1, donut hole ratio)

  // Wedge-specific (pie/donut slice)
  startAngle?: number; // Start angle in degrees (0 = right/3 o'clock, default 0)
  endAngle?: number; // End angle in degrees (default 270)

  // Chevron-specific (process pipeline arrow)
  pointDepth?: number; // How deep the arrow point cuts in (0-1 ratio of width, default 0.2)

  // Funnel-specific
  topWidth?: number; // Top edge width as ratio of node width (0-1, default 1)
  bottomWidth?: number; // Bottom edge width as ratio of node width (0-1, default 0.3)

  // Progress-specific
  value?: number; // Progress value 0-1 (default 0.5)
  progressOrientation?: 'horizontal' | 'vertical'; // Bar direction (default 'horizontal')
  progressColor?: string; // Filled portion color (default '#3b82f6')

  // Cylinder-specific (3D database shape)
  cylinderTopFill?: string; // Fill color for the top ellipse face (default: lighter shade of fill)
  cylinderOrientation?: 'vertical' | 'horizontal'; // Axis of the cylinder (default 'vertical')
  cylinderSegments?: number; // Stacked segments — 1 = solid (default), 2+ draws N-1 divider arcs

  // Callout-specific (speech bubble)
  pointerSide?: 'N' | 'E' | 'S' | 'W'; // Which side the pointer extends from (default 'S')
  pointerPosition?: number; // Position along the side 0-1 (default 0.3)
  pointerSize?: number; // Size of pointer as ratio of side length (default 0.12)

  // Algorithm visualization: algo-array
  // Row (or column) of equal-sized cells displaying values for sorting/searching/etc.
  cellValues?: string[]; // Values to display in each cell, e.g. ["3","1","4","1","5"]
  cellWidth?: number; // Width of each cell in pixels (default 50). Node w is auto-derived = cellWidth * cellValues.length
  cellHeight?: number; // Height of each cell in pixels (default 50). Node h matches.
  cellOrientation?: 'horizontal' | 'vertical'; // Layout direction (default 'horizontal')
  cellShowIndices?: boolean; // Show 0-based indices below/beside cells (default true)
  cellColors?: (string | null)[]; // Per-cell fill color override; null = use default fill
  cellLabels?: (string | null)[]; // Per-cell text override; null = use cellValues[i]
  cellGap?: number; // Gap in pixels between cells (default 0)
  cellFontSize?: number; // Font size for cell values (default 16)
  cellIndexFontSize?: number; // Font size for cell indices (default 11)
  cellIndexColor?: string; // Color for cell index labels (default falls back to labelColor)
  cellColor?: string; // Text color for cell values (default falls back to labelColor)

  // Range marker (algo-array): a contiguous span [rangeStart, rangeEnd] inclusive,
  // drawn as a colored bracket below (or beside) the cells. Used for sliding
  // window, binary search range halving, two-pointer ranges. Both endpoints
  // animate independently via transformTween for smooth slide effects.
  rangeStart?: number; // 0-based inclusive start index of the range marker
  rangeEnd?: number;   // 0-based inclusive end index of the range marker
  rangeColor?: string; // Color of the range bracket (default '#3b82f6')
  rangeLabel?: string; // Optional label drawn next to the bracket

  // Algorithm visualization: algo-pointer
  // Labeled marker (e.g. "i", "left", "slow") that points at a target node — position is derived
  pointerLabel?: string; // Text label like "i", "j", "left", "slow"
  pointerTargetId?: string; // ID of target node (e.g. an algo-array)
  pointerTargetIndex?: number; // For algo-array targets: 0-based cell index. Ignored otherwise.
  pointerTargetRow?: number; // For algo-grid targets: 0-based row index
  pointerTargetCol?: number; // For algo-grid targets: 0-based column index
  pointerTreeNodeId?: string; // For algo-tree targets: ID of the tree node to point at. Auto-slides between nodes when changed across steps.
  pointerLinkedListNodeId?: string; // For algo-linked-list targets: ID of the list node to point at. Auto-positions even when the chain is rewired.
  pointerGraphNodeId?: string; // For algo-graph targets: ID of the graph node to point at. Auto-positions based on fitted graph layout.
  pointerChartBarId?: string; // For algo-chart targets: ID of the bar to point at. Auto-positions based on fitted chart layout.
  pointerSidePosition?: 'top' | 'bottom' | 'left' | 'right'; // Which side of target the pointer sits on (default 'top')
  pointerColor?: string; // Color of the marker arrow + label (default '#f59e0b')
  pointerOffset?: number; // Distance from target edge in pixels (default 18)
  pointerArrowSize?: number; // Triangle size in pixels (default 10)
  pointerShowArrow?: boolean; // If false, hide the triangle and rely on the cell highlight + label only (default true)

  // Algorithm visualization: algo-grid
  // 2D table of equal-sized cells. Used for DP tables, matrices, board games, cellular automata.
  gridRows?: number; // Number of rows
  gridCols?: number; // Number of columns
  gridValues?: string[][]; // Cell text content [row][col]
  gridColors?: (string | null)[][]; // Per-cell fill color override [row][col]; empty/null = use default fill. Auto cross-fades.
  gridCellWidth?: number; // Width of each cell in pixels (default 50)
  gridCellHeight?: number; // Height of each cell in pixels (default 40)
  gridShowRowIndices?: boolean; // Show 0-based row indices on the left (default true)
  gridShowColIndices?: boolean; // Show 0-based column indices on top (default true)
  gridRowLabels?: string[]; // Custom row labels (e.g. ["", "A", "AB", "ABC"]); empty string falls back to index
  gridColLabels?: string[]; // Custom column labels (e.g. ["", "0", "1", "2"]); empty string falls back to index
  gridIndexFontSize?: number; // Font size for row/col index labels (default 11)
  gridIndexColor?: string; // Color for row/col index labels (default falls back to labelColor)
  gridCellFontSize?: number; // Font size for cell values (default 14)
  gridCellColor?: string; // Text color for cell values (default falls back to labelColor)

  // Algorithm visualization: algo-variable
  // Small labeled box showing a variable's current value (e.g. "min = 5", "i = 3").
  varName?: string; // Variable name shown to the left
  varValue?: string; // Variable value shown to the right (auto cross-fades between snapshots)
  varColor?: string; // Optional accent color for the value (defaults to labelColor)
  varNameColor?: string; // Optional color for the name text (defaults to labelColor)
  varOrientation?: 'horizontal' | 'stacked'; // 'horizontal' = "name: value", 'stacked' = name on top, value below (default 'horizontal')

  // Algorithm visualization: algo-tree
  // Tree structure with auto-layout. Used for BFS/DFS, BSTs, heaps, tries, parse trees.
  // Nodes are referenced by ID; layout is computed automatically from the children
  // arrays. Binary trees use empty-string phantom slots in children for left/right
  // positioning (e.g. children: ["leftId", ""] for a left-only node).
  treeNodes?: TreeNode[]; // Flat array of nodes; first un-referenced node is the implicit root
  nodeRadius?: number; // Radius of each node circle in pixels (default 24)
  nodeSpacing?: number; // Horizontal gap between sibling subtrees in pixels (default 60)
  levelHeight?: number; // Vertical gap between tree levels in pixels (default 80)
  // Per-node fill color override. Auto cross-fades between steps.
  // Accepts either a map (renderer's natural shape) or an array of {nodeId,color}
  // pairs (the form the AI emits, since Gemini's schema can't express
  // arbitrary-key objects). normalizeNodeColors() handles both at render time.
  nodeColors?:
    | { [nodeId: string]: string | null }
    | Array<{ nodeId: string; color: string }>;
  nodeFontSize?: number; // Font size for node values (default 14)
  treeNodeStrokeColor?: string; // Border color for nodes (default falls back to stroke)
  treeEdgeColor?: string; // Color for edges between nodes (default '#475569')
  treeEdgeWidth?: number; // Stroke width for edges (default 2)

  // Algorithm visualization: algo-linked-list
  // Singly linked list with auto-layout. Used for list reversal, cycle
  // detection, merging, palindrome checks. The chain is determined by
  // `next` pointers, NOT array order — rewiring `next` between steps
  // automatically reroutes the visual arrows.
  linkedListNodes?: LinkedListNode[]; // Flat array of nodes; head is the first un-referenced node
  linkedListOrientation?: 'horizontal' | 'vertical'; // Layout direction (default 'horizontal')
  linkedListSpacing?: number; // Gap in pixels between consecutive node boxes (default 24)
  linkedListNodeWidth?: number; // Width of each node box in pixels (default 60)
  linkedListNodeHeight?: number; // Height of each node box in pixels (default 50)
  linkedListEdgeColor?: string; // Color of the `next` arrows (default '#475569')
  linkedListShowNull?: boolean; // Draw "null" terminator after the tail (default true)
  // Note: nodeColors above is shared with algo-tree/algo-linked-list/algo-graph — same shape, same
  // cross-fade behavior. The renderer dispatches based on `kind`.

  // Algorithm visualization: algo-graph
  // General graph with manual node placement. Used for Dijkstra, BFS/DFS on graphs,
  // MST (Prim/Kruskal), topological sort, SCC, network flow. The AI places nodes
  // at x/y positions; the renderer scale-fits them into the bounding box.
  graphNodes?: GraphNode[]; // Flat array of nodes with x/y positions
  graphEdges?: GraphEdge[]; // Flat array of edges (source/target are node IDs)
  graphDirected?: boolean; // Draw arrowheads on edges (default false = undirected)
  graphNodeRadius?: number; // Radius of each node circle in pixels (default 24)
  graphEdgeColor?: string; // Default color for edges (default '#475569')
  graphEdgeWidth?: number; // Default stroke width for edges (default 2)
  graphShowWeights?: boolean; // Show weight labels at edge midpoints (default true if any edge has weight)
  edgeColors?: // Per-edge color overrides. Auto cross-fades between steps.
    | { [edgeId: string]: string | null }
    | Array<{ edgeId: string; color: string }>;

  // Algorithm visualization: algo-chart
  // Bar chart for value distributions, sort visualizations, decay charts.
  // Heights scale to the largest value (or chartMaxValue) to fit the box.
  chartBars?: ChartBar[]; // Array of bars rendered in order
  chartOrientation?: 'vertical' | 'horizontal'; // Default 'vertical' (bars grow up)
  chartBarSpacing?: number; // Gap between bars in pixels (default 8)
  chartBarColor?: string; // Default bar fill color (default '#7c3aed')
  chartShowValues?: boolean; // Print numeric value on top of each bar (default false)
  chartMaxValue?: number; // Optional override for axis maximum
  barColors?: // Per-bar color overrides. Auto cross-fades between steps.
    | { [barId: string]: string | null }
    | Array<{ barId: string; color: string }>;

  // Algorithm visualization: algo-chart-line
  // Line/curve plot for loss curves, learning rate schedules, accuracy curves.
  chartSeries?: ChartSeries[]; // Multiple series plotted on the same axes
  chartXRange?: [number, number]; // [xmin, xmax]; auto-fit if omitted
  chartYRange?: [number, number]; // [ymin, ymax]; auto-fit if omitted
  chartShowAxes?: boolean; // Draw axes + ticks (default true)
  chartXLabel?: string;
  chartYLabel?: string;
  chartGridLines?: boolean; // Faint gridlines behind the data (default false)
  seriesColors?: // Per-series color overrides. Cross-fades.
    | { [seriesId: string]: string | null }
    | Array<{ seriesId: string; color: string }>;

  // Algorithm visualization: algo-chart-scatter
  // Scatter plot for embeddings, clusters, decision boundaries.
  chartPoints?: ScatterPoint[]; // Points with (x, y) coords, per-point color and size
  pointColors?: // Per-point color overrides. Cross-fades.
    | { [pointId: string]: string | null }
    | Array<{ pointId: string; color: string }>;

  // algo-grid heatmap extension
  gridColormap?: 'heat' | 'cool' | 'viridis' | 'rdbu'; // Auto-colormap gridValues
  gridMinValue?: number; // Colormap lower bound
  gridMaxValue?: number; // Colormap upper bound

  // Pointer extensions for chart attachment
  pointerChartSeriesId?: string; // algo-chart-line: series to attach to
  pointerChartPointIndex?: number; // algo-chart-line: index within series.points
  pointerChartPointId?: string; // algo-chart-scatter: specific point id

  // UML-specific properties
  lifelineLength?: number; // UML lifeline dashed line length in pixels
  lifelineHead?: 'box' | 'actor' | 'icon'; // UML lifeline header style (default 'box'); 'actor' = stick figure, 'icon' = svgPaths glyph
  activations?: Array<{startY: number; endY: number}>; // UML lifeline activation bars (positions relative to header bottom)
  attributes?: string[]; // UML class attributes, e.g. ['-name: String', '+age: int']
  methods?: string[]; // UML class methods, e.g. ['+getName(): String']
  stereotype?: string; // UML class stereotype, e.g. 'interface', 'abstract'

  // SVG-specific
  svgPaths?: Array<{
    d: string; // SVG path data
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }>;
  svgViewBox?: { x: number; y: number; w: number; h: number };
  iconStyle?: 'outline' | 'solid'; // 'outline' = stroke only (default for icons), 'solid' = fill + stroke, undefined = preserve original colors

  /** Source icon reference (e.g. 'mdi:cached', 'logos:redis') — set on icon
   *  nodes and on rasterized-icon rects (imageData). Signals "this is an icon"
   *  even when rendered as an image. */
  iconRef?: string;

  /** LaTeX source for a math element. When present, the node renders compiled
   *  math (MathJax SVG on `imageData`) and the properties panel shows a LaTeX
   *  editor. See utils/latex.ts. */
  mathTex?: string;

  /** Function-plot spec. When present, the node's svgPaths are computed from it
   *  (axes + curve) and the properties panel shows a plot editor. See utils/mathPlot.ts. */
  plotSpec?: import('./utils/mathPlot').PlotSpec;

  /** Isometric-block spec. When present, the node's svgPaths are the 3 shaded faces
   *  of a cuboid and the properties panel shows an iso editor. See utils/isoBlock.ts. */
  isoSpec?: import('./utils/isoBlock').IsoSpec;

  // Glow treatment (render-time, see utils/node-glow.ts)
  /** Glow intensity 0..1; the node's outline casts a colored shadow-blur. */
  glow?: number;
  /** Glow color (hex). Defaults to the node's stroke/fill when unset. */
  haloColor?: string;
  /** Render as a dark glass panel/orb (circle/rect): glass body + gradient border. */
  glassy?: boolean;
  /** Hard offset drop-shadow (the "sticker card" depth): a SOLID silhouette offset
   *  behind the node, distinct from the blurred `glow`. See entity-renderers. */
  dropShadow?: { dx?: number; dy?: number; color?: string; radius?: number };

  // Icon background
  iconBg?: string; // Background fill color (hex). Enables background shape when set.
  iconBgShape?: 'circle' | 'rounded' | 'square'; // Shape of the background (default 'circle')
  iconBgPadding?: number; // Fraction 0-1, how much of the bg the icon fills (default 0.6)

  // Lottie-specific
  lottieData?: any; // Lottie/Bodymovin JSON animation data
  lottieIconRef?: string; // Reference to a Lottie icon from the catalog (e.g., "database", "api")
  lottieLoop?: boolean; // Whether to loop the animation (default: true)
  lottieAutoplay?: boolean; // Whether to autoplay (default: false, controlled by timeline)
  lottieSpeed?: number; // Playback speed multiplier (default: 1)
  lottiePaused?: boolean; // Whether the animation is paused (default: false)
  lottieSegment?: [number, number]; // Frame range to play [startFrame, endFrame] (default: play all frames)
  lottiePlayOnStepTransition?: boolean; // Whether to start playing when step transitions (default: false)
  lottieTimelineSync?: boolean; // Whether to sync animation progress with timeline position (default: false)
  
  // Lottie color/style customization
  lottiePreset?: 'normal' | 'twoTone' | 'grayTone' | 'dark'; // Color preset (default: 'normal')
  lottieColorPrimary?: string; // Primary/stroke color override (hex) - applies to all strokes
  lottieColorSecondary?: string; // Secondary/fill color override (hex) - applies to all fills
  lottieColorMap?: Record<string, string>; // Fine-grained color mapping: { originalHex: newHex8 } (hex8 includes alpha)
  lottieStrokeScale?: number; // Stroke width multiplier (0-3, default: 1 = 100%)
  lottieStrokeDash?: 'solid' | 'dashed' | 'dotted'; // Stroke dash pattern (default: 'solid')

  // Unified asset reference (new system - supports reference-based icons, lottie, images)
  // When present, takes precedence over legacy fields (imageData, lottieData, svgPaths)
  asset?: {
    /** Asset type: 'icon' | 'lottie' | 'image' | 'svg' */
    type: 'icon' | 'lottie' | 'image' | 'svg';
    /** Source: 'iconify' | 'lottie-library' | 'lottie-icons' | 'bundled' | 'url' | 'user' | 'embedded' */
    source: 'iconify' | 'lottie-library' | 'lottie-icons' | 'bundled' | 'url' | 'user' | 'embedded';
    /** Reference identifier (e.g., 'mdi:database' for iconify, 'confetti' for lottie-library) */
    ref?: string;
    /** Embedded/cached data for offline use or fallback */
    data?: string | object;
    /** Human-readable name */
    name?: string;
  };

  // Text-specific properties
  text?: string; // Text content (plain text only)
  fontFamily?: string; // e.g., 'Inter', 'Roboto', 'system-ui'
  fontWeight?: number; // 100-900
  fontStyle?: 'normal' | 'italic';
  fontSize?: number; // in pixels
  lineHeight?: number; // multiplier (e.g., 1.5)
  letterSpacing?: number; // in pixels
  color?: string; // text color (default fill)
  textStroke?: string; // text stroke color
  textStrokeWidth?: number; // text stroke width
  textShadow?: {
    x: number;
    y: number;
    blur: number;
    color: string;
  };
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  wrap?: 'word' | 'char' | 'ellipsis' | 'clip';
  autoFit?: 'none' | 'shrink' | 'grow';

  // Line highlighting (mainly for code/pseudocode in text nodes)
  highlightedLines?: number[]; // 0-indexed line numbers to highlight
  highlightLineColor?: string; // Background color for highlighted lines (default 'rgba(255,235,59,0.25)')

  // Syntax highlighting (text nodes only — pairs well with highlightedLines for code blocks)
  syntaxStyle?: 'none' | 'pseudo' | 'python' | 'javascript'; // default 'none'
  syntaxColors?: {
    keyword?: string;
    string?: string;
    comment?: string;
    number?: string;
    function?: string;
  };

  // Hand-drawn / sketchy rendering (Rough.js)
  rough?: boolean;              // Enable hand-drawn style
  roughness?: number;           // 0-3 (default 1) — how rough/sketchy the lines are
  roughFillStyle?: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots';  // default 'hachure'
  roughFillWeight?: number;     // Fill line weight (default 1)
  roughHachureAngle?: number;   // Hatch direction in degrees — vary it to separate touching shapes
  roughSeed?: number;           // Fixed seed for consistent rendering across frames

  // Group/hierarchy properties
  parentId?: string; // Reference to parent group (for nested hierarchy)
  
  // Group-specific properties (when kind === 'group')
  clipContent?: boolean; // Clip children to group bounds
  padding?: number; // Inner padding for group
  rotation?: number; // Group rotation in radians (2D rotation, same as rotationZ)
  scale?: number; // Group scale (1 = 100%)
  
  // 3D Rotation properties (in degrees for easier UI)
  rotationX?: number; // Rotation around X-axis (flip vertically, like a card flipping top-to-bottom)
  rotationY?: number; // Rotation around Y-axis (flip horizontally, like a door opening)
  rotationZ?: number; // Rotation around Z-axis (normal 2D rotation, 0-360 degrees)
  
  // Pivot & Scale for advanced transforms (for icon motion, hinges, etc.)
  pivotX?: number; // Pivot point X (0..1 relative to width, 0=left, 0.5=center, 1=right)
  pivotY?: number; // Pivot point Y (0..1 relative to height, 0=top, 0.5=center, 1=bottom)
  scaleX?: number; // Scale along X-axis (1 = 100%, 0.5 = 50%, 2 = 200%)
  scaleY?: number; // Scale along Y-axis (1 = 100%)
  // Affine 2x2 linear map [[m11,m12],[m21,m22]] applied about the pivot — the basis
  // for "transform the whole plane" visuals (grid deformation, determinant). Identity
  // is [1,0,0,1]; each entry tweens independently. See applyNodeTransform.
  m11?: number;
  m12?: number;
  m21?: number;
  m22?: number;
  /** World-space pivot for the affine map (defaults to this node's pivot). Set to
   *  a shared point (the plane origin) so grid + vectors + square deform as one. */
  mPivotX?: number;
  mPivotY?: number;
  /** 0..1 progressive stroke reveal for svgPaths ("draw-on", via lineDash). 1 = full. */
  drawProgress?: number;
  /** Tier 3 3D mesh: raw 3D vertices/edges/faces. The renderer (mesh3d.ts) rotates by
   *  rot3dX/Y/Z, projects, depth-sorts, flat-shades, and draws into the node box. */
  mesh3d?: import('./utils/mesh3d').Mesh3D;
  meshSpec?: import('./utils/mesh3d').MeshSpec; // editor authoring spec (preset + size/color)
  /** Intrinsic 3D rotation in degrees — each axis tweens independently (spin = rot3dY 0→360). */
  rot3dX?: number;
  rot3dY?: number;
  rot3dZ?: number;
  /** Per-axis 3D scale applied to mesh vertices — tween for a scaling/stretch matrix. */
  meshScaleX?: number;
  meshScaleY?: number;
  meshScaleZ?: number;
  /** Full 3x3 linear map on mesh vertices (row-major, identity default) — tween from
   *  identity to rotate / shear / reflect / SVD a 3D object. Applied after meshScale. */
  tm11?: number; tm12?: number; tm13?: number;
  tm21?: number; tm22?: number; tm23?: number;
  tm31?: number; tm32?: number; tm33?: number;
  /** Mesh-local position of the shaded marker ball (tween through a path, e.g. gradient descent). */
  markerX?: number; markerY?: number; markerZ?: number;
  meshProj?: 'ortho' | 'persp';
  /** Movable 2D arrow (one node, no follow-edge): tail->tip, head computed each
   *  frame. Tween arrowTip/Tail for free vectors, paths, tip-to-tail addition. */
  arrowTailX?: number; arrowTailY?: number; arrowTipX?: number; arrowTipY?: number;
  arrowColor?: string; arrowWidth?: number; arrowHead?: number;
  /** Draw a fixed ticked coordinate frame around a mesh3d object (editor toggle). */
  meshShowAxes?: boolean; meshAxesTicks?: number; meshAxesColor?: string;
  meshAxesExtent?: number; // axis half-length in OBJECT UNITS (ticks land on integers)
  /** pathMarker: a dot that rides a screen-space polyline at tweenable pathT (0..1). */
  pathPts?: [number, number][]; pathT?: number;
  pathTangent?: boolean; pathTangentLen?: number; tangentColor?: string;
  pathCenterX?: number; pathCenterY?: number; pathRadiusColor?: string; sinColor?: string; cosColor?: string;
  pathMarkerColor?: string; pathMarkerR?: number; pathLineColor?: string;
};

export type CustomPort = {
  side: 'N' | 'E' | 'S' | 'W';
  ratio: number;
};

export type EdgeModel = {
  id: string;
  from?: string;
  to?: string;
  fromXY?: Vec2;
  toXY?: Vec2;
  fromPort?: Port;
  toPort?: Port;
  fromPortCustom?: CustomPort;
  toPortCustom?: CustomPort;
  stroke?: string;
  width?: number;
  trim?: number;
  trimStart?: number;
  router?: 'AUTO' | 'VHV' | 'HVH';
  arrow?: 'none' | 'end' | 'start' | 'both';
  arrowOffset?: number; // Offset for arrowhead position (positive = away from node, negative = into node)
  arrowSize?: number; // Size multiplier for arrowhead (default 1)
  arrowOnTop?: boolean; // Draw arrowhead on top of nodes (for overlapping arrows)
  endArrowType?: 'triangle' | 'open-triangle' | 'diamond-filled' | 'diamond-hollow' | 'circle' | 'bar'; // Arrowhead shape at end
  startArrowType?: 'triangle' | 'open-triangle' | 'diamond-filled' | 'diamond-hollow' | 'circle' | 'bar'; // Arrowhead shape at start
  strokeStyle?: 'solid' | 'dashed' | 'dotted'; // Line dash pattern
  /**
   * How the ink itself is laid down, independent of the dash pattern above.
   * 'clean'  — one crisp constant-width stroke (the default).
   * 'marker' — a felt-tip ribbon whose width breathes along the line, with dabbed ends
   *            and a soft fringe. Beats the sketch look when both are asked for.
   */
  strokeTexture?: 'clean' | 'marker';
  glow?: boolean; // Soft glow/bloom on the edge line in vector mode (default on; set false to disable)
  label?: string;
  labelColor?: string; // Label text color
  labelFontSize?: number; // Label font size in pixels
  labelFontWeight?: 'normal' | 'bold'; // Label font weight
  labelFontStyle?: 'normal' | 'italic'; // Label font style (italic)
  labelFontFamily?: string; // Label font family
  labelPosition?: 'center' | 'above' | 'below'; // Label position relative to edge (perpendicular)
  labelOffset?: number; // Label offset from edge in pixels (perpendicular)
  labelPositionT?: number; // Label position along edge (0 = start, 0.5 = middle, 1 = end)
  labelFollowEdge?: boolean; // Rotate label to be parallel to edge direction
  labelOffsetX?: number; // Additional X offset for label position (world units)
  labelOffsetY?: number; // Additional Y offset for label position (world units)
  labelBgColor?: string; // Background color behind label text (e.g. "#1e293b" or "rgba(0,0,0,0.7)")
  labelBgPadding?: number; // Padding around label background in pixels (default 4)
  lineType?: 'straight' | 'curved' | 'elbowed'; // Type of line connection
  pathStyle?: 'orthogonal' | 'rounded'; // For elbowed: sharp or rounded corners
  edgeSpacing?: number;
  cornerRadius?: number;
  flowSpeed?: number;
  animationStyle?: 'flow' | 'ball' | 'pulse' | 'none'; // Animation style for the edge
  ballCount?: number; // Number of balls for 'ball' animation style
  waypoints?: Vec2[]; // Custom positions for intermediate path points (elbowed)
  curveControlPoint?: Vec2; // Custom control point for curved paths
  
  // Node flow animation: clones of nodes flowing along the edge
  nodeFlow?: {
    enabled: boolean;
    nodeTemplateIds: string[]; // Original node IDs (for reference/UI)
    edgeSequence?: string[]; // Ordered list of edge IDs for multi-edge path (includes this edge)
    edgeSpeeds?: number[]; // Per-edge speeds (ms) matching edgeSequence order; falls back to 'speed' if not set
    // Captured snapshots of nodes at the time they were added to the flow
    // This ensures the flowing clones don't change when the original node is updated
    nodeSnapshots: Array<{
      id: string;
      kind: NodeKind;
      w: number;
      h: number;
      label?: string;
      text?: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      imageData?: string;
      lottieData?: any; // Lottie animation data for animated icons
      svgPaths?: NodeModel['svgPaths']; // SVG path data for SVG icons
      svgViewBox?: NodeModel['svgViewBox']; // SVG viewBox for proper scaling
    }>;
    // Cached edge path at the time node flow was configured
    // This ensures the path doesn't change when attached nodes animate
    cachedPath?: {
      points: Vec2[];
      length: number;
      cum: number[];
    };
    speed: number; // Duration for one clone to travel full edge (ms)
    count: number; // How many clones to spawn (1-20)
    spacing: number; // Delay between each clone spawn (ms) - train effect
    loop: boolean; // Keep spawning or one-shot per animation cycle
    scale: number; // Scale of clones (0.1-2)
    opacity: number; // Base opacity (0-1)
    fadeOut: boolean; // Fade out as clone approaches end
    followEdge: boolean; // If true, clones follow live edge path; if false, use cached path
    offsetMs?: number; // Start delay for node flow animation (ms) - for sequential edge animations
  };
  
  // Hand-drawn / sketchy rendering (Rough.js)
  rough?: boolean;
  roughness?: number;
  roughSeed?: number;
  bowing?: number; // How much lines bow outward (0-10, default 1)

  // Anchor mode: controls whether edge endpoints follow node animations
  // 'follow' (default) - endpoints move with nodes
  // 'freezeStart' - start point is frozen, end follows nodes
  // 'freezeEnd' - end point is frozen, start follows nodes  
  // 'freezeBoth' - both endpoints frozen (fully static edge)
  anchorMode?: 'follow' | 'freezeStart' | 'freezeEnd' | 'freezeBoth';
  
  // Frozen endpoint positions (captured when anchor mode is set)
  frozenEndpoints?: {
    start?: Vec2; // Frozen start position (world coordinates)
    end?: Vec2;   // Frozen end position (world coordinates)
  };
  
  // Animation control: tracks which properties should be animated (stored in steps)
  _animatedProps?: {
    stroke?: boolean;
    width?: boolean;
    trim?: boolean;
    trimStart?: boolean;
    opacity?: boolean;
    waypoints?: boolean;
    curveControlPoint?: boolean;
  };
  
  // Layer order (higher = front, lower = back)
  // Controls whether this edge renders above or below nodes
  zIndex?: number;
  
  // Opacity (0-1, where 0 = invisible, 1 = fully visible)
  opacity?: number;
};

export type Camera = { x: number; y: number; zoom: number };

/** A cut to another camera for part of a step, and back (see Step.cameraCuts). */
export interface CameraCut {
  atMs: number;
  endMs: number;
  camera: Camera;
}

export type Step = {
  id?: string; // Unique identifier for this step (for snapshots, reordering, etc.)
  note?: string;
  caption?: string; // narration line for this step — spoken (TTS) + optional on-screen caption
  durationMs: number;
  easing?: Easing;
  propertyEasings?: Record<string, Easing>;
  actions?: StepAction[];
  camera?: Camera; // Optional camera keyframe — if set, playback animates to this view
  cameraDurationMs?: number; // Duration of camera tween (default: 60% of step durationMs)
  cameraEasing?: Easing; // Easing for camera tween (default: step's easing, fallback ease-in-out)
  cameraOffsetMs?: number; // Delay before camera starts moving (default: 0)
  cameraEnd?: Camera; // Optional second keyframe: after the camera tween settles,
  // the view drifts linearly to this camera over the REMAINDER of the step —
  // slow push-ins / Ken Burns. The next step's tween starts from cameraEnd.
  cameraEndDurationMs?: number; // How long that drift takes. Unset = the whole remainder
  // of the step, which is what a Ken Burns drift wants: it should be barely perceptible and
  // last as long as the shot. A scene that OPENS pushed in wants the opposite — the settle is
  // a move the audience should read as a move, and stretching it over an eight-second step
  // turns it into a crawl. Set this and the drift finishes in that many milliseconds and then
  // holds. Also switches the drift from linear to eased, since a deliberate move that stops
  // dead at the end reads as a glitch.
  cameraEndEasing?: Easing; // Easing for that drift; only consulted when cameraEndDurationMs
  // is set (an unbounded Ken Burns drift stays linear). Default: ease-out.
  cameraCuts?: CameraCut[]; // Hard cuts inside the step (a reaction shot of the listener while
  // someone talks): from atMs to endMs into the step the view IS that camera, then cuts back to
  // wherever the step's own camera has got to. They never change where the step rests.
  
  // Node data - supports both full snapshots and delta format
  // Step 0: Full snapshot (all nodes with complete properties)
  // Step 1+: Delta format (only nodes/properties that changed)
  nodes: Array<Partial<NodeModel> & { id: string }>;
  
  // Edge data - supports both full snapshots and delta format
  edges: Array<
    Pick<
      EdgeModel,
      | 'id'
      | 'trim'
      | 'trimStart'
      | 'stroke'
      | 'width'
      | 'router'
      | 'arrow'
      | 'from'
      | 'to'
      | 'fromXY'
      | 'toXY'
      | 'fromPort'
      | 'toPort'
      | 'fromPortCustom'
      | 'toPortCustom'
      | 'label'
      | 'labelColor'
      | 'labelFontSize'
      | 'labelFontWeight'
      | 'labelFontStyle'
      | 'labelFontFamily'
      | 'labelPosition'
      | 'labelOffset'
      | 'labelPositionT'
      | 'labelFollowEdge'
      | 'labelOffsetX'
      | 'labelOffsetY'
      | 'labelBgColor'
      | 'labelBgPadding'
      | 'arrowOffset'
      | 'arrowSize'
      | 'arrowOnTop'
      | 'lineType'
      | 'pathStyle'
      | 'edgeSpacing'
      | 'cornerRadius'
      | 'flowSpeed'
      | 'animationStyle'
      | 'ballCount'
      | 'waypoints'
      | 'curveControlPoint'
      | 'nodeFlow'
      | 'anchorMode'
      | 'frozenEndpoints'
      | '_animatedProps'
      | 'zIndex'
      | 'opacity'
    >
  >;
  
  // === Delta Format Fields (optional, for steps 1+) ===
  // New nodes added this step (full definitions)
  addNodes?: NodeModel[];
  // Node IDs removed this step
  removeNodeIds?: string[];
  // New edges added this step (full definitions)
  addEdges?: EdgeModel[];
  // Edge IDs removed this step
  removeEdgeIds?: string[];
  
  // Transitions override per node ID for the transition *into* this step
  transitions?: Record<string, TransitionType>;
  // Per-node delay in ms for staggered animations (node ID -> delay ms)
  delays?: Record<string, number>;

  // Internal metadata (set during normalization, not user-authored)
  _addedNodeIds?: string[];
  _removedNodeIds?: string[];
  _addedEdgeIds?: string[];
  _removedEdgeIds?: string[];
};

// Path switching modes for smooth transitions
export type StartMode = 'continue' | 'auto-snap' | 'reset-blend' | 'manual';

// Frame state for GIF export (pure rendering)
export type FrameState = {
  nodes: NodeModel[];
  edges: EdgeModel[];
  flowOffset?: number; // Global flow offset for animated edges
  phantomNodes?: PhantomNode[]; // Cloned nodes flowing along edges
  // Active step's narration, surfaced so drawScene can render on-screen captions.
  caption?: string;
  captionElapsedMs?: number; // time elapsed within the active step
  captionDurationMs?: number; // active step's total duration
  captionWords?: WordTiming[]; // per-word spans for the active step's narration, when measured
};

// Styling for the on-screen caption lower-third. All optional; the renderer fills in
// sensible defaults (see CAPTION_STYLE_DEFAULTS in rendering-utils).
export type CaptionStyle = {
  fontScale?: number; // multiplier on the default size (~3.6% of frame height); 1 = default
  textColor?: string; // hex, default near-white
  bandColor?: string; // hex of the background band, default near-black
  bandOpacity?: number; // 0..1, default 0.74
  fontWeight?: number; // default 600
  // 'band' is the lower-third chip. 'display' is the whiteboard-video treatment: heavy
  // outlined all-caps lettering sitting straight on the drawing with no chip behind it,
  // one word lit up at a time.
  variant?: 'band' | 'display';
  highlightColor?: string; // display: fill of the word being spoken
  outlineColor?: string; // display: the stroke drawn around every letter
};

// Animated sprite support for GIF overlays
export type AnimatedSprite = {
  frames: (ImageBitmap | VideoFrame)[];
  delaysMs: number[]; // per-frame delays (ms)
  totalMs: number; // sum(delaysMs)
  loopCount: number; // finite loop count, or Infinity for infinite loop
};

export type SpriteCache = Map<string, AnimatedSprite>;

// ============================================================================
// NARRATION TYPES
// ============================================================================

/** A single narration clip anchored to a step. One clip per step max. */
export type NarrationClip = {
  id: string;
  text: string;
  voice: {
    provider: TTSProvider;
    voiceId: string;
    voiceName: string;
  };
  speed?: number;               // playback rate multiplier, default 1
  stepIndex: number;            // which step this clip belongs to (1:1)
  audioData?: string;           // cached TTS result (base64 data URL)
  audioUrl?: string;            // offloaded audio in object storage (resolved -> audioData on load)
  audioDurationMs?: number;     // measured duration via AudioContext
  words?: WordTiming[];         // per-word spans from the voice service, for karaoke captions
};

// ============================================================================
// MULTI-SCENE / PROJECT TYPES
// ============================================================================

/** A single scene — self-contained diagram content (no artboard, that's project-level) */
export type Diagram = {
  nodes: readonly NodeModel[];
  edges: readonly EdgeModel[];
  steps: readonly Step[];
  paths?: Record<PathId, Path>;
  /** Per-scene narration track — one clip per step */
  narration?: NarrationClip[];
  /** Per-scene generation task ID for AI iteration threads */
  generationTaskId?: string;
  /** The surface THIS scene sits on, when it is not the one under the rest of the video.
   *  Absent on nearly every scene: the artboard's ground is the sheet the whole video lies on,
   *  and a scene names its own only when it happens somewhere else (the field notes, the
   *  blueprint, the terminal). `background` is the flat colour beneath it, which has to agree
   *  with the sheet or the frame flashes the wrong colour during a transition. */
  bg?: import('./utils/stage-background').BackgroundSpec;
  background?: string;
  /** Per-scene write-hand track (ordered write windows) for the continuous marker hand. */
  handTrack?: readonly { id?: string; t0: number; t1: number; sx: number; sy: number; ex: number; ey: number;
    /** 'carry' = the hand brings a finished picture in and sets it down, instead of drawing it. */
    mode?: 'write' | 'carry' }[];
};

/** Optional transition applied at a scene boundary.
 *  - `crossfade`: alpha-blend the two scenes.
 *  - `slideDown`/`slideUp`/`slideLeft`/`slideRight`: the incoming scene slides
 *    in over the outgoing one from the named edge (e.g. `slideDown` = the new
 *    scene enters from the top). The outgoing scene stays put underneath.
 *  - `pushUp`/`pushDown`/`pushLeft`/`pushRight`: BOTH scenes move together, as
 *    if they were panels of one long strip and the camera travelled along it.
 *    The outgoing scene leaves in the named direction and the incoming one
 *    arrives from the opposite edge, locked to it with no gap and no overlap.
 *
 *    The distinction from `slide` is the outgoing scene. A slide covers it: it
 *    sits still while the new scene passes over the top, which reads as one
 *    picture being buried by another. A push moves it: the pair reads as a
 *    single continuous surface, which is what "the scene slides away and the
 *    next one comes up" means to a viewer. Direction NAMES the outgoing scene's
 *    travel, so `pushUp` sends the current scene up and brings the next one in
 *    from below.
 *  - `travelOffUp`/`travelOffDown`/`travelOffLeft`/`travelOffRight`: the outgoing
 *    scene is moved ASIDE. It travels out of the frame, drifting and growing
 *    slightly as it goes, and what is behind it is the next scene — which on a
 *    drawn board is blank paper with its first strokes just starting. Direction
 *    names the outgoing scene's travel, as with push.
 *
 *    This is the transition hand-drawn explainers actually use, and it is not a
 *    push: a push locks the two scenes edge to edge so the incoming one arrives
 *    on cue, which reads as a camera tracking along a strip. Here nothing arrives.
 *    The finished picture is simply taken away and the paper it was lying on was
 *    never moving in the first place, so the eye reads it as a sheet being pushed
 *    off a desk rather than as a cut between two shots.
 *  - `scribbleWipe`/`scribbleWipeLeft`/`scribbleWipeUp`/`scribbleWipeDown`: the
 *    next scene is UNCOVERED behind a hand-drawn edge that sweeps across the
 *    frame, with marker scribble running along the leading edge. Neither scene
 *    moves. The name gives the sweep's travel; bare `scribbleWipe` sweeps left
 *    to right.
 *
 *    Every other transition here is a camera or a sheet of paper: something is
 *    faded, moved or taken away. This one is the HAND, which is why it belongs
 *    on drawn videos and reads as cheap trickery anywhere else. The edge is a
 *    fixed wobbly shape that translates across the frame rather than a shape
 *    regenerated per frame, because a wobble redrawn every frame boils, which
 *    looks like a rendering fault rather than like a drawn line.
 *  - `colorWipe`/`colorWipeLeft`/`colorWipeUp`/`colorWipeDown`: three bold flat
 *    bands, slightly skewed, sweep across and COVER the outgoing scene, then
 *    sweep on and uncover the incoming one. The motion-graphics wipe (Vyond,
 *    Powtoon): the punctuation before and after a kinetic-type beat, in that
 *    scene's own colour so the block that covers the frame is the ground the
 *    next scene is already standing on. The name gives the sweep's travel;
 *    bare `colorWipe` sweeps left to right. */
export type SceneTransition = {
  kind: 'crossfade' | 'slideDown' | 'slideUp' | 'slideLeft' | 'slideRight'
      | 'pushUp' | 'pushDown' | 'pushLeft' | 'pushRight'
      | 'travelOffUp' | 'travelOffDown' | 'travelOffLeft' | 'travelOffRight'
      | 'scribbleWipe' | 'scribbleWipeLeft' | 'scribbleWipeUp' | 'scribbleWipeDown'
      | 'colorWipe' | 'colorWipeLeft' | 'colorWipeUp' | 'colorWipeDown'
      | 'morph';
  durationMs: number;
  /** `colorWipe*` only: the block colour (hex). The leading bands are a lighter and a darker
   *  tint of it. Missing = the default brand violet. */
  color?: string;
};

/** Multi-scene container. Artboard is shared across all scenes. */
export type Project = {
  artboard: Artboard;
  diagrams: Diagram[];
  sceneNames?: string[];
  /** Per-boundary transitions. Index i applies between scene i and scene i+1.
   *  `null` or missing index = hard cut. Length should be diagrams.length - 1. */
  transitions?: (SceneTransition | null)[];
  /** Ambient "floating on water" idle bob applied to all non-text nodes at
   *  render time. Off by default; opt-in per project. */
  floatEnabled?: boolean;
  /** Per-scene float opt-out (parallel to scenes): these scene indices stay static. */
  floatOffScenes?: boolean[];
  /** Per-scene float opt-IN (parallel to scenes): these scenes float even when the
   *  global toggle is off. Takes precedence over floatOffScenes. */
  floatOnScenes?: boolean[];
  /** Motion sound-effects pack id ('off' / 'soft' / 'playful' / …) — so exports can mux SFX. */
  sfxPack?: string;
  /** Hand-drawn (rough.js) rendering for ALL nodes/edges — a View toggle.
   *  Off by default (clean vector); when on the renderers force
   *  `rough = sketchMode || node.rough`. Persisted so reload + export match. */
  sketchMode?: boolean;
  /** On-screen captions: burn the active step's narration as a lower-third. On by
   *  default; persisted so reload + export match. */
  showCaptions?: boolean;
  /** Look of the caption lower-third (font scale / colors / opacity). */
  captionStyle?: CaptionStyle;
  /** Reserved talking-head zone (artboard-logical coords) emitted by the
   *  storyboard backend in presenter mode. The export draws this as a fixed
   *  overlay; absent unless presenter mode is on. */
  presenterZone?: { x: number; y: number; w: number; h: number };
  /** Talking-head presenter that fills `presenterZone`. Source-agnostic: the
   *  `media` clip is composited the same way whether it came from an AI avatar
   *  job or a user-supplied recording. Absent/disabled → the zone shows its
   *  placeholder. */
  presenter?: Presenter;
};

/** How the presenter clip is produced. `avatar` = AI-generated talking head
 *  (lip-synced to the narration audio); `video` = a user recording/upload. */
export type PresenterSource = 'avatar' | 'video';

export type Presenter = {
  enabled: boolean;
  source: PresenterSource;
  /** Mask applied within `presenterZone`: full band (rounded rect) or a
   *  circular "camera bubble". Default 'band'. */
  shape?: 'band' | 'bubble';
  /** The resolved clip composited into the zone. Same shape regardless of
   *  source — this is the extensibility seam. Absent until generated/attached. */
  media?: { url: string; mediaType: 'image' | 'video'; posterUrl?: string };
  /** Which audio track wins. `narration` (default) keeps the existing TTS
   *  voiceover (an avatar is lip-synced to it and itself silent); `media` uses
   *  the clip's own audio (a user recording); `mute` drops both. */
  audio?: 'narration' | 'media' | 'mute';
  /** Avatar provenance, so a clip can be (re)generated. */
  avatar?: { provider?: string; faceImageUrl?: string; voiceId?: string };
};

// Default label padding: 0 for asset nodes (gap between icon/image and label),
// 10 for shape nodes (text inset from node edge)
export function isAssetNode(node: { kind?: string; imageData?: any; asset?: { type?: string } }): boolean {
  return node.kind === 'icon' || node.kind === 'svg' || node.kind === 'lottie'
    || !!node.imageData
    || (!!node.asset && (node.asset.type === 'icon' || node.asset.type === 'lottie' || node.asset.type === 'image' || node.asset.type === 'svg'));
}

export function getDefaultLabelPadding(node: { kind?: string; imageData?: any; asset?: { type?: string } }): number {
  return isAssetNode(node) ? 0 : 10;
}

