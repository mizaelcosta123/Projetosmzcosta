/**
 * Conjuring things by speaking, handling them with a finger on the stage,
 * and what the augmented-reality menu does on a browser with no camera.
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

console.log('\no palco: os objetos aparecem sem RA');
const stage = await page.evaluate(() => {
  const c = document.getElementById('holo');
  return { hidden: c.hidden, on: c.dataset.stage ?? null, bar: document.getElementById('holo-bar').hidden };
});
check('o canvas apareceu, no modo palco', [stage.hidden, stage.on], [false, 'on']);
check('com os controles', stage.bar, false);
/** Lit pixels on the hologram canvas, and where their centre is. */
async function lit() {
  return page.evaluate(() => {
    const c = document.getElementById('holo');
    const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let n = 0; let sx = 0; let sy = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 40) { n += 1; const p = (i - 3) / 4; sx += p % width; sy += Math.floor(p / width); }
    }
    return { n, x: n ? sx / n / (width / innerWidth) : 0, y: n ? sy / n / (height / innerHeight) : 0 };
  });
}
await page.waitForTimeout(200);
const drawn = await lit();
check('e desenhou algo de verdade', drawn.n > 200, true);
const composerHit = await page.evaluate(() => {
  const r = document.getElementById('prompt').getBoundingClientRect();
  return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id;
});
check('o campo de texto continua tocável por cima do palco', composerHit, 'prompt');

// The cube is on the right (x 0.6, z -1). Find it by the same maths the
// stage uses -- rebuilding the three things said so far and fitting the
// camera to them -- and drag it up the screen.
const at = await page.evaluate(async () => {
  const { toScreen, fit } = await import('./hands.js');
  const cube = { shape: 'cubo', x: 0.6, y: 0, z: -1, size: 0.45 };
  const others = [{ x: 0, y: 0, z: -1, size: 0.25 }, { x: 0, y: 0, z: -1, size: 0.25 }];
  const cam = fit([cube, ...others], innerWidth, innerHeight);
  return toScreen(cube, innerWidth, innerHeight, cam);
});
await page.mouse.move(at.x, at.y);
await page.mouse.down();
await page.waitForTimeout(80);
const held = await page.$eval('#caption', (n) => n.textContent.trim());
check('tocar segura o objeto', /^Segurando o cubo/.test(held), true);
for (let i = 1; i <= 8; i += 1) {
  await page.mouse.move(at.x - (at.x - 206) * (i / 8), at.y - 200 * (i / 8));
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(150);
const after = await lit();
check('arrastar levou o desenho junto (subiu)', after.y < drawn.y - 40, true);

// Double tap where the cube now is: it goes.
await page.mouse.click(206, at.y - 200);
await page.waitForTimeout(90);
await page.mouse.click(206, at.y - 200);
await page.waitForTimeout(150);
check('toque duplo apaga', (await page.$eval('#caption', (n) => n.textContent.trim())).startsWith('Apaguei o cubo'), true);
const fewer = await lit();
check('e some da tela', fewer.n === 0 || fewer.n < after.n, true);
check('mais um cubo, para o resto do teste', await say('cria um cubo azul grande à minha direita'), 'Um cubo.');

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
check('com nada na sala o palco sai', await page.$eval('#holo', (c) => [c.hidden, c.dataset.stage ?? null]), [true, null]);
check('e os controles dele também', await page.$eval('#holo-bar', (n) => n.hidden), true);

console.log('\nrealidade aumentada num navegador sem câmera nenhuma');
// The menu now opens the camera mode (tests-browser/lens.mjs covers it with
// a camera). With none at all, what matters is the same as before: a reason,
// and nothing left covering the screen.
await page.click('#more');
await page.click('[data-does="ar"]');
await page.waitForTimeout(600);
const excuse = await page.$eval('#caption', (n) => n.textContent.trim());
console.log('   ', excuse);
check('diz o motivo, e o motivo é a câmera', /câmera/i.test(excuse), true);
check('não deixou a câmera nem o painel dela por cima',
  await page.evaluate(() => [document.getElementById('lens').hidden, document.getElementById('lens-bar').hidden]), [true, true]);
check('nem o palco vazio', await page.$eval('#holo', (c) => c.hidden), true);
check('o campo de partículas continua vivo',
  await page.evaluate(() => Boolean(window.__field?._raf ?? true)), true);

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
