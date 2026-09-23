/**
 * Speaking while the answer arrives: where sentences are cut, what is said
 * instead of markdown, and a queue that says them in order and stops when
 * told.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { NODS, Rotation, Sentences, THINKING, Talk, spoken } from '../web/utter.js';

/** Feed a text in small chunks, as a stream would, and collect every piece. */
function stream(text, size = 3) {
  const s = new Sentences();
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(...s.push(text.slice(i, i + size)));
  out.push(...s.flush());
  return out;
}

test('a stream becomes its sentences, each as soon as it is complete', () => {
  const s = new Sentences();
  assert.deepEqual(s.push('Claro. Amanhã '), ['Claro.']);
  assert.deepEqual(s.push('chove à tarde. Leve'), ['Amanhã chove à tarde.']);
  assert.deepEqual(s.push(' um guarda-chuva!'), []);
  assert.deepEqual(s.flush(), ['Leve um guarda-chuva!']);
});

test('numbers and abbreviations are not sentence ends while they are being typed', () => {
  assert.deepEqual(stream('A versão 3.5 saiu. Custa R$ 2,50 hoje.'), ['A versão 3.5 saiu.', 'Custa R$ 2,50 hoje.']);
});

test('the first piece may stop at a comma, to start talking sooner', () => {
  const s = new Sentences();
  const first = s.push('Olha, isso depende bastante do que você quer, mas em geral ');
  assert.deepEqual(first, ['Olha, isso depende bastante do que você quer,']);
  // Later pieces wait for a real sentence end (or grow long).
  assert.deepEqual(s.push('funciona bem, sim, '), []);
});

test('a very long sentence is cut at a comma rather than held back', () => {
  const long = 'Primeiro. ' + 'uma frase que não acaba nunca e segue '.repeat(5) + ', e continua depois da vírgula sem ponto';
  const pieces = stream(long, 7);
  assert.ok(pieces.length >= 3, pieces.join(' | '));
});

test('what is spoken has no markdown, no code and no URLs spelled out', () => {
  assert.equal(spoken('**Importante:** leia o `README`.'), 'Importante: leia o README.');
  assert.equal(spoken('Veja https://example.com/x?y=1 agora'), 'Veja o link na tela agora');
  assert.equal(spoken('## Título\n- item um\n- item dois'), 'Título item um item dois');
  assert.equal(spoken('[o guia](https://x.y/z)'), 'o guia');
});

test('a code block is one piece, said as "on the screen", never read out', () => {
  const pieces = stream('Aqui está:\n```js\nconst a = 1; const b = 2.\nfoo();\n```\nPronto.', 4);
  assert.deepEqual(pieces, ['Aqui está:', '(o código está na tela)', 'Pronto.']);
});

// -- the queue ---------------------------------------------------------------

function voice() {
  const said = [];
  let release = null;
  const speak = (text) => new Promise((resolve) => {
    said.push(text);
    release = resolve;
  });
  return { said, speak, done: () => release?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('the first sentence is spoken before the stream has finished', async () => {
  const v = voice();
  const talk = new Talk({ speak: v.speak });
  talk.push('Sim. Isso ');
  await tick();
  assert.deepEqual(v.said, ['Sim.'], 'falando antes do resto chegar');
  talk.push('funciona.');
  v.done();
  const finished = talk.finish();
  await tick();
  v.done();
  await finished;
  assert.deepEqual(v.said, ['Sim.', 'Isso funciona.']);
});

test('pieces are said one after another, never over each other', async () => {
  const v = voice();
  const talk = new Talk({ speak: v.speak });
  talk.push('Um. Dois. Três. ');
  await tick();
  assert.deepEqual(v.said, ['Um.'], 'o segundo espera o primeiro terminar');
  v.done(); await tick();
  v.done(); await tick();
  assert.deepEqual(v.said, ['Um.', 'Dois.', 'Três.']);
});

test('a prelude goes first, and only if the answer has not started', async () => {
  const v = voice();
  const talk = new Talk({ speak: v.speak });
  talk.prelude('Hum…');
  talk.push('Resposta. ');
  await tick();
  assert.deepEqual(v.said, ['Hum…']);
  v.done(); await tick();
  assert.deepEqual(v.said, ['Hum…', 'Resposta.']);
  talk.prelude('Tarde demais.');
  v.done(); await tick();
  assert.ok(!v.said.includes('Tarde demais.'));
});

test('cancel stops everything still queued, and ends once', async () => {
  const v = voice();
  let ends = 0;
  let starts = 0;
  const talk = new Talk({ speak: v.speak, onStart: () => starts++, onEnd: () => ends++ });
  talk.push('Um. Dois. Três. ');
  await tick();
  talk.cancel();
  v.done(); await tick();
  talk.push('Quatro. ');
  await talk.finish();
  assert.deepEqual(v.said, ['Um.']);
  assert.deepEqual([starts, ends], [1, 1]);
});

test('finish waits for the last word, and a failing voice does not stop the rest', async () => {
  let n = 0;
  const said = [];
  const talk = new Talk({ speak: async (t) => { said.push(t); n += 1; if (n === 1) throw new Error('voz caiu'); } });
  talk.push('Um. Dois. ');
  await talk.finish();
  assert.deepEqual(said, ['Um.', 'Dois.']);
  assert.equal(talk.finished, true);
});

test('nods and thinking sounds rotate: never the same twice in a row', () => {
  for (const list of [NODS, THINKING]) {
    const r = new Rotation(list);
    const seen = Array.from({ length: list.length * 2 }, () => r.next());
    for (let i = 1; i < seen.length; i += 1) assert.notEqual(seen[i], seen[i - 1]);
  }
});
