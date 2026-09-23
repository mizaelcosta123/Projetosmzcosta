/**
 * Memory out to an Obsidian note and back, and a store that can take it in.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Memory, nowhereAdapter } from '../web/memory.js';
import { LONGEST, fromMarkdown, toMarkdown } from '../web/vault.js';
import { learnedNames } from '../web/conjure.js';

const NOW = new Date('2026-09-23T15:00:00.000Z');

function store(now = () => NOW.getTime()) {
  return new Memory({ adapter: nowhereAdapter(), now }).open();
}

test('an export reads as a note: front matter, a title, one section per kind', () => {
  const memory = store();
  memory.learn('cria um cubo azul', { kind: 'pedido' });
  memory.learn('quando eu disser caixote é um cubo', { kind: 'apelido' });
  const note = toMarkdown(memory.all(), { now: () => NOW });
  assert.match(note, /^---\ntipo: memoria-jarvis\nexportado: 2026-09-23T15:00:00\.000Z\ntotal: 2\n---\n/);
  assert.match(note, /^# Memória do Jarvis$/m);
  assert.match(note, /^## pedido$/m);
  assert.match(note, /^## apelido$/m);
  assert.match(note, /^- cria um cubo azul %%jarvis usos=0 em=2026-09-23T15:00:00\.000Z%%$/m);
});

test('the round trip keeps text, kind, uses and date -- and nothing of the preamble', () => {
  const memory = store();
  memory.learn('cria um cubo azul', { kind: 'pedido' });
  memory.learn('cria um cubo azul', { kind: 'pedido' });
  memory.learn('quando eu disser caixote é um cubo', { kind: 'apelido' });
  const back = fromMarkdown(toMarkdown(memory.all()), { source: 'vault.md' });
  assert.deepEqual(
    back.map(({ text, kind, uses, at, source }) => ({ text, kind, uses, at, source })).sort((a, b) => a.kind.localeCompare(b.kind)),
    [
      { text: 'quando eu disser caixote é um cubo', kind: 'apelido', uses: 0, at: NOW.getTime(), source: 'vault.md' },
      { text: 'cria um cubo azul', kind: 'pedido', uses: 1, at: NOW.getTime(), source: 'vault.md' },
    ]
  );
});

test('any note works: bullets, tasks, numbers, quotes and paragraphs', () => {
  const note = [
    '---', 'tags: [casa]', '---',
    '# Minha casa',
    'Moro em um apartamento no 4º andar.',
    '- a senha do wi-fi fica na geladeira',
    '- [ ] comprar lâmpadas',
    '- [x] trocar o filtro',
    '1. o síndico se chama Paulo',
    '> prefiro café sem açúcar',
    '```', 'codigo();', '```',
    '%% comentário que ninguém lê %%',
  ].join('\n');
  const rows = fromMarkdown(note, { source: 'casa.md' });
  assert.deepEqual(rows.map((r) => r.text), [
    'Moro em um apartamento no 4º andar.',
    'a senha do wi-fi fica na geladeira',
    'comprar lâmpadas',
    'trocar o filtro',
    'o síndico se chama Paulo',
    'prefiro café sem açúcar',
  ]);
  assert.ok(rows.every((r) => r.kind === 'nota' && r.source === 'casa.md'));
});

test('a line pasted as a whole chapter is cut to a memory', () => {
  const [row] = fromMarkdown('x'.repeat(5000));
  assert.equal(row.text.length, LONGEST);
});

test('absorbing does not duplicate, and keeps the larger count and the later date', () => {
  const memory = store();
  memory.learn('cria um cubo azul', { kind: 'pedido' });
  const later = NOW.getTime() + 86400000;
  const added = memory.absorb([
    { text: 'Cria um cubo azul', kind: 'pedido', uses: 5, at: later },
    { text: 'prefiro café sem açúcar', kind: 'nota' },
    { text: '   ', kind: 'nota' },
  ]);
  assert.equal(added, 1);
  assert.equal(memory.rows.length, 2);
  const cube = memory.rows.find((r) => r.kind === 'pedido');
  assert.deepEqual([cube.uses, cube.at], [5, later]);
});

test('importing the same export twice changes nothing', () => {
  const memory = store();
  memory.learn('cria um cubo azul', { kind: 'pedido' });
  const note = toMarkdown(memory.all());
  assert.equal(memory.absorb(fromMarkdown(note)), 0);
  assert.equal(memory.absorb(fromMarkdown(note)), 0);
  assert.equal(memory.rows.length, 1);
});

test('what was imported is recalled like anything learned', () => {
  const memory = store();
  memory.absorb(fromMarkdown('- prefiro café sem açúcar\n- o síndico se chama Paulo'));
  const [top] = memory.recall('como eu gosto do café?');
  assert.equal(top.row.text, 'prefiro café sem açúcar');
});

test('a taught name survives the trip through the vault', () => {
  const memory = store();
  memory.learn('quando eu disser caixote é um cubo', { kind: 'apelido' });
  const fresh = store();
  fresh.absorb(fromMarkdown(toMarkdown(memory.all())));
  assert.deepEqual(learnedNames(fresh), { caixote: 'cubo' });
});

test('forgetting everything is total, and saved', () => {
  const adapter = nowhereAdapter();
  const memory = new Memory({ adapter }).open();
  memory.learn('a');
  memory.learn('b');
  assert.equal(memory.clear(), 2);
  assert.deepEqual(adapter.load(), []);
  assert.deepEqual(memory.recall('a'), []);
});
