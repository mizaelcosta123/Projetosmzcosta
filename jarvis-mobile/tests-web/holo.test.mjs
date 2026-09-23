/**
 * The solids, and turning a sentence into one.
 *
 * The geometry tests check facts a wireframe either has or does not: a cube
 * has twelve edges, every edge points at a real corner, nothing is left
 * unconnected. Those are the mistakes that produce a shape that is almost
 * right and impossible to eyeball.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SOLIDS, Scene, hologram, place, project, solid } from '../web/holo.js';
import { HUES, conjure, learnedNames, parse, teaching } from '../web/conjure.js';
import { apply as arApply, identity, whyNot } from '../web/ar.js';

// -- geometry ----------------------------------------------------------------

test('a cube has eight corners and twelve edges', () => {
  // Derived from "two corners share an edge when they differ in one
  // coordinate" rather than typed out, so this is checking the derivation.
  const { points, edges } = solid('cubo');
  assert.equal(points.length, 8);
  assert.equal(edges.length, 12);
});

test('every edge points at a corner that exists', () => {
  for (const name of SOLIDS) {
    const { points, edges } = solid(name);
    for (const [a, b] of edges) {
      assert.ok(a >= 0 && a < points.length, `${name}: ${a}`);
      assert.ok(b >= 0 && b < points.length, `${name}: ${b}`);
      assert.notEqual(a, b, `${name}: aresta para si mesma`);
    }
  }
});

test('no corner is left floating', () => {
  /* A point nothing connects to draws as nothing, so it is invisible in a
     screenshot and only shows up as a shape that seems too sparse. */
  for (const name of SOLIDS) {
    const { points, edges } = solid(name);
    const touched = new Set(edges.flat());
    assert.equal(touched.size, points.length, `${name}: ${points.length - touched.size} soltos`);
  }
});

test('every solid fits in the unit box it claims', () => {
  // Size is applied as a multiplier, so a shape that is secretly 2 across
  // would come out twice as big as asked for.
  for (const name of SOLIDS) {
    for (const point of solid(name).points) {
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(point[axis]) <= 0.5001, `${name}.${axis} = ${point[axis]}`);
      }
    }
  }
});

test('a shape nobody has heard of becomes something rather than nothing', () => {
  // Driven by speech: a request for a dodecahedron should put *something* in
  // the room while he says he does not know that one.
  const made = solid('dodecaedro');
  assert.equal(made.name, 'cubo');
  assert.ok(made.points.length > 0);
});

test('placing spins about the object, then moves it', () => {
  const item = hologram({ shape: 'cubo', x: 1, y: 0, z: -2, size: 2, spin: 0 });
  item.angle = 0;
  const corner = place({ x: 0.5, y: 0, z: 0 }, item);
  assert.ok(Math.abs(corner.x - 2) < 1e-6, `${corner.x}`);
  assert.ok(Math.abs(corner.z + 2) < 1e-6, `${corner.z}`);

  item.angle = Math.PI / 2;
  const turned = place({ x: 0.5, y: 0, z: 0 }, item);
  assert.ok(Math.abs(turned.x - 1) < 1e-6, 'o giro é em torno do próprio centro');
  assert.ok(Math.abs(turned.z - -3) < 1e-6, `${turned.z}`);
});

test('a rotation keeps the object the same size', () => {
  const item = hologram({ shape: 'cubo', x: 0, y: 0, z: 0, size: 1, spin: 0 });
  const span = () => {
    const placed = item.points.map((point) => place(point, item));
    return Math.max(...placed.map((p) => Math.hypot(p.x, p.y, p.z)));
  };
  item.angle = 0;
  const before = span();
  item.angle = 0.7;
  assert.ok(Math.abs(span() - before) < 1e-5, 'girar não pode esticar');
});

// -- projection --------------------------------------------------------------

test('what is further away draws smaller', () => {
  const near = project({ x: 0.5, y: 0, z: -1 });
  const far = project({ x: 0.5, y: 0, z: -4 });
  assert.ok(near.x > far.x * 3);
});

test('what is behind the camera is not drawn', () => {
  /* Without this the perspective divide flips the point through the origin
     and draws a mirror of the room. */
  assert.equal(project({ x: 1, y: 1, z: 0.5 }).visible, false);
  assert.equal(project({ x: 1, y: 1, z: 0 }).visible, false);
  assert.equal(project({ x: 1, y: 1, z: -1 }).visible, true);
});

test('the centre of view is the centre of the screen', () => {
  const middle = project({ x: 0, y: 0, z: -2 });
  assert.equal(middle.x, 0);
  assert.equal(middle.y, 0);
});

// -- the scene ---------------------------------------------------------------

test('what is added is there, and what is removed is not', () => {
  const scene = new Scene();
  const item = scene.add({ shape: 'esfera' });
  assert.equal(scene.items.length, 1);
  assert.equal(scene.remove(item.id), true);
  assert.equal(scene.remove(item.id), false);
  assert.equal(scene.items.length, 0);
});

test('the room fills up from the front, not the back', () => {
  /* The one you just asked for is the one you are looking at; dropping that
     instead of the oldest would be absurd. */
  const scene = new Scene({ limit: 3 });
  for (let i = 0; i < 5; i += 1) scene.add({ shape: 'cubo', label: `n${i}` });
  assert.equal(scene.items.length, 3);
  assert.equal(scene.last().label, 'n4');
  assert.equal(scene.items[0].label, 'n2');
});

test('everything spins, and a long gap does not send it flying', () => {
  // A backgrounded tab hands back a step measured in minutes.
  const scene = new Scene();
  const item = scene.add({ shape: 'cubo', spin: 1 });
  scene.frame(600);
  assert.ok(item.angle >= 0 && item.angle < Math.PI * 2);
  assert.ok(scene.time <= 0.1, `${scene.time}`);
});

test('changing the shape brings its geometry with it', () => {
  const scene = new Scene();
  const item = scene.add({ shape: 'cubo' });
  scene.update(item.id, { shape: 'esfera' });
  assert.equal(item.shape, 'esfera');
  assert.ok(item.points.length > 8, 'ficou com a geometria antiga');
});

test('near edges are drawn over far ones', () => {
  const scene = new Scene();
  scene.add({ shape: 'cubo', z: -5 });
  scene.add({ shape: 'cubo', z: -1 });
  const edges = scene.edges();
  const first = edges[0];
  const last = edges[edges.length - 1];
  assert.ok(first.a.z < last.a.z, 'o mais longe tem de vir primeiro');
});

// -- reading a sentence ------------------------------------------------------

test('a full request is read whole', () => {
  const said = parse('cria um cubo azul grande à minha direita');
  assert.equal(said.verb, 'criar');
  assert.equal(said.shape, 'cubo');
  assert.equal(said.hue, HUES.azul);
  assert.ok(said.size > 0.3);
  assert.ok(said.where.x > 0);
});

test('a naked noun is a request', () => {
  /* Speech is clipped. Demanding a verb would reject half of what anybody
     actually says out loud. */
  const said = parse('um toro');
  assert.equal(said.verb, 'criar');
  assert.equal(said.shape, 'toro');
});

test('everyday words for shapes work', () => {
  for (const [word, shape] of [['bola', 'esfera'], ['caixa', 'cubo'], ['rosquinha', 'toro']]) {
    assert.equal(parse(`poe uma ${word}`).shape, shape, word);
  }
});

test('a sentence that is not about shapes is handed on, not guessed at', () => {
  /* Returning null is the signal to let the model handle it. Guessing here
     would put a cube in the room every time somebody asked the time. */
  const scene = new Scene();
  assert.equal(conjure(scene, 'que horas são'), null);
  assert.equal(conjure(scene, 'me conta uma piada'), null);
  assert.equal(scene.items.length, 0);
});

test('a shape he cannot build is handed on too', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'me faz um dodecaedro'), null);
  assert.equal(scene.items.length, 0, 'melhor nada do que a forma errada');
});

test('clearing everything and clearing one thing are different', () => {
  const scene = new Scene();
  conjure(scene, 'um cubo');
  conjure(scene, 'uma esfera');
  conjure(scene, 'tira o cubo');
  assert.deepEqual(scene.items.map((item) => item.shape), ['esfera']);
  conjure(scene, 'limpa tudo');
  assert.equal(scene.items.length, 0);
});

test('changing one acts on the last unless another is named', () => {
  const scene = new Scene();
  conjure(scene, 'um cubo');
  conjure(scene, 'uma esfera');
  conjure(scene, 'deixa vermelho');
  assert.equal(scene.last().hue, HUES.vermelho);
  conjure(scene, 'pinta o cubo de verde');
  assert.equal(scene.items[0].hue, HUES.verde);
});

test('the articles agree, because "Um esfera" reads as broken', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'uma bola'), 'Uma esfera.');
  assert.equal(conjure(scene, 'um cubo'), 'Um cubo.');
  assert.equal(conjure(scene, 'tira a esfera'), 'Tirei a esfera.');
});

// -- being taught a word -----------------------------------------------------

test('a name can be taught, in more than one phrasing', () => {
  for (const phrase of [
    'quando eu disser caixote é um cubo',
    'caixote quer dizer cubo',
    'chamo de caixote o cubo',
  ]) {
    assert.deepEqual(teaching(phrase), { alias: 'caixote', shape: 'cubo' }, phrase);
  }
});

test('and only when the other half names something buildable', () => {
  /* Without this it would happily record that a banana means a guitar. */
  assert.equal(teaching('banana quer dizer guitarra'), null);
  assert.equal(teaching('cubo quer dizer cubo'), null, 'ensinar o óbvio não é ensinar');
});

test('a taught name outranks the built-in vocabulary', () => {
  // Somebody renaming a word for themselves is the whole point of teaching.
  const aliases = { bola: 'cubo' };
  assert.equal(parse('poe uma bola').shape, 'esfera');
  assert.equal(parse('poe uma bola', { aliases }).shape, 'cubo');
});

test('taught names are read back out of what was remembered', () => {
  const memory = {
    rows: [
      { kind: 'apelido', text: 'quando eu disser caixote é um cubo' },
      { kind: 'nota', text: 'isto não é um apelido' },
      { kind: 'apelido', text: 'rosca quer dizer toro' },
    ],
  };
  assert.deepEqual(learnedNames(memory), { caixote: 'cubo', rosca: 'toro' });
});

test('an empty memory teaches nothing, and does not throw', () => {
  assert.deepEqual(learnedNames(null), {});
  assert.deepEqual(learnedNames({ rows: [] }), {});
});

// -- the matrix, which is where a scene quietly mirrors itself ---------------

test('the identity leaves a point where it was', () => {
  assert.deepEqual(arApply(identity(), { x: 1, y: 2, z: -3 }), { x: 1, y: 2, z: -3 });
});

test('the translation is read from the right three slots', () => {
  /* Column-major, which WebXR uses: elements 12, 13, 14 are the translation.
     Reading 3, 7, 11 instead is the mistake that mirrors a whole scene, and
     it looks plausible right up until you move. */
  const m = identity();
  m[12] = 5;
  m[13] = -1;
  m[14] = -2;
  assert.deepEqual(arApply(m, { x: 0, y: 0, z: 0 }), { x: 5, y: -1, z: -2 });
});

test('a quarter turn about Y sends +x to -z', () => {
  const m = identity();
  const c = Math.cos(Math.PI / 2);
  const s = Math.sin(Math.PI / 2);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  const turned = arApply(m, { x: 1, y: 0, z: 0 });
  assert.ok(Math.abs(turned.x) < 1e-9, `${turned.x}`);
  assert.ok(Math.abs(turned.z + 1) < 1e-9, `${turned.z}`);
});

// -- what the app says when there is no augmented reality --------------------

test('http is named as http, not as a missing feature', () => {
  /* The two send somebody to completely different places: one to the address
     bar, the other to the Play Store. */
  assert.match(whyNot({ xr: {} }, false), /https/i);
});

test('no WebXR at all says which browsers have it', () => {
  const said = whyNot({}, true);
  assert.match(said, /WebXR/);
  assert.match(said, /Android|iPhone/);
});

test('and a browser that has it is not refused up front', () => {
  // Whether AR actually works is a question only the device can answer, and
  // `supported()` asks it.
  assert.equal(whyNot({ xr: {} }, true), null);
});
