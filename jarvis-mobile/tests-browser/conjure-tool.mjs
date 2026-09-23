/**
 * The model making holograms: from the agent's event stream to the glass.
 *
 * The event socket is Playwright's own stand-in (`routeWebSocket`), so this
 * needs no backend. What it proves is the wiring a unit test cannot reach:
 * the app opens `/v1/agents/events`, reads a `tool_call_end` for `conjure`,
 * builds what its metadata says, and brings the stage up -- and ignores the
 * start event and a refused call, which carry arguments nobody checked.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/conjure-tool.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const BACKEND = 'http://127.0.0.1:59998';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 412, height: 880 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

// Everything else the app asks the backend for: answered, and empty.
await page.route(`${BACKEND}/**`, (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  headers: { 'Access-Control-Allow-Origin': '*' },
  body: '{}',
}));

let socket = null;
const opened = new Promise((resolve) => {
  page.routeWebSocket(`${BACKEND.replace('http', 'ws')}/v1/agents/events`, (ws) => {
    socket = ws;
    resolve();
  });
});
const send = (type, data) => socket.send(JSON.stringify({ type, data }));

await page.goto(UI, { waitUntil: 'networkidle' });
await page.evaluate((url) => localStorage.setItem('jarvis.settings.v1', JSON.stringify({
  providers: [{ id: 'p1', name: 'Jarvis', url, key: '', kind: 'jarvis', agent: true }],
  active: 'p1', model: '', speak: false, wake: false,
})), BACKEND);
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

console.log('\no fluxo de eventos do agente');
await Promise.race([opened, page.waitForTimeout(5000)]);
check('o app abriu /v1/agents/events', socket !== null, true);
if (!socket) {
  console.log('\nsem o socket não há o que testar');
  await browser.close();
  process.exit(1);
}

const lit = () => page.evaluate(() => {
  const c = document.getElementById('holo');
  if (c.hidden || !c.width) return 0;
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 40) n += 1;
  return n;
});

console.log('\nargumentos que ninguém conferiu não desenham nada');
send('tool_call_start', { tool: 'conjure', arguments: { shape: 'cubo' } });
await page.waitForTimeout(250);
check('o início da chamada não desenha', await page.$eval('#holo', (c) => c.hidden), true);
send('tool_call_end', { tool: 'conjure', success: false, metadata: {} });
await page.waitForTimeout(250);
check('uma chamada recusada também não', await page.$eval('#holo', (c) => c.hidden), true);

console.log('\numa chamada aceita');
send('tool_call_end', {
  tool: 'conjure',
  success: true,
  metadata: { action: 'criar', shape: 'piramide', color: 'verde', size: 'medio', place: 'frente', count: 3 },
});
await page.waitForTimeout(400);
check('o palco subiu', await page.$eval('#holo', (c) => [c.hidden, c.dataset.stage ?? null]), [false, 'on']);
const three = await lit();
check('e desenhou', three > 200, true);

send('tool_call_end', { tool: 'conjure', success: true, metadata: { action: 'limpar', shape: '' } });
await page.waitForTimeout(300);
check('limpar pelo modelo tira tudo e guarda o palco', await page.$eval('#holo', (c) => c.hidden), true);

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
