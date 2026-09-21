/**
 * Live voice: telling your voice from his, and noise from either.
 *
 * The two classes here decide when he stops talking, and getting that wrong is
 * the difference between a conversation and a machine that interrupts itself.
 * Both take a clock as an argument, so these run in milliseconds of pretend
 * time with no microphone anywhere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BargeIn, Envelope, VoiceGate, WakeWord, normalizeSpeech, wakeMatch } from '../web/live.js';

/** Feed a constant level for a stretch, returning every transition it caused. */
function hold(gate, level, ms, { from = 0, step = 16 } = {}) {
  const seen = [];
  for (let t = from; t < from + ms; t += step) {
    const change = gate.push(level, t);
    if (change) seen.push({ change, at: t });
  }
  return seen;
}

// -- the gate ---------------------------------------------------------------

test('silence is silence', () => {
  const gate = new VoiceGate();
  assert.deepEqual(hold(gate, 0.005, 3000), []);
  assert.equal(gate.talking, false);
});

test('a sustained voice begins, and only once', () => {
  const gate = new VoiceGate();
  const seen = hold(gate, 0.2, 2000);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].change, 'began');
  assert.equal(gate.talking, true);
});

test('a word is not heard before the onset has passed', () => {
  const gate = new VoiceGate({ onsetMs: 180 });
  const seen = hold(gate, 0.2, 2000);
  assert.ok(seen[0].at >= 180, `began at ${seen[0].at}ms, too eager`);
  assert.ok(seen[0].at < 260, `began at ${seen[0].at}ms, too slow`);
});

test('a slammed door never counts as speech', () => {
  // The whole promise: he does not stop answering for a noise. 80ms of loud,
  // then nothing.
  const gate = new VoiceGate();
  const seen = [...hold(gate, 0.9, 80), ...hold(gate, 0.002, 2000, { from: 80 })];
  assert.deepEqual(seen, []);
  assert.equal(gate.talking, false);
});

test('a pause inside a sentence does not end it', () => {
  const gate = new VoiceGate({ hangoverMs: 900 });
  hold(gate, 0.2, 600); // talking
  const quiet = hold(gate, 0.001, 400, { from: 600 }); // a breath
  const more = hold(gate, 0.2, 600, { from: 1000 }); // carrying on
  assert.deepEqual(quiet, []);
  assert.deepEqual(more, []);
  assert.equal(gate.talking, true);
});

test('the end arrives after the hangover, not before', () => {
  const gate = new VoiceGate({ hangoverMs: 900 });
  hold(gate, 0.2, 600);
  const seen = hold(gate, 0.001, 3000, { from: 600 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].change, 'ended');
  assert.ok(seen[0].at - 600 >= 900, 'ended too early');
  assert.ok(seen[0].at - 600 < 1000, 'ended too late');
});

test('hysteresis keeps a quiet talker from flickering', () => {
  // Between `off` and `on`: not loud enough to start, not quiet enough to end.
  const gate = new VoiceGate({ on: 0.055, off: 0.028 });
  hold(gate, 0.2, 600);
  const seen = hold(gate, 0.04, 5000, { from: 600 });
  assert.deepEqual(seen, [], 'a mid-level murmur must not end the phrase');
  assert.equal(gate.talking, true);
});

test('reset forgets everything', () => {
  const gate = new VoiceGate();
  hold(gate, 0.2, 1000);
  gate.reset();
  assert.equal(gate.talking, false);
  assert.equal(gate.state, 'silent');
});

// -- the envelope -----------------------------------------------------------

/**
 * A voice with syllables, shaped like the WAV that exposed this.
 *
 * Amplitude modulated at 4.5 Hz — conversational syllable rate — reaching zero
 * at every trough, which is what real speech does between syllables.
 */
function syllabic(ms) {
  return (0.5 + 0.5 * Math.sin((2 * Math.PI * 4.5 * ms) / 1000)) * 0.35;
}

test('a rise is followed immediately', () => {
  const envelope = new Envelope();
  assert.equal(envelope.push(0.4, 0), 0.4);
});

test('a fall decays instead of dropping', () => {
  const envelope = new Envelope({ releaseMs: 150 });
  envelope.push(0.4, 0);
  const after = envelope.push(0, 50);
  assert.ok(after > 0.2, `decayed to ${after}, too fast`);
  assert.ok(after < 0.4, `did not decay at all: ${after}`);
});

test('the decay is frame-rate independent', () => {
  // Same elapsed time, different sample counts: 60fps and 30fps must agree,
  // or the gate behaves differently on a busy phone.
  const fast = new Envelope({ releaseMs: 150 });
  const slow = new Envelope({ releaseMs: 150 });
  fast.push(0.5, 0);
  slow.push(0.5, 0);
  for (let t = 16; t <= 160; t += 16) fast.push(0, t);
  for (let t = 32; t <= 160; t += 32) slow.push(0, t);
  assert.ok(Math.abs(fast.value - slow.value) < 0.01, `${fast.value} vs ${slow.value}`);
});

test('the envelope never reads below the input', () => {
  const envelope = new Envelope();
  envelope.push(0.5, 0);
  assert.equal(envelope.push(0.3, 10_000), 0.3, 'a long gap must not fall under the signal');
});

test('syllables reach the gate as one phrase', () => {
  /* The regression, found by a browser and a synthesised voice.
   *
   * Speech dips to near-silence between syllables, several times a second.
   * Fed raw, every dip sent the gate back to silent and the onset timer never
   * completed — a staccato speaker was simply never heard. */
  const envelope = new Envelope();
  const gate = new VoiceGate();
  const seen = [];

  for (let t = 0; t < 2000; t += 16) {
    const change = gate.push(envelope.push(syllabic(t), t), t);
    if (change) seen.push(change);
  }
  assert.deepEqual(seen, ['began'], 'a syllabic voice must be heard, once');
});

test('without the envelope, that same voice is never heard', () => {
  // The counter-example, kept because it is the argument for the follower
  // existing at all. Each trough drops the gate back to silent before the
  // onset timer completes, so it never reaches 'speaking'.
  const gate = new VoiceGate();
  const seen = [];
  for (let t = 0; t < 2000; t += 16) {
    const change = gate.push(syllabic(t), t);
    if (change) seen.push(change);
  }
  assert.deepEqual(seen, []);
});

// -- interrupting him -------------------------------------------------------

test('a voice ducks him but does not stop him', () => {
  const barge = new BargeIn();
  assert.equal(barge.heardVoice(0), 'duck');
  assert.equal(barge.tick(100), null, 'too early to give up on it');
});

test('words confirm the cut-in', () => {
  const barge = new BargeIn();
  barge.heardVoice(0);
  assert.equal(barge.heardWords(), 'stop');
});

test('noise with no words lets him carry on', () => {
  const barge = new BargeIn({ confirmMs: 1200 });
  barge.heardVoice(0);
  assert.equal(barge.tick(1199), null);
  assert.equal(barge.tick(1200), 'restore');
  assert.equal(barge.tick(5000), null, 'restoring happens once');
});

test('words with no voice behind them are his own echo, and are ignored', () => {
  // Nothing ducked, so nothing was heard by the meter: the recogniser is
  // transcribing the speaker. Stopping here would make him interrupt himself.
  const barge = new BargeIn();
  assert.equal(barge.heardWords(), null);
});

test('a second voice while already ducked does not re-duck', () => {
  const barge = new BargeIn();
  assert.equal(barge.heardVoice(0), 'duck');
  assert.equal(barge.heardVoice(50), null);
});

test('after restoring, a fresh voice ducks again', () => {
  const barge = new BargeIn({ confirmMs: 1000 });
  barge.heardVoice(0);
  barge.tick(1000);
  assert.equal(barge.heardVoice(1100), 'duck');
});

// -- the two together -------------------------------------------------------

test('noise then speech: he ducks, waits, and only stops when words land', () => {
  const gate = new VoiceGate();
  const barge = new BargeIn({ confirmMs: 1200 });
  const acted = [];

  // A clatter: loud, brief. The gate never begins, so nothing ducks.
  for (const { change } of hold(gate, 0.9, 80)) {
    if (change === 'began') acted.push(barge.heardVoice(0));
  }
  assert.deepEqual(acted, [], 'a clatter must not touch his volume');

  // Now a real voice.
  for (const { change, at } of hold(gate, 0.25, 1000, { from: 200 })) {
    if (change === 'began') acted.push(barge.heardVoice(at));
  }
  assert.deepEqual(acted, ['duck']);
  assert.equal(barge.heardWords(), 'stop');
});

// -- his name ---------------------------------------------------------------

test('the four ways he was asked to be called all wake him', () => {
  for (const said of ['ei Jarvis', 'Jarvis', 'olá Jarvis', 'fala comigo Jarvis']) {
    assert.equal(wakeMatch(said).woke, true, said);
  }
});

test('accents and punctuation are not part of the comparison', () => {
  // A recogniser returns "olá" and "ola" interchangeably, and punctuates when
  // it feels like it.
  for (const said of ['Olá, Jarvis!', 'ola jarvis', 'OLÁ  JARVIS', 'Jarvis?']) {
    assert.equal(wakeMatch(said).woke, true, said);
  }
});

test('what he mishears is still his name', () => {
  for (const said of ['ei jarves', 'javis', 'oi jarbas']) {
    assert.equal(wakeMatch(said).woke, true, said);
  }
});

test('the question after his name comes with it', () => {
  assert.deepEqual(wakeMatch('Jarvis, qual a bateria do meu celular?'), {
    woke: true,
    rest: 'qual a bateria do meu celular',
  });
  assert.deepEqual(wakeMatch('ei Jarvis abre o youtube'), {
    woke: true,
    rest: 'abre o youtube',
  });
});

test('calling him with nothing after leaves nothing to ask', () => {
  assert.deepEqual(wakeMatch('ei Jarvis'), { woke: true, rest: '' });
});

test('ordinary conversation does not wake him', () => {
  for (const said of [
    'qual a bateria do meu celular',
    'abre o youtube',
    'javascript é uma linguagem',
    '',
    '   ',
  ]) {
    assert.equal(wakeMatch(said).woke, false, JSON.stringify(said));
  }
});

test('his name inside a longer word does not count', () => {
  // Word-by-word, not substring: "jarvisismo" is not him.
  assert.equal(wakeMatch('jarvisismo').woke, false);
  assert.equal(wakeMatch('isso é um jarvisito').woke, false);
});

test('normalizeSpeech survives whatever it is handed', () => {
  assert.equal(normalizeSpeech(null), '');
  assert.equal(normalizeSpeech(undefined), '');
  assert.equal(normalizeSpeech('  Olá,   MUNDO!  '), 'ola mundo');
});

// -- a refusal and an outage are not the same thing -------------------------

/** A recogniser whose only job is to report one error. */
function failWith(code) {
  class Failing {
    constructor() {
      this.lang = '';
      Failing.last = this;
    }
    start() {
      // Errors arrive asynchronously in a real browser; keep that shape.
      queueMicrotask(() => this.onerror?.({ error: code }));
    }
    stop() {
      this.onend?.();
    }
  }
  globalThis.SpeechRecognition = Failing;
  globalThis.webkitSpeechRecognition = Failing;
  return Failing;
}

/** Collect the events a WakeWord emits while an error code is in force. */
async function eventsFor(code) {
  failWith(code);
  const wake = new WakeWord();
  const seen = [];
  for (const name of ['denied', 'unavailable']) {
    wake.addEventListener(name, () => seen.push(name));
  }
  wake.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const armed = wake.armed;
  wake.stop();
  delete globalThis.SpeechRecognition;
  delete globalThis.webkitSpeechRecognition;
  return { seen, armed };
}

test('a person saying no is remembered', async () => {
  const { seen, armed } = await eventsFor('not-allowed');
  assert.deepEqual(seen, ['denied']);
  assert.equal(armed, false, 'a refusal stops the retrying');
});

test('the service being unreachable is not a refusal', async () => {
  /* The bug this pins. `service-not-allowed` means the transcription service
   * could not be reached — nobody was ever asked for permission. Reporting it
   * as a denial told people they had refused something they never saw, and
   * switched the wake word off for good over what is usually a hiccup. */
  const { seen, armed } = await eventsFor('service-not-allowed');
  assert.deepEqual(seen, ['unavailable']);
  assert.equal(armed, true, 'it comes back on its own, so keep listening');
});

test('the ordinary errors are not announced at all', async () => {
  // Chrome fires these constantly; onend restarts and nobody needs to know.
  for (const code of ['no-speech', 'aborted', 'network']) {
    const { seen, armed } = await eventsFor(code);
    assert.deepEqual(seen, [], code);
    assert.equal(armed, true, code);
  }
});
