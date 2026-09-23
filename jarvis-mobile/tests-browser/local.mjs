/**
 * The whole app, on this machine, against a local Ollama.
 *
 * What this proves that a unit test cannot: how many requests it actually
 * makes, and where they go. Every regression this file has caught was a call
 * to an endpoint that was never going to answer -- a WebSocket retrying a
 * route Ollama does not have, a `/v1/info` 404 before every first message --
 * and none of them fail anything. They just cost a phone its battery.
 *
 *   node tests-browser/fake-ollama.mjs &          # or a real one
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/local.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const OLLAMA = process.argv[3] ?? 'http://127.0.0.1:11434';
const KEY = 'jarvis.settings.v1';

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

/** A fresh page with its own storage, watching every call it makes. */
async function open({ settings } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 } });
  const page = await ctx.newPage();
  const calls = [];
  const errors = [];
  page.on('request', (r) => /\/v1\/|\/api\//.test(r.url()) && calls.push(`${r.method()} ${r.url()}`));
  page.on('websocket', (ws) => calls.push(`WS ${ws.url()}`));
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(UI, { waitUntil: 'networkidle' });
  if (settings) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, settings]);
    calls.length = 0;
    await page.reload({ waitUntil: 'networkidle' });
  }
  return { page, ctx, calls, errors };
}

const ollamaSettings = {
  providers: [{ id: 'p1', name: 'Ollama', url: OLLAMA, key: '', kind: 'ollama', agent: false }],
  active: 'p1', model: '', speak: false, wake: false,
};

// -- 1. nothing wasted on a provider that has no agent ----------------------
console.log('\nsem gastar nada com rotas que o Ollama não tem');
{
  const { page, ctx, calls, errors } = await open({ settings: ollamaSettings });
  await page.waitForTimeout(1200);
  check('nenhuma chamada ao abrir', calls, []);

  calls.length = 0;
  await page.evaluate(() => document.getElementById('settings')?.close());
  await page.fill('#prompt', 'você está local?');
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(2500);
  check('só modelos e a conversa', [...new Set(calls)], [
    `GET ${OLLAMA}/v1/models`,
    `POST ${OLLAMA}/v1/chat/completions`,
  ]);
  const answer = await page.$eval('#caption', (e) => e.textContent.trim());
  check('respondeu de verdade', answer.length > 0 && !/não consegui/i.test(answer), true);

  calls.length = 0;
  await page.click('#menu');
  await page.waitForTimeout(1500);
  check('configurações pergunta só a lista de modelos', [...new Set(calls)], [`GET ${OLLAMA}/api/tags`]);
  const models = await page.$$eval('#model-options option', (o) => o.map((x) => x.value));
  check('carregou os modelos', models.length > 0, true);
  const device = await page.$eval('#device-state', (e) => e.textContent.trim());
  check('diz a verdade sobre o aparelho', /só responde/.test(device), true);
  check('sem erros', errors, []);
  await ctx.close();
}

// -- 2. first run adopts the Ollama it finds --------------------------------
console.log('\nprimeiro acesso, servido daqui');
{
  const { page, ctx, calls, errors } = await open();
  await page.waitForTimeout(2500);
  check('uma pergunta só, para achar o Ollama', [...new Set(calls)], [`GET http://localhost:11434/api/tags`]);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);
  check('guardou o provedor', saved?.providers?.[0]?.url, 'http://localhost:11434');
  check('e já sabe que não é um agente', saved?.providers?.[0]?.agent, false);
  check('não abriu configurações', await page.evaluate(() => document.getElementById('settings').open), false);

  await page.fill('#prompt', 'oi');
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(2500);
  const answer = await page.$eval('#caption', (e) => e.textContent.trim());
  check('conversa sem ninguém configurar nada', !/não consegui/i.test(answer), true);
  check('sem erros', errors, []);
  await ctx.close();
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
