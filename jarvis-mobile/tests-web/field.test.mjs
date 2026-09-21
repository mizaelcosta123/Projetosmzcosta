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

// -- how much the voice moves it --------------------------------------------

/** The mean distance of a particle from the centre — how big the cloud is. */
function radius(field, n = 400) {
  let total = 0;
  for (let i = 0; i < n; i += 1) total += Math.hypot(field.x[i], field.y[i]);
  return total / n;
}

/** A phone-shaped canvas: 412x880 CSS, which is what this is built for. */
function phoneCanvas() {
  return {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 412, height: 880 }),
    getContext: () => ({ fillRect() {}, set fillStyle(_value) {} }),
  };
}

/** The sphere's shell, ignoring the halo, which is meant to bleed off screen. */
function shell(field) {
  const roles = field.shapes.orb.roles;
  const radii = [];
  for (let i = 0; i < field.count; i += 1) {
    if (roles[i] !== 4 /* HALO */) radii.push(Math.hypot(field.x[i], field.y[i]));
  }
  return {
    mean: radii.reduce((a, b) => a + b, 0) / radii.length,
    max: Math.max(...radii),
  };
}

/** How crowded the middle is — the count inside half the resting radius. */
function crowding(field, within) {
  let inside = 0;
  for (let i = 0; i < field.count; i += 1) {
    if (Math.hypot(field.x[i], field.y[i]) < within) inside += 1;
  }
  return inside;
}

test('the sphere opens up when he speaks', () => {
  /* The complaint this pins: on the sphere there is no jaw and no lips, so
   * speech could only swell it by 5% and a shout looked like a whisper. */
  const field = new ParticleField(phoneCanvas(), { count: 3000, shape: 'orb' });
  settle(field);
  const quiet = shell(field);

  field.setLevel(0.9);
  for (let i = 0; i < 120; i += 1) field.frame(1 / 60);
  const loud = shell(field);

  assert.ok(loud.mean > quiet.mean * 1.2, `only grew from ${quiet.mean} to ${loud.mean}`);
});

test('and the crowded middle is what empties', () => {
  // Separation, not inflation: the interior thins out as its particles move
  // outward, while the rim stays roughly where it was.
  const field = new ParticleField(phoneCanvas(), { count: 3000, shape: 'orb' });
  settle(field);
  const before = crowding(field, 0.4);

  field.setLevel(0.9);
  for (let i = 0; i < 120; i += 1) field.frame(1 / 60);
  const after = crowding(field, 0.4);

  assert.ok(after < before * 0.8, `the middle did not thin: ${before} -> ${after}`);
});

test('and none of it leaves the screen, at any volume', () => {
  /* The constraint that decides how hard the sphere may push. A phone is only
   * ~0.89 of these units wide, and an earlier version of this expansion threw
   * the shell clean off both sides at anything above half volume. The halo is
   * excluded on purpose: it starts beyond the edge and is meant to bleed. */
  for (const level of [0.25, 0.5, 0.75, 1]) {
    const field = new ParticleField(phoneCanvas(), { count: 3000, shape: 'orb' });
    settle(field);
    field.setLevel(level);
    for (let i = 0; i < 120; i += 1) field.frame(1 / 60);

    const halfWidth = field.canvas.width / 2 / field.scale;
    assert.ok(
      shell(field).max < halfWidth,
      `at ${level} the shell reaches ${shell(field).max}, past the edge at ${halfWidth}`
    );
  }
});

test('a louder voice agitates more than a quiet one', () => {
  const shakeAt = (level) => {
    const field = new ParticleField(stubCanvas(), { count: 400, shape: 'face' });
    settle(field);
    field.setLevel(level);
    for (let i = 0; i < 40; i += 1) field.frame(1 / 60);
    // Speed, not position: agitation is how much they are moving.
    let total = 0;
    for (let i = 0; i < 400; i += 1) total += Math.abs(field.vx[i]) + Math.abs(field.vy[i]);
    return total;
  };
  assert.ok(shakeAt(0.9) > shakeAt(0.3) * 1.5, 'loud should visibly outrun quiet');
});

test('the mouth keeps up with the voice', () => {
  /* The release used to take ~200ms — longer than a syllable — so the mouth
   * was still closing on one sound while the voice was into the next. */
  const field = new ParticleField(stubCanvas(), { count: 200, shape: 'face' });
  field.setLevel(1);
  for (let i = 0; i < 20; i += 1) field.frame(1 / 60);

  field.setLevel(0); // the sound stops
  let frames = 0;
  while (field.smoothLevel > 0.1 && frames < 120) {
    field.frame(1 / 60);
    frames += 1;
  }
  const ms = (frames / 60) * 1000;
  assert.ok(ms < 180, `took ${Math.round(ms)}ms to close — a syllable is ~200ms`);
});

test('the smoothing means the same thing at any frame rate', () => {
  /* It used to be a fixed fraction per frame, which is a per-frame rate: a
   * 120Hz phone settled twice as fast as a 60Hz one, so the same voice drove
   * a different face depending on the display. */
  const run = (fps) => {
    const field = new ParticleField(stubCanvas(), { count: 100, shape: 'face' });
    field.setLevel(1);
    for (let i = 0; i < fps / 4; i += 1) field.frame(1 / fps); // a quarter second
    return field.smoothLevel;
  };
  assert.ok(Math.abs(run(60) - run(120)) < 0.01, `${run(60)} vs ${run(120)}`);
});
