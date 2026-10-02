/**
 * Any figure, from a model that has no tools: the ```holograma block, end to end.
 *
 * The "model" is a Playwright route answering /v1/chat/completions with a
 * stream, the way OpenRouter or an Ollama does. So what this proves is the
 * universal path: the format is asked for only when the room is involved,
 * the block never reaches the caption, the figure appears, and a second
 * reply redraws the same figure instead of adding one.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/forge.mjs
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

const CAR = {
  acao: 'criar', nome: 'carro', cor: 'vermelho',
  pecas: [
    { forma: 'cubo', pos: [0, 0.35, 0], escala: [2, 0.5, 1] },
    { forma: 'cilindro', pos: [0.6, 0, 0.5], escala: [0.4, 0.12, 0.4], rot: [90, 0, 0], cor: 'branco' },
  ],
};
const BIGGER_WHEELS = {
  acao: 'redesenhar', nome: 'carro',
  pecas: [CAR.pecas[0], { ...CAR.pecas[1], escala: [0.7, 0.2, 0.7] }],
};

/** A server-sent-events body that streams `text` in small pieces. */
function sse(text) {
  const pieces = text.match(/[\s\S]{1,12}/g) ?? [];
  return pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('')
    + 'data: [DONE]\n\n';
}

async function session(url, replies) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  const asked = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route(`${url}/**`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    if (!request.url().endsWith('/v1/chat/completions')) {
      route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}');
    asked.push({ headers: request.headers(), messages: body.messages });
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: sse(replies.shift() ?? 'Ok.'),
    });
  });
  await page.goto(UI, { waitUntil: 'networkidle' });
  await page.evaluate(([k, endpoint]) => localStorage.setItem(k, JSON.stringify({
    providers: [{ id: 'p1', name: 'M', url: endpoint, key: 'sk-test', kind: 'openai', agent: false }],
    active: 'p1', model: 'qualquer', speak: false, wake: false,
  })), [KEY, url]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  return { ctx, page, errors, asked };
}

const say = async (page, text) => {
  await page.fill('#prompt', text);
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(1200);
};
const caption = (page) => page.$eval('#caption', (n) => n.textContent.trim());
const built = (page) => page.evaluate(() => {
  const holo = document.getElementById('holo');
  return !holo.hidden && holo.dataset.stage === 'on';
});
const systemOf = (call) => call.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

console.log('\num carro pedido a um modelo sem ferramentas');
{
  const { ctx, page, errors, asked } = await session('http://127.0.0.1:59996', [
    `Montei um carro vermelho.\n\`\`\`holograma\n${JSON.stringify(CAR)}\n\`\`\``,
    `Rodas maiores.\n\`\`\`holograma\n${JSON.stringify(BIGGER_WHEELS)}\n\`\`\``,
  ]);
  await say(page, 'cria um holograma de um carro');
  check('o formato foi pedido', systemOf(asked[0]).includes('```holograma'), true);
  check('a legenda não mostra o JSON', (await caption(page)).includes('"pecas"'), false);
  check('e diz o que fez', (await caption(page)).includes('Um carro.'), true);
  check('o palco mostra', await built(page), true);

  await say(page, 'deixa as rodas do carro maiores');
  check('o modelo vê o que está na cena', systemOf(asked[1]).includes('"nome":"carro"'), true);
  check('redesenhou, não criou outro', (await caption(page)).includes('Redesenhei o carro.'), true);

  await say(page, 'gira o carro 90 graus');
  check('girar por graus não passa pelo modelo', asked.length, 2);
  check('e responde na hora', await caption(page), 'Girei 90 graus.');
  check('sem erro na página', errors, []);
  await ctx.close();
}

console.log('\numa conversa comum não paga pelo formato');
{
  const { ctx, page, asked } = await session('http://127.0.0.1:59996', ['Bom dia!']);
  await say(page, 'bom dia, tudo bem com você?');
  check('respondeu', asked.length, 1);
  check('sem o formato do holograma', systemOf(asked[0]).includes('```holograma'), false);
  await ctx.close();
}

console.log('\nOpenRouter recebe a identificação do app');
{
  const { ctx, page, asked } = await session('https://openrouter.ai/api', ['Oi.']);
  await say(page, 'oi');
  const headers = asked[0]?.headers ?? {};
  check('X-Title', headers['x-title'], 'Jarvis');
  check('HTTP-Referer é a página', headers['http-referer'], new URL(UI).origin);
  check('e a chave continua', headers.authorization, 'Bearer sk-test');
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
