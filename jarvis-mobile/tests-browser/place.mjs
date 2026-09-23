/**
 * Location and weather, read off the request the model actually receives.
 *
 * Chromium is given a position (São Paulo, to six decimals), Open-Meteo and
 * the chat endpoint are stand-ins, and every check reads the body of
 * `/v1/chat/completions` -- not the screen -- because what matters is what
 * left the phone.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/place.mjs
 */

import { chromium } from 'playwright';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';
const MODEL = 'http://127.0.0.1:59997';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

const FORECAST = {
  current: { temperature_2m: 18.4, apparent_temperature: 17.2, relative_humidity_2m: 81,
    precipitation: 0.2, weather_code: 61, wind_speed_10m: 12.6 },
  daily: { time: ['a', 'b'], weather_code: [63, 2], temperature_2m_max: [21, 26],
    temperature_2m_min: [15, 15], precipitation_probability_max: [90, 10] },
};

async function session({ granted }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 880 },
    geolocation: { latitude: -23.550520, longitude: -46.633308, accuracy: 20 },
    permissions: granted ? ['geolocation'] : [],
  });
  const page = await ctx.newPage();
  const bodies = [];
  const weatherCalls = [];
  await page.route('https://api.open-meteo.com/**', (route) => {
    weatherCalls.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(FORECAST) });
  });
  await page.route(`${MODEL}/**`, (route) => {
    const request = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.url().endsWith('/v1/chat/completions')) {
      bodies.push(JSON.parse(request.postData() ?? '{}'));
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' },
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'Certo.' } }] })}\n\ndata: [DONE]\n\n` });
    }
    if (request.url().endsWith('/v1/models')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'm' }] }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await page.goto(UI, { waitUntil: 'networkidle' });
  await page.evaluate((url) => localStorage.setItem('jarvis.settings.v1', JSON.stringify({
    providers: [{ id: 'p1', name: 'M', url, key: '', kind: 'openai', agent: false, models: ['m'] }],
    active: 'p1', model: 'm', speak: false, wake: false,
  })), MODEL);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.getElementById('settings')?.close());
  const ask = async (text) => {
    const before = bodies.length;
    await page.fill('#prompt', text);
    await page.press('#prompt', 'Enter');
    for (let i = 0; i < 40 && bodies.length === before; i += 1) await page.waitForTimeout(100);
    await page.waitForTimeout(200);
    const body = bodies[bodies.length - 1];
    return (body?.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  };
  return { browser, ask, weatherCalls };
}

console.log('\ncom a localização liberada');
{
  const { browser, ask, weatherCalls } = await session({ granted: true });
  const rain = await ask('vai chover hoje?');
  check('a posição foi junto', /latitude -23\.55, longitude -46\.63/.test(rain), true);
  check('arredondada: os seis decimais não saíram', /-23\.5505|-46\.6333/.test(rain), false);
  check('com o tempo de lá', /chance de chuva 90%/.test(rain), true);
  check('e o Open-Meteo recebeu só dois decimais',
    weatherCalls.every((u) => u.includes('latitude=-23.55&') && u.includes('longitude=-46.63&')), true);
  const joke = await ask('me conta uma piada');
  check('numa pergunta sobre outra coisa, nada de posição', /latitude/.test(joke), false);
  const near = await ask('farmácia aqui perto');
  check('"aqui perto" leva a posição', /latitude -23\.55/.test(near), true);
  check('mas não busca o tempo', /Open-Meteo/.test(near), false);
  await browser.close();
}

console.log('\nsem a localização liberada');
{
  const { browser, ask, weatherCalls } = await session({ granted: false });
  const rain = await ask('vai chover hoje?');
  check('nenhuma posição saiu', /latitude/.test(rain), false);
  check('o modelo foi avisado para não inventar', /Não invente um lugar/.test(rain), true);
  check('e ninguém perguntou ao Open-Meteo', weatherCalls.length, 0);
  await browser.close();
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
