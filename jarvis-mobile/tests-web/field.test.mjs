/**
 * The three-state contract.
 *
 * Idle is *still* — not slow, not damped, stopped. Speech is driven by measured
 * amplitude. Thinking is a breath the field takes on its own so a wait reads as
 * attention. These tests exist because "it still looks alive at rest" is the
 * kind of regression a screenshot review passes right over.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// The field owns a canvas; these stubs let it run headless without pulling in
// a DOM implementation for what is pure arithmetic.
globalThis.window = { devicePixelRatio: 1 };

function stubCanvas() {
  return {
    width: 400,
    height: 400,
    getBoundingClientRect: () => ({ width: 400, height: 400 }),
    getContext: () => ({ fillRect() {}, set fillStyle(_value) {} }),
  };
}

const { ParticleField } = await import('../web/particles.js');

/** Run the field to rest and return a snapshot of where its particles sit. */
function settle(field, frames = 240) {
  for (let i = 0; i < frames; i += 1) field.frame(1 / 60);
  return Array.from(field.x.slice(0, 60));
}

const maxDrift = (before, field) =>
  before.reduce((worst, value, i) => Math.max(worst, Math.abs(value - field.x[i])), 0);

test('silence brings the field to a complete stop', () => {
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  const resting = settle(field);
  for (let i = 0; i < 90; i += 1) field.frame(1 / 60);
  assert.equal(maxDrift(resting, field), 0, 'a resting field must not drift at all');
});

test('speech moves it', () => {
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  const resting = settle(field);
  field.setLevel(0.9);
  for (let i = 0; i < 30; i += 1) field.frame(1 / 60);
  assert.ok(maxDrift(resting, field) > 0.01, 'a voice should displace the field');
});

test('thinking breathes without being told to speak', () => {
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  const resting = settle(field);
  field.setThinking(true);
  for (let i = 0; i < 120; i += 1) field.frame(1 / 60);
  assert.ok(maxDrift(resting, field) > 0, 'thinking is a visible state');
  assert.equal(field.level, 0, 'thinking must not fake a voice level');
});

test('leaving the thinking state settles back to stillness', () => {
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  settle(field);
  field.setThinking(true);
  for (let i = 0; i < 120; i += 1) field.frame(1 / 60);
  field.setThinking(false);
  const resting = settle(field, 420);
  for (let i = 0; i < 90; i += 1) field.frame(1 / 60);
  assert.ok(maxDrift(resting, field) < 1e-5, 'the breath must fade to nothing');
});

test('a voice overrides the breath rather than stacking with it', () => {
  /* Otherwise an answer arriving mid-thought would articulate the jaw on top
     of a pulse, and the two motions would read as one confused state. */
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  settle(field);
  field.setThinking(true);
  field.setLevel(0.8);
  for (let i = 0; i < 40; i += 1) field.frame(1 / 60);
  assert.ok(field.smoothLevel > 0.05, 'speech is in charge');
});

test('a backgrounded tab cannot fling the field off screen', () => {
  /* requestAnimationFrame hands back a multi-second delta after a tab wakes. */
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  settle(field);
  field.setLevel(1);
  field.frame(12);
  for (const value of field.x) assert.ok(Number.isFinite(value) && Math.abs(value) < 5);
});

test('an unknown shape is refused rather than rendering nothing', () => {
  const field = new ParticleField(stubCanvas(), { count: 200 });
  assert.throws(() => field.setShape('wireframe'), /unknown shape/);
});

test('lip shape separates vowels that loudness renders identical', () => {
  /* Amplitude alone opens the jaw, so "mmm" and "aah" at one volume produce
     the same mouth. Spread is what tells them apart. */
  const widthAt = (spread) => {
    const field = new ParticleField(stubCanvas(), { count: 2000, shape: 'face' });
    settle(field);
    for (let i = 0; i < 60; i += 1) {
      field.setLevel(0.8, spread);
      field.frame(1 / 60);
    }
    let widest = 0;
    for (let i = 0; i < field.count; i += 1) {
      if (field.shapes.face.aperture[i] < 1.2) {
        widest = Math.max(widest, Math.abs(field.x[i]));
      }
    }
    return widest;
  };

  const spreadVowel = widthAt(1);   // "ee"
  const neutral = widthAt(0);
  const rounded = widthAt(-1);      // "oo"

  assert.ok(spreadVowel > neutral, 'a spread vowel stretches the mouth');
  assert.ok(rounded < neutral, 'a rounded vowel purses it');
});

test('lip shape does nothing while he is silent', () => {
  /* The spectrum still reports a shape between words; acting on it would make
     a resting mouth twitch. */
  const field = new ParticleField(stubCanvas(), { count: 800, shape: 'face' });
  const resting = settle(field);
  for (let i = 0; i < 90; i += 1) {
    field.setLevel(0, 1);
    field.frame(1 / 60);
  }
  assert.equal(maxDrift(resting, field), 0, 'silence outranks any lip shape');
});

test('an out-of-range spread is clamped rather than distorting the face', () => {
  const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
  field.setLevel(0.5, 40);
  assert.equal(field.spread, 1);
  field.setLevel(0.5, Number.NaN);
  assert.equal(field.spread, 0);
});
