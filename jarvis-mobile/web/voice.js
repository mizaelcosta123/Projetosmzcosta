/**
 * Voice level sources for the particle field.
 *
 * The field asks one question every frame — "how loud is he right now?" — and
 * there are two honest ways to answer it:
 *
 *  - `AnalyserDriver` measures actual audio through a Web Audio AnalyserNode.
 *    This is true synchrony: the particles move with the waveform.
 *  - `SynthesisDriver` wraps the browser's speechSynthesis, which deliberately
 *    does not expose its audio stream. There is nothing to measure, so the
 *    level is *modelled* from word-boundary events. It looks alive and lines
 *    up with the words, but it is an approximation, not the waveform.
 *
 * Both stop at exactly zero when speech ends, which is what makes the field
 * come to a real stop.
 */

/** Shared shape: `level` is 0..1, `speaking` says whether to keep animating. */
export class VoiceDriver extends EventTarget {
  constructor() {
    super();
    this.level = 0;
    this.speaking = false;
  }

  _emitEnd() {
    this.level = 0;
    this.speaking = false;
    this.dispatchEvent(new Event('end'));
  }
}

/**
 * Measures real audio: the accurate path.
 *
 * Browsers only permit an AudioContext after a user gesture, so construction
 * is cheap and the context is created lazily on the first `speak()`.
 */
export class AnalyserDriver extends VoiceDriver {
  constructor() {
    super();
    this.context = null;
    this.analyser = null;
    this.buffer = null;
    this.audio = null;
    this._sources = new WeakMap();
  }

  _ensureContext() {
    if (this.context) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is unavailable in this browser.');
    this.context = new Ctx();
    this.analyser = this.context.createAnalyser();
    // 1024 is a good trade at 60fps: enough samples for a stable RMS, short
    // enough that the level tracks syllables rather than smearing across them.
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.buffer = new Uint8Array(this.analyser.fftSize);
    this.analyser.connect(this.context.destination);
  }

  /**
   * Play an audio URL and expose its loudness.
   *
   * @param {string} url Anything an <audio> element can play.
   * @returns {Promise<void>} Resolves when playback ends.
   */
  async speak(url) {
    this._ensureContext();
    if (this.context.state === 'suspended') await this.context.resume();

    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    this.audio = audio;

    // createMediaElementSource throws if called twice for one element; the map
    // keeps replays of the same element working.
    let source = this._sources.get(audio);
    if (!source) {
      source = this.context.createMediaElementSource(audio);
      source.connect(this.analyser);
      this._sources.set(audio, source);
    }

    this.speaking = true;
    this.dispatchEvent(new Event('start'));

    await audio.play();
    await new Promise((resolve) => {
      const done = () => {
        audio.removeEventListener('ended', done);
        audio.removeEventListener('error', done);
        resolve();
      };
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
    });
    this._emitEnd();
  }

  /** Root-mean-square of the current window, normalised to roughly 0..1. */
  sample() {
    if (!this.speaking || !this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buffer);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const centred = (this.buffer[i] - 128) / 128;
      sum += centred * centred;
    }
    const rms = Math.sqrt(sum / this.buffer.length);
    // Speech RMS rarely passes ~0.35, so scale it up before clamping;
    // otherwise the field would barely move on ordinary speech.
    this.level = Math.min(1, rms * 3.2);
    return this.level;
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this._emitEnd();
  }
}

/**
 * Wraps speechSynthesis: works everywhere, measures nothing.
 *
 * The level is a modelled envelope — a syllable-rate oscillation that restarts
 * on each word boundary the browser reports, with a short fade at the end of
 * the utterance. It tracks the rhythm of speech, not its waveform.
 */
export class SynthesisDriver extends VoiceDriver {
  constructor({ voice = null, rate = 1, pitch = 1 } = {}) {
    super();
    this.voice = voice;
    this.rate = rate;
    this.pitch = pitch;
    this._wordStart = 0;
    this._utterance = null;
  }

  static get available() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * Speak text aloud.
   *
   * @param {string} text
   * @returns {Promise<void>} Resolves when the utterance finishes.
   */
  speak(text) {
    if (!SynthesisDriver.available) {
      return Promise.reject(new Error('speechSynthesis is unavailable.'));
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    if (this.voice) utterance.voice = this.voice;
    this._utterance = utterance;

    return new Promise((resolve) => {
      utterance.onstart = () => {
        this.speaking = true;
        this._wordStart = performance.now();
        this.dispatchEvent(new Event('start'));
      };
      // Each boundary restarts the envelope, which is what makes the motion
      // land on the words instead of drifting against them.
      utterance.onboundary = () => {
        this._wordStart = performance.now();
      };
      const finish = () => {
        this._emitEnd();
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });
  }

  sample() {
    if (!this.speaking) return 0;
    const sinceWord = (performance.now() - this._wordStart) / 1000;
    // Syllable-rate carrier (~5.5 Hz is typical for conversational speech),
    // with each word decaying so the field breathes between them.
    const carrier = 0.5 + 0.5 * Math.sin(sinceWord * Math.PI * 5.5);
    const decay = Math.exp(-sinceWord * 1.8);
    this.level = Math.min(1, 0.25 + carrier * decay * 0.85);
    return this.level;
  }

  stop() {
    if (SynthesisDriver.available) window.speechSynthesis.cancel();
    this._emitEnd();
  }
}

/**
 * Pick the best driver available.
 *
 * Prefers real measurement when the caller can supply audio URLs; falls back
 * to the browser voice otherwise.
 *
 * @param {boolean} hasServerAudio Whether the server can return TTS audio.
 */
export function createVoiceDriver(hasServerAudio) {
  if (hasServerAudio) return new AnalyserDriver();
  if (SynthesisDriver.available) return new SynthesisDriver();
  return new VoiceDriver(); // silent: the field simply stays at rest
}
