/**
 * Live voice and the wake word, in a real browser.
 *
 * Chromium's fake capture device plays a WAV into getUserMedia, so the level
 * meter, the gate and the barge-in run for real. Recognition is stubbed —
 * Chrome's own needs Google's service — which also lets the test decide
 * exactly when words arrive, and that is the half worth driving by hand.
 */

import { chromium } from 'playwright';

const WAV = process.argv[2];
const PORT = process.argv[3];

const browser = await chromium.launch({
  // Undefined lets Playwright use whatever Chromium it downloaded itself.
  executablePath: process.env.CHROMIUM || undefined,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const context = await browser.newContext({
  viewport: { width: 412, height: 880 },
  permissions: ['microphone'],
});

// Both names: Chromium defines SpeechRecognition as well as the webkit one,
// and live.js prefers whichever it finds first.
await context.addInitScript(() => {
  window.__instances = [];
  class FakeRecognition {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      window.__instances.push(this);
    }
    start() {
      window.__recognition = this;
      this.running = true;
    }
    stop() {
      this.running = false;
      this.onend?.();
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  // Feed words to whichever recogniser is currently listening.
  window.__say = (text, isFinal = false) => {
    const results = { 0: { 0: { transcript: text }, isFinal }, length: 1 };
    window.__recognition?.onresult?.({ resultIndex: 0, results });
  };
});

// A configured server, so asking gets as far as a request we can read.
await context.addInitScript(() => {
  localStorage.setItem(
    'jarvis.settings.v1',
    JSON.stringify({ serverUrl: 'http://fake.jarvis', apiKey: '', model: 'test', speak: true, wake: true })
  );
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

// What the page would send to a model. This is where the question ends up, so
// it is the only honest place to check that the wake word carried it along.
const asked = [];
await page.route('http://fake.jarvis/**', async (route) => {
  const request = route.request();
  if (request.url().endsWith('/v1/chat/completions')) {
    // The user's turn, wherever it sits: system messages (memory, the voice
    // instructions) come before it.
    const messages = JSON.parse(request.postData() || '{}')?.messages ?? [];
    asked.push(messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        'data: {"choices":[{"delta":{"content":"tudo certo"}}]}\n\n' +
        'data: [DONE]\n\n',
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await page.waitForTimeout(400);

const status = () => page.locator('#status').textContent().then((s) => s.trim());
const liveMode = () => page.locator('#composer').getAttribute('data-live');
const caption = () => page.locator('#caption').textContent().then((s) => s.trim());

const check = (label, ok, detail = '') =>
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);

// -- the wake word ----------------------------------------------------------

console.log('--- a palavra de ativação ---');
// The first tap is what lets a page open a microphone; the app waits for it.
await page.mouse.click(200, 400);
await page.waitForTimeout(400);
const armed = await page.evaluate(() => Boolean(window.__recognition?.running));
check('ouvindo o nome após o primeiro toque', armed);
check('sessão ainda fechada', (await liveMode()) === null);

await page.evaluate(() => window.__say('e aí, tudo certo por aqui'));
await page.waitForTimeout(300);
check('conversa comum não acorda', (await liveMode()) === null);

await page.evaluate(() => window.__say('ei Jarvis, qual a bateria do meu celular'));
await page.waitForTimeout(1200);
check('o nome abriu a sessão', (await liveMode()) !== null, `data-live=${await liveMode()}`);
check(
  'a pergunta foi junto, sem o nome dele',
  asked.length === 1 && asked[0] === 'qual a bateria do meu celular',
  `pedido=${JSON.stringify(asked)}`
);
check('a resposta apareceu', (await caption()).includes('tudo certo'), `legenda=${await caption()}`);

await page.waitForTimeout(1500);

// -- the meter --------------------------------------------------------------

console.log('\n--- o medidor, com áudio de verdade ---');
let heard = false;
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(250);
  if ((await liveMode()) === 'hearing') {
    heard = true;
    break;
  }
}
check('a fala do arquivo virou "hearing"', heard, `data-live=${await liveMode()}`);

// -- the button -------------------------------------------------------------

console.log('\n--- o botão ---');
await page.locator('#live').click();
await page.waitForTimeout(500);
check('fecha a sessão', (await liveMode()) === null, `aria-pressed=${await page.locator('#live').getAttribute('aria-pressed')}`);

await page.locator('#live').click();
await page.waitForTimeout(700);
check('abre de novo', (await liveMode()) !== null);
await page.locator('#live').click();
await page.waitForTimeout(400);

console.log('\nerros de console:', errors.length ? errors.slice(0, 3) : 'nenhum');
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
