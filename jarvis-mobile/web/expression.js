/**
 * What his face is doing, apart from talking.
 *
 * The mouth already follows the voice. This is the rest of it: brows, eyelids,
 * cheeks, the corners of the mouth — the part that makes a face look like
 * somebody is behind it rather than a speaker with a jaw.
 *
 * Two ideas, both borrowed and neither copied. The vocabulary is FACS: a face
 * is described by **action units**, each a single muscle movement with an
 * intensity, and an emotion is a combination of them rather than a thing of
 * its own. That is what makes "speaking, and slightly amused" expressible —
 * emotions do not blend, action units add. openFACS (MIT) drives a rigged 3D
 * head from exactly this vocabulary, and its emotion vectors are the standard
 * Ekman combinations.
 *
 * The other is procedural transition, from ggldnl's expression library for
 * OLED robot eyes: rather than keyframed animations, hold a *target* and move
 * everything toward it every frame. Adding an expression is adding a vector,
 * and every transition between every pair comes free. That library is GPL-3
 * and this project is not, so none of its code is here — the idea is not the
 * code, and a particle field is not an eight-point polygon anyway.
 *
 * What is ours: doing it to 6500 points, and the livingness underneath —
 * blinks on a human interval, a slow drift, and a face that is never quite
 * symmetrical. Perfect symmetry is the thing that reads as a mask.
 */

/**
 * The action units this face can actually show.
 *
 * A subset. FACS has dozens and most of them are invisible on a face made of
 * dots at phone size — AU14's dimpler is a millimetre of skin. These are the
 * ones that survive the medium.
 */
export const AUS = [
  'browInner', // AU1  — inner brow raiser: the middle of the brow lifts
  'browOuter', // AU2  — outer brow raiser
  'browLower', // AU4  — brow lowerer and knitter
  'lidRaise', //  AU5  — upper lid raiser: the stare of surprise or fear
  'cheekRaise', // AU6 — cheek raiser, and the eye narrowing with it
  'lidTighten', // AU7 — lid tightener
  'noseWrinkle', // AU9 — nose wrinkler
  'lipPull', //   AU12 — lip corner puller: the smile
  'lipDepress', // AU15 — lip corner depressor
  'lipStretch', // AU20 — lip stretcher
  'jawDrop', //   AU26 — jaw drop, on top of whatever speech is doing
  'blink', //     AU45 — blink
];

/** Index of each unit, so a vector can be read by name without a map. */
export const AU = Object.fromEntries(AUS.map((name, index) => [name, index]));

/** A vector of zeroes — the neutral face. */
export function neutral() {
  return new Float32Array(AUS.length);
}

/** Build a vector from named intensities: `of({lipPull: 1})`. */
export function of(parts = {}) {
  const vector = neutral();
  for (const [name, value] of Object.entries(parts)) {
    const index = AU[name];
    if (index !== undefined) vector[index] = Math.min(1, Math.max(0, Number(value) || 0));
  }
  return vector;
}

/**
 * The prototypical expressions, as combinations.
 *
 * These are the EMFACS combinations — the same ones openFACS ships — trimmed
 * to the units above. They are not arbitrary: the difference between a polite
 * smile and a felt one is AU6, and leaving it out is why a lot of animated
 * faces look insincere.
 */
export const EMOTIONS = {
  neutro: of({}),
  alegre: of({ cheekRaise: 1, lipPull: 0.85, browOuter: 0.15 }),
  triste: of({ browInner: 1, browLower: 0.5, lipDepress: 0.7, lidTighten: 0.2 }),
  surpreso: of({ browInner: 0.8, browOuter: 0.9, lidRaise: 0.8, jawDrop: 0.6 }),
  bravo: of({ browLower: 1, lidRaise: 0.4, lidTighten: 0.6, lipStretch: 0.3 }),
  receoso: of({ browInner: 0.7, browOuter: 0.5, browLower: 0.5, lidRaise: 0.7, lipStretch: 0.6 }),
  enojado: of({ noseWrinkle: 1, browLower: 0.6, lipDepress: 0.4 }),
  pensativo: of({ browInner: 0.35, browLower: 0.45, lidTighten: 0.3 }),
  // Not an emotion so much as a posture: the face somebody makes while
  // listening to you, which is where he spends most of his time.
  atento: of({ browOuter: 0.25, lidRaise: 0.2 }),
};

/** Blinks land in this window. Humans average about one every four seconds. */
const BLINK_EVERY = [2200, 7000];

/** How long a blink takes, closing and opening. */
const BLINK_MS = 160;

/** Seconds to cover ~63% of the distance to a new expression. */
const SETTLE_TAU = 0.22;

/**
 * A face, procedurally.
 *
 * Holds where it is, where it is going, and gets there a bit at a time. The
 * clock is an argument so this runs in pretend time with no browser.
 */
export class Expression {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    /** Where the face is right now. */
    this.current = neutral();
    /** Where it is heading. */
    this.target = neutral();
    /** A steady left/right bias per unit, so the face is not a mirror. */
    this.bias = Float32Array.from(AUS, () => (random() - 0.5) * 0.22);

    this.name = 'neutro';
    this._blinkAt = 0;
    this._blinkUntil = 0;
    this._time = 0;
    this._started = false;
  }

  /**
   * Aim at an expression by name, or at a vector.
   *
   * Unknown names settle to neutral rather than throwing: this is driven by a
   * model, and a model will eventually ask for "sarcástico".
   */
  set(what) {
    if (typeof what === 'string') {
      this.name = what;
      this.target = EMOTIONS[what] ?? EMOTIONS.neutro;
      return this;
    }
    this.name = 'custom';
    this.target = what instanceof Float32Array ? what : of(what);
    return this;
  }

  /** Close the eyes now, whatever else is happening. */
  blink(now = this._time) {
    this._blinkUntil = now + BLINK_MS * 2;
    // Measured from the reopen, so a deliberate blink does not leave a stale
    // appointment in the past for the next frame to fire on.
    this._reschedule(this._blinkUntil);
    return this;
  }

  /** Schedule the next spontaneous blink, counting from `now`. */
  _reschedule(now) {
    const [low, high] = BLINK_EVERY;
    this._blinkAt = now + low + this.random() * (high - low);
  }

  /**
   * Advance to `now`, and return the face to draw.
   *
   * @param {number} now Milliseconds.
   * @param {number} [speech] 0..1, the current loudness.
   * @returns {Float32Array} Intensities, in AUS order.
   */
  frame(now, speech = 0) {
    if (!this._started) {
      this._started = true;
      this._time = now;
      this._reschedule(now);
    }
    const step = Math.min(0.1, Math.max(0, (now - this._time) / 1000));
    this._time = now;

    // Everything moves toward the target by a time constant, not a fixed
    // fraction per frame: the same transition takes the same time on a 60Hz
    // and a 120Hz screen.
    const rate = 1 - Math.exp(-step / SETTLE_TAU);
    for (let i = 0; i < this.current.length; i += 1) {
      this.current[i] += (this.target[i] - this.current[i]) * rate;
    }

    // Livingness. A face that holds perfectly still between sentences reads as
    // a photograph of a face.
    if (now >= this._blinkAt && now > this._blinkUntil) {
      this._blinkUntil = now + BLINK_MS * 2;
      // Book the next one as this one starts. Waiting for a frame to land on
      // the reopen is a coin toss at any frame rate, and a missed booking
      // leaves the appointment in the past: the eye flutters instead of
      // blinking.
      this._reschedule(this._blinkUntil);
    }
    if (now < this._blinkUntil) {
      // Down and back up, so the lid does not snap open.
      const through = 1 - Math.abs((now - (this._blinkUntil - BLINK_MS)) / BLINK_MS);
      this.current[AU.blink] = Math.max(0, Math.min(1, through));
    } else {
      this.current[AU.blink] *= 0.5;
      if (this.current[AU.blink] < 0.01) this.current[AU.blink] = 0;
    }

    // Speaking lifts the brows a little on the loud syllables. It is a small
    // thing and it is most of what separates talking from a jaw opening.
    const out = Float32Array.from(this.current);
    if (speech > 0) {
      out[AU.browOuter] = Math.min(1, out[AU.browOuter] + speech * 0.28);
      out[AU.browInner] = Math.min(1, out[AU.browInner] + speech * 0.12);
      out[AU.cheekRaise] = Math.min(1, out[AU.cheekRaise] + speech * 0.1);
    }
    return out;
  }

  /** How much more the left side does than the right, for a given unit. */
  sideBias(index) {
    return this.bias[index] ?? 0;
  }
}

/** The names a model may ask for, for a tool's enum. */
export const EMOTION_NAMES = Object.keys(EMOTIONS);
