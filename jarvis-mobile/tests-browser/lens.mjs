/**
 * The camera mode, with a real hand model reading a real hand.
 *
 * Chromium's fake camera is fed a photo of a hand (an MJPEG made by repeating
 * the JPEG), the page is served with the server's real security headers --
 * so the CSP has to let the model's library in, or nothing works -- and the
 * MediaPipe files are served from a local copy of the npm package in place of
 * jsDelivr and Google's model bucket, which this machine cannot reach.
 *
 *   npm pack @mediapipe/tasks-vision@1.0.1 && tar xzf mediapipe-*.tgz   # -> package/
 *   curl -O https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
 *   MEDIAPIPE=path/to/package MODEL=path/to/hand_landmarker.task HAND=path/to/hand.jpg \
 *     node tests-browser/lens.mjs
 *
 * SHOT=/tmp/lens.png saves what the screen looked like with the hand on it.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const WEB = resolve('web');
const PACKAGE = process.env.MEDIAPIPE;
const MODEL = process.env.MODEL;
const HAND = process.env.HAND;
if (!PACKAGE || !MODEL || !HAND) {
  console.log('Faltam MEDIAPIPE, MODEL e HAND — veja o cabeçalho deste arquivo.');
  process.exit(2);
}

// The server's own headers, from the one place they are defined.
const HEADERS = JSON.parse(execFileSync(process.env.PYTHON ?? '.venv/bin/python', ['-c',
  'import json; from jarvis_mobile.webheaders import PERMISSIONS_POLICY as P, CONTENT_SECURITY_POLICY as C; ' +
  'print(json.dumps({"Permissions-Policy": P, "Content-Security-Policy": C}))']).toString());

// A camera that shows the hand: the same JPEG, back to back, is an MJPEG.
const dir = mkdtempSync(join(tmpdir(), 'jarvis-lens-'));
const mjpeg = join(dir, 'hand.mjpeg');
const jpeg = readFileSync(HAND);
writeFileSync(mjpeg, Buffer.concat(Array.from({ length: 30 }, () => jpeg)));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
let headers = HEADERS;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    const file = join(WEB, path === '/' ? 'index.html' : path);
    const body = readFileSync(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, headers).end();
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const UI = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

async function session({ library = true } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    headless: false,
    args: ['--headless=new', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${mjpeg}`],
  });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, serviceWorkers: 'block' });
  await ctx.grantPermissions(['camera'], { origin: UI });
  const page = await ctx.newPage();
  // Listen to what the synthesizer actually outputs: every analyser the page
  // makes is kept where the test can read it. The app has no hook for this;
  // the test wraps the browser's own API before the page loads.
  await page.addInitScript(() => {
    const make = AudioContext.prototype.createAnalyser;
    window.__analysers = [];
    AudioContext.prototype.createAnalyser = function wrapped() {
      const node = make.call(this);
      window.__analysers.push(node);
      return node;
    };
    window.__peak = () => {
      const a = window.__analysers.at(-1);
      if (!a || a.context.state === 'closed') return 0;
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      return buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    };
    window.__rms = () => {
      const a = window.__analysers.at(-1);
      if (!a || a.context.state === 'closed') return 0;
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      return Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const blocked = [];
  page.on('console', (m) => /Content Security Policy/.test(m.text()) && blocked.push(m.text().slice(0, 160)));

  await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@*/**', (route) => {
    if (!library) return route.abort('connectionrefused');
    const rest = new URL(route.request().url()).pathname.replace(/^\/npm\/@mediapipe\/tasks-vision@[^/]+\//, '');
    try {
      route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': TYPES[extname(rest)] ?? 'application/octet-stream' },
        body: readFileSync(join(PACKAGE, rest)) });
    } catch {
      route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('https://storage.googleapis.com/mediapipe-models/**', (route) =>
    route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(MODEL) }));
  // Nothing to talk to; the camera mode needs no model endpoint.
  await page.route('http://127.0.0.1:59995/**', (route) => route.abort('connectionrefused'));

  await page.goto(UI, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('jarvis.settings.v1', JSON.stringify({
    providers: [{ id: 'p1', name: 'X', url: 'http://127.0.0.1:59995', key: '', kind: 'openai', agent: false }],
    active: 'p1', model: '', speak: false, wake: false,
  })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  return { browser, page, errors, blocked };
}

const status = (page) => page.$eval('#lens-status', (n) => n.textContent);

/** Pixels on the hand overlay in each finger's colour. */
const colours = (page) => page.evaluate(() => {
  const c = document.getElementById('lens-hands');
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const want = { polegar: [255, 43, 214], indicador: [43, 89, 255], medio: [34, 224, 74], anelar: [255, 230, 0], minimo: [255, 45, 45] };
  const count = Object.fromEntries(Object.keys(want).map((k) => [k, 0]));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    for (const [name, [r, g, b]] of Object.entries(want)) {
      if (Math.abs(data[i] - r) < 30 && Math.abs(data[i + 1] - g) < 30 && Math.abs(data[i + 2] - b) < 30) count[name] += 1;
    }
  }
  return count;
});

console.log('\na realidade aumentada abre a câmera');
{
  const { browser, page, errors, blocked } = await session();
  await page.click('#more');
  await page.click('[data-does="ar"]');
  await page.waitForTimeout(800);
  const open = await page.evaluate(() => ({
    lens: !document.getElementById('lens').hidden,
    bar: !document.getElementById('lens-bar').hidden,
    video: document.getElementById('lens-video').videoWidth > 0,
    stage: document.getElementById('holo').dataset.stage ?? null,
  }));
  check('a câmera está na tela, com o vídeo rodando', [open.lens, open.bar, open.video], [true, true, true]);
  check('o palco dos hologramas está por cima, mesmo vazio', open.stage, 'on');

  console.log('\no modelo de mãos, pelos cabeçalhos reais do servidor');
  for (let i = 0; i < 90 && !/Mãos prontas|não/.test(await status(page)); i += 1) await page.waitForTimeout(500);
  const ready = await status(page);
  console.log('   ', ready);
  check('carregou', /^Mãos prontas/.test(ready), true);
  check('o CSP não barrou nada', blocked, []);

  console.log('\na mão da foto');
  let seen = { polegar: 0 };
  for (let i = 0; i < 40; i += 1) {
    seen = await colours(page);
    if (Object.values(seen).every((n) => n > 30)) break;
    await page.waitForTimeout(250);
  }
  console.log('    pixels por dedo:', JSON.stringify(seen));
  check('os cinco dedos desenhados, cada um na sua cor', Object.values(seen).every((n) => n > 30), true);
  const pose = await page.$eval('#lens-pose', (n) => n.textContent);
  console.log('    pose:', pose);
  check('lida como mão aberta', pose, 'mão aberta');
  if (process.env.SHOT) {
    await page.screenshot({ path: process.env.SHOT });
    console.log('    captura em', process.env.SHOT);
  }

  console.log('\ncriar por voz com a câmera aberta');
  await page.fill('#prompt', 'uma esfera roxa');
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(400);
  const lit = await page.evaluate(() => {
    const c = document.getElementById('holo');
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 40) n += 1;
    return n;
  });
  check('a esfera aparece sobre a câmera', lit > 200, true);

  console.log('\no sintetizador, tocado pela mão da foto');
  await page.click('#lens-synth');
  let rms = 0;
  for (let i = 0; i < 20 && rms < 0.01; i += 1) {
    await page.waitForTimeout(150);
    rms = await page.evaluate(() => window.__rms());
  }
  const note = await page.$eval('#lens-note', (n) => n.textContent);
  console.log(`    ${note}  ·  RMS ${rms.toFixed(3)}`);
  check('ligado', await page.$eval('#lens-synth', (b) => b.getAttribute('aria-pressed')), 'true');
  check('uma nota da escala na tela', /^♪ (Dó|Ré|Mi|Fá|Sol|Lá|Si)♯? \d$/.test(note), true);
  check('e som saindo de verdade (medido na saída)', rms > 0.01, true);
  let peak = 0;
  for (let i = 0; i < 12; i += 1) {
    peak = Math.max(peak, await page.evaluate(() => window.__peak()));
    await page.waitForTimeout(60);
  }
  console.log(`    pico ${peak.toFixed(3)}`);
  check('sem distorcer: o pico nunca chega ao teto', peak < 0.95, true);
  if (process.env.SHOT) {
    await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-synth.png') });
  }
  await page.click('#lens-synth');
  await page.waitForTimeout(400);
  check('desligado: silêncio, e a nota some',
    [await page.evaluate(() => window.__rms()), await page.$eval('#lens-note', (n) => n.textContent)], [0, '']);

  console.log('\npousar na palma (a ideia da Hand-Detection-AR)');
  // The open hand in the photo stays put; drag the sphere onto its palm with
  // a finger on the glass, and hold still.
  const palm = await page.evaluate(() => {
    const c = document.getElementById('lens-hands');
    const { data, width } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    // The cursor ring is drawn in #7dd3fc around the palm; find its centre.
    let n = 0; let sx = 0; let sy = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - 125) < 12 && Math.abs(data[i + 1] - 211) < 12 && Math.abs(data[i + 2] - 252) < 12 && data[i + 3] > 200) {
        n += 1; sx += (i / 4) % width; sy += Math.floor(i / 4 / width);
      }
    }
    const ratio = c.width / innerWidth;
    return n ? { x: sx / n / ratio, y: sy / n / ratio } : null;
  });
  const sphere = await page.evaluate(async () => {
    const { toScreen, fit } = await import('./hands.js');
    const item = { x: 0, y: 0, z: -1, size: 0.25 };
    return toScreen(item, innerWidth, innerHeight, fit([item], innerWidth, innerHeight));
  });
  check('achei a palma pelo cursor', Boolean(palm), true);
  if (palm) {
    await page.mouse.move(sphere.x, sphere.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(sphere.x + (palm.x - sphere.x) * i / 10, sphere.y + (palm.y - sphere.y) * i / 10);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    let rested = '';
    for (let i = 0; i < 20 && !/pousou/.test(rested); i += 1) {
      await page.waitForTimeout(150);
      rested = await status(page);
    }
    console.log('   ', rested);
    check('a esfera pousou na mão', /esfera pousou na sua mão/.test(rested), true);
    check('e o rótulo diz "na palma"', await page.$eval('#lens-pose', (n) => n.textContent), 'na palma');
  }

  console.log('\nsair');
  await page.click('#lens-close');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => ({
    lens: document.getElementById('lens').hidden,
    stream: document.getElementById('lens-video').srcObject === null,
    stage: !document.getElementById('holo').hidden,
  }));
  check('a câmera fechou e foi desligada', [closed.lens, closed.stream], [true, true]);
  check('a esfera continua no palco, sem a câmera', closed.stage, true);
  console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
  if (errors.length) failures += 1;
  await browser.close();
}

console.log('\nsem conseguir baixar o modelo');
{
  const { browser, page, errors } = await session({ library: false });
  await page.click('#more');
  await page.click('[data-does="ar"]');
  for (let i = 0; i < 20 && !/baixar|carregou|servidor/.test(await status(page)); i += 1) await page.waitForTimeout(300);
  const said = await status(page);
  console.log('   ', said);
  check('diz o que aconteceu', /Não consegui baixar o rastreamento de mãos/.test(said), true);
  check('e a câmera continua aberta', await page.evaluate(() => !document.getElementById('lens').hidden), true);
  if (errors.length) { failures += 1; console.log('erros:', errors); }
  await browser.close();
}

console.log('\num backend com o cabeçalho de antes deste recurso');
{
  // What a phone sees when the interface updated and the backend was not
  // redeployed: the old policy, which does not name the library.
  headers = { ...HEADERS, 'Content-Security-Policy': HEADERS['Content-Security-Policy'].replace(' https://cdn.jsdelivr.net/npm/@mediapipe/', '') };
  const { browser, page } = await session();
  await page.click('#more');
  await page.click('[data-does="ar"]');
  for (let i = 0; i < 20 && !/baixar|servidor|carregou/.test(await status(page)); i += 1) await page.waitForTimeout(300);
  const said = await status(page);
  console.log('   ', said);
  check('culpa o cabeçalho e manda fazer o deploy — não a conexão', /Manual Deploy/.test(said), true);
  await browser.close();
  headers = HEADERS;
}

server.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
