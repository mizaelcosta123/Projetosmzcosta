/**
 * Reading a hand and acting on the holograms with it.
 *
 * The base hand is not invented: it is the 21 points MediaPipe's hand model
 * found in the photo this feature was asked for with -- an open right hand,
 * back to the camera. The other poses are that hand with fingers folded by
 * moving their tips, so each test changes only what the pose is about.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene } from '../web/holo.js';
import { camera, moveBy, toScreen } from '../web/hands.js';
import {
  BONES, FINGERS, HOLD_CREATE, HOLD_REMOVE, HandControl, LOST_AFTER, extended, read, smooth, toGlass,
} from '../web/handpose.js';

const OPEN = [
  [297, 805], [426, 798], [534, 734], [615, 657], [687, 602],
  [431, 560], [473, 420], [489, 334], [496, 266],
  [347, 547], [363, 388], [377, 288], [384, 217],
  [282, 559], [293, 421], [306, 332], [320, 271],
  [239, 590], [231, 487], [227, 416], [232, 354],
].map(([x, y]) => ({ x, y }));

const clone = (points) => points.map((p) => ({ ...p }));

/** Fold a finger: its tip goes back past the middle joint, towards the palm. */
function fold(points, name) {
  const out = clone(points);
  const [base, , , tip] = FINGERS[name].points;
  const w = out[0];
  out[tip] = { x: out[base].x + (w.x - out[base].x) * 0.25, y: out[base].y + (w.y - out[base].y) * 0.25 };
  out[tip - 1] = { x: (out[tip].x + out[base].x) / 2, y: (out[tip].y + out[base].y) / 2 };
  return out;
}

function tuckThumb(points) {
  const out = clone(points);
  out[4] = { x: 440, y: 600 };
  out[3] = { x: 480, y: 640 };
  return out;
}

const FIST = tuckThumb(['indicador', 'medio', 'anelar', 'minimo'].reduce(fold, OPEN));
const V = tuckThumb(fold(fold(OPEN, 'anelar'), 'minimo'));
const POINTING = tuckThumb(['medio', 'anelar', 'minimo'].reduce(fold, OPEN));

/** Thumb and index tips meeting, the index still reaching out. */
function pinch(points, at = { x: 590, y: 470 }) {
  const out = clone(points);
  out[8] = { x: at.x, y: at.y };
  out[4] = { x: at.x + 10, y: at.y + 10 };
  return out;
}

/** The whole hand moved, scaled about the wrist, and turned. */
function transform(points, { dx = 0, dy = 0, scale = 1, turn = 0 } = {}) {
  const w = points[0];
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return points.map((p) => {
    const x = (p.x - w.x) * scale;
    const y = (p.y - w.y) * scale;
    return { x: w.x + x * c - y * s + dx, y: w.y + x * s + y * c + dy };
  });
}

// -- reading poses -----------------------------------------------------------

test('the photo\'s open hand reads as open, every finger straight', () => {
  const r = read(OPEN);
  assert.equal(r.pose, 'aberta');
  assert.deepEqual(Object.values(r.up), [true, true, true, true, true]);
});

test('a folded finger reads as folded, one at a time', () => {
  for (const name of ['indicador', 'medio', 'anelar', 'minimo']) {
    assert.equal(extended(fold(OPEN, name), name), false, name);
    assert.equal(extended(OPEN, name), true, name);
  }
});

test('fist, V and pointing are told apart', () => {
  assert.equal(read(FIST).pose, 'punho');
  assert.equal(read(V).pose, 'v');
  assert.equal(read(POINTING).pose, 'apontando');
});

test('a fist is not a pinch, although thumb and index tips touch in both', () => {
  /* In a fist the thumb rests on the folded index, as close to its tip as a
     pinch would be. Read as a pinch, closing your hand to delete something
     would grab it instead. */
  const gapInFist = Math.hypot(FIST[4].x - FIST[8].x, FIST[4].y - FIST[8].y) / read(FIST).size;
  assert.ok(gapInFist < 0.3, `as pontas se tocam: ${gapInFist.toFixed(2)}`);
  assert.equal(read(FIST).pinched, false);
});

test('a pinch is read, and it is sticky at the edge', () => {
  const closed = read(pinch(OPEN));
  assert.equal(closed.pose, 'pinca');
  // Opened a little, past where it would start but short of where it lets go.
  const ajar = pinch(OPEN);
  ajar[4] = { x: ajar[8].x + 70, y: ajar[8].y + 70 }; // ~0.38 of the hand
  assert.equal(read(ajar).pinched, false, 'não fecha com essa folga');
  assert.equal(read(ajar, { pinched: true }).pinched, true, 'mas não solta com ela');
});

test('where the hand is "at" follows the pose', () => {
  const p = pinch(OPEN);
  assert.deepEqual(read(p).at, { x: 595, y: 475 }, 'entre os dedos da pinça');
  assert.deepEqual(read(POINTING).at, POINTING[8], 'na ponta do indicador');
});

test('the same pose reads the same near and far', () => {
  for (const scale of [0.4, 1, 1.8]) {
    assert.equal(read(transform(OPEN, { scale })).pose, 'aberta', `escala ${scale}`);
    assert.equal(read(transform(FIST, { scale })).pose, 'punho', `escala ${scale}`);
  }
});

test('every bone joins two real points, in the photo\'s finger colours', () => {
  assert.equal(BONES.length, 5 * 4 + 3);
  for (const bone of BONES) {
    assert.ok(bone.from >= 0 && bone.from <= 20 && bone.to >= 0 && bone.to <= 20);
  }
  assert.equal(FINGERS.indicador.colour, '#2b59ff');
  assert.equal(FINGERS.polegar.colour, '#ff2bd6');
});

// -- from the video to the glass --------------------------------------------

test('a cover-fitted video maps its centre to the screen\'s centre', () => {
  const at = toGlass({ x: 0.5, y: 0.5 }, { width: 1280, height: 720 }, { width: 412, height: 880 });
  assert.deepEqual(at, { x: 206, y: 440 });
});

test('landscape video on a portrait screen is cropped at the sides, not squashed', () => {
  const frame = { width: 1280, height: 720 };
  const screen = { width: 412, height: 880 };
  const top = toGlass({ x: 0.5, y: 0 }, frame, screen);
  const bottom = toGlass({ x: 0.5, y: 1 }, frame, screen);
  assert.ok(Math.abs(top.y) < 1e-9);
  assert.ok(Math.abs(bottom.y - 880) < 1e-9);
  const left = toGlass({ x: 0, y: 0.5 }, frame, screen);
  assert.ok(left.x < 0, 'a borda esquerda do vídeo fica fora da tela');
});

test('the front camera is a mirror, and so are its points', () => {
  const frame = { width: 1000, height: 1000 };
  const screen = { width: 1000, height: 1000 };
  assert.equal(toGlass({ x: 0.2, y: 0.5 }, frame, screen, true).x, 800);
  assert.equal(toGlass({ x: 0.2, y: 0.5 }, frame, screen, false).x, 200);
});

test('smoothing takes out jitter without losing a steady hand', () => {
  const still = smooth(OPEN, OPEN);
  assert.ok(still.every((p, i) => Math.abs(p.x - OPEN[i].x) < 1e-9 && Math.abs(p.y - OPEN[i].y) < 1e-9));
  const jittered = OPEN.map((p) => ({ x: p.x + 10, y: p.y }));
  const out = smooth(OPEN, jittered);
  assert.ok(out[8].x - OPEN[8].x < 10 && out[8].x - OPEN[8].x > 0);
});

// -- acting on the scene -------------------------------------------------------

const W = 720;
const H = 930;

/** A scene with one cube sitting exactly under the pinch point. */
function under(point) {
  const scene = new Scene();
  const cam = camera();
  const centre = { x: 0, y: 0, z: -1 };
  const c = toScreen(centre, W, H, cam);
  const where = { ...centre, ...moveBy(centre, point.x - c.x, point.y - c.y, W, H, cam) };
  const item = scene.add({ shape: 'cubo', size: 0.3, ...where });
  return { scene, item, cam };
}

function control(scene, cam, extra = {}) {
  const said = { created: [], removed: [], grabbed: 0, released: 0 };
  const hand = new HandControl({
    items: () => scene.items,
    size: () => ({ width: W, height: H }),
    view: () => cam,
    onCreate: (at) => said.created.push(at),
    onRemove: (item) => { said.removed.push(item.shape); scene.remove(item.id); },
    onGrab: () => { said.grabbed += 1; },
    onRelease: () => { said.released += 1; },
    ...extra,
  });
  return { hand, said };
}

test('pinching over an object grabs it, and moving the pinch moves it', () => {
  const start = pinch(OPEN);
  const { scene, item, cam } = under(read(start).at);
  const { hand, said } = control(scene, cam);
  hand.update([start], 0);
  assert.equal(hand.held, item);
  assert.equal(said.grabbed, 1);
  assert.equal(item.spin, 0, 'segurado não gira sozinho');
  hand.update([transform(start, { dx: 60, dy: -40 })], 33);
  const now = toScreen(item, W, H, cam);
  const target = { x: read(start).at.x + 60, y: read(start).at.y - 40 };
  assert.ok(Math.hypot(now.x - target.x, now.y - target.y) < 1e-6, 'ficou entre os dedos');
});

test('pinching empty air grabs nothing', () => {
  const { scene, cam } = under({ x: 100, y: 100 });
  const { hand, said } = control(scene, cam);
  hand.update([pinch(OPEN)], 0);
  assert.equal(hand.held, null);
  assert.equal(said.grabbed, 0);
});

test('bringing the held object closer makes it bigger; turning the hand turns it', () => {
  const start = pinch(OPEN);
  const { scene, item, cam } = under(read(start).at);
  const { hand } = control(scene, cam);
  hand.update([start], 0);
  const size = item.size;
  const angle = item.angle;
  hand.update([transform(start, { scale: 1.5 })], 33);
  assert.ok(Math.abs(item.size - size * 1.5) < 1e-9, `tamanho ${item.size}`);
  hand.update([transform(start, { turn: 0.4 })], 66);
  assert.ok(Math.abs(item.angle - (angle - 0.4)) < 1e-9, `ângulo ${item.angle}`);
});

test('opening the pinch lets go, and the object spins again', () => {
  const start = pinch(OPEN);
  const { scene, item, cam } = under(read(start).at);
  const spin = item.spin;
  const { hand, said } = control(scene, cam);
  hand.update([start], 0);
  hand.update([OPEN], 33);
  assert.equal(hand.held, null);
  assert.equal(said.released, 1);
  assert.equal(item.spin, spin);
});

test('a hand that leaves the frame lets go -- but not on one dropped frame', () => {
  const start = pinch(OPEN);
  const { scene, cam } = under(read(start).at);
  const { hand, said } = control(scene, cam);
  hand.update([start], 0);
  hand.update([], 50);
  assert.ok(hand.held, 'um quadro sem mão não solta');
  hand.update([], LOST_AFTER + 10);
  assert.equal(hand.held, null);
  assert.equal(said.released, 1);
});

test('a V held long enough creates, once, at the fingertip', () => {
  const { scene, cam } = under({ x: 50, y: 50 });
  const { hand, said } = control(scene, cam);
  hand.update([V], 0);
  hand.update([V], HOLD_CREATE - 100);
  assert.equal(said.created.length, 0, 'cedo demais');
  hand.update([V], HOLD_CREATE + 10);
  hand.update([V], HOLD_CREATE + 500);
  assert.equal(said.created.length, 1, 'uma vez só por gesto');
  assert.deepEqual(said.created[0], V[8]);
  hand.update([OPEN], HOLD_CREATE + 600);
  hand.update([V], HOLD_CREATE + 700);
  hand.update([V], HOLD_CREATE * 2 + 800);
  assert.equal(said.created.length, 2, 'abrir e repetir cria outro');
});

test('a fist held over an object removes it; a fist passing through does not', () => {
  const palm = read(FIST).at;
  const { scene, cam } = under(palm);
  const { hand, said } = control(scene, cam);
  hand.update([FIST], 0);
  hand.update([OPEN], HOLD_REMOVE - 200);
  hand.update([FIST], HOLD_REMOVE);
  hand.update([FIST], HOLD_REMOVE + 100);
  assert.deepEqual(said.removed, [], 'passou pelo punho sem parar');
  hand.update([FIST], HOLD_REMOVE * 2 + 50);
  assert.deepEqual(said.removed, ['cubo']);
  assert.equal(scene.items.length, 0);
});

test('a fist over empty air removes nothing', () => {
  const { scene, cam } = under({ x: 30, y: 30 });
  const { hand, said } = control(scene, cam);
  hand.update([FIST], 0);
  hand.update([FIST], HOLD_REMOVE + 100);
  assert.deepEqual(said.removed, []);
  assert.equal(scene.items.length, 1);
});

test('an object removed by something else while held is let go of', () => {
  const start = pinch(OPEN);
  const { scene, item, cam } = under(read(start).at);
  const { hand } = control(scene, cam);
  hand.update([start], 0);
  scene.remove(item.id);
  hand.update([transform(start, { dx: 20 })], 33);
  assert.equal(hand.held, null);
});
