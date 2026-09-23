/**
 * What his face does besides talk.
 *
 * The vocabulary is FACS: a face is action units with intensities, and an
 * emotion is a combination rather than a thing of its own. That choice is what
 * these tests mostly defend — because it is what makes "talking, and slightly
 * amused" expressible at all, and a library of named emotions cannot blend.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AU,
  AUS,
  EMOTIONS,
  EMOTION_NAMES,
  Expression,
  neutral,
  of,
} from '../web/expression.js';

/** A deterministic generator, so blinks fall where the test expects. */
function seeded(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Run a face forward, returning the last frame. */
function run(face, ms, step = 16, speech = 0) {
  let out = face.frame(0, speech);
  for (let t = step; t <= ms; t += step) out = face.frame(t, speech);
  return out;
}

// -- the vocabulary ----------------------------------------------------------

test('neutral is all zeroes', () => {
  const face = neutral();
  assert.equal(face.length, AUS.length);
  assert.ok(Array.from(face).every((value) => value === 0));
});

test('a vector can be built by name', () => {
  const face = of({ lipPull: 0.8, cheekRaise: 1 });
  // Float32Array: 0.8 is not representable, and the storage is deliberate —
  // these vectors are read once per particle per frame.
  assert.ok(Math.abs(face[AU.lipPull] - 0.8) < 1e-6);
  assert.equal(face[AU.cheekRaise], 1);
  assert.equal(face[AU.browLower], 0);
});

test('intensities are clamped rather than trusted', () => {
  const face = of({ lipPull: 5, browLower: -2, lidRaise: 'muito' });
  assert.equal(face[AU.lipPull], 1);
  assert.equal(face[AU.browLower], 0);
  assert.equal(face[AU.lidRaise], 0);
});

test('a unit nobody has heard of is ignored, not thrown', () => {
  // A model will eventually ask for one.
  assert.doesNotThrow(() => of({ orelhaMexendo: 1 }));
});

// -- the emotions ------------------------------------------------------------

test('a felt smile carries the cheek, not just the lip', () => {
  /* The difference between a polite smile and a felt one is AU6, and leaving
   * it out is why a lot of animated faces look insincere. */
  assert.ok(EMOTIONS.alegre[AU.cheekRaise] > 0.5);
  assert.ok(EMOTIONS.alegre[AU.lipPull] > 0.5);
});

test('sadness raises the inner brow and lowers the corners', () => {
  assert.ok(EMOTIONS.triste[AU.browInner] > 0.5);
  assert.ok(EMOTIONS.triste[AU.lipDepress] > 0.5);
  assert.equal(EMOTIONS.triste[AU.lipPull], 0, 'a sad face does not also smile');
});

test('surprise and anger disagree about the brow', () => {
  // The single clearest contrast in the whole system: up versus down.
  assert.ok(EMOTIONS.surpreso[AU.browOuter] > 0.5);
  assert.equal(EMOTIONS.surpreso[AU.browLower], 0);
  assert.ok(EMOTIONS.bravo[AU.browLower] > 0.5);
  assert.equal(EMOTIONS.bravo[AU.browOuter], 0);
});

test('every emotion is a real vector of the right length', () => {
  for (const name of EMOTION_NAMES) {
    assert.equal(EMOTIONS[name].length, AUS.length, name);
    for (const value of EMOTIONS[name]) {
      assert.ok(value >= 0 && value <= 1, `${name} fora de 0..1`);
    }
  }
});

// -- getting there -----------------------------------------------------------

test('a new expression arrives gradually, not in one frame', () => {
  const face = new Expression({ random: seeded() });
  face.set('alegre');
  const first = face.frame(0);
  const early = face.frame(16);
  assert.ok(early[AU.lipPull] > first[AU.lipPull], 'começou a andar');
  assert.ok(early[AU.lipPull] < EMOTIONS.alegre[AU.lipPull] * 0.5, 'e não chegou de uma vez');
});

test('and it does arrive', () => {
  const face = new Expression({ random: seeded() });
  face.set('alegre');
  const out = run(face, 1500);
  assert.ok(out[AU.lipPull] > EMOTIONS.alegre[AU.lipPull] * 0.95);
});

test('the transition takes the same time at any frame rate', () => {
  /* The same trap as the mouth: a fixed fraction per frame is a per-frame
   * rate, and a 120Hz phone would wear a different face. */
  const at = (step) => {
    const face = new Expression({ random: seeded() });
    face.set('alegre');
    return run(face, 300, step)[AU.lipPull];
  };
  assert.ok(Math.abs(at(16) - at(8)) < 0.03, `${at(16)} vs ${at(8)}`);
});

test('changing your mind mid-transition just changes the target', () => {
  // No queue, no interruption logic: every pair of expressions has a
  // transition because there is only ever one target.
  const face = new Expression({ random: seeded() });
  face.set('alegre');
  run(face, 200);
  face.set('triste');
  const out = run(face, 1500);
  assert.ok(out[AU.lipDepress] > 0.5);
  assert.ok(out[AU.lipPull] < 0.05, 'o sorriso saiu');
});

test('an expression nobody defined settles to neutral', () => {
  const face = new Expression({ random: seeded() });
  face.set('sarcastico');
  const out = run(face, 1200);
  assert.ok(Array.from(out).every((value) => value < 0.05), 'nada travado');
});

// -- livingness --------------------------------------------------------------

test('he blinks on his own', () => {
  const face = new Expression({ random: seeded(7) });
  let closed = 0;
  for (let t = 0; t <= 20_000; t += 16) {
    if (face.frame(t)[AU.blink] > 0.5) closed += 1;
  }
  assert.ok(closed > 0, 'uma face que nunca pisca é uma fotografia de uma face');
});

test('the blinks are spread out, not a flutter', () => {
  const face = new Expression({ random: seeded(7) });
  const moments = [];
  let wasClosed = false;
  for (let t = 0; t <= 30_000; t += 16) {
    const closed = face.frame(t)[AU.blink] > 0.5;
    if (closed && !wasClosed) moments.push(t);
    wasClosed = closed;
  }
  assert.ok(moments.length >= 3, `só ${moments.length} em 30s`);
  for (let i = 1; i < moments.length; i += 1) {
    const gap = moments[i] - moments[i - 1];
    assert.ok(gap > 1500, `piscadas a ${gap}ms uma da outra`);
  }
});

test('a blink can be asked for, and it closes', () => {
  const face = new Expression({ random: seeded() });
  face.frame(0);
  face.blink(0);
  const out = run(face, 160);
  assert.ok(out[AU.blink] > 0.5);
});

test('the face is not a mirror of itself', () => {
  /* Perfect symmetry is the thing that reads as a mask. */
  const face = new Expression({ random: seeded(3) });
  const biases = AUS.map((_, index) => face.sideBias(index));
  assert.ok(biases.some((value) => Math.abs(value) > 0.02));
  assert.ok(biases.every((value) => Math.abs(value) < 0.2), 'e não uma careta');
});

// -- speaking ----------------------------------------------------------------

test('speech lifts the brows without being an expression', () => {
  const quiet = new Expression({ random: seeded() });
  const loud = new Expression({ random: seeded() });
  const a = run(quiet, 500, 16, 0);
  const b = run(loud, 500, 16, 0.9);
  assert.ok(b[AU.browOuter] > a[AU.browOuter] + 0.1, 'as sobrancelhas acompanham a voz');
});

test('and the lift does not stick once he stops', () => {
  const face = new Expression({ random: seeded() });
  run(face, 500, 16, 0.9);
  const after = run(face, 200, 16, 0);
  assert.ok(after[AU.browOuter] < 0.05, `ficou em ${after[AU.browOuter]}`);
});

test('speech on top of an expression adds, it does not replace', () => {
  // The whole reason for action units instead of named emotions.
  const face = new Expression({ random: seeded() });
  face.set('alegre');
  const still = run(face, 1200, 16, 0);
  const talking = face.frame(1216, 0.8);
  assert.ok(talking[AU.lipPull] > 0.5, 'continua alegre');
  assert.ok(talking[AU.browOuter] > still[AU.browOuter], 'e fala por cima');
});

// -- robustness --------------------------------------------------------------

test('a huge gap between frames does not fling the face', () => {
  const face = new Expression({ random: seeded() });
  face.set('surpreso');
  face.frame(0);
  const out = face.frame(600_000); // a backgrounded tab
  for (const value of out) assert.ok(value >= 0 && value <= 1, `${value} fora de 0..1`);
});

test('time going backwards does not either', () => {
  const face = new Expression({ random: seeded() });
  face.frame(1000);
  const out = face.frame(500);
  for (const value of out) assert.ok(Number.isFinite(value));
});
