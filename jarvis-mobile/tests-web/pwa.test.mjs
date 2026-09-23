/**
 * The service worker's rules and the reply notification.
 *
 * The worker itself runs only in a browser (tests-browser/offline.mjs); what
 * is checked here is the part that decides things: what it may cache, what
 * the page tells it to keep, and when a notification is worth sending.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loaded, notifyReply, registerWorker } from '../web/pwa.js';

const WORKER = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
/** The worker without its comments, which name files while explaining why
 *  the code does not. */
const CODE = WORKER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the worker is network-first, so a deploy is never hidden behind a cache', () => {
  /* The fetch handler must try the network before the cache. Cache-first is
     how an app ends up serving last month's app.js forever. */
  const handler = WORKER.slice(WORKER.indexOf("addEventListener('fetch'"));
  assert.ok(handler.indexOf('fetch(request)') < handler.indexOf('cache.match'), 'rede antes do cache');
});

test('the worker never keeps conversations, status or anything not GET', () => {
  assert.match(WORKER, /request\.method !== 'GET'/);
  assert.match(WORKER, /\(v1\|api\)/);
  assert.match(WORKER, /health/);
  assert.match(WORKER, /url\.origin !== self\.location\.origin/);
});

test('the worker keeps no list of files that could drift', () => {
  /* deploy.py records the black page an allowlist caused once. */
  assert.doesNotMatch(CODE, /app\.js|styles\.css|particles\.js/);
});

test('the page reports what it loaded from its own origin only', () => {
  const perf = {
    getEntriesByType: () => [
      { name: 'https://jarvis.example/app.js' },
      { name: 'https://jarvis.example/face.js' },
      { name: 'https://api.open-meteo.com/v1/forecast?x=1' },
      { name: 'not a url' },
    ],
  };
  const here = { origin: 'https://jarvis.example', href: 'https://jarvis.example/#x' };
  assert.deepEqual(loaded(perf, here), [
    'https://jarvis.example/',
    'https://jarvis.example/app.js',
    'https://jarvis.example/face.js',
  ]);
});

test('registering never throws, with or without a worker API', async () => {
  assert.equal(await registerWorker({ nav: {} }), null);
  const failing = { serviceWorker: { register: async () => { throw new Error('SecurityError'); } } };
  assert.equal(await registerWorker({ nav: failing }), null);
});

test('registering hands the worker the list to keep', async () => {
  const posted = [];
  const nav = {
    serviceWorker: {
      register: async () => ({ scope: '/' }),
      ready: Promise.resolve({ active: { postMessage: (message) => posted.push(message) } }),
    },
  };
  const perf = { getEntriesByType: () => [] };
  await registerWorker({ nav, perf });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'cache');
  assert.ok(Array.isArray(posted[0].urls));
});

// -- notifications -------------------------------------------------------------

function fakes({ hidden = true, permission = 'granted', registration = true } = {}) {
  const shown = [];
  class Notice {
    static permission = permission;
    constructor(title, options) { shown.push({ via: 'page', title, options }); }
  }
  const nav = {
    serviceWorker: {
      getRegistration: async () => (registration
        ? { showNotification: async (title, options) => shown.push({ via: 'worker', title, options }) }
        : undefined),
    },
  };
  return { shown, deps: { doc: { hidden }, Notice, nav } };
}

test('a reply you are looking at is not announced', async () => {
  const { shown, deps } = fakes({ hidden: false });
  assert.equal(await notifyReply('oi', deps), false);
  assert.equal(shown.length, 0);
});

test('without the permission nothing is sent, and nothing asks for it', async () => {
  for (const permission of ['default', 'denied']) {
    const { shown, deps } = fakes({ permission });
    assert.equal(await notifyReply('oi', deps), false);
    assert.equal(shown.length, 0);
  }
});

test('in the background, through the worker -- the only way Android allows', async () => {
  const { shown, deps } = fakes();
  assert.equal(await notifyReply('  Amanhã chove à tarde.  ', deps), true);
  assert.equal(shown[0].via, 'worker');
  assert.equal(shown[0].options.body, 'Amanhã chove à tarde.');
  assert.equal(shown[0].options.tag, 'jarvis-reply', 'uma de cada vez');
});

test('without a worker, the page constructor is the fallback', async () => {
  const { shown, deps } = fakes({ registration: false });
  assert.equal(await notifyReply('oi', deps), true);
  assert.equal(shown[0].via, 'page');
});

test('a long reply is cut, not sent whole into a notification', async () => {
  const { shown, deps } = fakes();
  await notifyReply('palavra '.repeat(100), deps);
  assert.ok(shown[0].options.body.length <= 160);
  assert.ok(shown[0].options.body.endsWith('…'));
});
