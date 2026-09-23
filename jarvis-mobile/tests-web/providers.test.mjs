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
  probeAgent,
  reachesDevice,
  readModels,
  relearn,
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

// -- learning what an endpoint is, instead of guessing from its hostname ----

/** A fetch that answers one way, and records what was asked. */
function answering(reply) {
  const asked = [];
  const impl = async (url, init) => {
    asked.push(url);
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.body === undefined) throw new Error('not json');
        return reply.body;
      },
    };
  };
  impl.asked = asked;
  return impl;
}

test('a backend that answers about a phone is an agent', async () => {
  const impl = answering({ status: 200, body: { linked: false, transport: 'none' } });
  assert.equal(await probeAgent(makeProvider({ url: 'https://meu.jarvis' }), impl), true);
  assert.deepEqual(impl.asked, ['https://meu.jarvis/v1/device']);
});

test('a 404 settles it: there is no agent here', async () => {
  /* The whole point. An unlisted endpoint -- vLLM on 8000, LM Studio on 1234 --
     used to be taken for a Jarvis, which meant a WebSocket retrying against a
     route it does not have every thirty seconds for as long as the page was
     open. */
  const impl = answering({ status: 404 });
  assert.equal(await probeAgent(makeProvider({ url: 'http://127.0.0.1:1234' }), impl), false);
});

test('unreachable is not an answer', async () => {
  /* A backend that is merely asleep -- Render's free tier sleeps -- must not
     be written down as "only answers questions" and left that way. */
  const impl = answering(new TypeError('Failed to fetch'));
  assert.equal(await probeAgent(makeProvider({ url: 'https://dormindo.test' }), impl), undefined);
});

test('a refused key is not an answer either', async () => {
  for (const status of [401, 403]) {
    const impl = answering({ status });
    assert.equal(await probeAgent(makeProvider({ url: 'https://x.test' }), impl), undefined, String(status));
  }
});

test('a 200 full of HTML is not an agent', async () => {
  /* The catch-all route used to answer this with the page itself, which reads
     as "yes" while carrying nothing. */
  const impl = answering({ status: 200 }); // json() throws
  assert.equal(await probeAgent(makeProvider({ url: 'https://x.test' }), impl), false);
});

test('nor is a bare array', async () => {
  const impl = answering({ status: 200, body: [] });
  assert.equal(await probeAgent(makeProvider({ url: 'https://x.test' }), impl), false);
});

test('the probe carries the key, like every other call', async () => {
  const seen = [];
  const impl = async (url, init) => {
    seen.push(init?.headers?.Authorization);
    return { ok: true, status: 200, json: async () => ({ linked: true }) };
  };
  await probeAgent(makeProvider({ url: 'https://x.test', key: 'sk-abc' }), impl);
  assert.deepEqual(seen, ['Bearer sk-abc']);
});

test('what was learned outranks what was guessed', async () => {
  // Guessed a Jarvis from an unknown host, then found out otherwise.
  const guessed = makeProvider({ url: 'http://127.0.0.1:8000' });
  assert.equal(reachesDevice(guessed), true, 'o palpite começa otimista');
  assert.equal(reachesDevice({ ...guessed, agent: false }), false);

  // And the other way: a Jarvis on Ollama's own port is unusual, not impossible.
  const ollama = makeProvider({ url: 'http://localhost:11434' });
  assert.equal(reachesDevice(ollama), false);
  assert.equal(reachesDevice({ ...ollama, agent: true }), true);
});

test('a provider only carries the answer once it has one', () => {
  /* Absent and false mean different things: absent is "nobody asked", and an
     entry saved before this existed must not read as a settled no. */
  assert.equal('agent' in makeProvider({ url: 'https://x.test' }), false);
  assert.equal(makeProvider({ url: 'https://x.test', agent: false }).agent, false);
  assert.equal(makeProvider({ url: 'https://x.test', agent: true }).agent, true);
});

test('an entry saved before any of this still reaches the device', () => {
  // Migration in the plainest sense: old settings have no `agent` field.
  const old = { id: 'p1', name: 'Meu Jarvis', url: 'https://meu.jarvis', key: '', kind: 'jarvis' };
  assert.equal(reachesDevice(old), true);
});

// -- keeping what was learned, across an edit that changed nothing ----------

test('what was learned survives the sheet reading its own fields back', () => {
  /* `collectProvider` runs on open, on close and on every change of the
     picker, and it rebuilds the entry from the inputs. Rebuilding dropped the
     `/v1/device` answer that had already been paid for, so one visit to
     Configurações sent the event WebSocket back to retrying a route that is
     not there. */
  const learned = { ...makeProvider({ url: 'http://127.0.0.1:1234' }), agent: false };
  const rebuilt = makeProvider({ id: learned.id, url: 'http://127.0.0.1:1234' });
  assert.equal(rebuilt.agent, undefined, 'reconstruir sozinho perde a resposta');
  assert.equal(relearn(learned, rebuilt).agent, false);
  assert.equal(reachesDevice(relearn(learned, rebuilt)), false);
});

test('and is dropped when the address is edited', () => {
  /* What was learned belongs to an address, not to a row. Keeping a `false`
     after somebody finally typed their real backend would be worse than the
     bug this fixes. */
  const learned = { ...makeProvider({ url: 'http://127.0.0.1:1234' }), agent: false };
  const moved = makeProvider({ id: learned.id, url: 'https://meu.jarvis' });
  assert.equal('agent' in relearn(learned, moved), false);
  assert.equal(reachesDevice(relearn(learned, moved)), true, 'volta a valer o palpite');
});

test('a trailing slash or a pasted /v1 is the same address', () => {
  // normalizeUrl already handles both; the comparison has to go through it.
  const learned = { ...makeProvider({ url: 'https://meu.jarvis' }), agent: true };
  for (const typed of ['https://meu.jarvis/', 'https://meu.jarvis/v1']) {
    assert.equal(relearn(learned, makeProvider({ url: typed })).agent, true, typed);
  }
});

test('editing only the name or the key keeps it', () => {
  const learned = { ...makeProvider({ url: 'https://meu.jarvis', key: 'a' }), agent: true };
  const renamed = makeProvider({ id: learned.id, name: 'Outro nome', url: 'https://meu.jarvis', key: 'b' });
  assert.equal(relearn(learned, renamed).agent, true);
});

test('an entry that never learned anything stays that way', () => {
  const fresh = makeProvider({ url: 'https://meu.jarvis' });
  const rebuilt = makeProvider({ id: fresh.id, url: 'https://meu.jarvis' });
  assert.equal('agent' in relearn(fresh, rebuilt), false);
});

test('relearn never mutates what it was given', () => {
  const learned = { ...makeProvider({ url: 'https://x.test' }), agent: false };
  const rebuilt = makeProvider({ id: learned.id, url: 'https://x.test' });
  const out = relearn(learned, rebuilt);
  assert.equal('agent' in rebuilt, false, 'o novo não foi alterado no lugar');
  assert.notEqual(out, rebuilt);
});
