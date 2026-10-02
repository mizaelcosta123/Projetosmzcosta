/**
 * The skills catalogue: the right recipe for the request, and none for chat.
 *
 * Retrieval here is hashed words, not understanding, so these tests pin the
 * requests that matter rather than claim it is never wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PACKS, Skills, teachingSkill, validate } from '../web/skills.js';
import { memoryAdapter } from '../web/knowledge.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../web/skills/${name}.json`, import.meta.url)));
const catalogue = () => {
  const skills = new Skills({ adapter: memoryAdapter() });
  for (const pack of PACKS) skills.add(read(pack));
  return skills;
};

test('every built-in pack is valid, and together they are over a hundred', () => {
  const ids = new Set();
  let total = 0;
  for (const pack of PACKS) {
    const rows = read(pack);
    for (const row of rows) {
      assert.ok(validate(row), `${pack}: ${row.id}`);
      assert.ok(row.exemplos.length >= 3, `${row.id}: poucos exemplos`);
      assert.ok(!ids.has(row.id), `id repetido: ${row.id}`);
      ids.add(row.id);
    }
    total += rows.length;
  }
  assert.ok(total >= 100, `${total}`);
  assert.deepEqual(fs.readdirSync(new URL('../web/skills/', import.meta.url)).sort(), PACKS.map((p) => `${p}.json`).sort());
});

test('the APIs a skill names exist in the API catalogue', () => {
  const apis = new Set(JSON.parse(fs.readFileSync(new URL('../web/apis.json', import.meta.url))).map((a) => a.id));
  for (const pack of PACKS) {
    for (const row of read(pack)) {
      for (const api of row.apis ?? []) assert.ok(apis.has(api), `${row.id} → ${api}`);
    }
  }
});

test('the request picks the recipe for it', () => {
  const skills = catalogue();
  for (const [request, id] of [
    ['escreve um email pro meu chefe pedindo folga', 'email-formal'],
    ['resume esse texto para mim', 'resumo'],
    ['estou com dor de cabeça forte', 'sintomas'],
    ['como faço um bolo de cenoura', 'receita'],
    ['meu código deu erro', 'depurar'],
    ['organiza meu dia', 'planejar-dia'],
    ['como instalar ollama no termux', 'termux'],
    ['cria um holograma de um carro', 'holo-figura'],
    ['quanto rende mil reais na poupança', 'juros'],
    ['o que você sabe fazer?', 'o-que-sabe'],
  ]) {
    assert.equal(skills.pick(request)[0]?.skill.id, id, request);
  }
});

test('ordinary chat picks nothing, and pays nothing', () => {
  const skills = catalogue();
  for (const message of ['bom dia, tudo bem?', 'obrigado', 'me conta uma piada', 'oi']) {
    assert.deepEqual(skills.pick(message), [], message);
    assert.equal(skills.contextFor(message), '');
  }
});

test('at most two recipes, and only ones close to the best', () => {
  const skills = catalogue();
  for (const request of ['escreve um email formal', 'me explica a fotossíntese', 'monta um plano de estudos']) {
    const picked = skills.pick(request);
    assert.ok(picked.length <= 2);
    if (picked.length === 2) assert.ok(picked[1].score >= picked[0].score * 0.75);
  }
});

test('a recipe taught by voice is read, kept, and chosen', async () => {
  const taught = teachingSkill('aprenda a habilidade: quando eu pedir um resumo de reunião, faça uma lista de decisões e tarefas com responsáveis');
  assert.equal(taught.quando, 'um resumo de reunião');
  assert.match(taught.instrucoes, /^uma lista de decisões/);
  assert.equal(teachingSkill('aprenda isso: o wifi é x'), null);

  const adapter = memoryAdapter();
  const skills = new Skills({ adapter });
  await skills.learn(taught);
  const reopened = await new Skills({ adapter }).open();
  assert.equal(reopened.stats().mine, 1);
  assert.equal(reopened.pick('faz um resumo de reunião')[0].skill.origem, 'voce');
});

test('a built-in pack never overwrites one of yours with the same id', async () => {
  const skills = new Skills({ adapter: memoryAdapter() });
  await skills.learn({ id: 'resumo', quando: 'resumir', instrucoes: 'do meu jeito' });
  skills.add(read('escrita'));
  assert.equal(skills.list.find((s) => s.id === 'resumo').instrucoes, 'do meu jeito');
});

test('only yours can be forgotten', async () => {
  const skills = catalogue();
  assert.equal(await skills.forget('resumo'), false);
  await skills.learn({ id: 'meu', quando: 'quando eu pedir piada de pavê', instrucoes: 'conte uma piada de pavê' });
  assert.equal(await skills.forget('meu'), true);
});

test('a skill with no "when" or no instructions is not a skill', () => {
  assert.equal(validate({ quando: 'x' }), null);
  assert.equal(validate({ instrucoes: 'x' }), null);
  assert.equal(validate(null), null);
  assert.equal(validate({ quando: 'q', instrucoes: 'i', nome: 'Meu Nome!' }).id, 'meu-nome');
});
