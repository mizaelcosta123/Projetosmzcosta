/**
 * Free public APIs the model can ask for, from any endpoint.
 *
 * The same trick as the hologram block, and for the same reason: talking
 * straight to OpenRouter or to an Ollama in Termux there is no tool calling
 * to speak of, but every model can write a fenced block. So the model is
 * shown the few APIs that fit the question, answers with
 *
 *     ```api
 *     {"api": "cep", "params": {"cep": "01001000"}}
 *     ```
 *
 * and the app makes the call, cuts the answer down to what matters, and asks
 * the model again with the result in hand. A model that would have guessed
 * an address, a price or a forecast now reads it.
 *
 * Only APIs with no key and with CORS open, so the browser can call them
 * directly: nothing goes through a server of ours, and nothing needs signing
 * up. The catalogue is data (`apis.json`); adding an API is adding an entry.
 *
 * What leaves the phone: the parameters, to the one API chosen, over https.
 * Never a key, never the conversation.
 */

import { dot, embed, fold } from './memory.js';
import { focus } from './knowledge.js';

/** Calls per question. A loop of model → API → model must end. */
export const MOST_CALLS = 3;
/** Each call's patience. A slow API is a missing one. */
export const TIMEOUT = 6000;
/** What one result may cost in the second request. */
export const RESULT_BUDGET = 2000;
/** Below this, an API is only sharing a word with the question. */
export const FLOOR = 0.4;
/** And close to the best one: a far second only costs tokens. */
export const NEAR = 0.6;
/** How many are described to the model at once. */
export const SHOWN = 4;

/** A question about a thing, a person, a place or an event. */
const QUESTION = /^\s*(quem (foi|e|era|inventou|descobriu|criou|escreveu)|o que (foi|e|era|significa)|quando (foi|aconteceu|nasceu|morreu)|onde (fica|nasceu)|qual (foi|e) (a|o) (historia|origem))\b/;

/** The fence languages that mean "call this". */
const LANGUAGES = new Set(['api', 'consulta', 'chamada']);

/** Fenced blocks, as `preview.js` reads them -- inlined to keep this file standalone. */
function blocks(reply) {
  const out = [];
  const fence = /```([\w+-]*)[^\S\n]*\n([\s\S]*?)```/g;
  let match = fence.exec(String(reply ?? ''));
  while (match !== null) {
    out.push({ language: match[1].toLowerCase(), code: match[2] });
    match = fence.exec(String(reply ?? ''));
  }
  return out;
}

/** Check one catalogue entry. Null when it could not be called safely. */
export function validate(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(entry.id)) return null;
  if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) return null;
  if (/[?&](api_?key|key|token|apikey)=/i.test(entry.url)) return null;
  if (!entry.quando || !entry.nome) return null;
  return {
    id: entry.id,
    nome: String(entry.nome),
    quando: String(entry.quando),
    url: entry.url,
    params: entry.params && typeof entry.params === 'object' ? entry.params : {},
    cidade: Boolean(entry.cidade),
    campos: Array.isArray(entry.campos) ? entry.campos.map(String) : [],
    exemplo: entry.exemplo ?? { api: entry.id, params: {} },
    espacos: entry.espacos ?? null,
    nota: entry.nota ?? '',
    limite: entry.limite ?? '',
    exemplos: Array.isArray(entry.exemplos) ? entry.exemplos.map(String).slice(0, 12) : [],
  };
}

/** Clean a parameter the way its entry says, then check it against its pattern. */
function clean(value, spec) {
  let text = String(value ?? '').trim();
  if (spec.limpar === 'digitos') text = text.replace(/\D/g, '');
  if (spec.limpar === 'maiusculas') text = text.toUpperCase().replace(/\s+/g, '');
  if (spec.limpar === 'minusculas') text = text.toLowerCase().replace(/\s+/g, '');
  if (spec.limpar === 'sem_acento') text = fold(text).replace(/[^a-z]/g, '');
  if (spec.padrao && !new RegExp(spec.padrao).test(text)) return null;
  return text;
}

/**
 * The URL for a call, or an error saying which parameter is wrong.
 *
 * Every value is checked against its entry's pattern and then encoded: a
 * model's parameter goes into a path or a query string, and nothing it writes
 * may turn into a different path or a second host.
 *
 * @returns {{url: string}|{error: string}}
 */
export function buildUrl(entry, params = {}) {
  const values = {};
  for (const [name, spec] of Object.entries(entry.params)) {
    const given = params?.[name];
    if (given === undefined || given === null || given === '') {
      if (spec.valor_padrao !== undefined) {
        values[name] = spec.valor_padrao;
        continue;
      }
      if (spec.obrigatorio === false) {
        values[name] = '';
        continue;
      }
      return { error: `falta o parâmetro "${name}" (${spec.descricao})` };
    }
    const ok = clean(given, spec);
    if (ok === null) return { error: `"${name}" inválido: ${spec.descricao}` };
    values[name] = ok;
  }
  const url = entry.url.replace(/\{(\w+)\}/g, (_, name) => {
    const raw = values[name] ?? '';
    const spaced = entry.espacos ? raw.replace(/\s+/g, entry.espacos) : raw;
    return encodeURIComponent(spaced);
  });
  return { url };
}

/**
 * Pick values out of a JSON answer by path: `a.b`, `list[].name`, `[].x`,
 * and `*.x` for every key of an object. Arrays are cut to the first 8.
 */
export function pluck(data, path) {
  const steps = path.split('.').flatMap((step) => {
    if (step === '[]') return ['[]'];
    if (step.endsWith('[]')) return [step.slice(0, -2), '[]'].filter(Boolean);
    return [step];
  });
  let values = [data];
  for (const step of steps) {
    const next = [];
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (step === '[]') {
        if (Array.isArray(value)) next.push(...value.slice(0, 8));
      } else if (step === '*') {
        if (typeof value === 'object') next.push(...Object.values(value).slice(0, 8));
      } else if (typeof value === 'object' && step in value) {
        next.push(value[step]);
      }
    }
    values = next;
  }
  return values;
}

/** The useful part of an answer, as compact text within the budget. */
export function summarize(entry, data, budget = RESULT_BUDGET) {
  let text;
  if (entry.campos.length) {
    const lines = [];
    for (const path of entry.campos) {
      const found = pluck(data, path).filter((v) => v !== undefined && v !== null && v !== '');
      if (!found.length) continue;
      const shown = found.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)));
      lines.push(`${path}: ${shown.join(' | ')}`);
    }
    text = lines.join('\n');
  }
  if (!text) text = JSON.stringify(data);
  if (entry.nota) text += `\n(nota: ${entry.nota})`;
  return text.length > budget ? `${text.slice(0, budget)}…` : text;
}

/** The ```api blocks in a reply, read. A block that is not JSON is dropped. */
export function parseCalls(reply) {
  const calls = [];
  for (const block of blocks(reply)) {
    if (!LANGUAGES.has(block.language)) continue;
    let data;
    try {
      data = JSON.parse(block.code);
    } catch {
      continue;
    }
    for (const row of Array.isArray(data) ? data : [data]) {
      if (row && typeof row.api === 'string') {
        calls.push({ api: row.api.trim().toLowerCase(), params: row.params && typeof row.params === 'object' ? row.params : {} });
      }
    }
  }
  return calls;
}

/** Does this reply ask for a call, readable or not? */
export function asksForCall(reply) {
  return blocks(reply).some((block) => LANGUAGES.has(block.language));
}

export class Apis {
  /** @param {Array<object>} catalogue Entries as in `apis.json`. */
  constructor(catalogue = []) {
    this.list = catalogue.map(validate).filter(Boolean);
    this.byId = new Map(this.list.map((entry) => [entry.id, entry]));
    // One key per way of asking, and the best one counts: a question sounds
    // like one example, not like the average of a description.
    this.keys = this.list.map((entry) => [`${entry.nome}. ${entry.quando}`, ...entry.exemplos].map(embed));
  }

  /** The APIs that fit this question, best first. Empty for most messages. */
  pick(text, { count = SHOWN, floor = FLOOR } = {}) {
    const subject = focus(text);
    if (!this.list.length || !subject) return [];
    const query = embed(subject);
    return this.list
      .map((entry, i) => ({ entry, score: Math.max(...this.keys[i].map((key) => dot(query, key))) }))
      .filter(({ score }) => score >= floor)
      .sort((a, b) => b.score - a.score)
      .filter(({ score }, _, all) => score >= all[0].score * NEAR)
      .slice(0, count);
  }

  /**
   * The system message describing the APIs for this question, or ''.
   *
   * A question about who or what something is matches no example by its
   * words -- "quem foi Santos Dumont" shares nothing with any of them -- and
   * it is exactly what the encyclopedia is for. So a question that picked
   * nothing is offered the Wikipedia pair.
   */
  contextFor(text, options) {
    let picked = this.pick(text, options);
    if (!picked.length && QUESTION.test(fold(text))) {
      picked = ['wikipedia', 'wikipedia-busca'].map((id) => this.byId.get(id)).filter(Boolean).map((entry) => ({ entry, score: 0 }));
    }
    if (!picked.length) return '';
    const lines = [
      'Você pode consultar APIs públicas gratuitas. Se a pergunta precisar de um dado atual ou exato que uma delas tem, ' +
      'responda SOMENTE com um bloco ```api contendo {"api": id, "params": {...}} (pode ser uma lista de até 3) e nada mais; ' +
      'o app faz a consulta e te devolve o resultado para você responder. Se não precisar, responda normalmente.',
    ];
    for (const { entry } of picked) {
      const params = Object.entries(entry.params)
        .map(([name, spec]) => `${name}${spec.obrigatorio === false ? '?' : ''}: ${spec.descricao}`)
        .join('; ');
      const city = entry.cidade ? ' (em vez de lat/lon, pode mandar "cidade")' : '';
      lines.push(`- ${entry.id} — ${entry.nome}. Para: ${entry.quando}. Parâmetros: ${params || 'nenhum'}${city}. Exemplo: ${JSON.stringify(entry.exemplo)}`);
    }
    return lines.join('\n');
  }

  /**
   * Make one call. Never throws: a failure is a result saying so, which the
   * model is then told to report instead of inventing an answer.
   *
   * An entry marked `cidade` takes a city name instead of coordinates, found
   * with the geocoding entry first -- so "o tempo em Recife" is one block
   * from the model, not two rounds.
   *
   * @returns {Promise<{api: string, ok: boolean, text: string, nome: string}>}
   */
  async call({ api, params = {} }, { fetchImpl = globalThis.fetch, timeout = TIMEOUT } = {}) {
    const entry = this.byId.get(api);
    if (!entry) return { api, nome: api, ok: false, text: `API "${api}" não existe no catálogo.` };
    let given = { ...params };
    if (entry.cidade && (given.lat === undefined || given.lon === undefined) && given.cidade) {
      const place = await this._locate(given.cidade, { fetchImpl, timeout });
      if (!place) return { api, nome: entry.nome, ok: false, text: `Não encontrei a cidade "${given.cidade}".` };
      given = { ...given, lat: place.lat, lon: place.lon };
    }
    const built = buildUrl(entry, given);
    if (built.error) return { api, nome: entry.nome, ok: false, text: `Consulta não feita: ${built.error}.` };
    try {
      const data = await this._get(built.url, { fetchImpl, timeout });
      return { api, nome: entry.nome, ok: true, text: summarize(entry, data) };
    } catch (error) {
      return { api, nome: entry.nome, ok: false, text: `A API não respondeu (${error?.message ?? 'erro'}).` };
    }
  }

  async _locate(city, options) {
    const geo = this.byId.get('geocodificar');
    if (!geo) return null;
    const built = buildUrl(geo, { cidade: city });
    if (built.error) return null;
    try {
      const data = await this._get(built.url, options);
      const first = data?.results?.[0];
      if (!first) return null;
      return { lat: String(first.latitude), lon: String(first.longitude) };
    } catch {
      return null;
    }
  }

  async _get(url, { fetchImpl, timeout }) {
    if (typeof fetchImpl !== 'function') throw new Error('sem rede');
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined,
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '?'}`);
    return response.json();
  }

  /**
   * Every call a reply asks for, made (up to the limit), as the message that
   * goes back to the model.
   */
  async run(reply, options = {}) {
    const calls = parseCalls(reply).slice(0, options.most ?? MOST_CALLS);
    const results = [];
    for (const call of calls) {
      options.onCall?.(this.byId.get(call.api)?.nome ?? call.api);
      results.push(await this.call(call, options));
    }
    return results;
  }
}

/** The message carrying results back to the model for its real answer. */
export function resultsMessage(results) {
  return [
    'Resultados das consultas feitas pelo app (não foi a pessoa que escreveu isto):',
    ...results.map((r) => `### ${r.nome} (${r.api})${r.ok ? '' : ' — FALHOU'}\n${r.text}`),
    'Agora responda à pergunta original usando esses dados, em linguagem natural, sem blocos ```api. ' +
    'Se uma consulta falhou, diga que não conseguiu o dado em vez de inventar.',
  ].join('\n\n');
}
