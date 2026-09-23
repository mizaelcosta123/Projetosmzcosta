/**
 * Choosing models out of a catalogue that can run to three hundred.
 *
 * The datalist this replaced was unusable on a phone: it only opens on focus,
 * filters as you type against a list you cannot see, and keeps nothing. What
 * this checks is the part a unit test cannot reach — that adding an endpoint
 * and a key opens a list with everything on it, that several can be kept, and
 * that what was kept survives closing and reopening the sheet.
 *
 *   node tests-browser/fake-ollama.mjs &        # a catalogue to pick from
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/models.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const ENDPOINT = process.argv[3] ?? 'http://127.0.0.1:11434';
const KEY = 'jarvis.settings.v1';

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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)));
page.on('console', (m) => m.type() === 'error' && !/WebSocket|404/.test(m.text()) && errors.push(m.text().slice(0, 180)));

await page.goto(UI, { waitUntil: 'networkidle' });
// An endpoint with a key, exactly as somebody would type it in.
await page.evaluate(([k, url]) => localStorage.setItem(k, JSON.stringify({
  providers: [{ id: 'p1', name: 'Meu endpoint', url, key: 'sk-teste', kind: 'openai', agent: false }],
  active: 'p1', model: '', speak: false, wake: false,
})), [KEY, ENDPOINT]);
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

console.log('\nabrir o catálogo depois de pôr endereço e chave');
await page.click('#menu');
await page.waitForTimeout(900);
await page.click('#model-pick');
await page.waitForTimeout(1200);

check('o catálogo abriu', await page.$eval('#catalogue', (d) => d.open), true);
const offered = await page.$$eval('.catalogue label span', (n) => n.map((x) => x.textContent));
check('e veio com tudo que o endereço oferece', offered.length, 3);
console.log('    ', offered);

console.log('\nescolher vários');
await page.click('.catalogue label:has-text("qwen2.5-coder:1.5b") input');
await page.waitForTimeout(200);
await page.click('.catalogue label:has-text("llama3.2:3b") input');
await page.waitForTimeout(300);
let saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).providers[0].models, KEY);
check('guardou os dois', saved, ['llama3.2:3b', 'qwen2.5-coder:1.5b']);
check('os escolhidos sobem para o topo',
  await page.$eval('.catalogue .catalogue-group', (n) => n.textContent), 'escolhidos (2)');

console.log('\nfiltrar');
await page.fill('#catalogue-search', 'qwen');
await page.waitForTimeout(250);
check('a busca reduz a lista',
  (await page.$$eval('.catalogue label span', (n) => n.map((x) => x.textContent))), ['qwen2.5-coder:1.5b']);
await page.fill('#catalogue-search', 'nada-disso');
await page.waitForTimeout(250);
check('e diz quando não acha', /Nada com/.test(await page.$eval('#catalogue-note', (n) => n.textContent)), true);
await page.fill('#catalogue-search', '');
await page.waitForTimeout(250);

await page.screenshot({ path: `${process.env.OUT ?? '/tmp'}/catalogo.png` });

console.log('\no seletor de modelo');
await page.click('#catalogue-done');
await page.waitForTimeout(400);
const options = await page.$$eval('#model option', (o) => o.map((x) => x.value));
check('lista os escolhidos, o padrão e a saída para digitar',
  options, ['', 'llama3.2:3b', 'qwen2.5-coder:1.5b', '__outro__']);

await page.selectOption('#model', 'qwen2.5-coder:1.5b');
await page.waitForTimeout(300);
check('escolher um o guarda',
  await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).model, KEY), 'qwen2.5-coder:1.5b');

console.log('\nsobrevive a fechar e reabrir');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.click('#menu');
await page.waitForTimeout(900);
check('o seletor continua com os dois',
  (await page.$$eval('#model option', (o) => o.map((x) => x.value))).filter((v) => v && v !== '__outro__'),
  ['llama3.2:3b', 'qwen2.5-coder:1.5b']);
check('e o escolhido continua escolhido',
  await page.$eval('#model', (s) => s.value), 'qwen2.5-coder:1.5b');
check('a lista guardada não se perdeu',
  await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).providers[0].models, KEY),
  ['llama3.2:3b', 'qwen2.5-coder:1.5b']);

console.log('\ndesmarcar o que está em uso');
await page.click('#model-pick');
await page.waitForTimeout(900);
await page.click('.catalogue label:has-text("qwen2.5-coder:1.5b") input');
await page.waitForTimeout(300);
await page.click('#catalogue-done');
await page.waitForTimeout(300);
check('o seletor não fica apontando para o nada',
  await page.$eval('#model', (s) => s.value), 'llama3.2:3b');

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
