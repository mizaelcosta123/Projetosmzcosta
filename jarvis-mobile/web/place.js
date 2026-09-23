/**
 * Where you are, and what the weather is doing there -- when it matters.
 *
 * The permissions panel has always offered location "para tempo, trajeto, o
 * que há por perto", and until this file nothing ever read it: granting it
 * changed nothing. That is worse than not asking, because it teaches people
 * that the switches here are decoration.
 *
 * Three rules keep this from becoming surveillance with a chat window:
 *
 *  1. **Only when the question is about a place or the weather.** A position
 *     riding along with every message would put your whereabouts in front of
 *     every provider you talk to, for questions about recipes.
 *  2. **Only when already granted.** `getCurrentPosition` on a page without
 *     permission *prompts*, and a permission prompt that appears because you
 *     asked about rain is a trap, not a feature. The panel is where it is
 *     asked for; here it is only read.
 *  3. **Rounded to two decimals** -- about a kilometre -- before it leaves the
 *     phone. Enough for weather and "what is near"; not enough for a door.
 *
 * Weather comes from Open-Meteo: no key, no account, free for this use, and
 * a GET that CSP's `connect-src *` already allows.
 */

import { fold } from './memory.js';

/** Things said when the answer depends on where you are. */
const PLACE = new RegExp(
  // Anchored at a word start: "vento" is inside "inventou", "rain" inside
  // "brain", and a false match here puts your position in a message about
  // neither.
  '\\b(?:' + [
    'onde (eu )?(estou|to|fica|tem|e o|e a|encontro|acho)\\b',
    'perto (de mim|daqui)', 'aqui perto', 'por aqui', 'mais proxim', 'nas proximidades',
    'minha localiza', 'minha posic', 'meu endere', 'que (bairro|cidade|rua)',
    'como (chego|chegar|vou)', 'rotas?\\b', 'trajeto', 'caminho (ate|para|pra)', 'distancia',
    'where am i', 'near me', 'nearby', 'directions', 'how (do i|to) get',
  ].join('|') + ')'
);

/** Things said when the answer is the weather. "tempo" alone is also time,
 *  so it only counts next to a word that makes it the sky. */
const WEATHER = new RegExp(
  '\\b(?:' + [
    'clima\\b', 'chov', 'chuva', 'garoa', 'temperatura', 'quantos graus', 'calor\\b', 'frio\\b',
    'guarda.?chuva', 'previsao', 'ventos?\\b', 'umidade', 'ensolarad', 'nublad', 'tempestade',
    'tempo (hoje|amanha|agora|la fora|ai|aqui|esta|vai|de hoje)', 'como (esta|ta) o tempo',
    'weather', 'rain(ing|y)?\\b', 'forecast', 'temperature', 'umbrella',
  ].join('|') + ')'
);

/** Does this message need to know where you are? */
export function aboutPlace(text) {
  return PLACE.test(fold(text));
}

/** Is this message about the weather? */
export function aboutWeather(text) {
  return WEATHER.test(fold(text));
}

/** Two decimals: about 1.1 km of latitude. */
export function coarse(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The position, if -- and only if -- it has already been granted.
 *
 * @returns {Promise<{lat: number, lon: number, accuracy: number}|null>}
 */
export async function position({ nav = globalThis.navigator, timeout = 8000 } = {}) {
  const geo = nav?.geolocation;
  if (!geo?.getCurrentPosition) return null;
  // Asking the Permissions API never prompts. Anything but a clear
  // "granted" -- prompt, denied, a browser that will not say -- is a no.
  let state = 'unknown';
  try {
    state = (await nav.permissions?.query({ name: 'geolocation' }))?.state ?? 'unknown';
  } catch {
    state = 'unknown';
  }
  if (state !== 'granted') return null;
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      ({ coords }) => resolve({
        lat: coarse(coords.latitude),
        lon: coarse(coords.longitude),
        accuracy: Math.round(coords.accuracy ?? 0),
      }),
      () => resolve(null),
      // Ten minutes old is fine for weather and for "near me", and it saves
      // waking the GPS for every question.
      { timeout, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false }
    );
  });
}

/** WMO weather codes, as Open-Meteo reports them, in Portuguese. */
export const SKY = {
  0: 'céu limpo', 1: 'quase limpo', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'neblina', 48: 'neblina com geada',
  51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte',
  56: 'garoa congelante', 57: 'garoa congelante forte',
  61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte',
  66: 'chuva congelante', 67: 'chuva congelante forte',
  71: 'neve fraca', 73: 'neve', 75: 'neve forte', 77: 'grãos de neve',
  80: 'pancadas de chuva fracas', 81: 'pancadas de chuva', 82: 'pancadas de chuva fortes',
  85: 'pancadas de neve', 86: 'pancadas de neve fortes',
  95: 'trovoada', 96: 'trovoada com granizo', 99: 'trovoada com granizo forte',
};

/** The request, built in one place so a test can read it. */
export function weatherUrl(lat, lon) {
  const query = new URLSearchParams({
    latitude: String(coarse(lat)),
    longitude: String(coarse(lon)),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '2',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

/**
 * The weather where you are. Null on any failure: the answer then comes
 * without it, which is better than an error about a side request.
 */
export async function weather(lat, lon, { fetchImpl = globalThis.fetch, timeout = 6000 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const response = await fetchImpl(weatherUrl(lat, lon), controller ? { signal: controller.signal } : {});
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const round = (value) => (Number.isFinite(value) ? Math.round(value) : '?');

/** Open-Meteo's answer, as a few lines a model can read. */
export function describeWeather(data) {
  const now = data?.current;
  if (!now) return '';
  const lines = [
    `Agora: ${SKY[now.weather_code] ?? 'tempo indefinido'}, ${round(now.temperature_2m)}°C ` +
      `(sensação ${round(now.apparent_temperature)}°C), umidade ${round(now.relative_humidity_2m)}%, ` +
      `vento ${round(now.wind_speed_10m)} km/h, precipitação ${now.precipitation ?? 0} mm.`,
  ];
  const daily = data.daily;
  const names = ['Hoje', 'Amanhã'];
  for (let i = 0; i < Math.min(2, daily?.time?.length ?? 0); i += 1) {
    lines.push(
      `${names[i]}: ${SKY[daily.weather_code?.[i]] ?? 'tempo indefinido'}, ` +
        `mínima ${round(daily.temperature_2m_min?.[i])}°C, máxima ${round(daily.temperature_2m_max?.[i])}°C, ` +
        `chance de chuva ${round(daily.precipitation_probability_max?.[i])}%.`
    );
  }
  return lines.join('\n');
}

/**
 * The system message for this question, or '' when it needs none.
 *
 * @param {string} text The message about to be sent.
 * @param {{locate?: () => Promise<object|null>, forecast?: (lat, lon) => Promise<object|null>,
 *          now?: () => Date}} [deps] Injectable for tests.
 */
export async function contextFor(text, {
  locate = () => position(),
  forecast = (lat, lon) => weather(lat, lon),
  now = () => new Date(),
} = {}) {
  const place = aboutPlace(text);
  const sky = aboutWeather(text);
  if (!place && !sky) return '';

  const here = await locate();
  if (!here) {
    // Said, so the model does not invent a city -- and so it can tell the
    // person where to switch it on, instead of guessing.
    return (
      'A pergunta depende de onde a pessoa está, mas a localização não está liberada ' +
      'para este app. Não invente um lugar: responda de forma geral ou peça a cidade, ' +
      'e mencione que dá para liberar em Configurações → Permissões → Localização.'
    );
  }

  const lines = [
    `Localização aproximada da pessoa (arredondada para ~1 km): ` +
      `latitude ${here.lat}, longitude ${here.lon}. Hora local: ${now().toLocaleString('pt-BR')}.`,
  ];
  if (sky) {
    const report = describeWeather(await forecast(here.lat, here.lon));
    lines.push(report
      ? `Tempo nesse lugar, pela Open-Meteo, agora mesmo:\n${report}`
      : 'Tentei buscar o tempo nesse lugar e não consegui; não invente números.');
  }
  return lines.join('\n');
}
