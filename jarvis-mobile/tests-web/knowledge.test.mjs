/**
 * The vault: what goes in, what comes back out, and what is never sent.
 *
 * The behaviour that matters most is the restraint -- a message the vault
 * knows nothing about gets nothing, because every passage sent is tokens
 * paid and a context full of noise is worse than an empty one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { Knowledge, chunk, digest, focus, learning, memoryAdapter, readFile } from '../web/knowledge.js';

const fresh = async (seed = []) => new Knowledge({ adapter: memoryAdapter(seed) }).open();

test('a long document is cut into passages that each fit, and overlap', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Frase número ${i} fala de um assunto diferente.`).join(' ');
  const passages = chunk(text, { size: 200, overlap: 60 });
  assert.ok(passages.length > 5);
  for (const passage of passages) assert.ok(passage.length <= 260, `${passage.length}`);
  // The tail of one opens the next: a sentence cut at the edge is whole somewhere.
  const last = passages[0].match(/Frase número \d+/g).pop();
  assert.ok(passages[1].includes(last), `${last} não aparece de novo`);
});

test('paragraphs are where the author cut, and are kept apart when big', () => {
  const passages = chunk(`${'a '.repeat(200)}\n\n${'b '.repeat(200)}`, { size: 450 });
  assert.equal(passages.length, 2);
});

test('the same passage is stored once, however many times it is imported', async () => {
  const vault = await fresh();
  const first = await vault.add('A consulta com a dentista é dia 12 às 15h, na rua das Flores.');
  const again = await vault.add('A consulta com a dentista é dia 12 às 15h,   na rua das Flores.');
  assert.deepEqual([first.added, again.added, again.skipped], [1, 0, 1]);
  assert.equal(vault.stats().passages, 1);
});

test('a question about something stored finds it, with where it came from', async () => {
  const vault = await fresh();
  await vault.add('A senha do wifi da casa da praia é tubarao2026.', { title: 'praia', source: 'notas.md' });
  await vault.add('A receita de pão leva farinha, fermento, água e sal.', { source: 'receitas.md' });
  const [best] = vault.search('qual é a senha do wifi da praia?');
  assert.equal(best.row.source, 'notas.md');
  const context = vault.contextFor('qual é a senha do wifi da praia?');
  assert.match(context, /de: notas\.md/);
  assert.match(context, /tubarao2026/);
});

test('a message the vault knows nothing about costs nothing', async () => {
  const vault = await fresh();
  await vault.add('A senha do wifi da casa da praia é tubarao2026.');
  for (const message of ['bom dia, tudo bem?', 'me conta uma piada', 'cria um cubo']) {
    assert.equal(vault.contextFor(message), '', message);
  }
});

test('the context is held to its budget', async () => {
  const vault = await fresh();
  for (let i = 0; i < 10; i += 1) await vault.add(`Projeto Atlas, fase ${i}: ${'detalhe importante do projeto atlas '.repeat(15)}`);
  const context = vault.contextFor('projeto atlas detalhe', { count: 10, budget: 1200 });
  assert.ok(context.length < 1500, `${context.length}`);
});

test('what is stored comes back after a reload; the built-in pack is never stored', async () => {
  const adapter = memoryAdapter();
  const vault = await new Knowledge({ adapter }).open();
  vault.seed([{ title: 'Manual', text: 'O Jarvis cria hologramas 3D por voz.' }]);
  await vault.add('Meu carro é um Gol 2012 prata.', { source: 'você disse' });
  const reopened = await new Knowledge({ adapter }).open();
  assert.equal(reopened.stats().passages, 1);
  assert.equal(reopened.search('hologramas por voz').length, 0, 'o pacote não foi gravado');
});

test('forgetting a document, and forgetting everything, spare the built-in pack', async () => {
  const vault = await fresh();
  vault.seed([{ title: 'Manual', text: 'O Jarvis cria hologramas 3D por voz e por gestos.' }]);
  await vault.add('Lista de compras: arroz, feijão, café.', { source: 'compras.md', title: 'compras' });
  await vault.add('A reunião de condomínio é na quinta.', { source: 'condominio.md', title: 'condominio' });
  const [doc] = vault.documents().filter((d) => d.source === 'compras.md');
  assert.equal(await vault.forget(doc.doc), 1);
  assert.equal(vault.search('lista de compras arroz feijão').length, 0);
  await vault.clear();
  assert.equal(vault.stats().passages, 0);
  assert.ok(vault.search('hologramas por voz e gestos').length > 0, 'o manual continua');
});

test('Markdown, CSV and JSON are read as text a passage can be found by', () => {
  const [note] = readFile('notas/praia.md', '---\ntags: x\n---\n# Praia\nVer [[Wifi|a senha]] e ![](foto.png) [site](http://x)');
  assert.equal(note.title, 'praia');
  assert.doesNotMatch(note.text, /tags:|\[\[|!\[|http/);
  assert.match(note.text, /a senha/);

  const [sheet] = readFile('gastos.csv', 'item;valor\nluz;120\n"água; esgoto";80');
  assert.match(sheet.text, /item: luz; valor: 120/);
  assert.match(sheet.text, /item: água; esgoto; valor: 80/);

  const docs = readFile('docs.json', JSON.stringify([{ titulo: 'A', texto: 'um' }, { title: 'B', extra: { cor: 'azul' } }]));
  assert.deepEqual(docs.map((d) => d.title), ['A', 'B']);
  assert.match(docs[1].text, /cor: azul/);
  assert.equal(readFile('quebrado.json', '{nao é json')[0].text, '{nao é json');
});

test('"aprenda isso" is a fact; "aprenda a habilidade" is not', () => {
  assert.equal(learning('aprenda isso: meu carro é um Gol 2012'), 'meu carro é um Gol 2012');
  assert.equal(learning('Jarvis, guarde que a consulta é dia 12'), 'a consulta é dia 12');
  assert.equal(learning('memorize: o código do portão é 4321'), 'o código do portão é 4321');
  assert.equal(learning('aprenda a habilidade: quando eu pedir x, faça y'), null);
  assert.equal(learning('aprendi muito hoje'), null);
  assert.equal(learning('guarda'), null);
});

test('the words that say how something is asked are not what it is about', () => {
  assert.equal(focus('como faço um bolo de cenoura?'), 'bolo cenoura');
  assert.equal(focus('oi, bom dia, tudo bem?'), '', 'só palavras genéricas: sobre nada');
  assert.equal(digest('A  b'), digest('a b'));
});

test('the built-in manual answers "o que você sabe fazer"', async () => {
  const manual = JSON.parse(fs.readFileSync(new URL('../web/knowledge/jarvis.json', import.meta.url)));
  assert.ok(manual.length >= 10);
  for (const doc of manual) assert.ok(doc.titulo && doc.texto.length > 80, doc.titulo);
  const vault = await fresh();
  vault.seed(manual.map((d) => ({ title: d.titulo, text: d.texto, source: 'manual do Jarvis' })));
  assert.match(vault.contextFor('como eu configuro o ollama no termux?'), /ollama serve/);
  assert.match(vault.contextFor('como giro um holograma por voz?'), /gira 90 graus/);
  assert.equal(vault.stats().passages, 0, 'o manual não conta como seu');
});
