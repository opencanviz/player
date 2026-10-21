/**
 * `<canviz-player>`: an explainer on a page with no code.
 *
 *   <canviz-player src="explainer.canviz" autoplay loop></canviz-player>
 *
 * Attributes: `src` (URL of a document), `autoplay`, `loop`, `controls` (play button and
 * scrubber, on unless set to "false"), `captions` (on unless "false"). Set `.doc` to play a
 * document already in memory. Methods: play(), pause(), seek(ms). Events: `ready`, `ended`,
 * `error` (detail is the Error).
 */
import { createPlayer, type CanvizDocument, type ProjectRenderer } from './index';

export * from './index';

const STYLE = `
  :host { display: block; position: relative; contain: content; }
  .stage { position: relative; width: 100%; cursor: pointer; }
  canvas { display: block; width: 100%; height: 100%; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 2px 0; font: 12px/1 system-ui, sans-serif; color: inherit; }
  .bar[hidden] { display: none; }
  button { all: unset; cursor: pointer; width: 22px; text-align: center; }
  button:focus-visible, input:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  input { flex: 1; margin: 0; }
  .time { font-variant-numeric: tabular-nums; opacity: .7; }
`;

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class CanvizPlayerElement extends HTMLElement {
  static observedAttributes = ['src', 'controls', 'captions'];

  private canvas: HTMLCanvasElement;
  private stage: HTMLDivElement;
  private bar: HTMLDivElement;
  private btn: HTMLButtonElement;
  private scrub: HTMLInputElement;
  private time: HTMLSpanElement;
  private renderer: ProjectRenderer | null = null;
  private document_: CanvizDocument | null = null;
  private t = 0;
  private playing = false;
  private raf = 0;
  private last = 0;
  private visible = true;
  private builtFor = 0;
  private loadId = 0;
  private resizeTimer = 0;
  private ro: ResizeObserver;
  private io: IntersectionObserver;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="stage" part="stage"><canvas part="canvas"></canvas></div>
      <div class="bar" part="controls"><button aria-label="Play">▶</button><input type="range" min="0" step="10" value="0" aria-label="Seek"><span class="time"></span></div>`;
    this.stage = root.querySelector('.stage')!;
    this.canvas = root.querySelector('canvas')!;
    this.bar = root.querySelector('.bar')!;
    this.btn = root.querySelector('button')!;
    this.scrub = root.querySelector('input')!;
    this.time = root.querySelector('.time')!;
    this.btn.onclick = this.stage.onclick = () => (this.playing ? this.pause() : this.play());
    this.scrub.oninput = () => this.seek(Number(this.scrub.value));
    // The renderer draws at a fixed pixel size; rebuild it only when the element grows well past
    // what it was built for, so a resize stays sharp without re-preparing on every pixel.
    this.ro = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        if (this.document_ && this.wantedHeight() > this.builtFor * 1.25) void this.build();
      }, 200);
    });
    // Explainers scrolled out of view don't animate.
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible && this.playing) this.loop();
    });
  }

  connectedCallback() {
    this.ro.observe(this);
    this.io.observe(this);
  }

  disconnectedCallback() {
    this.pause();
    this.ro.disconnect();
    this.io.disconnect();
  }

  attributeChangedCallback(name: string) {
    if (name === 'src') void this.fetchSrc();
    else this.syncControls();
  }

  get doc(): CanvizDocument | null {
    return this.document_;
  }

  set doc(d: CanvizDocument | null) {
    this.document_ = d;
    if (d) void this.build();
  }

  get duration(): number {
    return this.renderer?.totalDurationMs ?? 0;
  }

  get currentTime(): number {
    return this.t;
  }

  play() {
    if (!this.renderer || this.duration === 0) return;
    if (this.t >= this.duration) this.t = 0;
    this.playing = true;
    this.syncControls();
    this.loop();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncControls();
  }

  /** Jump to `ms` and draw that frame, with any video clips seeked to it. */
  async seek(ms: number) {
    this.t = Math.max(0, Math.min(ms, this.duration));
    const r = this.renderer;
    if (!r) return;
    await r.prepareFrameAt(this.t);
    if (r === this.renderer) this.draw();
  }

  private async fetchSrc() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
      this.doc = await res.json();
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: e }));
    }
  }

  private wantedHeight(): number {
    const a = this.renderer ? this.renderer.pxW / this.renderer.pxH : 16 / 9;
    const w = this.clientWidth || 640;
    return Math.min(2160, Math.max(360, Math.round((w / a) * (window.devicePixelRatio || 1))));
  }

  private async build() {
    const id = ++this.loadId;
    const doc = this.document_!;
    try {
      const height = this.wantedHeight();
      const r = await createPlayer(this.canvas, doc, {
        targetHeight: height,
        showCaptions: this.getAttribute('captions') !== 'false',
        progressiveImages: {},
      });
      if (id !== this.loadId) return;
      this.renderer = r;
      this.builtFor = height;
      this.stage.style.aspectRatio = `${r.pxW} / ${r.pxH}`;
      this.scrub.max = String(r.totalDurationMs);
      this.t = Math.min(this.t, r.totalDurationMs);
      this.draw();
      // Pictures streamed in behind the first frame: repaint once they're all here.
      void r.imagesReady.then(() => { if (r === this.renderer && !this.playing) this.draw(); });
      this.dispatchEvent(new Event('ready'));
      if (this.hasAttribute('autoplay') && !this.playing) this.play();
    } catch (e) {
      if (id === this.loadId) this.dispatchEvent(new CustomEvent('error', { detail: e }));
    }
  }

  private loop() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing || !this.visible) return;
      this.t += now - this.last;
      this.last = now;
      if (this.t >= this.duration) {
        if (this.hasAttribute('loop')) this.t %= this.duration;
        else {
          this.t = this.duration;
          this.draw();
          this.pause();
          this.dispatchEvent(new Event('ended'));
          return;
        }
      }
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw() {
    if (!this.renderer) return;
    // The last boundary evaluates past the final step; hold its last frame instead.
    this.renderer.renderFrameAt(Math.min(this.t, Math.max(0, this.duration - 1)));
    this.syncControls();
  }

  private syncControls() {
    this.bar.hidden = this.getAttribute('controls') === 'false';
    this.btn.textContent = this.playing ? '❚❚' : '▶';
    this.btn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    this.scrub.value = String(this.t);
    this.time.textContent = `${fmt(this.t)} / ${fmt(this.duration)}`;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('canviz-player')) {
  customElements.define('canviz-player', CanvizPlayerElement);
}
