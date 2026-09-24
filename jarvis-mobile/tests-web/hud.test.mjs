/**
 * The HUD around him: what it draws at each level, and the promises it
 * makes to the rest of the interface -- that it never moves the field, that
 * it steps down on its own, and that it stays out of the camera's way.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EFFECTS, Hud, boot, buzz, dust, projectDust, quality, rings } from '../web/hud.js';
import { Scene } from '../web/holo.js';
import { built } from '../web/ar.js';

const W = 780;
const H = 1688;

function recorder() {
  const calls = { fillRect: 0, arc: 0, ellipse: 0, stroke: 0, moveTo: 0 };
  const context = new Proxy(
    { calls },
    {
      get(target, key) {
        if (key === 'calls') return calls;
        if (key in calls) return () => { calls[key] += 1; };
        if (key in target) return target[key];
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    }
  );
  return context;
}

function rig({ effects = 'completo', reduced = false, field = {} } = {}) {
  const context = recorder();
  const canvas = { width: 0, height: 0, dataset: {}, getContext: () => context };
  let frames = 0;
  const win = {
    innerWidth: W / 2,
    innerHeight: H / 2,
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    requestAnimationFrame: () => { frames += 1; return frames; },
    cancelAnimationFrame() {},
    document: { hidden: false, addEventListener() {} },
  };
  const hud = new Hud({
    canvas,
    field: { cx: W / 2, cy: H / 2, scale: 437, level: 0, thinking: false, targetShape: 'orb', ...field },
    effects,
    win,
  });
  hud.start();
  return { hud, context, canvas, frames: () => frames };
}

test('every level of effects says what it draws', () => {
  assert.deepEqual(EFFECTS, ['completo', 'leve', 'desligado']);
  const full = quality({ effects: 'completo' });
  const light = quality({ effects: 'leve' });
  assert.ok(full.dust > light.dust && light.dust > 0, `${full.dust} > ${light.dust} > 0`);
  assert.equal(full.rings && light.rings, true);
  assert.equal(quality({ effects: 'algo que não existe' }).dust, full.dust, 'um valor estranho vira o padrão');
});

test('switched off, or with reduced motion, the rings stay and nothing moves', () => {
  for (const options of [{ effects: 'desligado' }, { effects: 'completo', reduced: true }]) {
    const plan = quality(options);
    assert.equal(plan.motion, false);
    assert.equal(plan.dust, 0);
    assert.equal(plan.rings, true);
    assert.equal(plan.flashes, false);
  }
});

test('in the camera only the flashes run: the room and the hands come first', () => {
  const plan = quality({ effects: 'completo', lens: true });
  assert.deepEqual([plan.dust, plan.rings, plan.flashes], [0, false, true]);
});

test('the dust is the same for the same seed, and hangs around him', () => {
  const a = dust(50, 3);
  const b = dust(50, 3);
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a], [...dust(50, 4)]);
  for (let i = 0; i < 50; i += 1) {
    assert.ok(Math.abs(a[i * 4]) <= 1.7 && Math.abs(a[i * 4 + 1]) <= 1.3 && Math.abs(a[i * 4 + 2]) <= 1.7);
    assert.ok(a[i * 4 + 3] > 0);
  }
});

test('dust is drawn inside the screen, and nearer is bigger', () => {
  const near = projectDust(0.2, 0.1, 1.2, 0, W, H, 400);
  const far = projectDust(0.2, 0.1, -1.2, 0, W, H, 400);
  assert.ok(near.visible && far.visible);
  assert.ok(near.k > far.k, 'perto cresce');
  for (const p of [near, far]) assert.ok(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H);
  assert.equal(projectDust(0, 0, 3.1, 0, W, H, 400).visible, false, 'atrás da câmera não aparece');
  // A half turn puts the near point where the far one was.
  const turned = projectDust(0.2, 0.1, 1.2, Math.PI, W, H, 400);
  assert.ok(Math.abs(turned.k - projectDust(-0.2, 0.1, -1.2, 0, W, H, 400).k) < 1e-9);
});

test('the rings answer what he is doing', () => {
  const rest = rings({ t: 10 });
  const speaking = rings({ level: 0.8, t: 10 });
  const thinking = rings({ thinking: true, t: 10 });
  assert.ok(speaking.push > rest.push, 'a voz empurra para fora');
  assert.ok(speaking.alpha > rest.alpha);
  assert.ok(Math.abs(thinking.turns[0]) > Math.abs(rest.turns[0]), 'pensando gira mais rápido');
  assert.equal(thinking.sweep, true);
  assert.equal(rest.sweep, false);
  assert.ok(rings({ face: true, t: 10 }).alpha < rest.alpha / 2, 'em volta de um rosto, só um halo');
  assert.deepEqual(rings({ t: 10, motion: false }).turns, [0, -0, 0, 0], 'parado quando não há movimento');
});

test('the HUD reads the field and never writes to it', () => {
  const field = { cx: W / 2, cy: H / 2, scale: 437, level: 0.5, thinking: true, targetShape: 'orb' };
  const frozen = JSON.stringify(field);
  const { hud } = rig({ field });
  hud.field = field;
  for (let i = 0; i < 20; i += 1) hud.draw(1 / 60);
  assert.equal(JSON.stringify(field), frozen);
});

test('full effects draw dust and rings; switched off draws the rings once and stops', () => {
  const on = rig({ effects: 'completo' });
  on.hud.draw(1 / 60);
  assert.ok(on.context.calls.fillRect > 100, `poeira: ${on.context.calls.fillRect}`);
  assert.ok(on.context.calls.arc > 5, 'anéis');
  assert.ok(on.frames() > 0, 'um laço rodando');

  const off = rig({ effects: 'desligado' });
  assert.equal(off.frames(), 0, 'nenhum laço');
  assert.equal(off.context.calls.fillRect, 0, 'sem poeira');
  assert.ok(off.context.calls.arc > 0, 'os anéis, desenhados uma vez');
});

test('long frames step the dust down by themselves', () => {
  const { hud } = rig();
  const before = hud.plan.dust;
  for (let i = 0; i < 200; i += 1) hud._pace(0.05);
  assert.ok(hud.plan.dust < before, `${hud.plan.dust} < ${before}`);
  for (let i = 0; i < 400; i += 1) hud._pace(0.05);
  assert.equal(hud.plan.dust, 0);
  assert.equal(hud.plan.rings, true, 'os anéis ficam');
  hud.setEffects('leve');
  assert.ok(hud.plan.dust > 0, 'escolher de novo começa do zero');
});

test('a flash plays and then lets the loop go', () => {
  const { hud } = rig({ effects: 'completo' });
  hud.setMode('lens');
  hud.burst(100, 200);
  assert.equal(hud.bursts.length, 1);
  for (let i = 0; i < 60; i += 1) hud.draw(1 / 60);
  assert.equal(hud.bursts.length, 0);
});

test('no flashes when effects are off', () => {
  const { hud } = rig({ effects: 'desligado' });
  hud.burst(100, 200);
  assert.equal(hud.bursts.length, 0);
});

test('under a WebXR session the HUD draws nothing', () => {
  const { hud, context } = rig();
  hud.setMode('xr');
  const drawn = context.calls.fillRect + context.calls.arc;
  hud._restart();
  assert.equal(context.calls.fillRect + context.calls.arc, drawn);
  assert.equal(hud.canvas.dataset.mode, 'xr');
});

function node() {
  const listeners = {};
  return {
    hidden: true,
    removed: false,
    classList: { add() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
    remove() { this.removed = true; },
    listeners,
  };
}

function store() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

test('the start-up plays once a session', () => {
  const storage = store();
  const win = { addEventListener() {}, setTimeout() {} };
  const first = node();
  assert.equal(boot(first, { storage, win }), true);
  assert.equal(first.hidden, false);
  const second = node();
  assert.equal(boot(second, { storage, win }), false);
  assert.equal(second.removed, true);
});

test('the start-up never plays with reduced motion, and survives refused storage', () => {
  const win = { addEventListener() {}, setTimeout() {} };
  const quiet = node();
  assert.equal(boot(quiet, { storage: store(), reduced: true, win }), false);
  assert.equal(quiet.removed, true);
  const refused = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(boot(node(), { storage: refused, win }), true);
  assert.equal(boot(null), false);
});

test('a buzz where there is none is nothing at all', () => {
  const felt = [];
  buzz(20, { vibrate: (ms) => felt.push(ms) });
  assert.deepEqual(felt, [20]);
  assert.doesNotThrow(() => buzz(20, {}));
  assert.doesNotThrow(() => buzz(20, { vibrate() { throw new Error('no'); } }));
  assert.doesNotThrow(() => buzz(20, undefined));
});

test('a new hologram is built over its first moments, then stays whole', () => {
  assert.equal(built(0), 0);
  assert.ok(built(0.3) > 0.5 && built(0.3) < 1);
  assert.equal(built(0.6), 1);
  assert.equal(built(5), 1);
  assert.equal(built(NaN), 1, 'sem hora de nascimento: inteiro');
});

test('the scene tells whoever listens about each new one', () => {
  const heard = [];
  const scene = new Scene({ onAdd: (item) => heard.push(item.shape) });
  scene.add({ shape: 'cubo' });
  scene.add({ shape: 'esfera' });
  assert.deepEqual(heard, ['cubo', 'esfera']);
});
