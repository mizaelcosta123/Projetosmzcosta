/**
 * The sentences the rules only half understood, settled by a decision model.
 *
 * Unit tests cover the client and the guards; what they cannot reach is the
 * wiring — that `ask()` really consults `/v1/decide` after the rules decline,
 * really builds the object from the answer, and really never asks on an
 * ordinary message. This drives the page the way a person does.
 *
 * The chat endpoint is a **closed port** on purpose: anything that reaches the
 * model fails, so a cube on the stage proves the decision model settled it.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/decide.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const KEY = 'jarvis.settings.v1';
const ENDPOINT = 'http://127.0.0.1:59994';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

/**
 * A page whose backend answers /v1/decide with `choice`, and nothing else.
 *
 * `asked` counts the calls, which is how "an ordinary message never waits for
 * a classifier" is checked rather than asserted.
 */
async function session({ choice = 'holograma', confidence = 0.93, available = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 } });
  const page = await ctx.newPage();
  const errors = [];
  const asked = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => m.type() === 'error'
    && !/WebSocket|404|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())
    && errors.push(m.text().slice(0, 200)));

  await page.route(`${ENDPOINT}/v1/decide`, (route) => {
    asked.push(JSON.parse(route.request().postData() ?? '{}').text);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        available
          ? { available: true, pedido: { choice, confidence, probabilities: { [choice]: confidence } } }
          : { available: false, reason: 'sem modelo de decisao' }
      ),
    });
  });

  await page.goto(UI, { waitUntil: 'networkidle' });
  await page.evaluate(([k, url]) => localStorage.setItem(k, JSON.stringify({
    providers: [{ id: 'p1', name: 'J', url, key: '', kind: 'jarvis', agent: true }],
    active: 'p1', model: '', speak: false, wake: false,
  })), [KEY, ENDPOINT]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  return { ctx, page, errors, asked };
}

const say = async (page, text) => {
  await page.fill('#prompt', text);
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(900);
};

const caption = (page) => page.$eval('#caption', (n) => n.textContent.trim());
/** The stage only comes up when there is something in the room to show, so
 *  "is it up?" is "was anything built?" without reaching into the page. */
const built = (page) => page.evaluate(() => {
  const holo = document.getElementById('holo');
  return !holo.hidden && holo.dataset.stage === 'on';
});

console.log('\na frase que as regras recusam, decidida em milissegundos');
{
  const { ctx, page, errors, asked } = await session({ choice: 'holograma' });
  await say(page, 'faz aí um cubo pirambeira pra mim');
  check('perguntou ao modelo de decisão', asked, ['faz aí um cubo pirambeira pra mim']);
  check('e o cubo apareceu, sem passar pelo modelo de conversa',
    [(await caption(page)).startsWith('Um cubo'), await built(page)], [true, true]);
  check('sem erro no console', errors, []);
  await ctx.close();
}

console.log('\numa frase que as regras entendem sozinhas não pergunta nada');
{
  const { ctx, page, asked } = await session();
  await say(page, 'cria um cubo');
  check('o caminho rápido respondeu', (await caption(page)).startsWith('Um cubo'), true);
  check('e ninguém foi consultado', asked, []);
  await ctx.close();
}

console.log('\numa mensagem comum nunca espera por um classificador');
{
  const { ctx, page, asked } = await session();
  await say(page, 'bom dia, tudo bem com você?');
  check('nada foi perguntado', asked, []);
  await ctx.close();
}

console.log('\n"conversa" deixa a frase seguir para o modelo, como antes');
{
  const { ctx, page, asked } = await session({ choice: 'conversa', confidence: 0.97 });
  // Not "o que é um cubo?": `teaching` reads that as being taught that "que"
  // means cubo, and answers before any of this runs. That is a bug in the
  // rules, older than this file and reported separately -- not something to
  // paper over here.
  await say(page, 'me explica o cubo aí direito');
  check('perguntou', asked.length, 1);
  check('e não desenhou nada', await built(page), false);
  await ctx.close();
}

console.log('\numa resposta insegura não desenha nada');
{
  const { ctx, page, asked } = await session({ choice: 'holograma', confidence: 0.55 });
  await say(page, 'faz aí um cubo pirambeira pra mim');
  check('perguntou', asked.length, 1);
  check('mas 0,55 não é uma decisão', await built(page), false);
  await ctx.close();
}

console.log('\nsem modelo de decisão no backend, pergunta uma vez e para');
{
  const { ctx, page, asked } = await session({ available: false });
  await say(page, 'faz aí um cubo pirambeira pra mim');
  await say(page, 'faz aí uma esfera pirambeira pra mim');
  check('uma pergunta, não duas', asked.length, 1);
  check('e nada foi desenhado', await built(page), false);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
