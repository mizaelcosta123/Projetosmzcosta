/**
 * The settings sheet, driven the way a person drives it.
 *
 * Everything here is DOM wiring, which unit tests cannot reach: whether the
 * picker fills, whether switching entries clears a model ID that belonged to
 * the other one, whether the sentence about reaching the phone actually
 * changes. A missing element handle is a TypeError at click time and nowhere
 * else, so this is the only place it shows up before a user finds it.
 *
 *   node tests-browser/settings.mjs <porta>
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 412, height: 880 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

// Stand in for every provider the page might ask, so nothing leaves the box.
await page.route('**/api/tags', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: [{ name: 'qwen2.5:1.5b' }, { name: 'llama3.2:1b' }] }),
  })
);
await page.route('**/v1/models', (route) => {
  // Port 9 is the discard port and stands in for "nothing is listening". It
  // has to actually fail, or the check below passes on this stub's answer —
  // which is exactly what it did the first time this was run.
  if (route.request().url().includes(':9/')) return route.abort('connectionrefused');
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-4.5' }] }),
  });
});

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });

const check = (label, ok, detail = '') =>
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);

const options = () =>
  page.$$eval('#provider option', (nodes) => nodes.map((n) => n.textContent));
const role = () => page.locator('#provider-role').textContent();
const status = () => page.locator('#provider-status').textContent();
const models = () => page.$$eval('#model-options option', (n) => n.map((o) => o.value));

// Served by a backend, so the page has somewhere to talk to and does not open
// the sheet by itself. The gear is how you get there.
await page.waitForTimeout(400);
await page.locator('#menu').click();
await page.waitForTimeout(400);

console.log('--- primeira abertura ---');
check('o painel abriu', await page.locator('#settings').isVisible());
check('há um provedor na lista', (await options()).length >= 1, (await options()).join(', '));
check(
  'ele diz que alcança o aparelho',
  (await role()).includes('alcança o seu aparelho'),
  await role()
);
await page.waitForTimeout(500);
check('os modelos carregaram sozinhos', (await models()).length > 0, (await models()).join(', '));

console.log('\n--- o Ollama do Termux, num toque ---');
await page.locator('#provider-ollama').click();
await page.waitForTimeout(700);
check('entrou na lista', (await options()).some((n) => n.includes('Ollama')), (await options()).join(', '));
check(
  'e avisa que NÃO chega ao Termux',
  (await role()).includes('só responde') && (await role()).includes('Termux'),
  await role()
);
check(
  'os modelos dele vieram pelo /api/tags',
  (await models()).includes('qwen2.5:1.5b'),
  (await models()).join(', ')
);

console.log('\n--- trocar de provedor ---');
await page.locator('#model').fill('qwen2.5:1.5b');
await page.selectOption('#provider', { index: 0 });
await page.waitForTimeout(300);
check(
  'o modelo do outro provedor não ficou para trás',
  (await page.locator('#model').inputValue()) === '',
  `modelo=${await page.locator('#model').inputValue()}`
);

console.log('\n--- um endereço que não responde ---');
await page.locator('#provider-add').click();
await page.locator('#provider-url').fill('http://127.0.0.1:9/');
await page.locator('#provider-test').click();
await page.waitForTimeout(1200);
check(
  'o erro aparece na tela, e diz o que fazer',
  (await status()).includes('CORS') || (await status()).includes('alcancei'),
  await status()
);

console.log('\n--- remover ---');
const before = (await options()).length;
await page.locator('#provider-remove').click();
await page.waitForTimeout(200);
check('saiu da lista', (await options()).length === before - 1, `${before} -> ${(await options()).length}`);

console.log('\nerros de console:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
