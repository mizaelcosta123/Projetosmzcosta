/**
 * Location and weather: when they ride along, and when they must not.
 *
 * The failures worth guarding are the quiet ones -- a position attached to a
 * message about recipes, a permission prompt fired because somebody asked
 * about rain, a precise coordinate leaving the phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SKY, aboutPlace, aboutWeather, coarse, contextFor, describeWeather, position, weather, weatherUrl,
} from '../web/place.js';

test('questions about the weather are recognised', () => {
  for (const text of [
    'vai chover amanhã?', 'como está o tempo lá fora', 'preciso de guarda-chuva?',
    'qual a temperatura agora', 'tá frio?', 'previsão pra hoje', "what's the weather", 'is it raining',
  ]) {
    assert.ok(aboutWeather(text), text);
  }
});

test('words that only contain a weather word are not about the weather', () => {
  /* "tempo" is also time; "vento" hides in "inventou", "rain" in "brain". */
  for (const text of [
    'quanto tempo falta pro natal', 'ele inventou uma história', 'brain training',
    'me explica o calorímetro', 'o frigorífico abriu', 'train schedule',
  ]) {
    assert.equal(aboutWeather(text), false, text);
  }
});

test('questions about where you are are recognised, and others are not', () => {
  for (const text of ['onde estou?', 'farmácia aqui perto', 'como chego no centro', 'restaurants near me']) {
    assert.ok(aboutPlace(text), text);
  }
  for (const text of ['me conta uma piada', 'a rotação da terra', 'onde está o erro nesse código']) {
    assert.equal(aboutPlace(text), false, text);
  }
});

test('coordinates are rounded to about a kilometre before they go anywhere', () => {
  assert.equal(coarse(-23.550520), -23.55);
  assert.equal(coarse(-46.633308), -46.63);
  const url = new URL(weatherUrl(-23.550520, -46.633308));
  assert.equal(url.searchParams.get('latitude'), '-23.55');
  assert.equal(url.searchParams.get('longitude'), '-46.63');
  assert.equal(url.host, 'api.open-meteo.com');
});

// -- the position ------------------------------------------------------------

function fakeNav(state, coords = { latitude: -23.550520, longitude: -46.633308, accuracy: 30 }) {
  const calls = { position: 0 };
  return {
    calls,
    permissions: { query: async () => ({ state }) },
    geolocation: {
      getCurrentPosition(ok) {
        calls.position += 1;
        ok({ coords });
      },
    },
  };
}

test('the position is read only when already granted', async () => {
  const nav = fakeNav('granted');
  assert.deepEqual(await position({ nav }), { lat: -23.55, lon: -46.63, accuracy: 30 });
});

test('it never prompts: "prompt", "denied" or silence mean no call at all', async () => {
  /* getCurrentPosition is what draws the prompt, so it must not even run. */
  for (const state of ['prompt', 'denied']) {
    const nav = fakeNav(state);
    assert.equal(await position({ nav }), null, state);
    assert.equal(nav.calls.position, 0, `${state}: não chamou`);
  }
  const silent = fakeNav('granted');
  silent.permissions = { query: async () => { throw new TypeError('unknown name'); } };
  assert.equal(await position({ nav: silent }), null);
  assert.equal(silent.calls.position, 0);
});

// -- the weather -------------------------------------------------------------

const SAMPLE = {
  current: {
    temperature_2m: 18.4, apparent_temperature: 17.2, relative_humidity_2m: 81,
    precipitation: 0.2, weather_code: 61, wind_speed_10m: 12.6,
  },
  daily: {
    time: ['2026-09-23', '2026-09-24'],
    weather_code: [63, 2],
    temperature_2m_max: [21.2, 25.9],
    temperature_2m_min: [15.1, 14.8],
    precipitation_probability_max: [90, 10],
  },
};

test('the report reads like a forecast, in Portuguese', () => {
  const text = describeWeather(SAMPLE);
  assert.match(text, /Agora: chuva fraca, 18°C \(sensação 17°C\), umidade 81%, vento 13 km\/h/);
  assert.match(text, /Hoje: chuva, mínima 15°C, máxima 21°C, chance de chuva 90%/);
  assert.match(text, /Amanhã: parcialmente nublado, mínima 15°C, máxima 26°C, chance de chuva 10%/);
  assert.equal(describeWeather(null), '');
});

test('every code Open-Meteo documents has a name', () => {
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
    assert.ok(SKY[code], String(code));
  }
});

test('a weather service that fails costs nothing but the weather', async () => {
  assert.equal(await weather(0, 0, { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await weather(0, 0, { fetchImpl: async () => { throw new TypeError('offline'); } }), null);
});

// -- what goes to the model --------------------------------------------------

test('nothing rides along with a question about neither', async () => {
  let asked = false;
  const context = await contextFor('me conta uma piada', { locate: async () => { asked = true; return null; } });
  assert.equal(context, '');
  assert.equal(asked, false, 'nem perguntou a posição');
});

test('a weather question carries the place and the forecast', async () => {
  const context = await contextFor('vai chover hoje?', {
    locate: async () => ({ lat: -23.55, lon: -46.63 }),
    forecast: async () => SAMPLE,
    now: () => new Date('2026-09-23T15:00:00Z'),
  });
  assert.match(context, /latitude -23\.55, longitude -46\.63/);
  assert.match(context, /chance de chuva 90%/);
});

test('a place question carries the place but does not fetch the weather', async () => {
  let fetched = false;
  const context = await contextFor('farmácia aqui perto', {
    locate: async () => ({ lat: 1, lon: 2 }),
    forecast: async () => { fetched = true; return SAMPLE; },
  });
  assert.match(context, /latitude 1, longitude 2/);
  assert.equal(fetched, false);
});

test('without the permission the model is told not to invent a place', async () => {
  const context = await contextFor('vai chover?', { locate: async () => null });
  assert.match(context, /Não invente um lugar/);
  assert.match(context, /Configurações → Permissões → Localização/);
});

test('a forecast that failed is said, so no numbers are made up', async () => {
  const context = await contextFor('qual a temperatura', {
    locate: async () => ({ lat: 1, lon: 2 }),
    forecast: async () => null,
  });
  assert.match(context, /não invente números/);
});
