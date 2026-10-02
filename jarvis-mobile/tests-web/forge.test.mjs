/**
 * The ```holograma block: any figure, from any model.
 *
 * What is held still here is the forgiveness and its limits. Small models
 * write sloppy JSON and the reader has to take it; but no number from a
 * model reaches the geometry unclamped, and a shape nobody can build is
 * dropped rather than becoming a cube in the wrong place.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene } from '../web/holo.js';
import { HUES } from '../web/conjure.js';
import {
  apply, applyAll, hasBlock, hideBlocks, loose, normalize, parseBlocks, roomPrompt, sceneContext,
} from '../web/forge.js';

const block = (json) => `Pronto.\n\`\`\`holograma\n${json}\n\`\`\`\n`;

const CAR = JSON.stringify({
  acao: 'criar', nome: 'carro', cor: 'vermelho', tamanho: 'grande',
  pecas: [
    { forma: 'cubo', pos: [0, 0.35, 0], escala: [2, 0.5, 1] },
    { forma: 'cilindro', pos: [0.6, 0, 0.5], escala: [0.4, 0.12, 0.4], rot: [90, 0, 0], cor: 'branco' },
  ],
});

// -- reading ------------------------------------------------------------------

test('a well-formed block is read whole', () => {
  const [read] = parseBlocks(block(CAR));
  assert.equal(read.action, 'criar');
  assert.equal(read.name, 'carro');
  assert.equal(read.hue, HUES.vermelho);
  assert.equal(read.parts.length, 2);
  assert.equal(read.parts[1].hue, HUES.branco);
  assert.deepEqual(read.parts[1].rot, [90, 0, 0]);
});

test('the mistakes small models make are forgiven', () => {
  /* Single quotes, bare keys, a trailing comma, a comment. Each is a block
     a 1.5B model really writes, and each would otherwise be a figure lost. */
  const sloppy = "{acao:'criar', nome:'torre', // a torre\n pecas:[{forma:'cilindro', escala:[1,4,1]},],}";
  const [read] = parseBlocks(block(sloppy));
  assert.equal(read.name, 'torre');
  assert.equal(read.parts.length, 1);
});

test('a block cut off mid-reply still builds what arrived', () => {
  assert.deepEqual(loose('{"pecas":[{"forma":"cubo"},{"forma":"esfera"'), { pecas: [{ forma: 'cubo' }, { forma: 'esfera' }] });
});

test('valid JSON is never "repaired"', () => {
  assert.deepEqual(loose('{"nome":"d\'água"}'), { nome: "d'água" });
});

test('English keys and accented shapes are understood', () => {
  const [read] = parseBlocks(block('{"action":"create","name":"Rocket","parts":[{"shape":"cone"},{"shape":"pirâmide"},{"shape":"cylinder"}]}'));
  assert.equal(read.name, 'rocket');
  assert.deepEqual(read.parts.map((p) => p.shape), ['cone', 'piramide', 'cilindro']);
});

test('numbers are clamped, so a model cannot freeze the phone', () => {
  const [read] = parseBlocks(block('{"pecas":[{"forma":"cubo","pos":[1e308,0,-1e308],"escala":[0,99999,"x"]}],"detalhe":42,"tamanho":900}'));
  assert.deepEqual(read.parts[0].pos, [50, 0, -50]);
  assert.deepEqual(read.parts[0].scale, [0.001, 50, 1]);
  assert.equal(read.detail, 5);
  assert.equal(read.size, 1.5);
});

test('a shape nobody can build is dropped, the rest kept', () => {
  const [read] = parseBlocks(block('{"pecas":[{"forma":"roda"},{"forma":"esfera"}]}'));
  assert.deepEqual(read.parts.map((p) => p.shape), ['esfera']);
  assert.deepEqual(parseBlocks(block('{"pecas":[{"forma":"roda"}]}')), [], 'nada construível, nada lido');
});

test('a generator without its data is not a part', () => {
  const [read] = parseBlocks(block('{"pecas":[{"forma":"torno"},{"forma":"torno","perfil":[[0.3,0],[0.5,1]]}]}'));
  assert.equal(read.parts.length, 1);
});

test('only holograma blocks are read; other code is left alone', () => {
  const reply = '```js\n{"pecas":[{"forma":"cubo"}]}\n```';
  assert.deepEqual(parseBlocks(reply), []);
  assert.equal(hasBlock(reply), false);
  assert.equal(hasBlock(block('{nada')), true);
});

test('several figures in one block, as a list', () => {
  const reply = block('[{"nome":"a","forma":"cubo"},{"nome":"b","forma":"esfera"}]');
  assert.equal(parseBlocks(reply).length, 2);
});

test('an unknown action is ignored, not guessed', () => {
  assert.equal(normalize({ acao: 'explodir', nome: 'carro' }), null);
  assert.equal(normalize({ acao: 'criar' }), null, 'criar sem nada para construir');
  assert.equal(normalize([1, 2]), null);
});

// -- carrying it out ----------------------------------------------------------

test('creating a figure puts it in the room, named', () => {
  const scene = new Scene();
  assert.equal(applyAll(scene, block(CAR)), 'Um carro.');
  const car = scene.find('carro');
  assert.equal(car.shape, 'composto');
  assert.equal(car.hue, HUES.vermelho);
  assert.ok(car.edges.length > 12);
});

test('redrawing keeps the place, the turn and the size', () => {
  /* "Redraw it, in small details or large": the figure changes in front of
     you, it does not jump back to the middle. */
  const scene = new Scene();
  applyAll(scene, block(CAR));
  const car = scene.find('carro');
  Object.assign(car, { x: 0.4, angle: 1.2, size: 0.33 });
  const before = car.edges.length;
  const said = applyAll(scene, block(JSON.stringify({
    acao: 'redesenhar', nome: 'carro',
    pecas: [{ forma: 'cubo', escala: [2, 0.5, 1] }, ...[0, 1, 2, 3].map((i) => ({ forma: 'cilindro', pos: [i < 2 ? 0.6 : -0.6, 0, i % 2 ? 0.5 : -0.5], escala: [0.5, 0.15, 0.5], rot: [90, 0, 0] }))],
  })));
  assert.equal(said, 'Redesenhei o carro.');
  assert.equal(scene.items.length, 1, 'o mesmo objeto, não um novo');
  assert.notEqual(car.edges.length, before);
  assert.deepEqual([car.x, car.angle, car.size], [0.4, 1.2, 0.33]);
});

test('redrawing only the detail or the colour', () => {
  const scene = new Scene();
  applyAll(scene, block('{"nome":"bola","forma":"esfera"}'));
  const ball = scene.find('bola');
  const before = ball.edges.length;
  applyAll(scene, block('{"acao":"redesenhar","nome":"bola","detalhe":5,"cor":"verde"}'));
  assert.ok(ball.edges.length > before);
  assert.equal(ball.hue, HUES.verde);
});

test('redrawing something that is not there creates it', () => {
  const scene = new Scene();
  assert.equal(applyAll(scene, block('{"acao":"redesenhar","nome":"casa","pecas":[{"forma":"cubo"},{"forma":"piramide","pos":[0,1,0]}]}')), 'Uma casa.');
});

test('turning by degrees, relative, and setting an angle', () => {
  const scene = new Scene();
  applyAll(scene, block(CAR));
  const car = scene.find('carro');
  applyAll(scene, block('{"acao":"girar","nome":"carro","graus":[0,90,0]}'));
  assert.ok(Math.abs(car.angle - Math.PI / 2) < 1e-9);
  assert.equal(car.spin, 0, 'parou no ângulo');
  applyAll(scene, block('{"acao":"girar","nome":"carro","rotacao":[180,0,0]}'));
  assert.ok(Math.abs(car.rx - Math.PI) < 1e-9);
  assert.equal(car.angle, 0);
  applyAll(scene, block('{"acao":"girar","nome":"carro","giro":true}'));
  assert.ok(car.spin > 0);
});

test('removing by name, and only that one', () => {
  const scene = new Scene();
  applyAll(scene, block(CAR));
  applyAll(scene, block('{"nome":"bola","forma":"esfera"}'));
  assert.equal(applyAll(scene, block('{"acao":"apagar","nome":"carro"}')), 'Apaguei o carro.');
  assert.deepEqual(scene.items.map((i) => i.name), ['bola']);
  assert.equal(apply(scene, normalize({ acao: 'apagar', nome: 'navio' })), null, 'não apaga outro no lugar');
});

// -- what is shown, and what the model is told ---------------------------------

test('the caption never shows the block, even half-written', () => {
  assert.equal(hideBlocks(block(CAR)), 'Pronto.');
  assert.equal(hideBlocks('Montando…\n```holograma\n{"acao":"cri'), 'Montando…');
  assert.equal(hideBlocks('Veja:\n```html\n<b>oi</b>\n```'), 'Veja:\n```html\n<b>oi</b>\n```', 'outros blocos ficam');
});

test('the prompt names every shape and the format', () => {
  const prompt = roomPrompt();
  for (const word of ['```holograma', 'pecas', 'redesenhar', 'torno', 'extrusao', 'icosaedro']) {
    assert.ok(prompt.includes(word), word);
  }
});

test('the model is shown what is in the room, within a budget', () => {
  const scene = new Scene();
  assert.equal(sceneContext(scene), '');
  applyAll(scene, block(CAR));
  const said = sceneContext(scene);
  assert.match(said, /"nome":"carro"/);
  assert.match(said, /"forma":"cilindro"/);
  for (let i = 0; i < 20; i += 1) applyAll(scene, block(CAR.replace('carro', `carro${i}`)));
  assert.ok(sceneContext(scene, 1500).length <= 1600);
});
