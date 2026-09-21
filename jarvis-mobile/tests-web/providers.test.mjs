/**
 * Where the answers come from — and, more importantly, what each place can do.
 *
 * The distinction these tests defend is that a provider endpoint answers and a
 * Jarvis backend acts. Getting it wrong means someone adds their OpenRouter
 * key, asks him to open an app, and is told a plausible lie about a phone
 * nothing ever touched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  JARVIS,
  OLLAMA,
  OPENAI,
  chatUrl,
  detectKind,
  explainUnreachable,
  fetchModels,
  headersFor,
  makeProvider,
  modelsUrl,
  normalizeUrl,
  readModels,
  reachesDevice,
  termuxOllama,
} from '../web/providers.js';

// -- telling the two kinds apart --------------------------------------------

test('blank means this same server, which is a backend', () => {
  assert.equal(detectKind(''), JARVIS);
  assert.equal(detectKind('   '), JARVIS);
});

test('the Ollama port is recognised wherever it is', () => {
  for (const url of [
    'http://localhost:11434',
    'http://127.0.0.1:11434/',
    'http://192.168.0.10:11434',
  ]) {
    assert.equal(detectKind(url), OLLAMA, url);
  }
});

test('the known model hosts are providers, not backends', () => {
  for (const url of ['https://openrouter.ai/api', 'https://api.openai.com']) {
    assert.equal(detectKind(url), OPENAI, url);
  }
});

test('anything else is assumed to be a backend', () => {
  // The safer guess: calling somebody's real Jarvis a provider would strip the
  // device tools out of the interface for no reason.
  assert.equal(detectKind('https://jarvis-backend-rhnc.onrender.com'), JARVIS);
  assert.equal(detectKind('http://localhost:8000'), JARVIS);
  assert.equal(detectKind('not a url at all'), JARVIS);
});

test('only a backend reaches the phone', () => {
  assert.equal(reachesDevice(makeProvider({ url: 'http://localhost:8000' })), true);
  assert.equal(reachesDevice(makeProvider({ url: 'http://localhost:11434' })), false);
  assert.equal(reachesDevice(makeProvider({ url: 'https://openrouter.ai/api' })), false);
});

// -- addresses --------------------------------------------------------------

test('a pasted /v1 is not doubled', () => {
  // People paste what the provider's own docs show, which usually ends in /v1.
  const provider = makeProvider({ url: 'https://openrouter.ai/api/v1/' });
  assert.equal(provider.url, 'https://openrouter.ai/api');
  assert.equal(chatUrl(provider), 'https://openrouter.ai/api/v1/chat/completions');
});

test('normalizeUrl survives whatever it is handed', () => {
  assert.equal(normalizeUrl(null), '');
  assert.equal(normalizeUrl(undefined), '');
  assert.equal(normalizeUrl('  http://x:8000///  '), 'http://x:8000');
});

test('Ollama is asked its own way', () => {
  const ollama = makeProvider({ url: 'http://localhost:11434' });
  assert.equal(modelsUrl(ollama), 'http://localhost:11434/api/tags');
  // But it speaks the OpenAI shape for chat, so that stays uniform.
  assert.equal(chatUrl(ollama), 'http://localhost:11434/v1/chat/completions');
});

test('a key becomes a bearer header, and no key becomes no header', () => {
  assert.deepEqual(headersFor(makeProvider({ url: 'http://x', key: 'abc' })), {
    Authorization: 'Bearer abc',
  });
  assert.deepEqual(headersFor(makeProvider({ url: 'http://x' })), {});
});

// -- reading whatever shape came back ---------------------------------------

test('all three catalogue shapes are understood', () => {
  assert.deepEqual(readModels({ data: [{ id: 'b' }, { id: 'a' }] }), ['a', 'b']);
  assert.deepEqual(readModels({ models: [{ name: 'q' }] }), ['q']);
  assert.deepEqual(readModels(['z', 'y']), ['y', 'z']);
});

test('nonsense comes back as an empty list, not an exception', () => {
  for (const payload of [null, undefined, 42, {}, { data: 'nope' }, { models: [{}] }]) {
    assert.deepEqual(readModels(payload), [], JSON.stringify(payload));
  }
});

test('duplicates collapse', () => {
  assert.deepEqual(readModels({ data: [{ id: 'a' }, { id: 'a' }] }), ['a']);
});

// -- asking ------------------------------------------------------------------

const reply = (status, payload) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => payload,
});

test('a good answer becomes a sorted list', async () => {
  const models = await fetchModels(makeProvider({ url: 'http://localhost:11434' }), async () =>
    reply(200, { models: [{ name: 'qwen2.5:1.5b' }, { name: 'llama3.2:1b' }] })
  );
  assert.deepEqual(models, ['llama3.2:1b', 'qwen2.5:1.5b']);
});

test('a refused key says so, and says which case it is', async () => {
  const withKey = makeProvider({ url: 'https://openrouter.ai/api', key: 'wrong' });
  await assert.rejects(
    () => fetchModels(withKey, async () => reply(401)),
    /chave foi recusada/
  );

  const without = makeProvider({ url: 'https://openrouter.ai/api' });
  await assert.rejects(
    () => fetchModels(without, async () => reply(401)),
    /campo está vazio/
  );
});

test('an empty catalogue is a failure, not an empty picker', async () => {
  await assert.rejects(
    () => fetchModels(makeProvider({ url: 'http://x:8000' }), async () => reply(200, { data: [] })),
    /sem nenhum modelo/
  );
});

test('an unreachable Ollama is told exactly what to type', async () => {
  /* The failure everyone hits first. Ollama refuses cross-origin calls by
   * default, and the browser reports that identically to "not running" —
   * a bare `TypeError: Failed to fetch` naming neither. */
  const dead = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(
    () => fetchModels(termuxOllama(), dead),
    /OLLAMA_ORIGINS/
  );
});

test('an unreachable anything-else does not mention Ollama', async () => {
  const message = explainUnreachable(makeProvider({ url: 'https://openrouter.ai/api' }));
  assert.ok(!message.includes('OLLAMA_ORIGINS'), message);
  assert.ok(message.includes('CORS'), message);
});

// -- making one --------------------------------------------------------------

test('a provider without a name is labelled by its host', () => {
  assert.equal(makeProvider({ url: 'http://localhost:11434' }).name, 'localhost:11434');
  assert.equal(makeProvider({ url: 'https://openrouter.ai/api' }).name, 'openrouter.ai');
  assert.equal(makeProvider({ url: '' }).name, 'Este servidor');
});

test('ids do not collide', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(makeProvider({ url: 'http://x' }).id);
  assert.equal(ids.size, 200);
});

test('the Termux preset points at this phone', () => {
  const ollama = termuxOllama();
  assert.equal(ollama.kind, OLLAMA);
  assert.equal(ollama.url, 'http://localhost:11434');
  assert.equal(reachesDevice(ollama), false, 'a bare Ollama has no agent behind it');
});
