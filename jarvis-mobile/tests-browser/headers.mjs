/**
 * Whether the browser will even offer a permission prompt.
 *
 * This is the one bug in the project that is invisible in development and
 * total in production. A static file server sends no `Permissions-Policy`, so
 * the camera works on a laptop; a deployed OpenJarvis sends `camera=()`,
 * which is not "ask the user" but "no origin may use this, including this
 * one". The button then does nothing, `getUserMedia` rejects, and no dialog
 * appears — because the page was never permitted to ask.
 *
 * So the only honest test serves the real headers to a real browser.
 *
 *   node tests-browser/headers.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const WEB = path.resolve('web');
const PORT = Number(process.argv[2] ?? 8899);

// Exactly what each side sends, copied from the two sources of truth.
const BEFORE = {
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
};
const AFTER = JSON.parse(process.env.FIXED_HEADERS);

let headers = BEFORE;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(WEB, name);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'text/plain', ...headers });
  res.end(fs.readFileSync(file));
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  // Auto-accept, so what we measure is whether the browser *offers* at all.
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}${ok ? '' : `  (esperado ${want}, veio ${got})`}`);
};

/** Ask the browser for each thing, from inside the real page. */
async function tryAll(which) {
  headers = which;
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone', 'geolocation'],
    geolocation: { latitude: -23.55, longitude: -46.63 },
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  const out = await page.evaluate(async () => {
    const result = {};
    const ask = async (fn) => {
      try { await fn(); return 'ok'; } catch (e) { return e?.name ?? String(e); }
    };
    result.camera = await ask(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    });
    result.microphone = await ask(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    });
    result.geolocation = await new Promise((done) => {
      navigator.geolocation.getCurrentPosition(() => done('ok'), (e) => done(`code${e.code}`),
        { timeout: 5000 });
    });
    // And a blob: URL, which is how a camera still and a recorded clip are held.
    result.blob = await ask(async () => {
      const url = URL.createObjectURL(new Blob(['x'], { type: 'text/plain' }));
      const r = await fetch(url);
      await r.text();
      URL.revokeObjectURL(url);
    });
    return result;
  });
  await ctx.close();
  return out;
}

console.log('\ncom os cabeçalhos que o OpenJarvis manda hoje');
const before = await tryAll(BEFORE);
console.log('   ', before);
check('a câmera é recusada sem prompt', before.camera !== 'ok', true);
check('o microfone também', before.microphone !== 'ok', true);
check('e a localização também', before.geolocation !== 'ok', true);

console.log('\ncom a correção');
const after = await tryAll(AFTER);
console.log('   ', after);
check('a câmera abre', after.camera, 'ok');
check('o microfone abre', after.microphone, 'ok');
check('a localização responde', after.geolocation, 'ok');
check('um blob: pode ser lido', after.blob, 'ok');

// And what the panel itself says, which is where somebody actually looks.
console.log('\ne o que o painel diz, com os cabeçalhos de hoje');
{
  headers = BEFORE;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 },
    permissions: ['camera', 'microphone', 'geolocation'] });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  await page.click('#more');
  await page.click('[data-does="permissions"]');
  await page.waitForTimeout(700);
  const rows = await page.$$eval('.perms-row',
    (r) => r.map((x) => `${x.dataset.perm}=${x.dataset.state}`));
  console.log('   ', rows);
  check('a câmera acusa o servidor, não você', rows.includes('camera=blocked'), true);
  check('o microfone também', rows.includes('microphone=blocked'), true);
  check('e a localização também', rows.includes('geolocation=blocked'), true);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await ctx.close();
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
