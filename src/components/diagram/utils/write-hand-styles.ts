// Compatibility surface for the write-on hand list. The catalogue itself moved to
// hand-registry.ts, which covers carrying hands too and can take hands added at runtime.
//
// This file exists because several places import the style list by this name; new code should
// import from './hand-registry' directly. Both are light and side-effect-free — neither pulls in
// any image bytes, which is the whole reason the split exists.
export {
  DEFAULT_WRITE_HAND_STYLE,
  WRITE_HAND_STYLES,
  listHands,
  type WriteHandStyle,
} from './hand-registry';
