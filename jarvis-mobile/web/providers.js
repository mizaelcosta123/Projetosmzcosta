/**
 * Where the answers come from, and what each place can actually do.
 *
 * There are two different things a URL in the settings sheet can point at, and
 * conflating them is the whole reason this module exists:
 *
 *   - a **Jarvis backend**, which runs the agent. It can think *and* reach your
 *     phone, because the device tools and the bridge live there.
 *   - a **provider**, like OpenRouter or a bare Ollama. It can only answer.
 *     There is no agent on the other end, so no `device_*` tool exists and
 *     nothing will ever touch Termux, however good the model is.
 *
 * Both are useful and the app supports both. What it must not do is let you
 * add the second while expecting the first — so `reachesDevice()` is part of
 * the type, and the sheet says it out loud next to every entry.
 */

/**
 * @typedef {{id: string, name: string, url: string, key: string, kind: string,
 *            agent?: boolean}} Provider
 *
 * `kind` is a guess made offline, from the port and the hostname. `agent` is
 * what was actually found when something asked. Undefined means nobody has
 * asked yet; once it is a boolean it outranks the guess, because a hostname
 * cannot tell you what is listening on it and a request can.
 */

export const JARVIS = 'jarvis';
export const OPENAI = 'openai';
export const OLLAMA = 'ollama';

/** Ollama's port. Recognising it is what makes the Termux preset one tap. */
const OLLAMA_PORT = '11434';

/**
 * Hosts that serve models rather than an agent.
 *
 * Kept as a list of the ones this project actually speaks to, not a heuristic:
 * guessing "provider" about somebody's real backend is the worse mistake.
 */
const PROVIDER_HOSTS = [
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.together.xyz',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
  'huggingface.co',
  'nousresearch.com',
  'opencode.ai',
];

/** Strip trailing slashes, and any `/v1` the person pasted along with the host. */
export function normalizeUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '');
}

/**
 * What kind of thing lives at this URL.
 *
 * @param {string} url
 * @returns {string} One of JARVIS, OPENAI, OLLAMA.
 */
export function detectKind(url) {
  const clean = normalizeUrl(url);
  if (!clean) return JARVIS; // blank means "this same server"
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return JARVIS;
  }
  if (parsed.port === OLLAMA_PORT) return OLLAMA;
  const host = parsed.host.toLowerCase();
  if (PROVIDER_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) {
    return OPENAI;
  }
  return JARVIS;
}

/**
 * Can a model reached this way do anything to the phone?
 *
 * Only through a Jarvis backend. This is not a limit of the model — it is that
 * `device_open`, `device_shell` and the rest are registered in the agent, and
 * a provider endpoint has no agent behind it.
 *
 * @param {Provider} provider
 */
export function reachesDevice(provider) {
  if (typeof provider?.agent === 'boolean') return provider.agent;
  return (provider?.kind ?? JARVIS) === JARVIS;
}

/**
 * Ask an endpoint whether there is an agent behind it.
 *
 * This is what replaces guessing from the hostname. The list of known
 * provider hosts can only ever be a list of the ones somebody thought of; a
 * person pasting their own vLLM on port 8000, or LM Studio on 1234, used to
 * be taken for a Jarvis -- which meant a WebSocket reconnecting to it every
 * thirty seconds, all night, for a route it does not have.
 *
 * One request settles it, and the answer is remembered on the provider.
 *
 * @param {Provider} provider
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean|undefined>} undefined when it could not be told.
 */
export async function probeAgent(provider, fetchImpl = globalThis.fetch) {
  const base = normalizeUrl(provider?.url) || originOfPage();
  let response;
  try {
    response = await fetchImpl(`${base}/v1/device`, { headers: headersFor(provider) });
  } catch {
    // Unreachable says nothing about what it is. Leaving this unknown keeps
    // a Jarvis that happens to be asleep from being demoted permanently.
    return undefined;
  }
  if (response.status === 404) return false;
  // A key problem is a key problem, not an answer about what is listening.
  if (response.status === 401 || response.status === 403) return undefined;
  if (!response.ok) return undefined;
  const payload = await response.json().catch(() => null);
  // The catch-all route used to answer this with the HTML page, and a 200
  // full of markup reads as "yes" while meaning nothing.
  return Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload);
}

/** Where to POST a chat. Ollama speaks the OpenAI shape too, so this is uniform. */
export function chatUrl(provider) {
  return `${normalizeUrl(provider?.url) || ''}/v1/chat/completions`;
}

/** Where to ask what models exist. Ollama has its own, always-present, endpoint. */
export function modelsUrl(provider) {
  const base = normalizeUrl(provider?.url) || '';
  return provider?.kind === OLLAMA ? `${base}/api/tags` : `${base}/v1/models`;
}

/** The headers a request to this provider needs. */
export function headersFor(provider, extra = {}) {
  const headers = { ...extra };
  if (provider?.key) headers.Authorization = `Bearer ${provider.key}`;
  return headers;
}

/**
 * Read a model list out of whatever shape the endpoint answered with.
 *
 * Three shapes in the wild: OpenAI's `{data: [{id}]}`, Ollama's
 * `{models: [{name}]}`, and a bare array from the occasional proxy.
 *
 * @returns {string[]} Model IDs, sorted, without duplicates.
 */
export function readModels(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : (payload?.data ?? payload?.models ?? []);
  if (!Array.isArray(rows)) return [];
  const names = rows
    .map((row) => (typeof row === 'string' ? row : (row?.id ?? row?.name ?? '')))
    .filter((name) => typeof name === 'string' && name.length > 0);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Ask a provider what it can run.
 *
 * Throws with a sentence a person can act on rather than a status code —
 * a blocked CORS preflight and a wrong key look identical from here
 * (`TypeError: Failed to fetch`), and the difference is what they do next.
 *
 * @param {Provider} provider
 * @param {typeof fetch} [fetchImpl] Injected by the tests.
 * @returns {Promise<string[]>}
 */
export async function fetchModels(provider, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(modelsUrl(provider), { headers: headersFor(provider) });
  } catch {
    throw new Error(explainUnreachable(provider));
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      provider.key
        ? 'A chave foi recusada por este endereço.'
        : 'Este endereço pede uma chave, e o campo está vazio.'
    );
  }
  if (!response.ok) {
    throw new Error(`O endereço respondeu ${response.status} ao listar os modelos.`);
  }
  const models = readModels(await response.json().catch(() => null));
  if (models.length === 0) throw new Error('O endereço respondeu, mas sem nenhum modelo.');
  return models;
}

/** Why a fetch to this provider might have failed before it ever got a status. */
export function explainUnreachable(provider) {
  if (provider?.kind === OLLAMA) {
    return (
      'Não alcancei o Ollama. Ele precisa estar rodando (`ollama serve`) e ' +
      'aceitar esta página: pare o Ollama e suba de novo com ' +
      `OLLAMA_ORIGINS=${originOfPage()} ollama serve`
    );
  }
  return (
    'Não alcancei esse endereço. Confira se está escrito certo e se o serviço ' +
    'aceita chamadas de outra origem (CORS).'
  );
}

/** This page's origin, which is what a local service has to be told to allow. */
function originOfPage() {
  try {
    return globalThis.location?.origin || '*';
  } catch {
    return '*';
  }
}

/** A provider with the fields filled in and an id that will not collide. */
export function makeProvider({ name = '', url = '', key = '', id = '', agent } = {}) {
  const clean = normalizeUrl(url);
  const entry = {
    id: id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || hostLabel(clean),
    url: clean,
    key: key.trim(),
    kind: detectKind(clean),
  };
  // Only carried when it is known. An absent field and `false` mean different
  // things here, and JSON.stringify drops undefined for us.
  if (typeof agent === 'boolean') entry.agent = agent;
  return entry;
}

/** A short human label for a URL, for when nobody typed a name. */
function hostLabel(url) {
  if (!url) return 'Este servidor';
  try {
    const { hostname, port } = new URL(url);
    return port ? `${hostname}:${port}` : hostname;
  } catch {
    return url;
  }
}

/** The Ollama running on this very phone, which is the whole Termux case. */
export function termuxOllama() {
  return makeProvider({ name: 'Ollama (Termux)', url: `http://localhost:${OLLAMA_PORT}` });
}
