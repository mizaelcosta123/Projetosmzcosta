/**
 * Eyes that jump, and a head that follows them late.
 *
 * These check the three facts the module is built on, because each of them is
 * easy to break with a change that looks like a smoothing tweak: the eye
 * moves in jumps and not in glides, the head only helps with the big ones,
 * and the eyes give the movement back as the head arrives.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Gaze, MOODS } from '../web/gaze.js';

/** A seeded generator, so a failure is the same failure tomorrow. */
function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Run `ms` of frames at `step`, collecting each one. */
function run(gaze, ms, { step = 16.7, speech = 0, from = 0 } = {}) {
  const frames = [];
  for (let t = from; t <= from + ms; t += step) frames.push({ t, ...gaze.frame(t, speech) });
  return frames;
}

const maxOf = (frames, key) => Math.max(...frames.map((f) => Math.abs(f[key])));

// -- saccades ---------------------------------------------------------------

test('the eye arrives in well under a tenth of a second', () => {
  /* A saccade is ballistic. Anything that eases over a third of a second is a
     puppet, and it is the most common way to get this wrong. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.8, 0);
  const frames = run(gaze, 400, { step: 5, from: 1 });
  // eyeX alone never reaches the target and must not: the head starts turning
  // at once and the eye gives that much back. Where he is *looking* is the
  // sum, and that is what has to arrive.
  const arrived = frames.find((f) => f.eyeX + f.yaw > 0.8 * 0.9);
  assert.ok(arrived, 'nunca chegou');
  assert.ok(arrived.t < 100, `demorou ${arrived.t.toFixed(0)}ms`);
});

test('and then it holds still', () => {
  /* The hold is as much of a saccade as the jump. An eye that drifts between
     fixations reads as drunk. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.5, 0.2);
  run(gaze, 200, { from: 1 });
  const settled = run(gaze, 600, { from: 202 });
  // Again the sum: the eye is still handing movement back to the head here,
  // which is motion with a reason. The gaze is what must not wander.
  const look = settled.map((f) => f.eyeX + f.yaw);
  const span = Math.max(...look) - Math.min(...look);
  assert.ok(span < 0.02, `derivou ${span.toFixed(3)} enquanto deveria estar parado`);
});

test('he does not stare at one spot forever', () => {
  const gaze = new Gaze({ random: seeded(11) });
  const frames = run(gaze, 12000);
  const spots = new Set(frames.map((f) => f.eyeX.toFixed(1)));
  assert.ok(spots.size > 3, `só ${spots.size} posições em 12 segundos`);
});

test('the fixations are not a metronome', () => {
  /* Evenly spaced glances read as a machine sweeping a room. */
  const gaze = new Gaze({ random: seeded(3) });
  const frames = run(gaze, 20000);
  const jumps = [];
  for (let i = 1; i < frames.length; i += 1) {
    if (Math.abs(frames[i].eyeX - frames[i - 1].eyeX) > 0.02) jumps.push(frames[i].t);
  }
  const gaps = [];
  for (let i = 1; i < jumps.length; i += 1) {
    const gap = jumps[i] - jumps[i - 1];
    if (gap > 100) gaps.push(gap); // one jump spans a few frames
  }
  assert.ok(gaps.length > 3, 'poucas fixações para julgar');
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const spread = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  assert.ok(spread > mean * 0.2, `intervalos regulares demais (desvio ${spread.toFixed(0)}ms)`);
});

// -- the head ---------------------------------------------------------------

test('a small glance does not move the head', () => {
  /* Under about fifteen degrees the head stays put. A head that tracks every
     flick is a bobblehead. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.15, 0);
  const frames = run(gaze, 2000, { from: 1 });
  assert.ok(maxOf(frames, 'yaw') < 0.01, `a cabeça mexeu ${maxOf(frames, 'yaw').toFixed(3)}`);
});

test('a big one does', () => {
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.9, 0);
  const frames = run(gaze, 2000, { from: 1 });
  // The head takes a little over half of what is left past the threshold, and
  // never more than HEAD_LIMIT. Turning further puts the face in
  // three-quarter view, where the perspective divide walks it off the frame.
  assert.ok(frames[frames.length - 1].yaw > 0.3, 'a cabeça deveria ter virado junto');
});

test('the eyes get there first', () => {
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.9, 0);
  const frames = run(gaze, 2000, { step: 5, from: 1 });
  const eyeThere = frames.findIndex((f) => Math.abs(f.eyeX) > 0.5);
  const headThere = frames.findIndex((f) => f.yaw > 0.3);
  assert.ok(eyeThere >= 0 && headThere >= 0, 'um dos dois nunca chegou');
  assert.ok(eyeThere < headThere, 'a cabeça não pode chegar antes dos olhos');
});

test('and give the movement back as the head arrives', () => {
  /* The counter-rotation. Without it the eyes stay pinned to the corner of
     the socket while the head turns, and he looks possessed. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.95, 0);
  const frames = run(gaze, 2500, { step: 5, from: 1 });
  const peak = frames.reduce((best, f) => (f.eyeX > best.eyeX ? f : best));
  const last = frames[frames.length - 1];
  assert.ok(peak.eyeX > 0.5, `o olho mal saiu do lugar (${peak.eyeX.toFixed(2)})`);
  assert.ok(last.eyeX < peak.eyeX * 0.75, `o olho ficou no canto (${last.eyeX.toFixed(2)})`);
  // What the eye gives back is what the head takes on, measured over the same
  // stretch. Comparing against the head's *total* turn would be wrong: the
  // head is already moving by the time the eye peaks, so the peak is never
  // the uncountered maximum.
  const gaveBack = peak.eyeX - last.eyeX;
  const headTook = last.yaw - peak.yaw;
  assert.ok(
    Math.abs(gaveBack - headTook) < 0.05,
    `devolveu ${gaveBack.toFixed(3)} enquanto a cabeça assumiu ${headTook.toFixed(3)}`
  );
});

test('the gaze itself never wavers while the head catches up', () => {
  /* eye-in-head plus head is where he is actually looking, and that is what
     must hold steady. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.95, 0);
  const frames = run(gaze, 2500, { step: 5, from: 1 }).filter((f) => f.t > 300);
  for (const f of frames) {
    assert.ok(Math.abs(f.eyeX + f.yaw - 0.95) < 0.06, `olhar escorregou para ${(f.eyeX + f.yaw).toFixed(2)}`);
  }
});

test('the head tilts into a turn', () => {
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.at(0.9, 0);
  const frames = run(gaze, 2000, { from: 1 });
  const last = frames[frames.length - 1];
  assert.ok(Math.abs(last.roll) > 0.05, 'sem inclinação');
  assert.ok(Math.sign(last.roll) !== Math.sign(last.yaw), 'inclinou para o lado errado');
});

// -- moods ------------------------------------------------------------------

test('thinking looks away, attending looks at you', () => {
  const away = new Gaze({ random: seeded(5) }).look('pensando');
  const here = new Gaze({ random: seeded(5) }).look('atento');
  const reach = (gaze) => {
    const frames = run(gaze, 15000);
    return frames.reduce((a, f) => a + Math.hypot(f.eyeX, f.eyeY), 0) / frames.length;
  };
  assert.ok(reach(away) > reach(here), 'pensando deveria olhar mais longe');
});

test('an unknown mood settles somewhere sane instead of throwing', () => {
  /* A model will eventually ask him to look "desconfiado". */
  const gaze = new Gaze({ random: seeded() });
  assert.doesNotThrow(() => gaze.look('desconfiado'));
  assert.ok(gaze.mood in MOODS);
});

test('changing mood re-aims now, not in three seconds', () => {
  const gaze = new Gaze({ random: seeded(9) });
  run(gaze, 500);
  const before = gaze.wantX;
  gaze.look('pensando');
  assert.notEqual(gaze.wantX, before, 'continuou mirando no alvo antigo');
});

// -- the eye-roll -----------------------------------------------------------

test('rolling the eyes goes up and around, then comes back', () => {
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.rollEyes(1);
  const frames = run(gaze, 900, { step: 5, from: 1 });
  const top = Math.min(...frames.map((f) => f.eyeY));
  assert.ok(top < -0.4, `não subiu o bastante (${top.toFixed(2)})`);
  const across = Math.min(...frames.map((f) => f.eyeX));
  assert.ok(across < -0.2, 'não passou de lado');
  assert.equal(gaze.rolling, false, 'devia ter terminado');
  const back = frames[frames.length - 1];
  assert.ok(Math.hypot(back.eyeX, back.eyeY) < 0.35, 'não voltou');
});

test('a roll survives a frame rate that skips most of it', () => {
  /* A 10fps phone must still see the whole gesture, not land between phases
     and leave the eyes stuck at the top. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.rollEyes(1);
  run(gaze, 1500, { step: 100, from: 1 });
  assert.equal(gaze.rolling, false);
});

// -- speaking and nodding ---------------------------------------------------

test('speaking moves the head a little', () => {
  const quiet = run(new Gaze({ random: seeded(2) }), 3000);
  const loud = run(new Gaze({ random: seeded(2) }), 3000, { speech: 0.8 });
  assert.ok(maxOf(loud, 'pitch') > maxOf(quiet, 'pitch'), 'a cabeça deveria acompanhar a fala');
});

test('a nod is a dip that ends', () => {
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.nod(1);
  const frames = run(gaze, 1400, { from: 1 });
  assert.ok(maxOf(frames.slice(0, 40), 'pitch') > 0.08, 'não abaixou');
  assert.ok(Math.abs(frames[frames.length - 1].pitch) < 0.05, 'ficou de cabeça baixa');
});

// -- robustness -------------------------------------------------------------

test('nothing leaves its range, however long it runs', () => {
  const gaze = new Gaze({ random: seeded(13) });
  const frames = run(gaze, 60000, { speech: 1 });
  for (const f of frames) {
    for (const key of ['eyeX', 'eyeY', 'yaw', 'pitch', 'roll', 'lid']) {
      assert.ok(Number.isFinite(f[key]), `${key} virou ${f[key]}`);
      assert.ok(Math.abs(f[key]) <= 1.01, `${key} saiu da faixa: ${f[key]}`);
    }
  }
});

test('a huge gap between frames does not fling the head off', () => {
  /* A backgrounded tab hands back a step measured in minutes. */
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(0);
  gaze.frame(400000, 0.5);
  const after = gaze.frame(400016);
  for (const key of ['eyeX', 'yaw', 'pitch']) {
    assert.ok(Number.isFinite(after[key]) && Math.abs(after[key]) <= 1.01, key);
  }
});

test('time running backwards does not either', () => {
  const gaze = new Gaze({ random: seeded() });
  gaze.frame(5000);
  const after = gaze.frame(1000);
  assert.ok(Number.isFinite(after.eyeX) && Number.isFinite(after.yaw));
});

test('the same seed gives the same wandering', () => {
  const a = run(new Gaze({ random: seeded(21) }), 8000);
  const b = run(new Gaze({ random: seeded(21) }), 8000);
  for (let i = 0; i < a.length; i += 37) assert.equal(a[i].eyeX, b[i].eyeX);
});
