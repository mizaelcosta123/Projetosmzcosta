/**
 * The camera mode's wiring, with a detector made of numbers.
 *
 * The model itself is exercised in tests-browser/lens.mjs, on a real photo.
 * What is checked here is everything between its output and the scene: the
 * mapping from the video frame to the glass, the smoothing, the gestures,
 * and that a V creates where the finger is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene } from '../web/holo.js';
import { camera, toScreen } from '../web/hands.js';
import { toGlass } from '../web/handpose.js';
import { Lens, placeAt } from '../web/lens.js';

const W = 400;
const H = 800;
const FRAME = { width: 720, height: 930 };

// The photo's open hand, normalised to its frame, as the model reports it.
const OPEN = [
  [297, 805], [426, 798], [534, 734], [615, 657], [687, 602],
  [431, 560], [473, 420], [489, 334], [496, 266],
  [347, 547], [363, 388], [377, 288], [384, 217],
  [282, 559], [293, 421], [306, 332], [320, 271],
  [239, 590], [231, 487], [227, 416], [232, 354],
].map(([x, y]) => ({ x: x / FRAME.width, y: y / FRAME.height }));

function vShape() {
  const out = OPEN.map((p) => ({ ...p }));
  for (const [base, tip] of [[13, 16], [17, 20]]) {
    out[tip] = { x: (out[base].x * 3 + out[0].x) / 4, y: (out[base].y * 3 + out[0].y) / 4 };
    out[tip - 1] = { x: (out[tip].x + out[base].x) / 2, y: (out[tip].y + out[base].y) / 2 };
  }
  out[4] = { x: 440 / FRAME.width, y: 600 / FRAME.height };
  out[3] = { x: 480 / FRAME.width, y: 640 / FRAME.height };
  return out;
}

function rig(frames, synth = null) {
  const scene = new Scene();
  const stage = { cam: camera(), hands: { selected: null }, holding: false, pin() {} };
  const context = {
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
    save() {}, restore() {}, fillRect() {}, fillText() {},
  };
  const said = [];
  const poses = [];
  const notes = [];
  const lens = new Lens({
    root: { hidden: true },
    video: { readyState: 4, videoWidth: FRAME.width, videoHeight: FRAME.height, currentTime: 0 },
    overlay: { width: W, height: H, getContext: () => context },
    stage,
    scene,
    onStatus: (text) => said.push(text),
    onPose: (label) => poses.push(label),
    onNote: (text) => notes.push(text),
    synth,
    win: { innerWidth: W, innerHeight: H, devicePixelRatio: 1 },
  });
  let i = 0;
  lens.detector = { detectForVideo: () => ({ landmarks: frames(i++) }) };
  const step = (time) => {
    lens.video.currentTime += 1 / 30;
    lens._frame(time);
  };
  return { lens, scene, stage, said, poses, notes, step };
}

test('the model\'s open hand reaches the screen as "mão aberta"', () => {
  const { step, poses } = rig(() => [OPEN]);
  step(0);
  assert.equal(poses.at(-1), 'mão aberta');
});

test('a frame already read is not read again', () => {
  let calls = 0;
  const { lens } = rig(() => { calls += 1; return [OPEN]; });
  lens._frame(0);
  lens._frame(16);
  assert.equal(calls, 1, 'o mesmo quadro da câmera, lido uma vez');
});

test('a V held for a second creates the pending shape under the fingertip', () => {
  const { step, scene, said, lens } = rig(() => [vShape()]);
  lens.pending = { shape: 'esfera', hue: 275, size: 0.2 };
  for (let t = 0; t <= 1000; t += 33) step(t);
  assert.equal(scene.items.length, 1);
  const made = scene.last();
  assert.deepEqual([made.shape, made.hue, made.size], ['esfera', 275, 0.2]);
  assert.match(said.at(-1), /Criei uma esfera/);
  const tip = toGlass(vShape()[8], FRAME, { width: W, height: H });
  const where = toScreen(made, W, H, camera());
  assert.ok(Math.hypot(where.x - tip.x, where.y - tip.y) < 1e-6, 'na ponta do indicador');
});

test('no hand, nothing held, and the pose label empties', () => {
  const { step, poses, stage } = rig(() => []);
  step(0);
  assert.equal(poses.at(-1), '');
  assert.equal(stage.holding, false);
});

test('placing at a point on the glass lands exactly there', () => {
  const cam = camera();
  const at = placeAt({ x: 123, y: 456 }, W, H, cam);
  const back = toScreen(at, W, H, cam);
  assert.ok(Math.abs(back.x - 123) < 1e-6 && Math.abs(back.y - 456) < 1e-6);
});

test('flipping the camera keeps one frame loop, not two', async () => {
  const pending = new Set();
  let next = 1;
  const win = {
    innerWidth: W, innerHeight: H, devicePixelRatio: 1,
    requestAnimationFrame: () => { const id = next++; pending.add(id); return id; },
    cancelAnimationFrame: (id) => pending.delete(id),
  };
  const stopped = [];
  const stream = (name) => ({ getTracks: () => [{ stop: () => stopped.push(name) }] });
  const nav = { mediaDevices: { getUserMedia: async ({ video }) => stream(video.facingMode.ideal) } };
  const lens = new Lens({
    root: { hidden: true },
    video: { classList: { toggle() {} }, play: async () => {}, srcObject: null },
    overlay: { width: 0, height: 0, getContext: () => null },
    stage: { cam: camera(), hands: { selected: null }, pin() {} },
    scene: new Scene(),
    load: () => new Promise(() => {}),
    nav,
    win,
  });
  assert.equal(await lens.open(), true);
  assert.equal(await lens.flip(), true);
  assert.equal(await lens.flip(), true);
  assert.equal(pending.size, 1, `laços pendentes: ${pending.size}`);
  assert.deepEqual(stopped, ['environment', 'user'], 'a câmera anterior foi desligada a cada virada');
  assert.equal(lens.facing, 'environment');
  lens.close();
  assert.equal(pending.size, 0);
  assert.deepEqual(stopped, ['environment', 'user', 'environment']);
});

test('with the synthesizer on, the hand plays a note and the holograms swell with it', () => {
  const sent = [];
  const synth = { running: true, set: (c) => sent.push(c), level: () => 0.4 };
  const { step, scene, notes, lens } = rig(() => [OPEN], synth);
  scene.add({ shape: 'esfera', x: 0.9, y: 0.9, z: -1 });
  step(0);
  const played = sent.at(-1);
  assert.ok(played.gain > 0, 'mão aberta soa');
  assert.match(notes.at(-1), /^♪ (Dó|Ré|Mi|Fá|Sol|Lá|Si)/);
  assert.equal(scene.items[0].pulse, 0.2, 'nível 0,4 → incha 20%');
  lens.quiet();
  assert.equal(scene.items[0].pulse, 0);
  assert.equal(notes.at(-1), '');
});

test('with the synthesizer off, nothing is sent and nothing swells', () => {
  const sent = [];
  const synth = { running: false, set: (c) => sent.push(c), level: () => 1 };
  const { step, scene } = rig(() => [OPEN], synth);
  scene.add({ shape: 'cubo' });
  step(0);
  assert.equal(sent.length, 0);
  assert.equal(scene.items[0].pulse ?? 0, 0);
});
