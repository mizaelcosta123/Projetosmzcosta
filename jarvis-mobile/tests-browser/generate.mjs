/**
 * Making a picture, driven the way a person drives it.
 *
 * The real service is unreachable from the container this runs in, so the
 * endpoint is intercepted and answers with a real JPEG. What that still proves
 * is everything between the button and the picture: that the mode changes what
 * the field means, that the prompt reaches the URL encoded, that the rate cap
 * holds the button instead of letting the service refuse, and that a failure
 * says which failure it was.
 *
 *   node tests-browser/generate.mjs <porta>
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';

// The smallest valid JPEG, so the <img> really decodes something.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 412, height: 880 } });
const page = await context.newPage();

/** The camera, the create mode and the rest moved behind the "+" button;
 *  this opens it when needed and presses the item by what it does. */
async function more(does) {
  if (await page.locator('#more-menu').isHidden()) await page.locator('#more').click();
  await page.locator(`[data-does="${does}"]`).click();
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

const asked = [];
let nextStatus = 200;
await page.route('https://image.pollinations.ai/**', (route) => {
  asked.push(route.request().url());
  if (nextStatus !== 200) return route.fulfill({ status: nextStatus, body: '' });
  return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG });
});

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await page.waitForTimeout(400);

const check = (label, ok, detail = '') =>
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);

// -- the mode ----------------------------------------------------------------

console.log('--- o modo criar ---');
check('começa desligado', (await page.locator('[data-does="create"]').getAttribute('aria-pressed')) === 'false');
await more('create');
await page.waitForTimeout(200);
check('liga', (await page.locator('[data-does="create"]').getAttribute('aria-pressed')) === 'true');
check(
  'e o campo diz o que espera agora',
  (await page.locator('#prompt').getAttribute('placeholder')).includes('Descreva'),
  await page.locator('#prompt').getAttribute('placeholder')
);

// -- generating --------------------------------------------------------------

console.log('\n--- gerando ---');
await page.locator('#prompt').fill('um gato azul de óculos');
await page.locator('#send').click();
await page.waitForTimeout(1500);

check('a galeria abriu', !(await page.locator('#gallery').isHidden()));
check('pediu ao serviço', asked.length === 1, `${asked.length} pedidos`);
check(
  'com o texto codificado no caminho',
  decodeURIComponent(new URL(asked[0]).pathname).includes('um gato azul de óculos'),
  new URL(asked[0]).pathname.slice(0, 60)
);
check('sem marca d\'água', new URL(asked[0]).searchParams.get('nologo') === 'true');
check('e privado', new URL(asked[0]).searchParams.get('private') === 'true');

const shown = await page.evaluate(() => {
  const img = document.getElementById('made');
  return { src: img.getAttribute('src') || '', w: img.naturalWidth };
});
check('a imagem foi exibida', shown.src.startsWith('blob:'), shown.src.slice(0, 20));
check('e o navegador decodificou', shown.w > 0, `${shown.w}px`);
check('salvar habilitou', !(await page.locator('#save').isDisabled()));

// -- the rate cap ------------------------------------------------------------

console.log('\n--- o limite do serviço gratuito ---');
check(
  '"gerar outra" fica em espera',
  await page.locator('#again').isDisabled(),
  await page.locator('#again').textContent()
);
check(
  'e diz quantos segundos',
  /\d+s/.test(await page.locator('#again').textContent()),
  await page.locator('#again').textContent()
);

// -- failures ----------------------------------------------------------------

console.log('\n--- quando o serviço recusa ---');
await page.evaluate(() => {
  // Let the cooldown expire so the next attempt is allowed through.
  window.__skip = true;
});
nextStatus = 429;
await page.locator('#close-gallery').click();
await page.locator('#prompt').fill('outra coisa');
await page.locator('#send').click();
await page.waitForTimeout(1200);
check(
  'o 429 vira "espere", não um código',
  (await page.locator('#made-note').textContent()).includes('15 segundos'),
  await page.locator('#made-note').textContent()
);
check('em vermelho', (await page.locator('#made-note').getAttribute('data-state')) === 'bad');

nextStatus = 503;
await page.locator('#close-gallery').click();
await page.locator('#prompt').fill('mais uma');
await page.locator('#send').click();
await page.waitForTimeout(1200);
check(
  'o 503 diz que está ocupado',
  (await page.locator('#made-note').textContent()).includes('ocupado'),
  await page.locator('#made-note').textContent()
);

// -- the mode does not leak into chat ----------------------------------------

console.log('\n--- desligar volta a conversar ---');
await page.locator('#close-gallery').click();
await more('create');
await page.waitForTimeout(200);
const before = asked.length;
await page.locator('#prompt').fill('oi');
await page.locator('#send').click();
await page.waitForTimeout(800);
check('não gerou imagem', asked.length === before, `${asked.length - before} pedidos novos`);
check('a galeria continua fechada', await page.locator('#gallery').isHidden());

if (process.env.SHOT) {
  // One picture of the composer with every control on it, and one of the
  // gallery holding a result — the two screens this change adds.
  await page.screenshot({ path: `${process.env.SHOT}/compositor.png` });
  nextStatus = 200;
  await more('create');
  await page.locator('#prompt').fill('uma raposa de origami ao entardecer');
  await page.locator('#send').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${process.env.SHOT}/galeria.png` });
}

console.log('\nerros de console:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
