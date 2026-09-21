/**
 * A field of particles that settles into shapes and breathes with a voice.
 *
 * Three ideas carry the whole thing:
 *
 *  1. Every particle owns a fixed slot index. Each shape answers "where does
 *     slot i sit?", so morphing is a straight interpolation of two answers and
 *     a particle keeps its identity as the face assembles.
 *  2. Shapes carry more than position. Brightness, size and colour come from
 *     the shape's own geometry — for the face, from a depth field and a light
 *     — which is what lets a cloud of dots read as an anatomy rather than a
 *     silhouette.
 *  3. Motion is driven by the real amplitude of the voice. Silence is not a
 *     slower animation but zero displacement, so the field comes to an actual
 *     stop.
 */

import { ROLE, sampleFace } from './face.js';
import { sampleOrb } from './orb.js';

const TAU = Math.PI * 2;

export { ROLE, sampleFace, sampleOrb };

/**
 * Deterministic PRNG (mulberry32).
 *
 * Layout must be identical on every load: a particle that jumps to a new slot
 * on reload reads as a glitch, and a reproducible field is far easier to
 * eyeball for regressions.
 */
export function makeRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SHAPES = { orb: sampleOrb, face: sampleFace };

/**
 * Move a hue toward a target along the shortest arc of the colour wheel.
 *
 * Hue is circular, so a plain lerp from 350° to 10° would run the long way
 * through the whole spectrum. This wraps the difference into [-180, 180] first.
 */
function stepHue(current, target, rate) {
  const diff = ((target - current + 540) % 360) - 180;
  if (Math.abs(diff) < 0.1) return target;
  return (current + diff * rate + 360) % 360;
}

/**
 * The animated field.
 *
 * Owns its canvas, resizes with it, and renders on demand. It knows nothing
 * about audio plumbing or the network: callers push a level in, which keeps
 * the visual testable with synthetic input.
 */
export class ParticleField {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.count] Particle count. The face needs several
   *   thousand before the features resolve; past ~9k on a phone, frame time
   *   grows faster than the likeness improves.
   * @param {string} [options.shape] Starting shape, a key of SHAPES.
   * @param {number} [options.restDrift] Motion left when the voice is silent.
   *   Zero by design — the field is meant to stop, not idle.
   * @param {number} [options.hue] Base hue; accents sit opposite it.
   */
  constructor(canvas, options = {}) {
    const {
      count = 6500,
      shape = 'orb', // he wears a face only on request
      restDrift = 0,
      hue = 192,
      accentHue = 38,
    } = options;

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.count = count;
    this.restDrift = restDrift;
    // Hue is animated, not fixed: switching the active agent recolours the
    // whole field, and a hard cut between two identities reads as a glitch. The
    // rendered hue chases the target along the shortest arc every frame.
    this.hue = hue;
    this.accentHue = accentHue;
    this.targetHue = hue;
    this.targetAccentHue = accentHue;

    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    // Per-particle phase so the shimmer does not pulse in lockstep.
    this.phase = new Float32Array(count);

    const random = makeRandom(0x5eed);
    for (let i = 0; i < count; i += 1) this.phase[i] = random() * TAU;

    this.shapes = {};
    for (const [name, sampler] of Object.entries(SHAPES)) {
      this.shapes[name] = sampler(count);
    }

    this.currentShape = shape;
    this.targetShape = shape;
    this.morph = 1; // 1 = fully on targetShape

    // Seed positions on the starting shape so the first frame is not a rush
    // inward from the origin.
    this.x.set(this.shapes[shape].xs);
    this.y.set(this.shapes[shape].ys);

    this.level = 0;
    this.smoothLevel = 0;
    this.spread = 0;
    this.smoothSpread = 0;
    this.thinking = false;
    this.thinkLevel = 0;
    this.time = 0;

    this.resize();
  }

  /** Match the backing store to the element's CSS size and pixel ratio. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    // Cap the ratio: a 3x buffer costs real frame time for detail no one can
    // see at this dot size.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    // The face is taller than wide, so height drives the fit.
    this.scale = Math.min(width * 0.56, height * 0.37);
    this.cx = width / 2;
    this.cy = height / 2;
    this.unit = Math.max(1, ratio);
  }

  /**
   * Begin morphing to another shape.
   *
   * @param {string} name Key of SHAPES.
   * @param {boolean} [immediate] Skip the transition.
   */
  setShape(name, immediate = false) {
    if (!this.shapes[name]) throw new Error(`unknown shape: ${name}`);
    if (name === this.targetShape && !immediate) return;
    this.currentShape = this.targetShape;
    this.targetShape = name;
    this.morph = immediate ? 1 : 0;
  }

  /**
   * Feed the field the voice's current loudness, and optionally its lip shape.
   *
   * Loudness alone opens the jaw, which makes every sound at a given volume
   * look the same. Lip spread is what separates them: a mouth saying "ee" is
   * wide and nearly closed, one saying "oo" is small and round, and loudness
   * cannot tell you which. Drivers that measure the spectrum supply it; the
   * rest pass nothing and the mouth stays at its neutral width.
   *
   * @param {number} level 0 for silence, 1 for peak.
   * @param {number} [spread] -1 rounded, 0 neutral, +1 spread.
   */
  setLevel(level, spread = 0) {
    this.level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    this.spread = Number.isFinite(spread) ? Math.min(1, Math.max(-1, spread)) : 0;
  }

  /**
   * Recolour the field to another agent's identity.
   *
   * Each agent owns a base hue and an accent that sits roughly opposite it. The
   * transition is handled in `frame()` so it eases over a beat rather than
   * cutting, which is what sells one agent handing the field to another.
   *
   * @param {number} hue Base hue, 0..360.
   * @param {number} [accentHue] Accent hue, 0..360.
   * @param {boolean} [immediate] Skip the transition.
   */
  setPalette(hue, accentHue, immediate = false) {
    if (Number.isFinite(hue)) this.targetHue = hue;
    if (Number.isFinite(accentHue)) this.targetAccentHue = accentHue;
    if (immediate) {
      this.hue = this.targetHue;
      this.accentHue = this.targetAccentHue;
    }
  }

  /**
   * Mark him as working on an answer.
   *
   * A deliberate third state, distinct from both silence and speech. Idle is
   * still — that contract does not bend — and speech is driven by measured
   * amplitude. Thinking is a slow breath the field takes on its own, so a wait
   * reads as attention rather than as a frozen screen.
   *
   * @param {boolean} value
   */
  setThinking(value) {
    this.thinking = Boolean(value);
  }

  /**
   * Advance the simulation and draw one frame.
   *
   * @param {number} dt Seconds since the previous frame.
   */
  frame(dt) {
    // Clamp: a backgrounded tab returns a huge dt, which would fling every
    // particle off screen on the first frame back.
    const step = Math.min(dt, 0.05);
    this.time += step;

    // Attack fast, release slow — speech should grab the field immediately and
    // let it settle gently, the way a voice actually decays.
    const rising = this.level > this.smoothLevel;
    this.smoothLevel += (this.level - this.smoothLevel) * (rising ? 0.45 : 0.08);
    if (this.smoothLevel < 0.002) this.smoothLevel = 0;
    // Lips are muscle: they cannot snap between shapes the way a spectrum
    // reading can, and an unsmoothed spread reads as a flutter.
    this.smoothSpread += (this.spread - this.smoothSpread) * 0.22;

    if (this.morph < 1) this.morph = Math.min(1, this.morph + step * 1.5);

    // Ease the palette toward the active agent along the shorter way round the
    // colour wheel, so cyan → violet never detours through the greens.
    this.hue = stepHue(this.hue, this.targetHue, 0.06);
    this.accentHue = stepHue(this.accentHue, this.targetAccentHue, 0.06);

    // Roughly one breath every three seconds — slow enough to read as thought
    // rather than as a pulse waiting to be dismissed. It fades in and out so
    // entering and leaving the state is never a jump.
    const wanted = this.thinking ? Math.sin(this.time * 2.1) * 0.5 + 0.5 : 0;
    this.thinkLevel += (wanted - this.thinkLevel) * 0.06;
    if (!this.thinking && this.thinkLevel < 0.004) this.thinkLevel = 0;
    // Speech always wins: once he answers, the breath stops competing.
    const breath = this.smoothLevel > 0.05 ? 0 : this.thinkLevel;

    const energy = this.smoothLevel;
    const from = this.shapes[this.currentShape];
    const to = this.shapes[this.targetShape];
    // Ease the morph so the face assembles rather than snapping.
    const m = this.morph >= 1 ? 1 : this.morph * this.morph * (3 - 2 * this.morph);
    const blended = m > 0 && m < 1;

    const { x, y, vx, vy, phase, ctx } = this;
    const scale = this.scale;
    const spread = 1 + energy * 0.05 + breath * 0.035;
    // How wide the mouth is held, and how wide the opening between the lips
    // is: "ee" stretches both, "oo" purses both.
    const lips = this.smoothSpread * energy;
    const lipWidth = 1 + lips * 0.2;
    const apertureWidth = 1 + lips * 0.32;

    // Buckets let the renderer set fillStyle a handful of times per frame
    // instead of once per particle, which is the difference between smooth and
    // stuttering on a phone. Two hues x eight levels.
    const LEVELS = 8;
    const buckets = Array.from({ length: LEVELS * 2 }, () => []);

    for (let i = 0; i < this.count; i += 1) {
      const tx = blended ? from.xs[i] + (to.xs[i] - from.xs[i]) * m : to.xs[i];
      const ty = blended ? from.ys[i] + (to.ys[i] - from.ys[i]) * m : to.ys[i];
      const role = m < 0.5 ? from.roles[i] : to.roles[i];

      let goalX = tx * spread;
      let goalY = ty * spread;

      if (energy > 0) {
        // The mandible swings open and carries the lower face with it, so the
        // gap between the lips widens instead of the lips sliding over a
        // frozen chin. The lip seam holds no particles, so the opening reads
        // as a real cavity.
        const drop = blended
          ? from.jaw[i] + (to.jaw[i] - from.jaw[i]) * m
          : to.jaw[i];
        goalY += drop * energy * 0.26;

        if (role === ROLE.MOUTH && drop < 0.05) {
          goalY -= energy * 0.045; // the upper lip lifts a little
        }
        if (lips !== 0) {
          const near = blended
            ? from.aperture[i] + (to.aperture[i] - from.aperture[i]) * m
            : to.aperture[i];
          if (near < 3) {
            // Full effect on the lips, fading to nothing by the cheeks.
            const weight = 1 - near / 3;
            goalX *= 1 + (lipWidth - 1) * weight;
          }
        }
        if (role === ROLE.HALO) {
          // Loose points drift further out as he speaks.
          goalX *= 1 + energy * 0.16;
          goalY *= 1 + energy * 0.16;
        } else {
          const wobble = Math.sin(this.time * 5.5 + phase[i]);
          goalX += wobble * energy * 0.022;
          goalY += Math.cos(this.time * 4.6 + phase[i]) * energy * 0.022;
        }
      } else if (this.restDrift > 0) {
        goalX += Math.sin(this.time + phase[i]) * this.restDrift;
      }

      // Critically-damped-ish spring: reaches the target without ringing.
      vx[i] = (vx[i] + (goalX - x[i]) * 14 * step) * 0.82;
      vy[i] = (vy[i] + (goalY - y[i]) * 14 * step) * 0.82;
      x[i] += vx[i] * step;
      y[i] += vy[i] * step;

      const baseBright = blended
        ? from.bright[i] + (to.bright[i] - from.bright[i]) * m
        : to.bright[i];
      const size = blended
        ? from.sizes[i] + (to.sizes[i] - from.sizes[i]) * m
        : to.sizes[i];

      // Movement adds light on top of the shape's own shading, so speech reads
      // even where the displacement itself is small.
      if (energy > 0.04) {
        const inside = blended
          ? from.aperture[i] + (to.aperture[i] - from.aperture[i]) * m
          : to.aperture[i];
        // The opening grows with the voice; anything within it is inside his
        // mouth, and drawing it would fill the cavity back in. A rounded
        // vowel narrows the opening even at the same loudness.
        if (inside < energy / apertureWidth) continue;
      }

      const speed = Math.abs(vx[i]) + Math.abs(vy[i]);
      const lit = Math.min(1, baseBright + speed * 1.6 + energy * 0.12 + breath * 0.14);
      const level = Math.min(LEVELS - 1, Math.floor(lit * LEVELS));
      const hueBucket = (blended ? to.accent[i] : to.accent[i]) * LEVELS;

      const list = buckets[hueBucket + level];
      list.push(this.cx + x[i] * scale, this.cy + y[i] * scale, size);
    }

    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const unit = this.unit;
    for (let b = 0; b < buckets.length; b += 1) {
      const points = buckets[b];
      if (points.length === 0) continue;
      const level = b % LEVELS;
      const isAccent = b >= LEVELS;
      const t = level / (LEVELS - 1);
      const hue = isAccent ? this.accentHue : this.hue;
      const light = (isAccent ? 46 : 30) + t * (isAccent ? 34 : 42);
      const alpha = 0.2 + t * 0.8;
      ctx.fillStyle = `hsla(${hue}, ${isAccent ? 88 : 90}%, ${light}%, ${alpha})`;
      for (let p = 0; p < points.length; p += 3) {
        const s = Math.max(1, points[p + 2] * unit);
        ctx.fillRect(points[p], points[p + 1], s, s);
      }
    }
  }

  /** Drive the field from requestAnimationFrame until `stop()` is called. */
  start() {
    if (this._raf) return;
    let last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
