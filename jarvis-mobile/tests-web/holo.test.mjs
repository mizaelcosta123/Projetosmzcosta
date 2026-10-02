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
import { HUES, MOST, SIZES, conjure, learnedNames, parse, perform, teaching } from '../web/conjure.js';
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
  // Driven by speech: a request for a tesseract should put *something* in
  // the room while he says he does not know that one.
  const made = solid('tesserato');
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

test('ordinary sentences that share a word with a command are not swallowed', () => {
  /* Each of these used to be intercepted before the model saw it: "tira" and
     "some" are verbs for removing, "muda" for changing, "faz" for making,
     and a shape named in a question is not a request for one. With objects
     in the room it was worse -- "tira uma dúvida" emptied it. */
  const scene = new Scene();
  conjure(scene, 'um cubo');
  conjure(scene, 'uma esfera');
  for (const sentence of [
    'tira uma dúvida pra mim',
    'muda de assunto',
    'give me some ideas',
    'o que é uma pirâmide?',
    'faz um resumo sobre a esfera celeste',
    'gira em torno de que o planeta?',
  ]) {
    assert.equal(conjure(scene, sentence), null, sentence);
  }
  assert.equal(scene.items.length, 2, 'nada foi apagado nem criado');
});

test('commands made only of known words still work, fillers and all', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'Jarvis, cria um cubo vermelho grande aí na minha frente, por favor'), 'Um cubo.');
  assert.equal(conjure(scene, 'agora deixa ele azul'), 'Pronto.');
  assert.equal(scene.last().hue, HUES.azul);
  assert.equal(conjure(scene, 'limpa tudo'), 'Limpei 1 objeto.');
});

test('colours agree with the noun, and still count as known words', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'uma bola vermelha'), 'Uma esfera.');
  assert.equal(scene.last().hue, HUES.vermelho);
  assert.equal(conjure(scene, 'uma pirâmide amarela minúscula'), 'Uma pirâmide.');
  assert.equal(scene.last().hue, HUES.amarelo);
});

test('a shape he cannot build is handed on too', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'me faz um tesserato'), null);
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

// -- the model's tool call ---------------------------------------------------

test('a tool call makes what it names, where it says', () => {
  const scene = new Scene();
  const said = perform(scene, { action: 'criar', shape: 'esfera', color: 'dourado', size: 'grande', place: 'direita' });
  assert.equal(said, 'Uma esfera.');
  const made = scene.last();
  assert.deepEqual([made.shape, made.hue, made.size, made.x], ['esfera', HUES.dourado, SIZES.grande, 0.6]);
});

test('several of one shape sit side by side, centred on the place', () => {
  const scene = new Scene();
  assert.equal(perform(scene, { shape: 'cubo', count: 3 }), '3 cubos.');
  const xs = scene.items.map((item) => item.x);
  assert.equal(xs.length, 3);
  assert.ok(Math.abs(xs.reduce((a, b) => a + b, 0)) < 1e-9, 'centrados');
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'em fila');
});

test('a count past the limit is held to it, not obeyed', () => {
  const scene = new Scene();
  perform(scene, { shape: 'cubo', count: 500 });
  assert.equal(scene.items.length, MOST);
});

test('names the browser does not know do nothing, rather than something else', () => {
  /* The tool refuses these server-side. One arriving here means the two
     tables drifted apart, and a silent wrong object would hide that. */
  const scene = new Scene();
  assert.equal(perform(scene, { shape: 'tesserato' }), null);
  assert.equal(perform(scene, { action: 'explodir', shape: 'cubo' }), null);
  assert.equal(scene.items.length, 0);
  perform(scene, { shape: 'cubo', color: 'toString' });
  assert.equal(scene.last().hue, 195, '"toString" está *em* todo objeto; não é uma cor');
});

test('changing, spinning, stopping and clearing through the tool', () => {
  const scene = new Scene();
  perform(scene, { shape: 'cubo' });
  perform(scene, { shape: 'toro' });
  assert.equal(perform(scene, { action: 'mudar', shape: 'cubo', color: 'verde' }), 'Pronto.');
  assert.equal(scene.items[0].hue, HUES.verde);
  assert.equal(perform(scene, { action: 'mudar' }), null, 'mudar sem o quê não faz nada');
  assert.equal(perform(scene, { action: 'parar' }), 'Parado.');
  assert.equal(scene.last().spin, 0);
  assert.equal(perform(scene, { action: 'girar' }), 'Girando.');
  assert.ok(scene.last().spin > 0);
  assert.equal(perform(scene, { action: 'limpar', shape: 'toro' }), 'Tirei o toro.');
  assert.equal(perform(scene, { action: 'limpar' }), 'Limpei 1 objeto.');
});

// -- any figure: detail, composition, three axes ------------------------------

import { DETAIL, LIMITS, compose, nounOf, rebuild } from '../web/holo.js';

test('the regular solids have the faces geometry says they have', () => {
  /* Wired by nearest distance, so a wrong constant shows up as the wrong
     number of edges rather than as a shape that merely looks odd. */
  for (const [name, points, edges] of [
    ['tetraedro', 4, 6], ['octaedro', 6, 12], ['icosaedro', 12, 30], ['dodecaedro', 20, 30],
  ]) {
    const made = solid(name);
    assert.deepEqual([made.points.length, made.edges.length], [points, edges], name);
  }
});

test('more detail is more segments, and the default is what the six always drew', () => {
  assert.ok(solid('esfera', { detail: 5 }).edges.length > solid('esfera', { detail: 1 }).edges.length);
  assert.ok(solid('cilindro', { detail: 4 }).edges.length > solid('cilindro', { detail: 2 }).edges.length);
  assert.equal(DETAIL, 3);
  assert.equal(solid('esfera').points.length, 60, 'a esfera antiga: 5 anéis de 12');
  assert.equal(solid('esfera', { detail: 99 }).edges.length, solid('esfera', { detail: 5 }).edges.length, 'limitado a 5');
});

test('a composed figure fits the unit box and keeps each part\'s colour', () => {
  const built = compose([
    { shape: 'cubo', scale: [4, 1, 2], hue: 0 },
    { shape: 'cilindro', pos: [1.5, -0.6, 1], scale: [0.6, 0.2, 0.6], rot: [90, 0, 0], hue: 200 },
  ]);
  assert.equal(built.parts, 2);
  for (const p of built.points) {
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(p[axis]) <= 0.5001, `${axis} = ${p[axis]}`);
  }
  const hues = new Set(built.edges.map((edge) => edge[2]));
  assert.deepEqual([...hues].sort(), [0, 200]);
});

test('parts nobody can build are skipped, not turned into cubes', () => {
  const built = compose([{ shape: 'roda' }, { shape: 'esfera' }]);
  assert.equal(built.parts, 1);
  assert.equal(compose([{ shape: 'roda' }]), null);
  assert.equal(compose('nada'), null);
});

test('the lathe, the extrusion and free lines build from their data', () => {
  const vase = compose([{ shape: 'torno', profile: [[0.2, 0], [0.5, 0.5], [0.15, 1], [0.25, 1.3]] }]);
  assert.ok(vase.edges.length > 30);
  const letter = compose([{ shape: 'extrusao', outline: [[0, 0], [1, 0], [1, 1], [0, 1]], height: 0.2 }]);
  assert.equal(letter.edges.length, 12, 'um contorno de 4 levantado é uma caixa');
  const zigzag = compose([{ shape: 'linhas', points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]] }]);
  assert.equal(zigzag.edges.length, 2, 'sem arestas, liga os pontos em ordem');
  const bad = compose([{ shape: 'linhas', points: [[0, 0, 0], [1, 0, 0]], edges: [[0, 9], [0, 0]] }]);
  assert.equal(bad.edges.length, 1, 'arestas inválidas caem para a polilinha');
});

test('a figure is capped in edges, so a phone stays at sixty frames', () => {
  const many = Array.from({ length: 200 }, () => ({ shape: 'esfera' }));
  const built = compose(many, 5);
  assert.ok(built.edges.length <= LIMITS.edges, `${built.edges.length}`);
  assert.ok(built.parts <= LIMITS.parts);
});

test('a quarter turn about X takes up to towards you', () => {
  const item = hologram({ shape: 'linha', x: 0, y: 0, z: 0, size: 1, spin: 0 });
  item.rx = Math.PI / 2;
  const top = place({ x: 0, y: 1, z: 0 }, item);
  assert.ok(Math.abs(top.y) < 1e-9 && Math.abs(top.z - 1) < 1e-9, JSON.stringify(top));
});

test('it can spin about any axis', () => {
  const scene = new Scene();
  const item = scene.add({ shape: 'cubo', spin: 1, spinAxis: 'x' });
  scene.frame(0.05);
  assert.ok(item.rx > 0);
  assert.equal(item.angle, 0);
});

test('the scene drops the oldest when the edges, not just the count, run out', () => {
  const scene = new Scene();
  const heavy = Array.from({ length: 23 }, () => ({ shape: 'esfera' }));
  for (let i = 0; i < 6; i += 1) scene.add({ spec: { parts: heavy }, detail: 5, name: `n${i}` });
  assert.ok(scene.weight() <= LIMITS.scene, `${scene.weight()}`);
  assert.equal(scene.last().name, 'n5');
});

test('more detail rebuilds the same object in place', () => {
  const scene = new Scene();
  const item = scene.add({ shape: 'esfera', x: 0.3 });
  const before = item.edges.length;
  scene.update(item.id, { detail: 5 });
  assert.ok(item.edges.length > before);
  assert.equal(item.x, 0.3);
  item.detail = 1;
  rebuild(item);
  assert.ok(item.edges.length < before);
});

test('figures are found by the name people call them', () => {
  const scene = new Scene();
  scene.add({ spec: { parts: [{ shape: 'cubo' }] }, name: 'casa' });
  scene.add({ shape: 'esfera' });
  assert.equal(scene.find('casa').shape, 'composto');
  assert.equal(scene.find('esfera').shape, 'esfera');
  assert.equal(scene.find('carro'), null);
});

test('the article agrees with what it is', () => {
  assert.equal(nounOf({ name: 'casa' }), 'a casa');
  assert.equal(nounOf({ name: 'carro' }, { definite: false, capital: true }), 'Um carro');
  assert.equal(nounOf({ name: 'planeta' }), 'o planeta');
  assert.equal(nounOf({ shape: 'helice' }), 'a hélice');
  assert.equal(nounOf({ name: 'robo', gender: 'f' }), 'a robo', 'o modelo pode dizer o gênero');
});

// -- turning and detail by voice -----------------------------------------------

test('turning by a number of degrees, without the network', () => {
  const scene = new Scene();
  conjure(scene, 'um cubo');
  assert.equal(conjure(scene, 'gira 90 graus'), 'Girei 90 graus.');
  assert.ok(Math.abs(scene.last().angle - Math.PI / 2) < 1e-9);
  assert.equal(scene.last().spin, 0, 'parado no ângulo pedido');
  conjure(scene, 'gira 45 graus para a esquerda');
  assert.ok(Math.abs(scene.last().angle - Math.PI / 4) < 1e-9);
  conjure(scene, 'gira 90 graus para cima');
  assert.ok(Math.abs(scene.last().rx + Math.PI / 2) < 1e-9);
});

test('upside down, on its side, tilted and straightened', () => {
  const scene = new Scene();
  conjure(scene, 'um cone');
  assert.equal(conjure(scene, 'vira de cabeça para baixo'), 'De cabeça para baixo.');
  assert.ok(Math.abs(scene.last().rx - Math.PI) < 1e-9);
  assert.equal(conjure(scene, 'deita ele'), 'Deitei.');
  assert.ok(Math.abs(Math.abs(scene.last().rz) - Math.PI / 2) < 1e-9);
  assert.equal(conjure(scene, 'endireita'), 'Endireitei.');
  assert.deepEqual([scene.last().rx, scene.last().rz], [0, 0]);
  assert.equal(conjure(scene, 'inclina para trás'), 'Inclinei.');
  assert.ok(scene.last().rx > 0);
});

test('more and less detail, held to its range', () => {
  const scene = new Scene();
  conjure(scene, 'uma esfera');
  const before = scene.last().edges.length;
  assert.equal(conjure(scene, 'mais detalhe'), 'Mais detalhe.');
  assert.ok(scene.last().edges.length > before);
  conjure(scene, 'mais detalhe');
  assert.equal(conjure(scene, 'mais detalhe'), 'Já está no máximo de detalhe.');
  assert.equal(conjure(scene, 'menos detalhe'), 'Menos detalhe.');
});

test('the new shapes are made by voice, with the articles right', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'um cilindro azul'), 'Um cilindro.');
  assert.equal(conjure(scene, 'uma estrela dourada'), 'Uma estrela.');
  assert.equal(conjure(scene, 'uma mola'), 'Uma hélice.');
  assert.equal(conjure(scene, 'tira a estrela'), 'Tirei a estrela.');
});

test('a figure the model built answers to its name in the fast path', () => {
  const scene = new Scene();
  scene.add({ spec: { parts: [{ shape: 'cubo' }] }, name: 'carro' });
  scene.add({ shape: 'esfera' });
  assert.equal(conjure(scene, 'gira o carro 90 graus'), 'Girei 90 graus.');
  assert.ok(scene.find('carro').angle > 1);
  assert.equal(scene.find('esfera').angle, 0, 'só o carro girou');
  assert.equal(conjure(scene, 'apaga o carro'), 'Tirei o carro.');
  assert.equal(scene.find('carro'), null);
});
