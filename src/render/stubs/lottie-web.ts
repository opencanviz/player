/**
 * lottie-web stub for the headless render bundle. Lottie playback is not used on the
 * canvas render path (kept only behind the unused lottie-utils helper), and lottie-web's
 * DOM/SVG init is brittle under headless Chromium. esbuild aliases 'lottie-web' to this
 * no-op so nothing in the render path pulls in the real library.
 */
const lottie = {
  loadAnimation: () => ({
    goToAndStop: () => {},
    destroy: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  setQuality: () => {},
};
export default lottie;
