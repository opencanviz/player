/**
 * Global sketch-mode toggle (the View-panel "Sketch style" switch).
 *
 * Sketch/hand-drawn rendering is a per-project VIEW setting, not a generation
 * choice: generated nodes are clean vector, and flipping this re-renders every
 * node/edge hand-drawn at render time (`rough = sketchMode || node.rough`). It's
 * a module-level flag rather than threaded through every render-options object
 * because it's genuinely global to the editor session — both the live canvas
 * and the (same-page) export read it. React state in the editor is the source
 * of truth and mirrors here via setGlobalSketchMode; the value is persisted on
 * the project so reload + export stay consistent.
 *
 * It returns a stable value during any single render/export run (set once
 * before frames), so frame output stays deterministic.
 */
let _sketchMode = false;

export const setGlobalSketchMode = (v: boolean): void => {
  _sketchMode = !!v;
};

export const getGlobalSketchMode = (): boolean => _sketchMode;
