/**
 * The heads-up display around him: dust hanging in the air, rings turning
 * around the orb, and the flashes that mark something happening.
 *
 * A layer of its own, over the field and under the chrome, and it never
 * touches the field's particles. That is the line this file is careful not
 * to cross: the field comes to a real stop in silence (`field.test.mjs`
 * holds its drift at exactly zero), and that stillness is still his. What
 * moves at rest is the room around him -- slow enough to read as depth, not
 * as him fidgeting.
 *
 * It costs frames a phone also needs for the field, so it is graded:
 *
 *   completo    dust, rings, flashes
 *   leve        a third of the dust
 *   desligado   the rings, drawn once and left still
 *
 * and it steps itself down when frames run long. In the camera mode only the
 * flashes run: the video and the hand model need the GPU, and anything in
 * front of the room is in front of the hands.
 */

export const EFFECTS = ['completo', 'leve', 'desligado'];

/** Dust at each level. A few hundred squares is nothing to fill; it is the
 *  field under it that costs. */
const DUST = { completo: 260, leve: 90, desligado: 0 };

/** Same perspective as the field's, so the dust sits in the same space. */
const CAMERA = 3.2;

/** Seconds of long frames before stepping down, and what "long" means. */
const SLOW_FRAME = 0.022;
const SLOW_FOR = 2;

/** The middle ring's segments, in radians. */
const SEGMENTS = [[0, 0.32], [0.4, 0.46], [0.54, 0.9], [1.05, 1.18], [1.3, 1.95], [2.1, 2.2], [2.5, 3.6], [3.8, 4.1], [4.3, 5.4], [5.6, 5.9]];

/** How long a flash lasts. */
const BURST = 0.75;

/**
 * What to draw, from what was asked for and where.
 *
 * @param {{effects?: string, reduced?: boolean, lens?: boolean}} options
 * @returns {{dust: number, rings: boolean, motion: boolean, flashes: boolean}}
 */
export function quality({ effects = 'completo', reduced = false, lens = false } = {}) {
  const level = EFFECTS.includes(effects) ? effects : 'completo';
  if (reduced || level === 'desligado') {
    return { dust: 0, rings: !lens, motion: false, flashes: false };
  }
  if (lens) return { dust: 0, rings: false, motion: true, flashes: true };
  return { dust: DUST[level], rings: true, motion: true, flashes: true };
}

/**
 * Points hanging in a box around him, the same every time for the same seed.
 *
 * @returns {Float32Array} x, y, z, size -- four per point.
 */
export function dust(count, seed = 7) {
  let state = (seed | 0) || 1;
  const random = () => {
    state = (Math.imul(state, 16807) % 2147483647 + 2147483647) % 2147483647;
    return state / 2147483647;
  };
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = (random() * 2 - 1) * 1.7;
    out[i * 4 + 1] = (random() * 2 - 1) * 1.3;
    out[i * 4 + 2] = (random() * 2 - 1) * 1.7;
    out[i * 4 + 3] = 0.5 + random() * 1.2;
  }
  return out;
}

/**
 * One point of dust on the glass: turned about the vertical axis, then the
 * perspective divide. `scale` is how many pixels a unit is.
 */
export function projectDust(x, y, z, angle, width, height, scale) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = x * c + z * s;
  const rz = -x * s + z * c;
  const gap = CAMERA - rz;
  if (gap < 0.3) return { visible: false, x: 0, y: 0, k: 0, depth: rz };
  const k = CAMERA / gap;
  const px = width / 2 + rx * scale * k;
  const py = height / 2 + y * scale * k;
  const visible = px >= 0 && px <= width && py >= 0 && py <= height;
  return { visible, x: px, y: py, k, depth: rz };
}

/**
 * The rings, as numbers: how far out, how turned, how bright.
 *
 * Thinking spins them up and brings the sweep; speaking pushes them out with
 * the level. A face gets them at a third -- around a face they are a halo,
 * around an orb they are the machine.
 */
export function rings({ thinking = false, level = 0, face = false, t = 0, motion = true } = {}) {
  const speed = motion ? (thinking ? 3.2 : level > 0.02 ? 1.7 : 1) : 0;
  const push = 1 + Math.min(1, Math.max(0, level)) * 0.07;
  const alpha = (0.5 + Math.min(1, level) * 0.4 + (thinking ? 0.15 : 0)) * (face ? 0.32 : 1);
  return {
    push,
    alpha,
    sweep: thinking && motion,
    turns: [t * 0.09 * speed, -t * 0.05 * speed, t * 0.24 * speed, t * 0.03 * speed],
  };
}

/** A short buzz, where the phone has one. iOS has no vibrate: this is a no-op there. */
export function buzz(pattern = 12, nav = globalThis.navigator) {
  try {
    nav?.vibrate?.(pattern);
  } catch {
    /* Some browsers throw rather than refuse. Nothing to do either way. */
  }
}

/**
 * The start-up sequence: once per session, skipped for reduced motion.
 *
 * The overlay is markup in `index.html` and CSS animation in `styles.css`;
 * this only decides whether it plays and takes it out afterwards. It never
 * takes a tap -- `pointer-events: none` -- so nothing under it waits for it.
 *
 * @returns {boolean} Whether it played.
 */
export function boot(node, { storage = safeSession(), reduced = false, win = globalThis } = {}) {
  if (!node) return false;
  let seen = false;
  try {
    seen = storage?.getItem('jarvis.boot') === '1';
    storage?.setItem('jarvis.boot', '1');
  } catch {
    /* Storage refused: play it, it is only a second and a half. */
  }
  if (seen || reduced) {
    node.remove?.();
    return false;
  }
  node.hidden = false;
  const done = () => node.remove?.();
  node.addEventListener?.('animationend', (event) => {
    if (event.target === node) done();
  });
  // Any touch skips it; and a timer, in case the animation never ends
  // (a backgrounded tab does not run it).
  win.addEventListener?.('pointerdown', () => node.classList?.add('skip'), { once: true, capture: true });
  win.setTimeout?.(done, 4000);
  return true;
}

function safeSession() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export class Hud {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {{cx:number, cy:number, scale:number, level:number, thinking:boolean, targetShape?:string}} o.field
   *   Read, never written: where he is and what he is doing.
   * @param {string} [o.effects]
   */
  constructor({ canvas, field, effects = 'completo', win = globalThis }) {
    this.canvas = canvas;
    this.field = field;
    this.win = win;
    this.ctx = canvas.getContext?.('2d') ?? null;
    this.effects = effects;
    this.mode = 'home';
    this.reduced = false;
    const query = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (query) {
      this.reduced = query.matches;
      query.addEventListener?.('change', (event) => {
        this.reduced = event.matches;
        this._restart();
      });
    }
    this.points = dust(DUST.completo);
    this.angle = 0;
    this.time = 0;
    this.level = 0;
    this.bursts = [];
    /** Stepped down from long frames: 0 none, 1 less dust, 2 no dust. */
    this.strain = 0;
    this.slowFor = 0;
    this.frameTime = 0;
    this.raf = 0;
    this.last = 0;

    win.document?.addEventListener?.('visibilitychange', () => {
      if (win.document.hidden) this._halt();
      else this._restart();
    });
  }

  /** What to draw right now. */
  get plan() {
    const base = quality({ effects: this.effects, reduced: this.reduced, lens: this.mode === 'lens' });
    const dustScale = this.strain === 0 ? 1 : this.strain === 1 ? 0.35 : 0;
    return { ...base, dust: Math.round(base.dust * dustScale) };
  }

  setEffects(effects) {
    this.effects = EFFECTS.includes(effects) ? effects : 'completo';
    this.strain = 0;
    this._restart();
  }

  /** `home`, `lens` (only flashes) or `xr` (nothing: the session has the screen). */
  setMode(mode) {
    this.mode = mode;
    this.canvas.dataset.mode = mode;
    this._restart();
  }

  resize() {
    const ratio = Math.min(this.win.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round((this.win.innerWidth || 1) * ratio));
    const height = Math.max(1, Math.round((this.win.innerHeight || 1) * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ratio = ratio;
    this._restart();
  }

  start() {
    this.resize();
  }

  /** A ring of light where something was made, in CSS pixels. */
  burst(x, y, hue = 190) {
    if (!this.plan.flashes) return;
    this.bursts.push({ x, y, hue, t: 0 });
    this._restart();
  }

  _halt() {
    this.win.cancelAnimationFrame?.(this.raf);
    this.raf = 0;
  }

  _restart() {
    this._halt();
    this.last = 0;
    if (this.mode === 'xr') {
      this._clear();
      return;
    }
    const plan = this.plan;
    const animated = plan.motion && (plan.dust > 0 || plan.rings);
    if (animated || this.bursts.length > 0) {
      this.raf = this.win.requestAnimationFrame?.((now) => this._tick(now)) ?? 0;
    } else {
      this.draw(0);
    }
  }

  _tick(now) {
    const step = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this._pace(step);
    this.draw(step);
    const plan = this.plan;
    if ((plan.motion && (plan.dust > 0 || plan.rings)) || this.bursts.length > 0) {
      this.raf = this.win.requestAnimationFrame((next) => this._tick(next));
    } else {
      this.raf = 0;
      this.draw(0);
    }
  }

  /** Step down when frames run long for a while. Never back up by itself:
   *  a phone that struggled once will struggle again. */
  _pace(step) {
    if (!step) return;
    this.frameTime += (step - this.frameTime) * 0.1;
    this.slowFor = this.frameTime > SLOW_FRAME ? this.slowFor + step : 0;
    if (this.slowFor > SLOW_FOR && this.strain < 2) {
      this.strain += 1;
      this.slowFor = 0;
    }
  }

  _clear() {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** One picture. Public so a test can draw without a clock. */
  draw(step = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const plan = this.plan;
    const { width, height } = this.canvas;
    const ratio = this.ratio || 1;
    this.time += step;
    ctx.clearRect(0, 0, width, height);

    const field = this.field ?? {};
    const target = Number.isFinite(field.level) ? field.level : 0;
    this.level += (target - this.level) * Math.min(1, step * 10 || 1);
    const cx = Number.isFinite(field.cx) ? field.cx : width / 2;
    const cy = Number.isFinite(field.cy) ? field.cy : height / 2;
    const scale = Number.isFinite(field.scale) ? field.scale : Math.min(width, height) * 0.4;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (plan.dust > 0) this._dust(ctx, plan.dust, step, width, height, scale, ratio);
    if (plan.rings) {
      const base = Math.min(scale * 0.8, width * 0.44);
      this._rings(ctx, cx, cy, base, ratio, plan.motion);
    }
    this._bursts(ctx, step, ratio);
    ctx.restore();
  }

  _dust(ctx, count, step, width, height, scale, ratio) {
    this.angle += step * 0.045;
    const drift = this.time * 0.02;
    const points = this.points;
    const n = Math.min(count, points.length / 4);
    for (let i = 0; i < n; i += 1) {
      // A slow rise, wrapping: motes in a beam of light, not a snow globe.
      let y = points[i * 4 + 1] - drift * (0.5 + (i % 5) * 0.2);
      y = ((y + 1.3) % 2.6 + 2.6) % 2.6 - 1.3;
      const p = projectDust(points[i * 4], y, points[i * 4 + 2], this.angle, width, height, scale * 0.9);
      if (!p.visible) continue;
      // Near is bigger and brighter; far fades into the dark.
      const near = (p.depth + 1.7) / 3.4;
      const alpha = 0.08 + near * 0.42;
      // Capped: a mote close to the lens is still a mote, not a square.
      const size = Math.max(1, Math.min(2.4 * ratio, points[i * 4 + 3] * Math.min(p.k, 1.4) * ratio * (0.5 + near * 0.6)));
      ctx.fillStyle = `rgba(${near > 0.8 ? '220, 250, 255' : '92, 225, 255'}, ${alpha.toFixed(3)})`;
      ctx.fillRect(p.x, p.y, size, size);
    }
  }

  _rings(ctx, cx, cy, base, ratio, motion) {
    const field = this.field ?? {};
    const r = rings({
      thinking: Boolean(field.thinking),
      level: this.level,
      face: field.targetShape === 'face',
      t: this.time,
      motion,
    });
    const radius = base * r.push;
    const a = r.alpha;
    const arc = (alpha) => `rgba(92, 225, 255, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

    ctx.lineCap = 'round';

    // Outer: a fine dotted circle.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(r.turns[0]);
    ctx.setLineDash?.([2 * ratio, 7 * ratio]);
    ctx.strokeStyle = arc(a * 0.45);
    ctx.lineWidth = 1 * ratio;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Middle: segments, and one warm marker riding them.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(r.turns[1]);
    ctx.setLineDash?.([]);
    // The glow is the same segments again, wide and faint, under the line.
    // Not `shadowBlur`: that is a blur per stroke, and measured here it took
    // the whole page from 60 frames a second to 12.
    for (const [width, alpha] of [[7, 0.14], [2, 0.8]]) {
      ctx.lineWidth = width * ratio;
      ctx.strokeStyle = arc(a * alpha);
      ctx.beginPath();
      for (const [from, to] of SEGMENTS) {
        ctx.moveTo(Math.cos(from) * radius, Math.sin(from) * radius);
        ctx.arc(0, 0, radius, from, to);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255, 181, 71, ${Math.min(1, a * 1.1).toFixed(3)})`;
    ctx.lineWidth = 2.5 * ratio;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 4.62, 4.76);
    ctx.stroke();
    ctx.restore();

    // Inner: ticks, the other way round.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(r.turns[2] * -0.4);
    ctx.setLineDash?.([1 * ratio, 8 * ratio]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = arc(a * 0.5);
    ctx.lineWidth = 6 * ratio;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // An orbit, tilted: the one line that says "three dimensions".
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.28);
    ctx.setLineDash?.([40 * ratio, 10 * ratio, 4 * ratio, 10 * ratio]);
    ctx.lineDashOffset = -r.turns[3] * 400 * ratio;
    ctx.strokeStyle = arc(a * 0.4);
    ctx.lineWidth = 1 * ratio;
    ctx.beginPath();
    ctx.ellipse?.(0, 0, radius * 1.16, radius * 0.24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Thinking: a sweep going round, its tail fading behind it.
    if (r.sweep) {
      ctx.save();
      ctx.translate(cx, cy);
      const head = this.time * 2.4;
      ctx.lineWidth = 3 * ratio;
      ctx.setLineDash?.([]);
      for (let i = 0; i < 14; i += 1) {
        ctx.strokeStyle = arc((1 - i / 14) * 0.6);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.03, head - (i + 1) * 0.06, head - i * 0.06);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _bursts(ctx, step, ratio) {
    if (this.bursts.length === 0) return;
    const left = [];
    for (const burst of this.bursts) {
      burst.t += step;
      const t = burst.t / BURST;
      if (t >= 1) continue;
      left.push(burst);
      const ease = 1 - (1 - t) ** 3;
      const x = burst.x * ratio;
      const y = burst.y * ratio;
      const fade = 1 - t;
      ctx.save();
      ctx.setLineDash?.([]);
      ctx.strokeStyle = `hsla(${burst.hue}, 95%, 70%, ${fade.toFixed(3)})`;
      ctx.lineWidth = 2 * ratio;
      ctx.beginPath();
      ctx.arc(x, y, (14 + ease * 70) * ratio, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1 * ratio;
      ctx.beginPath();
      ctx.arc(x, y, (6 + ease * 44) * ratio, 0, Math.PI * 2);
      ctx.stroke();
      // Sparks thrown outwards.
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * Math.PI * 2 + burst.hue;
        const inner = (18 + ease * 60) * ratio;
        const outer = inner + 10 * fade * ratio;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
    this.bursts = left;
  }
}
