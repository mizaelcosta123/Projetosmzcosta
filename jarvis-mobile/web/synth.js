/**
 * A synthesizer played with your hands, in front of the camera.
 *
 * The idea is airsynth's -- a hand in the air as the controller, read by
 * MediaPipe -- made with the browser's own Web Audio API instead of
 * SuperCollider, so it needs nothing installed. And two ideas from the other
 * way round: ARSynth drives objects with oscillators, AR_Audio_Visualizer
 * makes the room answer the sound, so here the holograms choose the
 * waveform and pulse with the level.
 *
 *   mão, esquerda → direita     a nota, presa a uma escala
 *   mão, baixo → cima           o brilho (o filtro abre)
 *   mão, fechada → aberta       o volume (punho é silêncio)
 *   segunda mão, esquerda → direita   o eco
 *   segunda mão, baixo → cima         o vibrato
 *   o holograma sob a mão       a forma de onda
 *
 * Pitch snaps to a scale because a continuous theremin is famously hard to
 * play in tune, and a hand read from a camera wobbles by a few pixels even
 * held still: on a continuous pitch that is a permanent out-of-tune warble,
 * on a scale it is nothing at all.
 *
 * The mapping functions are plain arithmetic and are tested on their own;
 * `Synth` is the audio graph, and takes its AudioContext from a factory so a
 * test can hand it a fake one.
 */

/** Scales, as semitones from the root. */
export const SCALES = {
  pentatonica: [0, 3, 5, 7, 10],
  maior: [0, 2, 4, 5, 7, 9, 11],
  menor: [0, 2, 3, 5, 7, 8, 10],
  cromatica: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** The waveform each hologram gives the sound. The sphere is the round,
 *  pure tone; the cube's corners are a square wave's; the pyramid's edge is
 *  a saw's. The ring and the rest get the gentle triangle. */
export const SHAPE_WAVES = {
  esfera: 'sine',
  cubo: 'square',
  piramide: 'sawtooth',
  toro: 'triangle',
  plano: 'triangle',
  eixo: 'sine',
};

export const DEFAULT_WAVE = 'triangle';

const NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];

/** A MIDI note's name, the way it is said in Portuguese: 69 is "Lá 4". */
export function noteName(midi) {
  const n = Math.round(midi);
  return `${NAMES[((n % 12) + 12) % 12]} ${Math.floor(n / 12) - 1}`;
}

/** Equal temperament, A4 = 440 Hz. */
export function frequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Every note the width of the screen can play, left to right.
 *
 * @param {{root?: number, scale?: number[], octaves?: number}} [options]
 *   Root 57 is Lá 3; two octaves of the minor pentatonic is eleven notes,
 *   about 37 px each on a phone -- wide enough to land on on purpose.
 */
export function keyboard({ root = 57, scale = SCALES.pentatonica, octaves = 2 } = {}) {
  const notes = [];
  for (let octave = 0; octave < octaves; octave += 1) {
    for (const step of scale) notes.push(root + octave * 12 + step);
  }
  notes.push(root + octaves * 12);
  return notes;
}

/** Which note a horizontal position plays. */
export function noteAt(x, width, notes) {
  const t = Math.min(1, Math.max(0, x / Math.max(1, width)));
  return notes[Math.min(notes.length - 1, Math.floor(t * notes.length))];
}

/** How open a hand is, 0 (fist) to 1 (every finger out). */
export function openness(reading) {
  if (!reading?.up) return 0;
  return Object.values(reading.up).filter(Boolean).length / 5;
}

/**
 * What the synth should be doing, from what the hands are doing.
 *
 * @param {object|null} reading The driving hand (`handpose.read`), or null.
 * @param {{width:number,height:number}} screen
 * @param {{second?: object|null, shape?: string|null, notes?: number[]}} [extra]
 */
export function controls(reading, screen, { second = null, shape = null, notes = keyboard() } = {}) {
  if (!reading) return { gain: 0, midi: null, note: '', cutoff: 800, wave: DEFAULT_WAVE, echo: 0, vibrato: 0 };
  const midi = noteAt(reading.at.x, screen.width, notes);
  const height = Math.max(1, screen.height);
  const up = 1 - Math.min(1, Math.max(0, reading.at.y / height));
  // 200 Hz at the bottom to ~12.8 kHz at the top: six octaves of filter,
  // which the ear hears as an even sweep because it is exponential.
  const cutoff = 200 * 2 ** (up * 6);
  // Squared so the last fingers matter most: a relaxed, half-open hand is
  // quiet, a deliberately open one is loud.
  const gain = 0.45 * openness(reading) ** 2;
  const echo = second ? Math.min(1, Math.max(0, second.at.x / Math.max(1, screen.width))) * 0.6 : 0;
  const vibrato = second ? (1 - Math.min(1, Math.max(0, second.at.y / height))) * 25 : 0;
  return {
    gain,
    midi,
    note: noteName(midi),
    cutoff,
    wave: SHAPE_WAVES[shape] ?? DEFAULT_WAVE,
    echo,
    vibrato,
  };
}

/** How long parameter changes take to settle, in seconds. Short enough to
 *  feel immediate, long enough that a jump between notes is a glide and not
 *  a click. */
const GLIDE = 0.035;

/**
 * The audio graph.
 *
 *   osc ×2 (the second detuned) → low-pass → amp ─┬──────────────→ master → limiter → analyser → out
 *   vibrato LFO → both oscillators' detune          └→ delay ⇄ feedback → wet ┘
 *
 * The limiter is there because two oscillators in phase through a resonant
 * filter, plus the echo, can sum past full scale -- and a phone speaker
 * turns that into distortion. Measured without it: RMS 0.59, peaks at the
 * ceiling.
 */
export class Synth {
  constructor({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)() } = {}) {
    this.createContext = createContext;
    this.context = null;
    this.nodes = null;
    this.current = { gain: 0, midi: null, wave: DEFAULT_WAVE };
    this.buffer = null;
  }

  get running() {
    return this.context !== null;
  }

  /** Start. Must be called from a tap: browsers keep audio silent until a
   *  person has touched the page. Returns false where there is no Web Audio. */
  async start() {
    if (this.context) return true;
    let ctx;
    try {
      ctx = this.createContext();
    } catch {
      return false;
    }
    this.context = ctx;
    const now = ctx.currentTime;
    const osc = [ctx.createOscillator(), ctx.createOscillator()];
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    const delay = ctx.createDelay(1);
    const feedback = ctx.createGain();
    const wet = ctx.createGain();
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    const analyser = ctx.createAnalyser();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(6, now);
    filter.frequency.setValueAtTime(800, now);
    amp.gain.setValueAtTime(0, now);
    delay.delayTime.setValueAtTime(0.28, now);
    feedback.gain.setValueAtTime(0.35, now);
    wet.gain.setValueAtTime(0, now);
    master.gain.setValueAtTime(0.5, now);
    limiter.threshold.setValueAtTime(-10, now);
    limiter.knee.setValueAtTime(6, now);
    limiter.ratio.setValueAtTime(12, now);
    limiter.attack.setValueAtTime(0.003, now);
    limiter.release.setValueAtTime(0.15, now);
    analyser.fftSize = 1024;
    lfo.frequency.setValueAtTime(5.5, now);
    depth.gain.setValueAtTime(0, now);

    for (const [i, o] of osc.entries()) {
      o.type = DEFAULT_WAVE;
      o.frequency.setValueAtTime(frequency(57), now);
      // Seven cents apart: two oscillators a hair out of tune beat against
      // each other, which is most of what makes a synth sound like one.
      o.detune.setValueAtTime(i === 0 ? 0 : 7, now);
      depth.connect(o.detune);
      o.connect(filter);
      o.start(now);
    }
    lfo.connect(depth);
    lfo.start(now);
    filter.connect(amp);
    amp.connect(master);
    amp.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(master);
    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    this.nodes = { osc, filter, amp, delay, feedback, wet, master, limiter, analyser, lfo, depth };
    await ctx.resume?.();
    return true;
  }

  /** Apply `controls()`. Everything glides; the waveform switches. */
  set({ gain = 0, midi = null, cutoff = 800, wave = DEFAULT_WAVE, echo = 0, vibrato = 0 } = {}) {
    if (!this.nodes) return;
    const at = this.context.currentTime;
    const { osc, filter, amp, wet, depth } = this.nodes;
    amp.gain.setTargetAtTime(midi === null ? 0 : gain, at, GLIDE);
    if (midi !== null) {
      for (const o of osc) o.frequency.setTargetAtTime(frequency(midi), at, GLIDE);
    }
    filter.frequency.setTargetAtTime(cutoff, at, GLIDE);
    wet.gain.setTargetAtTime(echo, at, GLIDE * 3);
    depth.gain.setTargetAtTime(vibrato, at, GLIDE * 3);
    if (wave !== this.current.wave) for (const o of osc) o.type = wave;
    this.current = { gain, midi, wave };
  }

  /** How loud it is right now, 0..1 (RMS of the output). */
  level() {
    const analyser = this.nodes?.analyser;
    if (!analyser) return 0;
    if (!this.buffer || this.buffer.length !== analyser.fftSize) this.buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.buffer.length) * 3);
  }

  /** Fade out and let the audio hardware go. */
  async stop() {
    if (!this.context) return;
    const ctx = this.context;
    const { amp, osc, lfo } = this.nodes;
    amp.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    this.context = null;
    this.nodes = null;
    // A short tail, so stopping is a fade and not a click.
    await new Promise((resolve) => setTimeout(resolve, 120));
    for (const o of [...osc, lfo]) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    await ctx.close?.().catch(() => {});
  }
}
