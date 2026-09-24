/**
 * The holograms, without augmented reality.
 *
 * Before this, a hologram only existed inside a WebXR session: "cria um cubo"
 * on a phone without ARCore -- or on any computer -- answered "Fiz um cubo"
 * and showed nothing at all. A confident sentence about an invisible object is
 * worse than a refusal.
 *
 * So the same scene is also drawn over the field, by the same painter the
 * session uses, from a camera a little above and behind the origin that steps
 * back until everything fits (see `camera` and `fit` in `hands.js`). It
 * appears when there is something to show and goes when the room is empty,
 * and while it is up the glass is the hand.
 */

import { paint } from './ar.js';
import { Gestures, camera, fit } from './hands.js';

export class Stage {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas Shared with the AR session.
   * @param {import('./holo.js').Scene} options.scene
   * @param {HTMLElement} [options.bar] Its controls, shown and hidden with it.
   * @param {(text: string) => void} [options.onStatus]
   * @param {() => boolean} [options.busy] True while something else (the AR
   *   session) owns the canvas; the stage then neither draws nor listens.
   */
  constructor({ canvas, scene, bar = null, onStatus = () => {}, busy = () => false, win = globalThis }) {
    this.canvas = canvas;
    /** Its controls, shown and hidden with it. */
    this.bar = bar;
    this.scene = scene;
    this.onStatus = onStatus;
    this.busy = busy;
    this.win = win;
    this.shown = false;
    /** Held up by the camera mode: shown even when empty, so the first
     *  object made by hand has somewhere to appear, and without the stage's
     *  own buttons, which the camera mode replaces. */
    this.pinned = false;
    /** Set by whoever else is moving things (a hand on the camera), to stop
     *  the view refitting under them the way a finger on the glass does. */
    this.holding = false;
    this.frameId = 0;
    this.lastTime = 0;
    /** The camera, refitted as the room changes: see `hands.fit`. */
    this.cam = camera();

    this.hands = new Gestures({
      items: () => this.scene.items,
      size: () => this._size(),
      view: () => this.cam,
      onSelect: (item) => {
        if (item) this.onStatus(`Segurando ${article(item.shape)} ${item.shape}. Arraste, pince para girar ou escalar, toque duas vezes para apagar.`);
      },
      onRemove: (item) => {
        this.scene.remove(item.id);
        this.onStatus(`Apaguei ${article(item.shape)} ${item.shape}.`);
        if (this.scene.items.length === 0) this.hide();
      },
    });

    this._bind();
  }

  _bind() {
    const point = (event) => ({ id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp });
    const on = (type, handler) => this.canvas.addEventListener(type, (event) => {
      if (!this.shown || this.busy()) return;
      event.preventDefault();
      handler(point(event), event);
    });
    on('pointerdown', (p, event) => {
      this.canvas.setPointerCapture?.(event.pointerId);
      this.hands.down(p);
    });
    on('pointermove', (p) => this.hands.move(p));
    on('pointerup', (p) => this.hands.up(p));
    on('pointercancel', (p) => this.hands.cancel(p));
  }

  _size() {
    return { width: this.win.innerWidth || 1, height: this.win.innerHeight || 1 };
  }

  /**
   * Step back (or in) so everything fits. Eased, so a new object arriving
   * pulls the view back smoothly rather than jumping; and frozen while a
   * finger is down, or the object would slide out from under it as the view
   * refits around the drag.
   */
  refit(snap = false) {
    if (this.hands.fingers.size > 0 || this.holding) return;
    const { width, height } = this._size();
    const target = fit(this.scene.items, width, height).back;
    const back = snap ? target : this.cam.back + (target - this.cam.back) * 0.12;
    if (Math.abs(back - this.cam.back) > 1e-4) this.cam = camera(back);
  }

  /** Match the canvas to the screen, in device pixels. */
  resize() {
    const ratio = Math.min(this.win.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round((this.win.innerWidth || 1) * ratio);
    this.canvas.height = Math.round((this.win.innerHeight || 1) * ratio);
  }

  /** Hold the stage up (or let it go), whatever is in the room. */
  pin(on) {
    this.pinned = on;
    if (on) {
      this.show();
      if (this.bar) this.bar.hidden = true;
    } else if (this.scene.items.length === 0) {
      this.hide();
    } else if (this.bar && this.shown) {
      this.bar.hidden = false;
    }
  }

  /** Bring it up, if there is anything to show and nobody else has the canvas. */
  show() {
    if (this.busy() || (this.scene.items.length === 0 && !this.pinned)) return false;
    if (!this.shown) {
      this.shown = true;
      this.resize();
      this.refit(true);
      this.canvas.hidden = false;
      this.canvas.dataset.stage = 'on';
      if (this.bar) this.bar.hidden = this.pinned;
      this.lastTime = 0;
      this.frameId = this.win.requestAnimationFrame?.((time) => this._frame(time)) ?? 0;
    }
    return true;
  }

  /** Put it away. The objects stay in the scene for next time. */
  hide() {
    if (!this.shown || this.pinned) return;
    this.shown = false;
    this.win.cancelAnimationFrame?.(this.frameId);
    delete this.canvas.dataset.stage;
    if (this.bar) this.bar.hidden = true;
    this.hands.selected = null;
    // Only hide the canvas if the session is not using it right now.
    if (!this.busy()) this.canvas.hidden = true;
  }

  _frame(time) {
    if (!this.shown) return;
    this.frameId = this.win.requestAnimationFrame((next) => this._frame(next));
    if (this.busy()) return;
    const step = this.lastTime ? (time - this.lastTime) / 1000 : 0;
    this.lastTime = time;
    this.scene.frame(step);
    this.hands.prune();
    this.refit();
    this.draw();
  }

  /** One picture. Public so a test can draw without a clock. */
  draw() {
    const context = this.canvas.getContext?.('2d');
    if (!context) return;
    paint(context, this.canvas.width, this.canvas.height, this.scene, this.cam.matrix, {
      selected: this.hands.selected,
      materialize: true,
    });
  }
}

const FEMININE = new Set(['esfera', 'piramide']);
function article(shape) {
  return FEMININE.has(shape) ? 'a' : 'o';
}
