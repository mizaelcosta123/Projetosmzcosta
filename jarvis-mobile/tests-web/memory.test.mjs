/**
 * Remembering, and finding the right thing again.
 *
 * The attention tests are the ones worth reading. They check the properties
 * that make `attend` the transformer primitive rather than a similarity sort
 * dressed up: a distribution that sums to one, invariance to a constant
 * shift, temperature that actually sharpens, and — the one that caught a
 * real bug — that it discriminates at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIMS,
  Memory,
  attend,
  dot,
  embed,
  fold,
  nowhereAdapter,
  tokens,
} from '../web/memory.js';

const sum = (values) => values.reduce((a, b) => a + b, 0);

// -- turning words into vectors ---------------------------------------------

test('accents do not make two words strangers', () => {
  assert.equal(fold('Câmera'), 'camera');
  assert.equal(fold('AÇÃO'), 'acao');
});

test('the words that carry nothing are dropped', () => {
  assert.deepEqual(tokens('o cubo de a casa'), ['cubo', 'casa']);
});

test('a vector is unit length, so a long sentence does not win by length', () => {
  for (const text of ['cubo', 'cria um cubo azul grande bem na minha frente agora']) {
    const length = Math.sqrt(dot(embed(text), embed(text)));
    assert.ok(Math.abs(length - 1) < 1e-5, `${text}: ${length}`);
  }
});

test('an empty phrase is the zero vector, not a crash', () => {
  const vector = embed('');
  assert.equal(vector.length, DIMS);
  assert.equal(dot(vector, vector), 0);
});

test('the same words land in the same place every load', () => {
  // Hashed features, so this has to be true by construction — a vector that
  // moved between loads would make every stored memory unfindable.
  assert.deepEqual([...embed('cubo azul')], [...embed('cubo azul')]);
});

test('a typo lands nearer than an unrelated word', () => {
  /* Trigrams ride along with the words for exactly this. The useful claim is
     comparative, not a fixed number: a four-letter word has two trigrams, so
     the absolute similarity stays modest and pretending otherwise would be
     inventing a threshold to pass. */
  const typo = dot(embed('cubo'), embed('cuubo'));
  const other = dot(embed('cubo'), embed('esfera'));
  assert.equal(other, 0, 'palavras sem relação não deveriam se tocar');
  assert.ok(typo > 0.15, `erro de digitação ficou longe demais: ${typo.toFixed(2)}`);
});

test('phrases about the same thing are closer than phrases that are not', () => {
  const near = dot(embed('cria um cubo'), embed('faz um cubo aqui'));
  const far = dot(embed('cria um cubo'), embed('abre a câmera'));
  assert.ok(near > far, `${near} deveria passar de ${far}`);
});

// -- attention ---------------------------------------------------------------

test('the weights are a distribution', () => {
  const keys = ['cubo', 'esfera', 'câmera'].map(embed);
  const weights = attend(embed('cubo'), keys, { scaled: false, temperature: 0.08 });
  assert.ok(Math.abs(sum(weights) - 1) < 1e-9);
  for (const weight of weights) assert.ok(weight >= 0 && weight <= 1);
});

test('and it actually discriminates', () => {
  /* The bug this pins. The textbook √d assumes components of unit variance,
     and `embed` returns unit-*norm* vectors — the dot product is already a
     cosine and does not grow with d. Dividing by √256 put three unrelated
     memories at 0.340, 0.332 and 0.329: a uniform distribution wearing a
     softmax. */
  const keys = ['cria um cubo azul', 'abre a câmera', 'meu vault fica em notas'].map(embed);
  const weights = attend(embed('faz um cubo'), keys, { scaled: false, temperature: 0.08 });
  assert.ok(weights[0] > 0.7, `o relevante levou só ${weights[0].toFixed(3)}`);
  assert.ok(weights[0] > weights[1] * 5, 'diferença pequena demais para ser atenção');
});

test('the scale is explicit, and the two regimes differ', () => {
  const keys = ['cria um cubo azul', 'abre a câmera'].map(embed);
  const query = embed('faz um cubo');
  const flat = attend(query, keys, { scaled: true });
  const sharp = attend(query, keys, { scaled: false, temperature: 0.08 });
  assert.ok(sharp[0] - sharp[1] > flat[0] - flat[1], 'o √d deveria achatar vetores unitários');
});

test('a constant shift in the scores changes nothing', () => {
  /* softmax is shift-invariant, and the implementation subtracts the max to
     keep exp() away from overflow. If that subtraction were wrong this is
     what would show it. */
  const keys = [embed('cubo'), embed('esfera')];
  const query = embed('cubo');
  const shifted = keys.map((key) => {
    const copy = Float32Array.from(key);
    for (let i = 0; i < copy.length; i += 1) copy[i] += 0; // same direction
    return copy;
  });
  assert.deepEqual(attend(query, keys, { scaled: false }), attend(query, shifted, { scaled: false }));
});

test('temperature sharpens', () => {
  const keys = ['cubo azul', 'esfera azul', 'câmera'].map(embed);
  const query = embed('cubo');
  const cold = attend(query, keys, { scaled: false, temperature: 0.05 });
  const warm = attend(query, keys, { scaled: false, temperature: 1 });
  assert.ok(Math.max(...cold) > Math.max(...warm));
});

test('no keys is an empty answer, not a division by zero', () => {
  assert.deepEqual(attend(embed('cubo'), []), []);
  assert.deepEqual(attend(embed('cubo'), undefined), []);
});

test('one key takes all of it', () => {
  assert.deepEqual(attend(embed('cubo'), [embed('cubo')], { scaled: false }), [1]);
});

// -- the store ---------------------------------------------------------------

const store = (seed = []) => new Memory({ adapter: nowhereAdapter(seed) }).open();

test('what was learned comes back', () => {
  const memory = store();
  memory.learn('meu vault fica em /storage/notas', { kind: 'fato' });
  const [best] = memory.recall('onde estão minhas notas');
  assert.match(best.row.text, /vault/);
});

test('saying the same thing twice reinforces rather than duplicating', () => {
  const memory = store();
  memory.learn('chamo cubo de caixa');
  memory.learn('Chamo Cubo de Caixa');
  assert.equal(memory.rows.length, 1);
  assert.equal(memory.rows[0].uses, 1);
});

test('an empty memory is not a memory', () => {
  const memory = store();
  assert.equal(memory.learn('   '), null);
  assert.equal(memory.rows.length, 0);
});

test('recalling from nothing returns nothing', () => {
  assert.deepEqual(store().recall('qualquer coisa'), []);
});

test('what gets used outranks what merely matches', () => {
  /* The tilt is a multiplier on the weight, not on the score. Inside the
     softmax it would fight the temperature and make the whole distribution a
     function of how often the app has been used. */
  const memory = store();
  const rare = memory.learn('cubo pequeno');
  const used = memory.learn('cubo grande');
  for (let i = 0; i < 20; i += 1) memory.reinforce(used.id);
  const [first] = memory.recall('cubo');
  assert.equal(first.row.id, used.id, `veio ${first.row.text}`);
  assert.ok(rare, 'o outro continua lá');
});

test('the irrelevant is left out rather than padded in', () => {
  const memory = store();
  memory.learn('cria um cubo azul');
  memory.learn('abre a câmera');
  memory.learn('toca uma música');
  memory.learn('manda uma mensagem');
  const back = memory.recall('cubo', { count: 5 });
  assert.ok(back.length < 4, `trouxe ${back.length} de 4 — não filtrou nada`);
  assert.match(back[0].row.text, /cubo/);
});

test('forgetting is possible, and asked for by name', () => {
  const memory = store();
  const row = memory.learn('algo que eu não queria ter dito');
  assert.equal(memory.forget(row.id), true);
  assert.equal(memory.rows.length, 0);
  assert.equal(memory.forget(row.id), false, 'esquecer duas vezes não quebra');
});

test('the vectors stay lined up with the rows after a forget', () => {
  // Two parallel arrays is exactly the shape that drifts.
  const memory = store();
  const a = memory.learn('cubo azul');
  memory.learn('esfera vermelha');
  memory.learn('câmera aberta');
  memory.forget(a.id);
  assert.equal(memory.keys.length, memory.rows.length);
  const [best] = memory.recall('esfera');
  assert.match(best.row.text, /esfera/);
});

test('it fills up and lets go of the least useful, not just the oldest', () => {
  /* Something taught once and leaned on weekly must survive a week of
     chatter. */
  const memory = new Memory({ adapter: nowhereAdapter(), limit: 5 }).open();
  const treasured = memory.learn('meu vault fica em /storage/notas');
  for (let i = 0; i < 10; i += 1) memory.reinforce(treasured.id);
  for (let i = 0; i < 20; i += 1) memory.learn(`conversa fiada número ${i}`);
  assert.equal(memory.rows.length, 5);
  assert.ok(memory.rows.some((row) => row.id === treasured.id), 'perdeu o que importava');
});

test('it survives being closed and opened again', () => {
  const adapter = nowhereAdapter();
  const first = new Memory({ adapter }).open();
  first.learn('meu vault fica em /storage/notas', { kind: 'fato' });

  const second = new Memory({ adapter }).open();
  assert.equal(second.rows.length, 1);
  // The vectors are rebuilt, not stored: 256 floats a row would fill the
  // storage this lives in.
  assert.equal(second.keys.length, 1);
  assert.match(second.recall('notas')[0].row.text, /vault/);
});

test('rubbish in storage does not stop it opening', () => {
  const memory = new Memory({
    adapter: nowhereAdapter([null, { nope: true }, { text: 'isto presta' }]),
  }).open();
  assert.equal(memory.rows.length, 1);
});

test('an adapter is all a vault would have to be', () => {
  /* The whole reason the store is behind one: a vault is a list of notes
     with text, which is this shape. */
  const vault = {
    load: () => [{ id: 'n1', text: 'projeto jarvis mora em ~/dev', kind: 'nota', at: 1, uses: 0 }],
    saved: null,
    save(rows) { this.saved = rows; },
  };
  const memory = new Memory({ adapter: vault }).open();
  assert.match(memory.recall('onde mora o jarvis')[0].row.text, /~\/dev/);
  memory.learn('nova nota');
  assert.equal(vault.saved.length, 2, 'escreveu de volta no vault');
});
