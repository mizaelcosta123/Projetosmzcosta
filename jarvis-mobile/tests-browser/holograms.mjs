/**
 * Conjuring things by speaking, and what the app does with no WebXR.
 *
 * Playwright's Chromium has no WebXR and no ARCore, which is not a gap in
 * this test — it is the majority case. Every iPhone browser and every Android
 * without the AR services lands here, and what matters is that the app says
 * which of the two it is instead of a button that does nothing.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/holograms.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
// The endpoint is a closed port on purpose: reaching the network at all is
// the failure this test is looking for, so its refusal is expected noise.
page.on('console', (m) => m.type() === 'error'
  && !/WebSocket|404|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())
  && errors.push(m.text().slice(0, 200)));

await page.goto(UI, { waitUntil: 'networkidle' });
await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
  providers: [{ id: 'p1', name: 'X', url: 'http://127.0.0.1:59999', key: '', kind: 'openai', agent: false }],
  active: 'p1', model: '', speak: false, wake: false,
})), KEY);
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

/** Say something into the composer and wait. The endpoint is a dead port, so
 *  anything that reaches the network fails — which is how we can tell that
 *  the fast path answered without one. */
async function say(text) {
  await page.fill('#prompt', text);
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(450);
  return page.$eval('#caption', (n) => n.textContent.trim());
}

console.log('\nconjurar sem rede nenhuma');
check('um cubo', await say('cria um cubo azul grande à minha direita'), 'Um cubo.');
check('uma esfera, com o artigo certo', await say('poe uma bola vermelha'), 'Uma esfera.');
check('um toro', await say('me faz uma rosquinha'), 'Um toro.');
// How many are in the room is checked through what he says when clearing it,
// further down. Reaching into the page for a private field would test the
// wiring of the test rather than the behaviour.

console.log('\nensinar um nome');
check('ele anota', await say('quando eu disser caixote é um cubo'), 'Anotado: caixote é um cubo.');
check('e usa', await say('poe um caixote aqui'), 'Um cubo.');
check('guardado para a próxima sessão',
  await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.memory.v1') ?? '[]')
    .some((r) => r.kind === 'apelido')), true);

console.log('\no que ele não entende vai para o modelo');
const passed = await say('que horas são em Tóquio');
check('não inventou um objeto', /cubo|esfera|toro/i.test(passed), false);
check('tentou a rede, e o endereço está morto', /não|erro|alcanc/i.test(passed), true);

console.log('\nlimpar');
check('limpa tudo', await say('limpa tudo'), 'Limpei 4 objetos.');

console.log('\nsem WebXR, que é a maioria dos aparelhos');
await page.click('#more');
await page.click('[data-does="ar"]');
await page.waitForTimeout(600);
const excuse = await page.$eval('#caption', (n) => n.textContent.trim());
console.log('   ', excuse);
check('diz o motivo em vez de não fazer nada', excuse.length > 30, true);
check('e diz qual dos dois motivos é', /WebXR|HTTPS|Serviços de RA/i.test(excuse), true);
check('não deixou a tela da RA aberta por cima',
  await page.$eval('#holo', (c) => c.hidden), true);
check('o campo de partículas continua vivo',
  await page.evaluate(() => Boolean(window.__field?._raf ?? true)), true);

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
