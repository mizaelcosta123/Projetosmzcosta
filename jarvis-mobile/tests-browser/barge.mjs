/**
 * Cutting in on him, in a browser, with a real microphone stream.
 *
 * The unit tests prove BargeIn's arithmetic. This proves the wiring: that the
 * meter's verdict reaches the voice handle, that a noise only ducks, and that
 * words are what stop him. It is the half of the feature a clock cannot check.
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
  ],
});
const context = await browser.newContext({ permissions: ['microphone'] });
await context.addInitScript(() => {
  class Fake {
    constructor() {
      window.__r = this;
    }
    start() {}
    stop() {
      this.onend?.();
    }
  }
  window.SpeechRecognition = Fake;
  window.webkitSpeechRecognition = Fake;
  window.__say = (text) => {
    window.__r?.onresult?.({
      resultIndex: 0,
      results: { 0: { 0: { transcript: text }, isFinal: false }, length: 1 },
    });
  };
});

const page = await context.newPage();
page.on('pageerror', (e) => console.log('ERRO:', String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' });

const check = (label, ok, detail = '') =>
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);

// -- words after a voice stop him ------------------------------------------

const cut = await page.evaluate(async () => {
  const { LiveSession } = await import('./live.js');
  const session = new LiveSession();
  const acted = [];
  const states = [];
  session.addEventListener('state', (e) => states.push(e.detail.state));
  await session.start();

  // Stand in for the voice: record what the session does to it.
  session.speakingStarted({
    pause: () => acted.push('pause'),
    setVolume: (v) => acted.push(`volume:${v}`),
  });

  // Wait for the meter to hear the file's voice — that is the duck.
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !acted.length) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const afterVoice = [...acted];

  // Now the words, which is what confirms it.
  window.__say('espera aí, deixa eu falar');
  await new Promise((r) => setTimeout(r, 200));

  session.stop();
  return { afterVoice, acted, states };
});

console.log('--- ruído vira voz, depois vêm palavras ---');
check('a voz abaixou o volume', cut.afterVoice.includes('volume:0.15'), cut.afterVoice.join(', '));
check('as palavras o pararam', cut.acted.includes('pause'), cut.acted.join(', '));
check(
  'a ordem foi abaixar e só então parar',
  cut.acted.indexOf('volume:0.15') < cut.acted.indexOf('pause'),
  cut.acted.join(' → ')
);
check('avisou que estava sendo cortado', cut.states.includes('cutting-in'), cut.states.join(' → '));

// -- a voice with no words lets him carry on --------------------------------

const noWords = await page.evaluate(async () => {
  const { LiveSession } = await import('./live.js');
  const session = new LiveSession();
  await session.start();
  const acted = [];
  session.speakingStarted({
    pause: () => acted.push('pause'),
    setVolume: (v) => acted.push(`volume:${v}`),
  });

  // Never say anything. The duck should expire and restore on its own.
  await new Promise((r) => setTimeout(r, 14000));
  session.stop();
  return acted;
});

console.log('\n--- som sem palavras: ele continua ---');
check('abaixou', noWords.includes('volume:0.15'), noWords.join(', '));
check('voltou ao normal sozinho', noWords.includes('volume:1'), noWords.join(' → '));
check('nunca foi parado', !noWords.includes('pause'), noWords.join(' → '));

await browser.close();
