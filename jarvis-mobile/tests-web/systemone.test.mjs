/**
 * Asking the backend to settle a sentence the rules only half understood.
 *
 * The behaviour worth holding still is the restraint: this must never act on
 * a coin toss, never ask twice once told no, and never turn a missing
 * decision model into anything the person can see.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SURE, classify, intent, reset } from '../web/systemone.js';
import { Scene } from '../web/holo.js';
import { conjure } from '../web/conjure.js';

/** A fetch that answers with one payload and records what it was asked. */
function fake(payload, { ok = true, status = 200, throws = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options?.body ?? '{}') });
    if (throws) throw throws;
    return {
      ok,
      status,
      json: async () => payload,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const decided = (choice, confidence) => ({
  available: true,
  pedido: { choice, confidence, probabilities: { [choice]: confidence } },
});

test.beforeEach(() => reset());

test('it asks the backend, at the endpoint in use', async () => {
  const fetchImpl = fake(decided('holograma', 0.93));
  const answer = await classify('faz um cubo grandao', {
    base: 'https://jarvis.example.com/',
    headers: { Authorization: 'Bearer k' },
    fetchImpl,
  });
  assert.equal(fetchImpl.calls[0].url, 'https://jarvis.example.com/v1/decide');
  assert.equal(fetchImpl.calls[0].body.text, 'faz um cubo grandao');
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'Bearer k');
  assert.deepEqual([answer.choice, answer.confidence], ['holograma', 0.93]);
});

test('an empty sentence never reaches the network', async () => {
  const fetchImpl = fake(decided('holograma', 0.99));
  assert.equal(await classify('   ', { fetchImpl }), null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a coin toss is not a decision', async () => {
  /* Calibration is the whole point: acting at 0.51 would draw cubes at
     people who asked a question. */
  assert.equal(await intent('faz um cubo', { fetchImpl: fake(decided('holograma', 0.51)) }), null);
  reset();
  assert.equal(await intent('faz um cubo', { fetchImpl: fake(decided('holograma', 0.99)) }), 'holograma');
  reset();
  assert.ok(SURE > 0.5 && SURE < 1, `um limiar de verdade: ${SURE}`);
});

test('the threshold can be raised for a caller that wants more certainty', async () => {
  const fetchImpl = fake(decided('holograma', 0.8));
  assert.equal(await intent('faz um cubo', { fetchImpl, sure: 0.95 }), null);
});

test('a backend with no decision model is asked once and then left alone', async () => {
  /* A round trip per message to be told the same no is the thing that would
     make this cost something. */
  const fetchImpl = fake({ available: false, reason: 'sem modelo de decisao' });
  assert.equal(await classify('faz um cubo', { fetchImpl }), null);
  assert.equal(await classify('faz uma esfera', { fetchImpl }), null);
  assert.equal(await classify('faz um toro', { fetchImpl }), null);
  assert.equal(fetchImpl.calls.length, 1, 'perguntou uma vez só');
});

test('a backend without the route at all is the same: asked once', async () => {
  const fetchImpl = fake(null, { ok: false, status: 404 });
  assert.equal(await classify('faz um cubo', { fetchImpl }), null);
  assert.equal(await classify('faz um cubo', { fetchImpl }), null);
  assert.equal(fetchImpl.calls.length, 1);
});

test('a network that fails is never an error the person sees', async () => {
  const fetchImpl = fake(null, { throws: new TypeError('Failed to fetch') });
  assert.equal(await classify('faz um cubo', { fetchImpl }), null);
  assert.equal(await classify('faz um cubo', { fetchImpl }), null);
  assert.equal(fetchImpl.calls.length, 1);
});

test('a reply that is not JSON is just a no', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } });
  assert.equal(await classify('faz um cubo', { fetchImpl }), null);
});

test('no fetch at all (an old browser) is a no, not a crash', async () => {
  assert.equal(await classify('faz um cubo', { fetchImpl: undefined }), null);
});

test('reset lets it ask again, for when the endpoint changed', async () => {
  const off = fake({ available: false });
  assert.equal(await classify('faz um cubo', { fetchImpl: off }), null);
  reset();
  const on = fake(decided('holograma', 0.9));
  assert.equal((await classify('faz um cubo', { fetchImpl: on }))?.choice, 'holograma');
});

// -- what a trusted answer unlocks ---------------------------------------------

test('the rules still refuse a half-understood sentence on their own', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'faz aí um cubo pirambeira pra mim'), null);
  assert.equal(scene.items.length, 0, 'nada foi criado');
});

test('with something vouching for it, the same sentence builds the cube', () => {
  /* This is the whole point of the decision model: the rules were right to
     decline, and a calibrated answer is what they were missing. */
  const scene = new Scene();
  const done = conjure(scene, 'faz aí um cubo pirambeira pra mim', { trust: true });
  assert.ok(done, 'respondeu');
  assert.equal(scene.items.length, 1);
  assert.equal(scene.last().shape, 'cubo');
});

test('trust forgives leftovers, not the absence of anything to act on', () => {
  /* A sentence naming no shape and no verb is not a request the rules were
     being shy about -- there is nothing in it to build, trusted or not. */
  const scene = new Scene();
  assert.equal(conjure(scene, 'bom dia, tudo bem?', { trust: true }), null);
  assert.equal(conjure(scene, 'faz aí pra mim', { trust: true }), null);
  assert.equal(scene.items.length, 0);
});

test('a trusted question about a shape is answered, not refused', () => {
  const scene = new Scene();
  assert.equal(conjure(scene, 'pode fazer um cubo?'), null, 'sozinhas, as regras recusam');
  assert.ok(conjure(scene, 'pode fazer um cubo?', { trust: true }));
  assert.equal(scene.last().shape, 'cubo');
});
