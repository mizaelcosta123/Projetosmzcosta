/**
 * Live voice: he listens while you talk, stops when you cut in, and answers.
 *
 * Two ways in, both deliberate. The button in the composer opens a session.
 * Or his name does — but only once you have turned that on, because a page
 * that waits for a word is a page that hears every word, and that is not a
 * thing to decide on somebody's behalf. With the setting off, nothing here
 * touches the microphone.
 *
 * The hard part is not recognition, it is telling your voice from his. While
 * he speaks, the microphone hears him too, so a naive "any sound interrupts"
 * makes him stop talking at himself, and a naive "any transcript is the user"
 * makes him answer his own sentences. Two independent signals settle it:
 *
 *   1. our own level meter, on a stream with echo cancellation — the browser
 *      subtracts what it is playing, so what is left is mostly you;
 *   2. the recogniser's words.
 *
 * A word is only yours when the meter agrees it heard a voice, and a noise
 * only interrupts him when words follow it. That is what "he never stops
 * answering unless it is speech" means in code: a door slamming ducks his
 * volume for a moment and then he carries on.
 */

export {
  BargeIn, Backchannel, Envelope, LiveSession, VoiceGate, WakeWord, normalizeSpeech, stripOwn, wakeMatch,
  END_OF_TURN_MS,
};

/** Chrome ends recognition on its own; this is how long to wait before restarting. */
const RESTART_MS = 250;

/** The recogniser, under whichever name this browser has for it. */
function recognitionClass() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

// -- the wake word ----------------------------------------------------------

/**
 * His name, and the ways a recogniser tends to render it.
 *
 * Portuguese speech-to-text has no reason to know "Jarvis", so it guesses at
 * something it does know. These are the guesses worth catching; anything more
 * exotic and the button is right there.
 */
const NAMES = ['jarvis', 'jarves', 'jarvez', 'jarvis,', 'jarbas', 'jarvi', 'javis'];

/**
 * Lowercase, unaccented, single-spaced.
 *
 * Accents are the first thing a recogniser disagrees with itself about — "olá"
 * and "ola" arrive interchangeably — so the comparison happens without them.
 */
function normalizeSpeech(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Did they call him, and did they say anything after?
 *
 * The name anywhere in the sentence wakes him: "ei Jarvis", "Jarvis", "olá
 * Jarvis", "fala comigo Jarvis" are all the same rule, and listing greetings
 * would only mean missing the fifth one somebody actually says. Whatever
 * follows the name comes back as `rest`, so "Jarvis, qual a bateria?" asks the
 * question instead of making you say it twice.
 *
 * @param {string} text
 * @returns {{woke: boolean, rest: string}}
 */
function wakeMatch(text) {
  const words = normalizeSpeech(text).split(' ').filter(Boolean);
  const at = words.findIndex((word) => NAMES.includes(word));
  if (at === -1) return { woke: false, rest: '' };
  return { woke: true, rest: words.slice(at + 1).join(' ') };
}

/**
 * Listens for his name and nothing else.
 *
 * Its own recogniser, never running at the same time as the session's — two
 * of them fight over the microphone and one loses silently. Armed only when
 * the setting says so, because a page that listens for a word listens for
 * every word.
 */
class WakeWord extends EventTarget {
  constructor({ lang = 'pt-BR' } = {}) {
    super();
    this.lang = lang;
    this.armed = false;
    this._recognition = null;
  }

  /** Begin listening for the name. Resolves once the recogniser is running. */
  start() {
    const Recognition = recognitionClass();
    if (!Recognition) throw new Error('Este navegador não transcreve fala.');
    if (this.armed) return;
    this.armed = true;
    this._listen();
  }

  stop() {
    this.armed = false;
    if (!this._recognition) return;
    this._recognition.onend = null;
    try {
      this._recognition.stop();
    } catch {
      /* already stopped */
    }
    this._recognition = null;
  }

  _listen() {
    const Recognition = recognitionClass();
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const heard = event.results[index][0]?.transcript ?? '';
        const { woke, rest } = wakeMatch(heard);
        if (!woke) continue;
        // Hand over immediately: the session wants the microphone, and this
        // recogniser has to let go of it first.
        this.stop();
        this.dispatchEvent(new CustomEvent('wake', { detail: { rest } }));
        return;
      }
    };
    recognition.onerror = (event) => {
      // Two errors that look alike and are not. `not-allowed` is a person
      // saying no, and it should be remembered. `service-not-allowed` is the
      // transcription service being unreachable — no one was ever asked, and
      // it comes back on its own, so remembering it would switch the feature
      // off for good over a network hiccup.
      if (event.error === 'not-allowed') {
        this.armed = false;
        this.dispatchEvent(new CustomEvent('denied', { detail: { reason: event.error } }));
        return;
      }
      if (event.error === 'service-not-allowed') {
        this.dispatchEvent(new CustomEvent('unavailable', { detail: { reason: event.error } }));
        return;
      }
      // `no-speech`, `aborted` and `network` are ordinary: onend restarts.
    };
    recognition.onend = () => {
      if (!this.armed) return;
      setTimeout(() => {
        if (this.armed) this._listen();
      }, RESTART_MS);
    };

    try {
      recognition.start();
      this._recognition = recognition;
    } catch {
      /* already running */
    }
  }
}

/**
 * The outline of a sound, rather than the sound.
 *
 * Speech is not continuous: between syllables the energy falls to nearly
 * nothing, several times a second. Feeding that straight to the gate makes
 * every gap look like the end of a word, and a staccato speaker never gets
 * past the onset timer at all — which is exactly how this was found, with a
 * synthesised voice that dips to silence 4.5 times a second.
 *
 * Fast attack, slow release: it follows a rise immediately and lets a fall
 * decay, so the gate sees the shape of the phrase.
 */
class Envelope {
  constructor({ releaseMs = 150 } = {}) {
    this.releaseMs = releaseMs;
    this.value = 0;
    this._at = 0;
  }

  /**
   * @param {number} level The instantaneous loudness.
   * @param {number} now Milliseconds.
   * @returns {number} The followed value, never below the input.
   */
  push(level, now) {
    if (level >= this.value) {
      this.value = level;
    } else {
      const elapsed = Math.max(0, now - this._at);
      // Exponential decay with a time constant, so the fall is smooth and
      // frame-rate independent — 60fps and 30fps decay at the same speed.
      this.value = Math.max(level, this.value * Math.exp(-elapsed / this.releaseMs));
    }
    this._at = now;
    return this.value;
  }

  reset() {
    this.value = 0;
    this._at = 0;
  }
}

/** How loud, for how long, counts as somebody talking. */
const GATE_DEFAULTS = {
  //: Normalised RMS. Above this is voice, below `off` is silence; the gap is
  //: hysteresis, so a sentence's own quiet moments do not end it.
  on: 0.055,
  off: 0.028,
  //: Sustained this long before it counts. A cough is shorter than a word.
  onsetMs: 180,
  //: Silence this long ends the phrase. Long enough to think mid-sentence,
  //: short enough not to feel like waiting.
  hangoverMs: 900,
};

/**
 * Turns a stream of loudness samples into "is someone talking".
 *
 * Pure arithmetic over a clock you pass in, so it can be tested without a
 * microphone, a browser, or real time.
 */
class VoiceGate {
  constructor(options = {}) {
    const { on, off, onsetMs, hangoverMs } = { ...GATE_DEFAULTS, ...options };
    this.on = on;
    this.off = off;
    this.onsetMs = onsetMs;
    this.hangoverMs = hangoverMs;
    this.reset();
  }

  reset() {
    /** @type {'silent'|'rising'|'speaking'|'falling'} */
    this.state = 'silent';
    this._since = 0;
  }

  /**
   * Feed one sample.
   *
   * @param {number} level Normalised loudness, 0..1.
   * @param {number} now Milliseconds from any monotonic clock.
   * @returns {'began'|'ended'|null} The transition, if this sample caused one.
   */
  push(level, now) {
    switch (this.state) {
      case 'silent':
        if (level >= this.on) {
          this.state = 'rising';
          this._since = now;
        }
        return null;

      case 'rising':
        if (level < this.off) {
          // Too brief to be a word. This is the branch that keeps a slammed
          // door from interrupting him.
          this.state = 'silent';
          return null;
        }
        if (now - this._since >= this.onsetMs) {
          this.state = 'speaking';
          return 'began';
        }
        return null;

      case 'speaking':
        if (level < this.off) {
          this.state = 'falling';
          this._since = now;
        }
        return null;

      case 'falling':
        if (level >= this.on) {
          this.state = 'speaking';
          return null;
        }
        if (now - this._since >= this.hangoverMs) {
          this.state = 'silent';
          return 'ended';
        }
        return null;

      default:
        return null;
    }
  }

  /** True while the meter believes a person is talking. */
  get talking() {
    return this.state === 'speaking' || this.state === 'falling';
  }
}

/** How long a duck waits for words before deciding it was noise. */
const CONFIRM_MS = 1200;

/**
 * Deciding whether to interrupt him, in two steps.
 *
 * A voice alone only lowers his volume. Words confirm it and stop him. No
 * words, and he comes back up as if nothing happened — which is the whole
 * point: he never stops answering unless it is speech.
 */
class BargeIn {
  constructor({ confirmMs = CONFIRM_MS } = {}) {
    this.confirmMs = confirmMs;
    this.reset();
  }

  reset() {
    /** @type {'clear'|'ducked'} */
    this.state = 'clear';
    this._since = 0;
  }

  /**
   * The meter heard a voice while he was talking.
   *
   * @returns {'duck'|null}
   */
  heardVoice(now) {
    if (this.state !== 'clear') return null;
    this.state = 'ducked';
    this._since = now;
    return 'duck';
  }

  /**
   * The recogniser produced words.
   *
   * @returns {'stop'|null} Only meaningful while ducked — words with no voice
   *   behind them are his own speech coming back through the microphone.
   */
  heardWords() {
    if (this.state !== 'ducked') return null;
    this.state = 'clear';
    return 'stop';
  }

  /**
   * Time passing.
   *
   * @returns {'restore'|null}
   */
  tick(now) {
    if (this.state !== 'ducked') return null;
    if (now - this._since < this.confirmMs) return null;
    this.state = 'clear';
    return 'restore';
  }
}

/** Volume he drops to while a duck is unconfirmed. */
const DUCKED_VOLUME = 0.15;

/**
 * How long a silence ends your turn in a live conversation.
 *
 * Two seconds, as asked for: long enough to take a breath or look for a
 * word mid-thought without being answered, and not a moment longer -- the
 * short pauses in between are where he says "aham" instead (`Backchannel`).
 * The level meter's own default (900 ms) stays for everything else.
 */
const END_OF_TURN_MS = 2000;

/**
 * "Aham", "entendi": the small sounds a listener makes.
 *
 * Said in a short pause inside your turn -- not the pause that ends it --
 * and only after you have been talking for a while, and not again right
 * after the last one. That is what keeps them feeling like attention rather
 * than a tic: a nod after three words is an interruption, and three nods in
 * a row is a parrot.
 */
const NOD_DEFAULTS = {
  //: How far into a pause before nodding.
  afterMs: 700,
  //: Speech since the last nod before another is due.
  minTalkMs: 2500,
  //: Words since the last nod, the same way.
  minWords: 4,
  //: Never two nods closer than this.
  gapMs: 4000,
};

class Backchannel {
  constructor(options = {}) {
    Object.assign(this, { ...NOD_DEFAULTS, ...options });
    this.reset();
  }

  reset() {
    this.talked = 0;
    this._talkSince = null;
    this._last = -Infinity;
    this._noddedThisPause = false;
    this._wordsAtNod = 0;
  }

  /** Speech (re)started. */
  began(now) {
    if (this._talkSince === null) this._talkSince = now;
    this._noddedThisPause = false;
  }

  /** Speech paused -- maybe for good, maybe for breath. */
  paused(now) {
    if (this._talkSince !== null) this.talked += now - this._talkSince;
    this._talkSince = null;
  }

  /**
   * Time passing inside a pause.
   *
   * @param {number} now
   * @param {{pausedFor: number, words: number, endAfter: number}} at
   * @returns {boolean} Nod now.
   */
  tick(now, { pausedFor, words, endAfter }) {
    if (this._noddedThisPause || this._talkSince !== null) return false;
    if (pausedFor < this.afterMs || pausedFor > endAfter - 400) return false;
    if (this.talked < this.minTalkMs) return false;
    if (words - this._wordsAtNod < this.minWords) return false;
    if (now - this._last < this.gapMs) return false;
    this._noddedThisPause = true;
    this._last = now;
    this.talked = 0;
    this._wordsAtNod = words;
    return true;
  }
}

/**
 * Take his own "aham" back out of what you said.
 *
 * Echo cancellation keeps most of it off the microphone, but the recogniser
 * has its own capture, and on some phones "entendi" comes back as your
 * word. Each phrase he said recently is removed once, as a whole run of
 * words -- never a single word out of your sentence that happens to match.
 */
function stripOwn(text, phrases) {
  let words = String(text ?? '').split(/\s+/).filter(Boolean);
  for (const phrase of phrases) {
    const target = normalizeSpeech(phrase).split(' ').filter(Boolean);
    if (!target.length) continue;
    const plain = words.map((w) => normalizeSpeech(w));
    for (let i = 0; i + target.length <= plain.length; i += 1) {
      if (target.every((t, j) => plain[i + j] === t)) {
        words = [...words.slice(0, i), ...words.slice(i + target.length)];
        break;
      }
    }
  }
  return words.join(' ');
}

/**
 * A live conversation: microphone open, transcript in, answer out.
 *
 * Emits `state` (with `detail.state` and `detail.text`), `ask` (with
 * `detail.text`) when a turn ends -- two seconds of silence -- and `nod` in
 * a short pause inside one, for the page to say "aham". The page owns what asking means; this owns the listening.
 */
class LiveSession extends EventTarget {
  /**
   * @param {{lang?: string, gate?: object}} [options]
   */
  constructor({ lang = 'pt-BR', gate = {}, nods = {} } = {}) {
    super();
    this.lang = lang;
    this.gate = new VoiceGate({ hangoverMs: END_OF_TURN_MS, ...gate });
    this.nods = new Backchannel(nods);
    /** What he said while listening, with when -- to take back out. */
    this._own = [];
    this._gateWas = 'silent';
    this.envelope = new Envelope();
    this.barge = new BargeIn();
    this.active = false;

    this._stream = null;
    this._context = null;
    this._analyser = null;
    this._samples = null;
    this._frame = 0;
    this._recognition = null;
    this._final = '';
    this._interim = '';
    this._speaking = null; // the HTMLAudioElement or utterance target, while he talks
  }

  /** Why this browser cannot do live voice, or the empty string. */
  static unavailable() {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      return 'Este navegador não dá acesso ao microfone nesta página. Em Android, use o Chrome e abra por https.';
    }
    if (!recognitionClass()) {
      return 'Este navegador não transcreve fala. No Android, o Chrome faz; o Firefox ainda não.';
    }
    return '';
  }

  /** Open the microphone and start listening. Safe to call twice. */
  async start() {
    if (this.active) return;
    const problem = LiveSession.unavailable();
    if (problem) throw new Error(problem);

    this._stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation is not a nicety here: it is what makes the level
      // meter a second opinion rather than an echo of his own voice.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._context = new AudioContextClass();
    if (this._context.state === 'suspended') await this._context.resume();

    const source = this._context.createMediaStreamSource(this._stream);
    this._analyser = this._context.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.2;
    source.connect(this._analyser);
    this._samples = new Float32Array(this._analyser.fftSize);

    this.active = true;
    this.gate.reset();
    this.envelope.reset();
    this.barge.reset();
    this.nods.reset();
    this._own = [];
    this._gateWas = 'silent';
    this._final = '';
    this._interim = '';

    this._startRecognition();
    this._meter();
    this._emit('listening');
  }

  /** Close the microphone and go quiet. */
  stop() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this._frame);

    if (this._recognition) {
      this._recognition.onend = null;
      try {
        this._recognition.stop();
      } catch {
        /* already stopped */
      }
      this._recognition = null;
    }
    this._stream?.getTracks().forEach((track) => track.stop());
    this._stream = null;
    this._context?.close().catch(() => {});
    this._context = null;
    this._emit('off');
  }

  /**
   * Tell the session he has started speaking, so it can listen for a cut-in.
   *
   * @param {{pause: () => void, setVolume: (v: number) => void}} handle
   */
  speakingStarted(handle) {
    this._speaking = handle;
    this.barge.reset();
    this._emit('answering');
  }

  /**
   * He said something small while listening ("aham"). Remembered for a few
   * seconds, so it can be taken back out if the recogniser hears it as you.
   */
  heardOwn(text, now = performance.now()) {
    this._own.push({ text, at: now });
  }

  /** Your words, minus his recent nods. */
  _clean(text, now = performance.now()) {
    this._own = this._own.filter((entry) => now - entry.at < 8000);
    return this._own.length ? stripOwn(text, this._own.map((entry) => entry.text)) : text;
  }

  /** He finished, or was stopped. */
  speakingEnded() {
    this._speaking = null;
    this.barge.reset();
    if (this.active) this._emit('listening');
  }

  // -- internals ------------------------------------------------------------

  _emit(state, text = '') {
    this.dispatchEvent(new CustomEvent('state', { detail: { state, text } }));
  }

  /** Root-mean-square of the current window, which tracks loudness well enough. */
  _level() {
    this._analyser.getFloatTimeDomainData(this._samples);
    let sum = 0;
    for (const sample of this._samples) sum += sample * sample;
    return Math.sqrt(sum / this._samples.length);
  }

  _meter() {
    if (!this.active) return;
    const now = performance.now();
    this._step(this.envelope.push(this._level(), now), now);
    this._frame = requestAnimationFrame(() => this._meter());
  }

  /** One reading of the meter. Separate from the loop so a test can drive it. */
  _step(level, now) {
    const change = this.gate.push(level, now);

    if (this._speaking) {
      // He is talking. A voice ducks him; only words stop him.
      if (change === 'began' && this.barge.heardVoice(now) === 'duck') {
        this._speaking.setVolume(DUCKED_VOLUME);
        this._emit('cutting-in');
      }
      if (this.barge.tick(now) === 'restore') {
        this._speaking.setVolume(1);
        this._emit('answering');
      }
    } else if (change === 'ended') {
      this._commit();
    } else {
      if (change === 'began') this._emit('hearing');
      // Every frame of a turn, the start included: the nod counter has to
      // see speech begin, or it never counts any.
      this._maybeNod(now);
    }
    this._gateWas = this.gate.state;
  }

  /**
   * Follow the pauses inside a turn, and nod in the right one.
   *
   * The gate only reports a turn's start and end; the breaths in between are
   * its state moving between speaking and falling, read here.
   */
  _maybeNod(now) {
    const was = this._gateWas;
    const is = this.gate.state;
    if (is === 'speaking' && was !== 'speaking') this.nods.began(now);
    if (is === 'falling' && was === 'speaking') this.nods.paused(now);
    if (is !== 'falling') return;
    const words = (this._final + ' ' + this._interim).trim().split(/\s+/).filter(Boolean).length;
    const nod = this.nods.tick(now, {
      pausedFor: now - this.gate._since,
      words,
      endAfter: this.gate.hangoverMs,
    });
    if (nod) this.dispatchEvent(new CustomEvent('nod'));
  }

  /** Hand over whatever was heard, if it amounts to anything. */
  _commit() {
    const text = this._clean((this._final || this._interim).trim()).trim();
    this._final = '';
    this._interim = '';
    this.nods.reset();
    if (!text) {
      this._emit('listening');
      return;
    }
    this._emit('asking', text);
    this.dispatchEvent(new CustomEvent('ask', { detail: { text } }));
  }

  _startRecognition() {
    const Recognition = recognitionClass();
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => this._onResult(event);
    recognition.onerror = (event) => {
      // `no-speech` and `aborted` are ordinary in a session that stays open.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this._emit('error', String(event.error));
      }
    };
    recognition.onend = () => {
      if (!this.active) return;
      setTimeout(() => {
        if (this.active) this._startRecognition();
      }, RESTART_MS);
    };

    try {
      recognition.start();
      this._recognition = recognition;
    } catch {
      // Starting twice throws; the running one is fine.
    }
  }

  _onResult(event) {
    // The meter is the arbiter. Words arriving while it hears nothing are his
    // own voice returning through the microphone, and are dropped.
    if (!this.gate.talking && !this._speaking) return;

    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) this._final += text;
      else interim += text;
    }
    this._interim = interim;

    const heard = this._clean((this._final + interim).trim()).trim();
    if (!heard) return;

    if (this._speaking && this.barge.heardWords() === 'stop') {
      this._speaking.pause();
      this._speaking = null;
      this._emit('hearing', heard);
      return;
    }
    if (!this._speaking) this._emit('hearing', heard);
  }
}
