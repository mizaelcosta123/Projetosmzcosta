/**
 * The settings sheet, driven the way a person drives it.
 *
 * Updated for the sheet as it is now: the page adopts a local Ollama by
 * itself on first run, and the model field is a select of the models kept
 * for each address, filled from a catalogue, rather than free text.
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
const models = () => page.$$eval('#model option', (n) => n.map((o) => o.value).filter((v) => v && v !== '__outro__'));
const catalogue = () => page.$$eval('#catalogue-list label', (n) => n.map((l) => l.textContent.trim()));

// A static server on this machine and an Ollama answering /api/tags: the
// page finds it and points at it on its own, with nothing configured. The
// menu is how you get to the sheet afterwards.
await page.waitForTimeout(400);
if (!(await page.locator('#settings').isVisible())) await page.locator('#menu').click();
await page.waitForTimeout(400);

console.log('--- primeira abertura ---');
check('o painel abriu', await page.locator('#settings').isVisible());
check('achou o Ollama local sozinho', (await options()).some((n) => n.includes('Ollama')), (await options()).join(', '));
check(
  'e diz que ele só responde, sem alcançar o aparelho',
  (await role()).includes('só responde') && (await role()).includes('Termux'),
  await role()
);
await page.locator('#model-pick').click();
await page.waitForTimeout(700);
check(
  'o catálogo abre com os modelos dele, vindos do /api/tags',
  (await catalogue()).some((t) => t.includes('qwen2.5:1.5b')),
  (await catalogue()).join(', ')
);
await page.locator('#catalogue-done').click();
await page.waitForTimeout(200);

console.log('\n--- o Ollama do Termux, num toque ---');
const count = (await options()).length;
await page.locator('#provider-ollama').click();
await page.waitForTimeout(700);
check('continua na lista, sem duplicar', (await options()).filter((n) => n.includes('Ollama')).length === 1 && (await options()).length === count, (await options()).join(', '));
check(
  'e avisa que NÃO chega ao Termux',
  (await role()).includes('só responde') && (await role()).includes('Termux'),
  await role()
);

console.log('\n--- trocar de provedor ---');
await page.locator('#provider-add').click();
await page.locator('#provider-url').fill('https://openrouter.ai/api/v1');
await page.locator('#provider-test').click();
await page.waitForTimeout(900);
check('o outro endereço listou os modelos dele', (await models()).includes('anthropic/claude-sonnet-4.5'), (await models()).join(', '));
await page.selectOption('#provider', { index: 0 });
await page.waitForTimeout(300);
check(
  'o modelo do outro provedor não ficou para trás',
  !(await models()).includes('anthropic/claude-sonnet-4.5') && (await page.locator('#model').inputValue()) === '',
  `modelo=${await page.locator('#model').inputValue()}; lista=${(await models()).join(', ')}`
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

console.log('\n--- o painel do aparelho ---');
const deviceText = () => page.locator('#device-state').textContent();
const deviceTone = () => page.locator('#device-state').getAttribute('data-tone');

// A phone linked with an old runner: connected, and unable to tap anything.
await page.route('**/v1/device', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      linked: true,
      name: 'pixel',
      transport: 'bridge',
      stale: true,
      ui: false,
      shell: false,
      binaries: ['termux-open-url', 'termux-battery-status'],
    }),
  })
);
await page.locator('#device-refresh').click();
await page.waitForTimeout(600);
check('diz que o aparelho está ligado', (await deviceText()).includes('pixel'), await deviceText());
check('e avisa que o runner é antigo', (await deviceText()).includes('runner antigo'), await deviceText());
check('em âmbar, não em verde', (await deviceTone()) === 'warn', `tone=${await deviceTone()}`);
check(
  'os detalhes apareceram',
  !(await page.locator('#device-detail').isHidden()),
  await page.locator('#device-detail').textContent()
);

console.log('\n--- remover ---');
const before = (await options()).length;
await page.locator('#provider-remove').click();
await page.waitForTimeout(200);
check('saiu da lista', (await options()).length === before - 1, `${before} -> ${(await options()).length}`);

console.log('\nerros de console:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
