/**
 * Handling holograms with a finger, and drawing them without AR.
 *
 * Gestures are fed synthetic pointer events, so each one is checked for what
 * it does to the scene rather than for how it feels -- which only a thumb on
 * a phone can say.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene } from '../web/holo.js';
import {
  CAMERA_BACK, CAMERA_FAR, Gestures, SIZE_MAX, SIZE_MIN, camera, clampSize, fit, moveBy, pick,
  stageView, toScreen, twoFinger,
} from '../web/hands.js';
import { paint } from '../web/ar.js';
import { conjure } from '../web/conjure.js';
import { Stage } from '../web/stage.js';

const W = 400;
const H = 800;

function room() {
  const scene = new Scene();
  const middle = scene.add({ shape: 'cubo', x: 0, y: 0, z: -1 });
  const right = scene.add({ shape: 'esfera', x: 0.6, y: 0, z: -1 });
  return { scene, middle, right };
}

function hands(scene, extra = {}) {
  const said = { selected: [], removed: [] };
  const g = new Gestures({
    items: () => scene.items,
    size: () => ({ width: W, height: H }),
    onSelect: (item) => said.selected.push(item?.shape ?? null),
    onRemove: (item) => {
      said.removed.push(item.shape);
      scene.remove(item.id);
    },
    ...extra,
  });
  return { g, said };
}

// -- the maths ---------------------------------------------------------------

test('the centre of the room lands in the centre of the screen', () => {
  const spot = toScreen({ x: 0, y: 0, z: -1 }, W, H);
  assert.equal(spot.x, W / 2);
  assert.equal(spot.y, H / 2);
  assert.ok(spot.visible);
});

test('up in the room is up on the screen', () => {
  // Screen y grows downward; getting this sign wrong mirrors every drag.
  assert.ok(toScreen({ x: 0, y: 0.3, z: -1 }, W, H).y < H / 2);
});

test('a finger picks the object under it, and nothing on empty glass', () => {
  const { scene, middle, right } = room();
  const onRight = toScreen(right, W, H);
  assert.equal(pick(scene.items, W / 2, H / 2, W, H), middle);
  assert.equal(pick(scene.items, onRight.x, onRight.y, W, H), right);
  assert.equal(pick(scene.items, 5, 5, W, H), null);
});

test('an object behind the camera cannot be picked', () => {
  const scene = new Scene();
  scene.add({ x: 0, y: 0, z: 1 });
  assert.equal(pick(scene.items, W / 2, H / 2, W, H), null);
});

test('a drag keeps the object under the finger, at any depth', () => {
  for (const z of [-0.6, -1, -2.2]) {
    const item = { x: 0, y: 0, z };
    const before = toScreen(item, W, H);
    const moved = { ...item, ...moveBy(item, 50, -30, W, H) };
    const after = toScreen(moved, W, H);
    assert.ok(Math.abs(after.x - before.x - 50) < 1e-6, `x at z=${z}: ${after.x - before.x}`);
    assert.ok(Math.abs(after.y - before.y + 30) < 1e-6, `y at z=${z}: ${after.y - before.y}`);
  }
});

test('two fingers moving apart scale up; turning them twists', () => {
  const apart = twoFinger({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }, { x: 150, y: 0 });
  assert.equal(apart.scale, 2);
  assert.equal(apart.twist, 0);
  const turned = twoFinger({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
  assert.ok(Math.abs(turned.twist - Math.PI / 2) < 1e-9);
});

test('a twist across the ±π seam is small, not a whole turn', () => {
  const { twist } = twoFinger({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 });
  assert.ok(Math.abs(twist) < 0.1, `twist ${twist}`);
});

test('a pinch cannot shrink something out of reach or past the screen', () => {
  assert.equal(clampSize(0), SIZE_MIN);
  assert.equal(clampSize(99), SIZE_MAX);
});

// -- gestures ------------------------------------------------------------------

test('tap selects, tap on empty glass lets go', () => {
  const { scene } = room();
  const { g, said } = hands(scene);
  g.down({ id: 1, x: W / 2, y: H / 2, t: 0 });
  g.up({ id: 1, x: W / 2, y: H / 2, t: 80 });
  assert.equal(g.selected.shape, 'cubo');
  g.down({ id: 1, x: 5, y: 5, t: 1000 });
  g.up({ id: 1, x: 5, y: 5, t: 1080 });
  assert.equal(g.selected, null);
  assert.deepEqual(said.selected, ['cubo', null]);
});

test('dragging from an object moves it, no tap to choose first', () => {
  const { scene, middle } = room();
  const { g } = hands(scene);
  g.down({ id: 1, x: W / 2, y: H / 2, t: 0 });
  g.move({ id: 1, x: W / 2 + 40, y: H / 2, t: 16 });
  g.move({ id: 1, x: W / 2 + 80, y: H / 2 + 40, t: 32 });
  g.up({ id: 1, x: W / 2 + 80, y: H / 2 + 40, t: 48 });
  assert.ok(middle.x > 0, 'moveu para a direita');
  assert.ok(middle.y < 0, 'moveu para baixo');
  const now = toScreen(middle, W, H);
  assert.ok(Math.abs(now.x - (W / 2 + 80)) < 1e-6, 'ficou sob o dedo');
  assert.ok(Math.abs(now.y - (H / 2 + 40)) < 1e-6, 'nos dois eixos');
});

test('dragging on empty glass moves nothing', () => {
  const { scene, middle, right } = room();
  const { g } = hands(scene);
  g.down({ id: 1, x: 10, y: 10, t: 0 });
  g.move({ id: 1, x: 200, y: 200, t: 16 });
  g.up({ id: 1, x: 200, y: 200, t: 32 });
  assert.deepEqual([middle.x, middle.y, middle.z, right.x], [0, 0, -1, 0.6]);
});

test('dragging on empty glass leaves the chosen one where it is', () => {
  const { scene, middle } = room();
  const { g } = hands(scene);
  g.down({ id: 1, x: W / 2, y: H / 2, t: 0 });
  g.up({ id: 1, x: W / 2, y: H / 2, t: 60 });
  assert.equal(g.selected, middle);
  g.down({ id: 1, x: 20, y: 700, t: 1000 });
  g.move({ id: 1, x: 220, y: 500, t: 1016 });
  g.up({ id: 1, x: 220, y: 500, t: 1032 });
  assert.deepEqual([middle.x, middle.y, middle.z], [0, 0, -1]);
});

test('a pinch resizes and twists the held object, and it stops spinning while held', () => {
  const { scene, middle } = room();
  const { g } = hands(scene);
  const spin = middle.spin;
  g.down({ id: 1, x: W / 2, y: H / 2, t: 0 });
  g.down({ id: 2, x: W / 2 + 100, y: H / 2, t: 5 });
  assert.equal(middle.spin, 0, 'segurado não gira sozinho');
  const size = middle.size;
  g.move({ id: 2, x: W / 2 + 200, y: H / 2, t: 20 });
  assert.ok(Math.abs(middle.size - size * 2) < 1e-9);
  g.up({ id: 2, t: 40 });
  g.up({ id: 1, t: 41 });
  assert.equal(middle.spin, spin, 'solto, volta a girar');
});

test('two fingers with nothing chosen act on the newest', () => {
  const { scene, right } = room();
  const { g } = hands(scene);
  g.down({ id: 1, x: 10, y: 10, t: 0 });
  g.down({ id: 2, x: 110, y: 10, t: 1 });
  g.move({ id: 2, x: 210, y: 10, t: 16 });
  assert.equal(g.selected, right);
  assert.ok(right.size > 0.25);
});

test('double tap takes it away; two slow taps do not', () => {
  const { scene } = room();
  const { g, said } = hands(scene);
  const tap = (t) => {
    g.down({ id: 1, x: W / 2, y: H / 2, t });
    g.up({ id: 1, x: W / 2, y: H / 2, t: t + 60 });
  };
  tap(0);
  tap(1000);
  assert.equal(scene.items.length, 2, 'devagar é só selecionar de novo');
  tap(1200);
  assert.deepEqual(said.removed, ['cubo']);
  assert.equal(scene.items.length, 1);
  assert.equal(g.selected, null, 'o apagado não fica selecionado');
});

// -- drawing -------------------------------------------------------------------

function recorder() {
  const lines = [];
  let style = '';
  let width = 0;
  return {
    lines,
    clearRect() {},
    beginPath() {},
    moveTo(x, y) { lines.push({ from: [x, y], style, width }); },
    lineTo(x, y) { lines[lines.length - 1].to = [x, y]; },
    arc() {},
    stroke() {},
    set strokeStyle(value) { style = value; },
    set lineWidth(value) { width = value; },
  };
}

test('the painter draws every edge of what is in front, inside the screen', () => {
  const { scene } = room();
  const context = recorder();
  paint(context, W, H, scene, stageView());
  assert.equal(context.lines.length, scene.edges().length);
  for (const line of context.lines) {
    for (const [x, y] of [line.from, line.to]) {
      assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `${x},${y}`);
    }
  }
});

test('every place a sentence can name fits on a portrait phone, big or small', () => {
  /* The places were chosen for a room; this is the check that they also fit
     the glass once the camera refits, clear of the buttons above and the
     composer below, and that the gestures see what the painter drew. */
  for (const where of ['frente', 'aqui', 'direita', 'esquerda', 'acima', 'abaixo', 'longe']) {
    for (const [shape, size] of [['esfera', 'grande'], ['cubo', 'gigante'], ['toro', 'pequeno']]) {
      const scene = new Scene();
      conjure(scene, `${shape} ${size} ${where}`);
      const cam = fit(scene.items, W, H);
      const context = recorder();
      paint(context, W, H, scene, cam.matrix);
      assert.ok(context.lines.length > 0, `${shape} ${size} ${where}: desenhou`);
      for (const line of context.lines) {
        for (const [x, y] of [line.from, line.to]) {
          assert.ok(x >= 0 && x <= W && y >= 150 && y <= H - 200,
            `${shape} ${size} ${where}: ${x.toFixed(0)},${y.toFixed(0)}`);
        }
      }
      const centre = toScreen(scene.last(), W, H, cam);
      assert.equal(pick(scene.items, centre.x, centre.y, W, H, cam), scene.last(), `${shape} ${where}`);
    }
  }
});

test('the camera steps back only as far as it has to', () => {
  const scene = new Scene();
  scene.add({ shape: 'cubo', size: 0.1 });
  assert.equal(fit(scene.items, W, H).back, CAMERA_BACK, 'pequeno à frente: fica perto');
  scene.add({ shape: 'cubo', x: 0.6, size: 0.9 });
  const far = fit(scene.items, W, H).back;
  assert.ok(far > CAMERA_BACK && far < CAMERA_FAR, `recuou para ${far}`);
});

test('looking slightly down shows the top of a ring, not a flat band', () => {
  /* Dead level, a torus lying on the floor projects to a line one pixel
     tall. The point of the pitch is that it has height on the glass. */
  const scene = new Scene();
  scene.add({ shape: 'toro', size: 0.4 });
  const tall = (cam) => {
    const context = recorder();
    paint(context, W, H, scene, cam.matrix);
    const ys = context.lines.flatMap((line) => [line.from[1], line.to[1]]);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(tall(camera()) > tall(camera(CAMERA_BACK, 0)) * 1.6, `${tall(camera())} vs ${tall(camera(CAMERA_BACK, 0))}`);
});

test('what is held is drawn heavier than what is not', () => {
  const { scene, middle } = room();
  const context = recorder();
  paint(context, W, H, scene, stageView(), { selected: middle });
  const widths = (shape) => context.lines
    .filter((_, i) => scene.edges()[i].item.shape === shape)
    .map((line) => line.width);
  assert.ok(Math.min(...widths('cubo')) > Math.max(...widths('esfera')));
});

// -- the stage -------------------------------------------------------------------

function fakeCanvas() {
  const listeners = {};
  const context = recorder();
  return {
    hidden: true,
    dataset: {},
    width: 0,
    height: 0,
    listeners,
    context,
    addEventListener(type, fn) { listeners[type] = fn; },
    getContext: () => context,
    setPointerCapture() {},
  };
}

const win = { innerWidth: W, innerHeight: H, devicePixelRatio: 1, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };

test('the stage stays away with nothing to show, and while AR has the canvas', () => {
  const scene = new Scene();
  const canvas = fakeCanvas();
  let ar = false;
  const stage = new Stage({ canvas, scene, busy: () => ar, win });
  assert.equal(stage.show(), false, 'vazio');
  scene.add({ shape: 'cubo' });
  ar = true;
  assert.equal(stage.show(), false, 'a RA está usando');
  ar = false;
  assert.equal(stage.show(), true);
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.dataset.stage, 'on', 'o CSS só libera o toque com isto');
  stage.draw();
  assert.ok(canvas.context.lines.length > 0, 'desenhou');
});

test('double tapping the last object away puts the stage away too', () => {
  const scene = new Scene();
  scene.add({ shape: 'cubo', x: 0, y: 0, z: -1 });
  const canvas = fakeCanvas();
  const said = [];
  const stage = new Stage({ canvas, scene, win, onStatus: (text) => said.push(text) });
  stage.show();
  const event = (t) => ({ pointerId: 1, clientX: W / 2, clientY: H / 2, timeStamp: t, preventDefault() {} });
  for (const t of [0, 150]) {
    canvas.listeners.pointerdown(event(t));
    canvas.listeners.pointerup(event(t + 50));
  }
  assert.equal(scene.items.length, 0);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.dataset.stage, undefined);
  assert.ok(said.some((text) => text.startsWith('Apaguei o cubo')), said.join(' | '));
});
