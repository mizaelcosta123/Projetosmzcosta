/**
 * The camera, the clip and the tray, driven the way a person drives them.
 *
 * Chromium's fake video device gives getUserMedia a real stream, so the
 * viewfinder, the frame grab and the canvas re-encode all run for real. What
 * unit tests cannot reach is the wiring: whether the tray fills, whether the
 * camera light goes out when you close it, and above all whether an image
 * actually leaves in the request body.
 *
 *   node tests-browser/attach.mjs <porta>
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: 412, height: 880 },
  permissions: ['camera', 'microphone'],
});

await context.addInitScript(() => {
  localStorage.setItem(
    'jarvis.settings.v1',
    JSON.stringify({
      providers: [
        { id: 'p1', name: 'Provedor', url: 'http://fake.provider', key: 'k', kind: 'openai' },
      ],
      active: 'p1',
      model: 'vision-model',
      speak: false,
      wake: false,
    })
  );
});

const page = await context.newPage();

/** The camera, the create mode and the rest moved behind the "+" button;
 *  this opens it when needed and presses the item by what it does. */
async function more(does) {
  if (await page.locator('#more-menu').isHidden()) await page.locator('#more').click();
  await page.locator(`[data-does="${does}"]`).click();
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

// What the page would send. This is the only place the image can be proven.
const sent = [];
await page.route('http://fake.provider/**', async (route) => {
  const request = route.request();
  if (request.url().endsWith('/v1/chat/completions')) {
    sent.push(JSON.parse(request.postData() || '{}'));
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"vejo um gato"}}]}\n\ndata: [DONE]\n\n',
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await page.waitForTimeout(400);

const check = (label, ok, detail = '') =>
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);

const trayCount = () => page.locator('#tray figure').count();

// -- the camera --------------------------------------------------------------

console.log('--- a câmera ---');
await more('camera');
await page.waitForTimeout(1200);
check('o visor abriu', !(await page.locator('#viewfinder').isHidden()));
check(
  'e há um quadro de verdade nele',
  (await page.evaluate(() => document.getElementById('preview').videoWidth)) > 0,
  `${await page.evaluate(() => document.getElementById('preview').videoWidth)}px`
);

await page.locator('#shoot').click();
await page.waitForTimeout(900);
check('o visor fechou ao tirar', await page.locator('#viewfinder').isHidden());
check('a foto entrou na bandeja', (await trayCount()) === 1, `${await trayCount()} itens`);
check(
  'e a câmera foi desligada',
  await page.evaluate(() => !document.getElementById('preview').srcObject),
  'srcObject nulo'
);

// -- what leaves in the request ----------------------------------------------

console.log('\n--- o que sai no pedido ---');
await page.locator('#prompt').fill('o que você vê?');
await page.locator('#send').click();
await page.waitForTimeout(1500);

const body = sent[0];
const content = body?.messages?.[0]?.content;
check('a mensagem virou blocos', Array.isArray(content), typeof content);
check(
  'com a pergunta e a imagem',
  Array.isArray(content) &&
    content[0]?.type === 'text' &&
    content[1]?.type === 'image_url' &&
    String(content[1]?.image_url?.url).startsWith('data:image/jpeg'),
  Array.isArray(content) ? content.map((p) => p.type).join(', ') : ''
);
check('a bandeja esvaziou depois de enviar', (await trayCount()) === 0);

// -- a message with no picture keeps the old shape ---------------------------

console.log('\n--- sem imagem, nada muda ---');
await page.locator('#prompt').fill('só texto');
await page.locator('#send').click();
await page.waitForTimeout(1200);
check(
  'continua uma string',
  typeof sent[1]?.messages?.[0]?.content === 'string',
  typeof sent[1]?.messages?.[0]?.content
);

console.log('\nerros de console:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
