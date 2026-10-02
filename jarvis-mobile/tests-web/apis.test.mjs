/**
 * Free APIs from any model: the ```api block, the call, and its limits.
 *
 * Nothing here touches the network -- a fake fetch answers. What is held
 * still is the safety of building a URL from a model's words, the limits
 * on calls, and that a failure is said rather than papered over.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  Apis, MOST_CALLS, RESULT_BUDGET, asksForCall, buildUrl, parseCalls, pluck, resultsMessage, summarize, validate,
} from '../web/apis.js';

const CATALOGUE = JSON.parse(fs.readFileSync(new URL('../web/apis.json', import.meta.url)));
const apis = () => new Apis(CATALOGUE);
const block = (json) => `\`\`\`api\n${json}\n\`\`\``;

/** A fetch that answers by URL and records what it was asked. */
function fake(answer = () => ({}), { ok = true, status = 200, throws = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (throws) throw throws;
    return { ok, status, json: async () => answer(url) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('the catalogue: around thirty, every one https, keyless and valid', () => {
  assert.ok(CATALOGUE.length >= 25, `${CATALOGUE.length}`);
  for (const entry of CATALOGUE) {
    assert.ok(validate(entry), entry.id);
    assert.match(entry.url, /^https:\/\//, entry.id);
    assert.doesNotMatch(entry.url, /key=|token=/i, entry.id);
    assert.ok(entry.exemplos?.length >= 2, `${entry.id}: exemplos`);
    // The example the model is shown has to be a call that would be accepted.
    const built = entry.cidade && entry.exemplo.params.cidade ? { url: 'cidade' } : buildUrl(validate(entry), entry.exemplo.params);
    assert.ok(built.url, `${entry.id}: exemplo inválido ${built.error}`);
  }
  assert.equal(new Set(CATALOGUE.map((e) => e.id)).size, CATALOGUE.length, 'ids únicos');
});

test('an entry that would leak a key, or is not https, is refused', () => {
  assert.equal(validate({ id: 'x', nome: 'x', quando: 'x', url: 'http://a.com' }), null);
  assert.equal(validate({ id: 'x', nome: 'x', quando: 'x', url: 'https://a.com/?api_key=1' }), null);
  assert.equal(validate({ id: 'X Y', nome: 'x', quando: 'x', url: 'https://a.com' }), null);
});

test('the question picks the API for it, and chat picks none', () => {
  const catalogue = apis();
  for (const [question, id] of [
    ['vai chover amanhã em Recife?', 'clima'],
    ['qual o endereço do cep 01001-000', 'cep'],
    ['quanto está o dólar hoje', 'cambio'],
    ['preço do bitcoin', 'cripto'],
    ['quando é o próximo feriado', 'feriados'],
    ['qual a capital da austrália', 'pais'],
  ]) {
    assert.equal(catalogue.pick(question)[0]?.entry.id, id, question);
  }
  for (const message of ['bom dia, tudo bem?', 'me conta uma piada', 'escreve um email pro meu chefe']) {
    assert.equal(catalogue.contextFor(message), '', message);
  }
});

test('a who-was question is offered the encyclopedia', () => {
  const context = apis().contextFor('quem foi Santos Dumont?');
  assert.match(context, /wikipedia/);
  assert.match(context, /```api/);
});

test('a parameter becomes a value, never a path or a second host', () => {
  const catalogue = apis();
  assert.equal(buildUrl(catalogue.byId.get('cep'), { cep: '01001-000' }).url, 'https://brasilapi.com.br/api/cep/v2/01001000');
  const wiki = buildUrl(catalogue.byId.get('wikipedia'), { titulo: 'Santos Dumont/../../evil?x=1' }).url;
  assert.ok(wiki.startsWith('https://pt.wikipedia.org/api/rest_v1/page/summary/Santos_Dumont%2F..%2F..%2Fevil%3Fx%3D1'), wiki);
  assert.match(buildUrl(catalogue.byId.get('cep'), { cep: 'rm -rf' }).error, /inválido/);
  assert.match(buildUrl(catalogue.byId.get('cep'), {}).error, /falta/);
  assert.equal(new URL(buildUrl(catalogue.byId.get('livros'), { busca: 'a&host=evil.com' }).url).host, 'openlibrary.org');
});

test('optional parameters fall back to their defaults', () => {
  const url = buildUrl(apis().byId.get('sol'), { lat: '-8.05', lon: '-34.9' }).url;
  assert.match(url, /date=today/);
});

test('the ```api block is read; anything else is not a call', () => {
  assert.deepEqual(parseCalls(block('{"api":"CEP","params":{"cep":"01001000"}}')), [{ api: 'cep', params: { cep: '01001000' } }]);
  assert.equal(parseCalls(block('[{"api":"cep","params":{}},{"api":"taxas"}]')).length, 2);
  assert.deepEqual(parseCalls('```json\n{"api":"cep"}\n```'), []);
  assert.deepEqual(parseCalls(block('{nada')), []);
  assert.equal(asksForCall(block('{nada')), true);
  assert.equal(asksForCall('sem bloco'), false);
});

test('a call returns the useful part of the answer, within budget', async () => {
  const fetchImpl = fake(() => ({ cep: '01001000', street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP', location: { huge: 'x'.repeat(5000) } }));
  const result = await apis().call({ api: 'cep', params: { cep: '01001000' } }, { fetchImpl });
  assert.equal(result.ok, true);
  assert.match(result.text, /street: Praça da Sé/);
  assert.doesNotMatch(result.text, /huge/);
  const big = summarize(validate({ id: 'xx', nome: 'x', quando: 'x', url: 'https://x.com' }), { a: 'y'.repeat(9000) });
  assert.ok(big.length <= RESULT_BUDGET + 1);
});

test('a city is turned into coordinates first, in the same call', async () => {
  const fetchImpl = fake((url) => (url.includes('geocoding')
    ? { results: [{ latitude: -8.05, longitude: -34.9 }] }
    : { current: { temperature_2m: 29 }, daily: { temperature_2m_max: [31] } }));
  const result = await apis().call({ api: 'clima', params: { cidade: 'Recife' } }, { fetchImpl });
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[1], /latitude=-8\.05&longitude=-34\.9/);
  assert.match(result.text, /temperature_2m/);
});

test('failures are said, not invented over', async () => {
  const catalogue = apis();
  const down = await catalogue.call({ api: 'cep', params: { cep: '01001000' } }, { fetchImpl: fake(null, { throws: new TypeError('Failed to fetch') }) });
  assert.deepEqual([down.ok, /não respondeu/.test(down.text)], [false, true]);
  const refused = await catalogue.call({ api: 'cep', params: { cep: '01001000' } }, { fetchImpl: fake(null, { ok: false, status: 404 }) });
  assert.match(refused.text, /HTTP 404/);
  const unknown = await catalogue.call({ api: 'inventada' });
  assert.match(unknown.text, /não existe/);
  const nowhere = await catalogue.call({ api: 'clima', params: { cidade: 'Xyzzy' } }, { fetchImpl: fake(() => ({ results: [] })) });
  assert.match(nowhere.text, /Não encontrei a cidade/);
  assert.match(resultsMessage([down]), /FALHOU[\s\S]*em vez de inventar/);
});

test('a reply asking for many calls gets at most the limit', async () => {
  const fetchImpl = fake(() => ({}));
  const many = block(JSON.stringify(Array.from({ length: 10 }, () => ({ api: 'taxas', params: {} }))));
  const results = await apis().run(many, { fetchImpl });
  assert.equal(results.length, MOST_CALLS);
  assert.equal(fetchImpl.calls.length, MOST_CALLS);
});

test('paths reach into lists and objects', () => {
  const data = { a: [{ b: 1 }, { b: 2 }], c: { x: { v: 1 }, y: { v: 2 } } };
  assert.deepEqual(pluck(data, 'a[].b'), [1, 2]);
  assert.deepEqual(pluck(data, 'c.*.v'), [1, 2]);
  assert.deepEqual(pluck([{ n: 'x' }], '[].n'), ['x']);
  assert.deepEqual(pluck(data, 'nada.aqui'), []);
});
