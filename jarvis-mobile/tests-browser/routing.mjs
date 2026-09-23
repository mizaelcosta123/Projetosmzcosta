/**
 * Choosing between the models you kept, from what each has actually done.
 *
 * Two fake endpoints on different ports: one answers, one refuses. Nobody
 * tells the app which is which — it has to find out by trying, and then stop
 * choosing the one that fails. That is the whole claim, and it cannot be
 * checked in a unit test because it needs real requests, real failures and
 * real persistence across reloads.
 *
 *   node tests-browser/fake-ollama.mjs &            # answers
 *   PORT=8000 BROKEN=1 node tests-browser/fake-ollama.mjs &   # refuses
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/routing.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const GOOD = process.argv[3] ?? 'http://127.0.0.1:11434';
const KEY = 'jarvis.settings.v1';
const BELIEFS = 'jarvis.beliefs.v1';

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

await page.goto(UI, { waitUntil: 'networkidle' });

// Two models kept, nothing pinned. One of them the endpoint will refuse.
await page.evaluate(([k, url]) => localStorage.setItem(k, JSON.stringify({
  providers: [{
    id: 'p1', name: 'X', url, key: '', kind: 'openai', agent: false,
    models: ['bom-modelo', 'modelo-quebrado'],
  }],
  active: 'p1', model: '', speak: false, wake: false,
})), [KEY, GOOD]);

// The endpoint answers for one id and refuses for the other, so the app has
// to learn the difference from the outcomes alone.
await page.route('**/v1/chat/completions', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  if (body.model === 'modelo-quebrado') {
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"indisponível"}' });
  }
  return route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"choices":[{"delta":{"content":"pronto"}}]}\n\ndata: [DONE]\n\n',
  });
});

await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

async function say(text) {
  await page.fill('#prompt', text);
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(500);
}

console.log('\naprendendo qual dos dois presta');
for (let i = 0; i < 24; i += 1) await say(`pergunta ${i}`);

const learned = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), BELIEFS);
console.log('    crenças:', Object.fromEntries(Object.entries(learned)
  .map(([id, b]) => [id, `${((b.alpha / (b.alpha + b.beta)) * 100).toFixed(0)}%`])));

// `pick` creates a belief for every option it is shown, so both keys exist
// whether or not either was ever used. Evidence is what proves it was tried:
// alpha+beta above the Beta(1,1) prior means outcomes were filed against it.
const tried = (id) => Math.round((learned[id]?.alpha ?? 1) + (learned[id]?.beta ?? 1) - 2);
console.log('    tentativas:', { bom: tried('bom-modelo'), quebrado: tried('modelo-quebrado') });
check('usou o bom', tried('bom-modelo') > 10, true);
// Deliberately *not* asserting that the broken one was tried here. Once the
// good one's posterior sits near 0.95, Thompson draws the broken one about
// five times in a hundred, so "tried at least once in N rounds" is a coin
// flip dressed as a test -- flaky at roughly 5% for N=60. Exploration is
// checked where the generator is seeded, in tests-web/decide.test.mjs; what
// belongs here is the part that needs real requests.
console.log('    (exploração: verificada com semente em tests-web/decide.test.mjs)');
const rate = (id) => learned[id].alpha / (learned[id].alpha + learned[id].beta);
check('e descobriu qual responde', rate('bom-modelo') > rate('modelo-quebrado') + 0.3, true);

console.log('\nagora escolhe o que funciona');
const counts = {};
for (let i = 0; i < 14; i += 1) {
  await say(`mais uma ${i}`);
  const now = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), BELIEFS);
  for (const [id, b] of Object.entries(now)) counts[id] = b.alpha + b.beta;
}
const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), BELIEFS);
check('continua preferindo o que responde',
  after['bom-modelo'].alpha > after['modelo-quebrado'].alpha, true);

console.log('\no que aprendeu sobrevive a recarregar');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const reopened = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.beliefs.v1') ?? '{}'));
check('as crenças continuam lá', Object.keys(reopened).length, 2);

console.log('\num modelo fixado manda, e ninguém escolhe por você');
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.model = 'modelo-quebrado';
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.beliefs.v1'))['modelo-quebrado']);
await say('vai por este mesmo');
const unchanged = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.beliefs.v1'))['modelo-quebrado']);
check('não registrou nada contra o escolhido à mão',
  unchanged.alpha === before.alpha && unchanged.beta === before.beta, true);

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
