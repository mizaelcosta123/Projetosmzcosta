/**
 * Where he is looking, and how his head is carried.
 *
 * The thing that makes a face look alive is not the expression on it. A still
 * face with a perfect smile is a mask; a neutral face whose eyes move is a
 * person. Three facts from the physiology do almost all the work here:
 *
 *  1. **Eyes jump, they do not glide.** A saccade is ballistic: 30-80ms of
 *     movement, then 200-600ms of holding perfectly still. Animating the eyes
 *     with a gentle ease is the single most common way to make a face read as
 *     a puppet, because nothing in a real eye ever moves slowly.
 *
 *  2. **The head lags the eyes, and only comes along for the big ones.** Look
 *     to the side and your eyes arrive first; the head follows if the target
 *     was far enough to be worth turning for. Under about 15 degrees the head
 *     does not move at all.
 *
 *  3. **The eyes give the movement back.** This is the one that sells it. As
 *     the head catches up, the eyes counter-rotate toward the centre of their
 *     sockets, so the *gaze* stays on the target the whole time. Modelling
 *     gaze and head separately and taking eye-in-head as the difference gets
 *     this for free, and it is why the code below tracks where he is looking
 *     rather than where his eyeballs are pointing.
 */

/** How long the eye takes to arrive. Short enough to read as a jump. */
const SACCADE_TAU = 0.035;

/** The head is heavy. */
const HEAD_TAU = 0.34;

/** Gaze this far off-centre before the head bothers to help. */
const HEAD_THRESHOLD = 0.22;

/**
 * How much of the rest of the excursion the head takes.
 *
 * Kept well under half. A head that takes most of a large gaze shift turns so
 * far that the face is in three-quarter view, and at that point the drawn
 * head slides out of the frame -- the perspective divide displaces the near
 * side of a turned head, which is correct and is also most of a head-width.
 */
const HEAD_SHARE = 0.55;

/** And never further than this, whatever the gaze asks for. */
const HEAD_LIMIT = 0.42;

/**
 * What the eyes do in each state of mind, as [hold-low, hold-high, spread].
 *
 * `spread` is how far from the anchor a new fixation may land. Thinking looks
 * further away and holds longer; attending stays near the listener's face and
 * flicks about, which is what someone listening to you actually does.
 */
const MOODS = {
  atento: { hold: [420, 1500], spread: 0.22, anchor: [0, 0] },
  falando: { hold: [500, 1900], spread: 0.3, anchor: [0, -0.04] },
  pensando: { hold: [700, 2400], spread: 0.55, anchor: [0.18, -0.32] },
  vagando: { hold: [900, 3200], spread: 0.75, anchor: [0, 0] },
  parado: { hold: [1400, 4000], spread: 0.12, anchor: [0, 0] },
};

/** The ironic eye-roll, as phases of [seconds, x, y]. */
const ROLL = [
  [0.14, 0.15, -0.95], // up
  [0.16, -0.7, -0.75], // and over
  [0.14, -0.5, 0.1], // down the far side
  [0.2, 0, 0], // back, as if nothing happened
];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * A pair of eyes and the head they sit in.
 *
 * The clock is an argument, so this runs in pretend time with no browser.
 */
export class Gaze {
  constructor({ random = Math.random } = {}) {
    this.random = random;

    /** Where he is looking, in a -1..1 box. Not where the eyeballs point. */
    this.gazeX = 0;
    this.gazeY = 0;
    this.wantX = 0;
    this.wantY = 0;

    /** How the head is carried. Radians-ish; the renderer decides the scale. */
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    this.mood = 'atento';
    this._nextAt = 0;
    this._rollAt = -1; // when the current eye-roll started; -1 for none
    this._nod = 0;
    this._time = 0;
    this._started = false;
  }

  /** Change what kind of looking he is doing. Unknown names fall back. */
  look(mood) {
    this.mood = mood in MOODS ? mood : 'atento';
    // Re-aim now rather than at the next scheduled fixation, or a change of
    // mind takes up to three seconds to show.
    this._aim(this._time);
    return this;
  }

  /**
   * Look at a specific point, and hold it.
   *
   * Held for three seconds, not the mood's usual fraction of one: this is an
   * instruction, and a fixation that wanders off after a blink's worth of
   * time would read as him not having listened.
   */
  at(x, y) {
    this.wantX = clamp(x, -1, 1);
    this.wantY = clamp(y, -1, 1);
    this._nextAt = this._time + 3000;
    return this;
  }

  /** Roll his eyes. For irony, and for being told something he knew. */
  rollEyes(now = this._time) {
    this._rollAt = now;
    return this;
  }

  /** Is an eye-roll running right now? */
  get rolling() {
    return this._rollAt >= 0;
  }

  /** A single nod, for agreeing without interrupting. */
  nod(now = this._time) {
    this._nod = now;
    return this;
  }

  /** Pick the next fixation and schedule the one after it. */
  _aim(now) {
    const mood = MOODS[this.mood] ?? MOODS.atento;
    const [low, high] = mood.hold;
    const [ax, ay] = mood.anchor;
    // Squaring the draw keeps most fixations near the anchor with the
    // occasional long one, which is how a real scan is distributed -- a
    // uniform draw reads as a metronome sweeping a room.
    const reach = (sign) => sign * this.random() ** 2 * mood.spread;
    this.wantX = clamp(ax + reach(this.random() < 0.5 ? -1 : 1), -1, 1);
    this.wantY = clamp(ay + reach(this.random() < 0.5 ? -1 : 1), -1, 1);
    this._nextAt = now + low + this.random() * (high - low);
  }

  /**
   * Advance to `now`.
   *
   * @param {number} now Milliseconds.
   * @param {number} [speech] 0..1, the current loudness.
   * @returns {{eyeX: number, eyeY: number, yaw: number, pitch: number,
   *            roll: number, lid: number}}
   *   `eyeX`/`eyeY` are eye-in-head -- what the renderer moves the irises by.
   *   `lid` is how much the upper lid follows the eye, which is the detail
   *   that keeps a downward look from staring.
   */
  frame(now, speech = 0) {
    if (!this._started) {
      this._started = true;
      this._time = now;
      // Only pick somewhere if nothing has been asked for. `at()` before the
      // first frame is a reasonable thing to write, and aiming unconditionally
      // here would throw that instruction away one frame later.
      if (this._nextAt <= now) this._aim(now);
    }
    const step = Math.min(0.1, Math.max(0, (now - this._time) / 1000));
    this._time = now;

    // -- where he wants to look ---------------------------------------------
    if (this._rollAt >= 0) {
      // A roll overrides the schedule entirely: it is a gesture, not a glance.
      let elapsed = (now - this._rollAt) / 1000;
      let done = true;
      for (const [span, x, y] of ROLL) {
        if (elapsed < span) {
          this.wantX = x;
          this.wantY = y;
          done = false;
          break;
        }
        elapsed -= span;
      }
      if (done) {
        this._rollAt = -1;
        this._aim(now);
      }
    } else if (now >= this._nextAt) {
      this._aim(now);
    }

    // -- the jump ------------------------------------------------------------
    // A roll is a slower, deliberate sweep; a saccade is a jump. Using the
    // saccade constant for both would make the roll a flicker nobody sees.
    const tau = this._rollAt >= 0 ? 0.075 : SACCADE_TAU;
    const eyeRate = 1 - Math.exp(-step / tau);
    this.gazeX += (this.wantX - this.gazeX) * eyeRate;
    this.gazeY += (this.wantY - this.gazeY) * eyeRate;

    // -- what the head takes on ----------------------------------------------
    const over = (value) => {
      const past = Math.abs(value) - HEAD_THRESHOLD;
      if (past <= 0) return 0;
      return Math.sign(value) * Math.min(HEAD_LIMIT, past * HEAD_SHARE);
    };
    // Rolling your eyes is the one gaze movement that is *defined* by the head
    // not coming along: the whole gesture is eyes going somewhere the head
    // refuses to follow. Letting the head help cancels it -- the eyes
    // counter-rotate back to centre and the roll disappears entirely, which
    // is exactly what the first drawing of it showed.
    const rolling = this._rollAt >= 0;
    let wantYaw = rolling ? 0 : over(this.gazeX);
    let wantPitch = rolling ? 0 : over(this.gazeY);

    // Talking moves the head a little on its own: nobody speaks a sentence
    // with their head clamped. Tied to loudness, so it lands on the stresses.
    if (speech > 0) {
      wantPitch += speech * 0.1;
      wantYaw += Math.sin(now / 900) * speech * 0.06;
    }
    // A nod is a half-second dip, added on top of wherever the head was.
    if (this._nod) {
      const through = (now - this._nod) / 520;
      if (through >= 1) this._nod = 0;
      else wantPitch += Math.sin(through * Math.PI) * 0.42;
    }

    const headRate = 1 - Math.exp(-step / HEAD_TAU);
    this.yaw += (wantYaw - this.yaw) * headRate;
    this.pitch += (wantPitch - this.pitch) * headRate;
    // The head tilts into a turn slightly. It is small and nobody notices it
    // until it is missing, at which point the head reads as being on a post.
    this.roll += (this.yaw * -0.22 - this.roll) * headRate;

    // -- what is left for the eyes -------------------------------------------
    // The counter-rotation: as the head arrives, this shrinks toward zero and
    // the gaze stays exactly where it was.
    const eyeX = clamp(this.gazeX - this.yaw, -1, 1);
    const eyeY = clamp(this.gazeY - this.pitch, -1, 1);

    return {
      eyeX,
      eyeY,
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      // Looking down lowers the lid with the eye; looking up opens it. Without
      // this, a downward glance is a stare with the pupils moved.
      lid: clamp(eyeY * 0.5, -0.5, 0.5),
    };
  }
}

export { MOODS };
