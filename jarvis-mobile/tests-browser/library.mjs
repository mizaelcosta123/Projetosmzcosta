/**
 * The vault, the skills and the free APIs, in the real page.
 *
 * The "model" is a Playwright route that records each request and answers
 * from a script; the API is a route too. So this proves the wiring a unit
 * test cannot: a fact taught by voice reaches the next request, the right
 * recipe rides along with the right request and none with chat, and an
 * ```api block becomes a call and a second request carrying its result --
 * with no block ever on screen.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/library.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const MODEL = 'http://127.0.0.1:59998';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

const asked = [];
const replies = [];
await page.route(`${MODEL}/**`, (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (!route.request().url().endsWith('/v1/chat/completions')) return route.fulfill({ status: 404, headers: cors, body: '' });
  asked.push(JSON.parse(route.request().postData() ?? '{}').messages);
  return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: cors, body: sse(replies.shift() ?? 'Ok.') });
});
const apiCalls = [];
await page.route('https://brasilapi.com.br/**', (route) => {
  apiCalls.push(route.request().url());
  route.fulfill({
    status: 200, contentType: 'application/json', headers: cors,
    body: JSON.stringify({ cep: '01001000', street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' }),
  });
});

await page.goto(UI, { waitUntil: 'networkidle' });
await page.evaluate((url) => localStorage.setItem('jarvis.settings.v1', JSON.stringify({
  providers: [{ id: 'p', name: 'M', url, key: '', kind: 'openai', agent: false }],
  active: 'p', model: 'm', speak: false, wake: false,
})), MODEL);
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

const say = async (text) => {
  await page.fill('#prompt', text);
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(1300);
};
const caption = () => page.$eval('#caption', (n) => n.textContent.trim());
const systemOf = (messages) => (messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');

console.log('\num fato ensinado por voz chega à próxima pergunta');
await say('aprenda isso: o código do portão da garagem é 4321');
check('guardou sem chamar o modelo', [await caption(), asked.length], ['Guardado no vault de conhecimento.', 0]);
await say('qual é o código do portão da garagem?');
check('o trecho foi junto da pergunta', systemOf(asked[0]).includes('4321'), true);

console.log('\na habilidade certa vai com o pedido certo');
await say('escreve um email formal pro meu chefe pedindo folga na sexta');
check('a receita do e-mail formal', systemOf(asked[1]).includes('## E-mail formal'), true);

console.log('\nconversa comum não paga nada');
await say('bom dia, tudo bem?');
check('sem vault, habilidade nem API', /vault|## |```api/.test(systemOf(asked[2])), false);

console.log('\numa pergunta que precisa de dado vira consulta e segunda rodada');
replies.push('```api\n{"api":"cep","params":{"cep":"01001-000"}}\n```', 'Fica na Praça da Sé, em São Paulo.');
await say('qual o endereço do cep 01001-000?');
await page.waitForTimeout(800);
check('a primeira rodada ofereceu a API', systemOf(asked[3]).includes('cep —'), true);
check('a API foi chamada com o CEP limpo', apiCalls, ['https://brasilapi.com.br/api/cep/v2/01001000']);
const second = asked[4] ?? [];
check('a segunda rodada levou o resultado', second.some((m) => m.role === 'user' && m.content.includes('Praça da Sé')), true);
check('e não ofereceu a API de novo', systemOf(second).includes('responda SOMENTE com um bloco'), false);
check('a legenda é a resposta, sem bloco', await caption(), 'Fica na Praça da Sé, em São Paulo.');

console.log('\no painel de Conhecimento');
await page.click('#menu');
await page.waitForTimeout(500);
check('mostra o que foi guardado', (await page.$eval('#knowledge-state', (n) => n.textContent)).includes('1 documento'), true);
check('e conta as habilidades', /\d{3} habilidades/.test(await page.$eval('#skills-state', (n) => n.textContent)), true);
await page.fill('#knowledge-paste', 'A academia abre às 6h e fecha às 22h, menos domingo.');
await page.click('#knowledge-save');
await page.waitForTimeout(300);
check('guardar texto colado', (await page.$eval('#knowledge-state', (n) => n.textContent)).startsWith('Guardei 1 trecho'), true);
await page.fill('#knowledge-search', 'academia domingo');
await page.waitForTimeout(200);
check('buscar no vault', (await page.$eval('#knowledge-list', (n) => n.textContent)).includes('academia abre'), true);

console.log('\nsobrevive a recarregar');
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await say('que horas a academia abre?');
check('o vault veio do IndexedDB', systemOf(asked[asked.length - 1]).includes('6h'), true);

check('sem erro na página', errors, []);
await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
