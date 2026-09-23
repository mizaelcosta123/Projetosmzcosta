/**
 * The installed app with no signal, a deploy that is not hidden by the
 * cache, and a notification for a reply that arrived while you were away.
 *
 * Serves its own copy of the interface, because one check edits a file to
 * prove the worker lets a new version through.
 *
 *   node tests-browser/offline.mjs
 */

import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const SOURCE = new URL('../web/', import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), 'jarvis-offline-'));
cpSync(SOURCE, ROOT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const UI = `http://127.0.0.1:${server.address().port}`;
const MODEL = 'http://127.0.0.1:59996';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

// The full Chromium in its new headless mode, not Playwright's headless
// shell: the shell reports every notification permission as denied, whatever
// the context grants, so a notification test there can only ever fail.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  headless: false,
  args: ['--headless=new'],
});
const ctx = await browser.newContext({ viewport: { width: 412, height: 880 } });
await ctx.grantPermissions(['notifications'], { origin: UI });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

await page.route(`${MODEL}/**`, (route) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (route.request().url().endsWith('/v1/chat/completions')) {
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' },
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'Amanhã chove à tarde.' } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"data":[{"id":"m"}]}' });
});

await page.goto(UI, { waitUntil: 'networkidle' });
await page.evaluate((url) => localStorage.setItem('jarvis.settings.v1', JSON.stringify({
  providers: [{ id: 'p1', name: 'M', url, key: '', kind: 'openai', agent: false, models: ['m'] }],
  active: 'p1', model: 'm', speak: false, wake: false,
})), MODEL);
await page.reload({ waitUntil: 'networkidle' });

console.log('\no service worker');
const controlled = await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return Boolean(navigator.serviceWorker.controller);
});
check('registrado e controlando a página', controlled, true);
// Let the worker finish keeping what the page told it about.
await page.waitForTimeout(800);
const kept = await page.evaluate(async () => {
  const cache = await caches.open('jarvis-shell');
  return (await cache.keys()).map((r) => new URL(r.url).pathname).sort();
});
check('guardou os módulos que a página carregou', ['/app.js', '/particles.js', '/styles.css', '/hands.js'].every((p) => kept.includes(p)), true);
check('e nada de conversa', kept.some((p) => p.startsWith('/v1/')), false);

console.log('\nsem sinal nenhum');
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
const offline = await page.evaluate(() => ({
  title: document.title,
  composer: Boolean(document.getElementById('composer')),
  field: document.getElementById('field').width > 0,
}));
check('a página abriu do cache', offline.title, 'Jarvis');
check('com o compositor', offline.composer, true);
check('e o app rodou (o campo tem tamanho)', offline.field, true);
await ctx.setOffline(false);

console.log('\numa versão nova passa pelo cache');
writeFileSync(join(ROOT, 'styles.css'), readFileSync(join(ROOT, 'styles.css'), 'utf8') + '\n/* versao-nova */\n');
const fresh = await page.evaluate(async () => (await (await fetch('styles.css')).text()).includes('versao-nova'));
check('o arquivo editado chegou, não o guardado', fresh, true);

console.log('\na notificação');
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await page.evaluate(() => {
  // The phone, with the app in the background: the only case worth a ping.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
});
await page.fill('#prompt', 'vai chover amanhã?');
await page.press('#prompt', 'Enter');
await page.waitForTimeout(1200);
const shown = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
});
check('mostrou pelo service worker', shown, [{ title: 'Jarvis', body: 'Amanhã chove à tarde.', tag: 'jarvis-reply' }]);

await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
await page.evaluate(async () => {
  for (const n of await (await navigator.serviceWorker.getRegistration()).getNotifications()) n.close();
});
await page.fill('#prompt', 'e depois de amanhã?');
await page.press('#prompt', 'Enter');
await page.waitForTimeout(1200);
const quiet = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).length);
check('com o app na frente, nenhuma', quiet, 0);

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
