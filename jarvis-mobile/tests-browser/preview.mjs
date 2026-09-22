/**
 * Running a model's page, and proving it cannot reach this one.
 *
 * The unit tests assert the sandbox string. Only a browser can show what that
 * string buys: a frame that runs script and still cannot read the localStorage
 * the provider key lives in.
 *
 *   node tests-browser/preview.mjs <porta>
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 412, height: 880 } });

await context.addInitScript(() => {
  localStorage.setItem(
    'jarvis.settings.v1',
    JSON.stringify({
      providers: [{ id: 'p1', name: 'P', url: 'http://fake.provider', key: 'CHAVE-SECRETA', kind: 'openai' }],
      active: 'p1',
      model: 'm',
      speak: false,
      wake: false,
    })
  );
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

// A reply carrying a page that tries to steal the key.
//
// Built from an array so the newlines are real: a fenced block needs one after
// the language, and a literal backslash-n produced no block at all — which
// looked exactly like the feature being broken.
const STEAL =
  'document.getElementById("saida").textContent = "chave=" + (function () {' +
  ' try { return localStorage.getItem("jarvis.settings.v1") || "nada"; }' +
  ' catch (error) { return "BLOQUEADO: " + error.name; } })();';

const REPLY = [
  'Aqui está:',
  '',
  '```html',
  '<p id="saida">rodando</p>',
  `<script>${STEAL}<` + '/script>',
  '```',
].join('\n');

await page.route('http://fake.provider/**', (route) => {
  if (route.request().url().endsWith('/v1/chat/completions')) {
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: REPLY } }] })}\n\ndata: [DONE]\n\n`,
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await page.waitForTimeout(400);

const check = (label, ok, detail = '') =>
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);

console.log('--- a oferta ---');
check('nada a rodar antes de perguntar', await page.locator('#run').isHidden());

await page.locator('#prompt').fill('faça uma página');
await page.locator('#send').click();
await page.waitForTimeout(1800);

if (await page.locator('#run').isHidden()) {
  console.log('  legenda recebida:', JSON.stringify((await page.locator('#caption').textContent()).slice(0, 200)));
}
check('o botão apareceu', !(await page.locator('#run').isHidden()));
check('e diz o que vai acontecer', (await page.locator('#run').textContent()).includes('página'),
  await page.locator('#run').textContent());

console.log('\n--- rodando ---');
await page.locator('#run').click();
await page.waitForTimeout(1200);
check('o palco abriu', !(await page.locator('#stage').isHidden()));

const sandbox = await page.locator('#frame').getAttribute('sandbox');
check('com allow-scripts', String(sandbox).includes('allow-scripts'), sandbox);
check('e SEM allow-same-origin', !String(sandbox).includes('allow-same-origin'), sandbox);

const inside = await page.frameLocator('#frame').locator('#saida').textContent();
check('o script do modelo rodou', inside !== 'rodando', inside);
check(
  'e NÃO alcançou a chave',
  !String(inside).includes('CHAVE-SECRETA'),
  inside
);

console.log('\n--- fechar ---');
await page.locator('#close-stage').click();
await page.waitForTimeout(400);
check('o palco fechou', await page.locator('#stage').isHidden());

// The SecurityError from the frame is the protection working, not a fault: it
// is the browser refusing the read this test asked for on purpose.
const expected = errors.filter((line) => line.includes('allow-same-origin'));
const unexpected = errors.filter((line) => !line.includes('allow-same-origin'));
check('o navegador registrou a recusa', expected.length > 0, `${expected.length} SecurityError`);
console.log('\noutros erros de console:', unexpected.length ? unexpected.slice(0, 3) : 'nenhum');
await browser.close();
