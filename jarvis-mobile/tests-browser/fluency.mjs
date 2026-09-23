/**
 * How long until he starts talking, measured -- and whether he says "aham"
 * while you are still talking.
 *
 * A model server that streams the way a slow free model does -- the first
 * word after 1.2 s, then one word every 120 ms -- and a voice that records
 * when each thing was said. The same spoken question goes to two copies of
 * the interface: the one before streaming speech (argv[3], optional) and the
 * current one. What is compared is the one number anybody notices: the
 * silence between the end of your question and his first word.
 *
 *   python -m jarvis_mobile.deploy --source web --target /tmp/now && (cd /tmp/now && python3 -m http.server 8803 &)
 *   node tests-browser/fluency.mjs /tmp/fala.wav 8803 [porta-da-versao-anterior]
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';

const WAV = process.argv[2];
const NOW = process.argv[3] ?? '8803';
const BEFORE = process.argv[4] ?? '';

const FIRST_TOKEN_MS = 1200;
const WORD_MS = 120;
const REPLY = 'Claro. Amanhã chove à tarde em São Paulo, perto das quatro. Leve um guarda-chuva e um casaco leve.';

const model = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (!req.url.endsWith('/chat/completions')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end('{"data":[{"id":"lento"}]}');
  }
  res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const words = REPLY.split(' ');
  let i = 0;
  const send = () => {
    if (i >= words.length) {
      res.end('data: [DONE]\n\n');
      return;
    }
    const piece = (i ? ' ' : '') + words[i];
    i += 1;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    setTimeout(send, WORD_MS);
  };
  setTimeout(send, FIRST_TOKEN_MS);
}).listen(0, '127.0.0.1');
await new Promise((r) => model.once('listening', r));
const MODEL = `http://127.0.0.1:${model.address().port}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'OK  ' : 'FALHOU'}] ${label}${detail ? ` — ${detail}` : ''}`);
};

async function measure(port) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 412, height: 880 }, permissions: ['microphone'] });
  await context.addInitScript(() => {
    class FakeRecognition {
      start() { window.__recognition = this; this.running = true; }
      stop() { this.running = false; this.onend?.(); }
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
    window.__say = (text) => {
      const results = { 0: { 0: { transcript: text }, isFinal: true }, length: 1 };
      window.__recognition?.onresult?.({ resultIndex: 0, results });
    };
    // A voice that takes 55 ms a character, like a real one, and writes down
    // when it was asked to say what.
    window.__spoken = [];
    let current = null;
    const synth = {
      speaking: false,
      speak(u) {
        window.__spoken.push({ text: u.text, at: performance.now() });
        current = u;
        synth.speaking = true;
        setTimeout(() => u.onstart?.(), 5);
        u.__timer = setTimeout(() => { synth.speaking = false; current = null; u.onend?.(); }, u.text.length * 55);
      },
      cancel() {
        if (current) { clearTimeout(current.__timer); const u = current; current = null; synth.speaking = false; u.onend?.(); }
      },
      pause() {}, resume() {}, getVoices: () => [], addEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  });
  await context.addInitScript((url) => {
    localStorage.setItem('jarvis.settings.v1', JSON.stringify({
      providers: [{ id: 'p1', name: 'Lento', url, key: '', kind: 'openai', agent: false, models: ['lento'] }],
      active: 'p1', model: 'lento', speak: true, wake: true,
    }));
  }, MODEL);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  await page.mouse.click(200, 400); // the first tap arms the wake word
  await page.waitForTimeout(500);
  const asked = await page.evaluate(() => {
    window.__spoken.length = 0;
    const t0 = performance.now();
    window.__say('ei Jarvis, vai chover amanhã');
    return t0;
  });
  await page.waitForTimeout(FIRST_TOKEN_MS + REPLY.split(' ').length * WORD_MS + 6000);
  const spoken = await page.evaluate(() => window.__spoken);
  await browser.close();
  return { asked, spoken, errors };
}

const report = (name, { asked, spoken }) => {
  const rel = spoken.map((s) => ({ text: s.text, ms: Math.round(s.at - asked) }));
  console.log(`\n${name}`);
  for (const s of rel) console.log(`    ${String(s.ms).padStart(5)} ms  ${s.text}`);
  return rel;
};

const streamEnds = FIRST_TOKEN_MS + REPLY.split(' ').length * WORD_MS;
console.log(`modelo falso: primeira palavra em ${FIRST_TOKEN_MS} ms, a resposta termina em ~${streamEnds} ms`);

let before = null;
if (BEFORE) {
  const run = await measure(BEFORE);
  before = report('--- antes (esperava a resposta inteira) ---', run);
}
const run = await measure(NOW);
const now = report('--- agora ---', run);

console.log('\n--- o que conta ---');
const first = now[0];
const firstAnswer = now.find((s) => REPLY.includes(s.text.replace(/…$/, '')) && s.text.length > 3);
check('ele diz algo em menos de 1 s', first && first.ms < 1000, first ? `${first.ms} ms: "${first.text}"` : 'nada');
check('um "hum…" enquanto o modelo ainda não respondeu', first && first.ms < FIRST_TOKEN_MS && !REPLY.includes(first.text),
  first?.text);
check('a primeira frase da resposta começa antes de a resposta terminar',
  firstAnswer && firstAnswer.ms < streamEnds - 1000, firstAnswer ? `${firstAnswer.ms} ms (fim do stream em ${streamEnds})` : '');
check('a resposta inteira é dita, em ordem', now.filter((s) => REPLY.includes(s.text)).map((s) => s.text).join(' ') === REPLY,
  now.map((s) => s.text).join(' | '));
if (before) {
  const old = before.find((s) => s.text.length > 3);
  console.log(`\n    silêncio até a primeira palavra: antes ${old?.ms ?? '—'} ms → agora ${first?.ms} ms`);
  console.log(`    até a primeira frase da resposta: antes ${old?.ms ?? '—'} ms → agora ${firstAnswer?.ms} ms`);
}
// -- while you talk: "aham" in the breaths ------------------------------------

/**
 * The microphone plays the speech file -- four stretches of voice with a
 * second of silence between -- while words keep arriving as a recogniser's
 * interim results would. Each of those seconds is a breath, not the end of
 * a turn, and is where a listener says "aham".
 */
async function nods(port) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    class R { start() { window.__r = this; } stop() { this.onend?.(); } }
    window.SpeechRecognition = R;
    window.webkitSpeechRecognition = R;
    window.__spoken = [];
    const synth = {
      speaking: false,
      speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 300); },
      cancel() {}, pause() {}, resume() {}, getVoices: () => [],
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    localStorage.setItem('jarvis.settings.v1', JSON.stringify({
      providers: [{ id: 'p', name: 'x', url: 'http://127.0.0.1:59990', key: '', kind: 'openai', agent: false }],
      active: 'p', model: 'm', speak: true, wake: false,
    }));
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  await page.click('#live');
  const words = ('eu estava pensando em trocar de celular este ano mas não sei qual modelo escolher ' +
    'porque os preços subiram muito e a bateria do meu atual já não dura').split(' ');
  for (let i = 0; i < 90; i += 1) {
    await page.evaluate((text) => {
      const results = { 0: { 0: { transcript: text }, isFinal: false }, length: 1 };
      window.__r?.onresult?.({ resultIndex: 0, results });
    }, words.slice(0, 3 + i).join(' '));
    await page.waitForTimeout(200);
  }
  const said = await page.evaluate(() => window.__spoken);
  await browser.close();
  return said;
}

console.log('\n--- enquanto você fala ---');
const said = await nods(NOW);
console.log('    disse:', said.join(' · ') || 'nada');
const NOD_WORDS = ['Aham.', 'Hum.', 'Entendi.', 'Sei.', 'Ah, sim.', 'Certo.'];
check('um "aham" nas pausas curtas, com a voz real do arquivo no microfone', said.some((t) => NOD_WORDS.includes(t)));
check('nunca o mesmo duas vezes seguidas', said.every((t, i) => i === 0 || t !== said[i - 1]));

console.log('\nerros de console:', run.errors.length ? run.errors : 'nenhum');
if (run.errors.length) failures += 1;
model.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
