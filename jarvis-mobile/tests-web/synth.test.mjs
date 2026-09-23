/**
 * The synthesizer: what the hands mean musically, and the audio graph
 * driven by a fake AudioContext that records every parameter it is given.
 * The real sound is measured in tests-browser/lens.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WAVE, SCALES, SHAPE_WAVES, Synth, controls, frequency, keyboard, noteAt, noteName, openness,
} from '../web/synth.js';

const SCREEN = { width: 400, height: 800 };
const hand = (x, y, fingers = 5, extra = {}) => ({
  at: { x, y },
  up: Object.fromEntries(['polegar', 'indicador', 'medio', 'anelar', 'minimo'].map((f, i) => [f, i < fingers])),
  ...extra,
});

test('A4 is 440 and is called Lá 4; an octave doubles', () => {
  assert.equal(frequency(69), 440);
  assert.equal(frequency(81), 880);
  assert.equal(noteName(69), 'Lá 4');
  assert.equal(noteName(60), 'Dó 4');
  assert.equal(noteName(61), 'Dó♯ 4');
});

test('two octaves of the minor pentatonic from Lá 3: eleven notes, all in the scale', () => {
  const notes = keyboard();
  assert.equal(notes.length, 11);
  assert.equal(notes[0], 57);
  assert.equal(notes.at(-1), 81);
  for (const n of notes) assert.ok(SCALES.pentatonica.includes((n - 57) % 12), noteName(n));
});

test('left is low, right is high, and a wobbling hand stays on its note', () => {
  const notes = keyboard();
  assert.equal(noteAt(0, 400, notes), 57);
  assert.equal(noteAt(399, 400, notes), 81);
  assert.ok(noteAt(100, 400, notes) < noteAt(300, 400, notes));
  // A few pixels of camera jitter inside one key: the same note.
  const key = 400 / notes.length;
  assert.equal(noteAt(key * 3 + 5, 400, notes), noteAt(key * 3 + 12, 400, notes));
  assert.equal(noteAt(-50, 400, notes), 57, 'fora da tela: a primeira');
});

test('a fist is silence, an open hand is loud, half-open is quiet', () => {
  const loud = controls(hand(200, 400, 5), SCREEN).gain;
  const half = controls(hand(200, 400, 3), SCREEN).gain;
  assert.equal(controls(hand(200, 400, 0), SCREEN).gain, 0);
  assert.ok(half > 0 && half < loud / 2, `${half} vs ${loud}`);
  assert.equal(openness(hand(0, 0, 5)), 1);
});

test('higher hand, brighter filter -- six octaves of it', () => {
  const low = controls(hand(200, 800), SCREEN).cutoff;
  const high = controls(hand(200, 0), SCREEN).cutoff;
  assert.equal(low, 200);
  assert.equal(high, 200 * 64);
});

test('the hologram under the hand picks the waveform', () => {
  assert.equal(controls(hand(1, 1), SCREEN, { shape: 'esfera' }).wave, 'sine');
  assert.equal(controls(hand(1, 1), SCREEN, { shape: 'cubo' }).wave, 'square');
  assert.equal(controls(hand(1, 1), SCREEN, { shape: 'piramide' }).wave, 'sawtooth');
  assert.equal(controls(hand(1, 1), SCREEN, {}).wave, DEFAULT_WAVE);
  assert.ok(Object.values(SHAPE_WAVES).every((w) => ['sine', 'square', 'sawtooth', 'triangle'].includes(w)));
});

test('the second hand is the effects: right for echo, up for vibrato', () => {
  const none = controls(hand(200, 400), SCREEN);
  assert.deepEqual([none.echo, none.vibrato], [0, 0]);
  const fx = controls(hand(200, 400), SCREEN, { second: hand(400, 0) });
  assert.ok(fx.echo > 0.5 && fx.vibrato === 25);
});

test('no hand, no sound', () => {
  const c = controls(null, SCREEN);
  assert.equal(c.gain, 0);
  assert.equal(c.midi, null);
});

// -- the graph, on a fake context --------------------------------------------

function fakeContext() {
  const log = [];
  const param = (name) => ({
    setValueAtTime: (v) => log.push([name, 'set', v]),
    setTargetAtTime: (v) => log.push([name, 'target', v]),
  });
  const node = (kind) => {
    const n = { kind, connect: () => {}, start: () => {}, stop: () => { n.stopped = true; } };
    return n;
  };
  const ctx = {
    currentTime: 0,
    destination: node('out'),
    state: 'suspended',
    resume: async () => { ctx.state = 'running'; },
    close: async () => { ctx.state = 'closed'; },
    createOscillator: () => Object.assign(node('osc'), { type: 'sine', frequency: param('freq'), detune: param('detune') }),
    createBiquadFilter: () => Object.assign(node('filter'), { type: '', frequency: param('cutoff'), Q: param('q') }),
    createGain: () => Object.assign(node('gain'), { gain: param('gain') }),
    createDelay: () => Object.assign(node('delay'), { delayTime: param('delay') }),
    createDynamicsCompressor: () => Object.assign(node('limiter'), {
      threshold: param('threshold'), knee: param('knee'), ratio: param('ratio'),
      attack: param('attack'), release: param('release'),
    }),
    createAnalyser: () => Object.assign(node('analyser'), {
      fftSize: 8,
      getFloatTimeDomainData: (b) => b.fill(0.1),
    }),
  };
  return { ctx, log };
}

test('start builds the graph, resumes the context, and begins silent', async () => {
  const { ctx } = fakeContext();
  const synth = new Synth({ createContext: () => ctx });
  assert.equal(await synth.start(), true);
  assert.equal(ctx.state, 'running');
  assert.equal(synth.nodes.osc.length, 2);
  assert.equal(synth.nodes.osc[0].type, DEFAULT_WAVE);
});

test('set glides pitch and volume, and switches the waveform', async () => {
  const { ctx, log } = fakeContext();
  const synth = new Synth({ createContext: () => ctx });
  await synth.start();
  log.length = 0;
  synth.set(controls(hand(399, 0), SCREEN, { shape: 'cubo' }));
  assert.ok(log.some(([n, how, v]) => n === 'freq' && how === 'target' && v === 880));
  assert.ok(log.some(([n, how, v]) => n === 'gain' && how === 'target' && v > 0.4));
  assert.equal(synth.nodes.osc[1].type, 'square');
  log.length = 0;
  synth.set(controls(null, SCREEN));
  assert.ok(log.some(([n, , v]) => n === 'gain' && v === 0), 'sem mão, silêncio');
  assert.ok(!log.some(([n]) => n === 'freq'), 'e a nota fica onde estava, sem deslizar para outra');
});

test("the level is the output's RMS, and zero when stopped", async () => {
  const { ctx } = fakeContext();
  const synth = new Synth({ createContext: () => ctx });
  assert.equal(synth.level(), 0);
  await synth.start();
  assert.ok(Math.abs(synth.level() - 0.3) < 1e-6);
  await synth.stop();
  assert.equal(synth.level(), 0);
  assert.equal(ctx.state, 'closed');
  assert.equal(synth.running, false);
});

test('no Web Audio: start says so instead of throwing', async () => {
  const synth = new Synth({ createContext: () => { throw new TypeError('AudioContext is not a constructor'); } });
  assert.equal(await synth.start(), false);
  assert.equal(synth.running, false);
});
