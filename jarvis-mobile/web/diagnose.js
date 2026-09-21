/**
 * Telling the two addresses apart, and saying what a failed fetch means.
 *
 * The settings sheet asks for a "Servidor". There are two plausible URLs in a
 * user's head at that moment — this backend, and the model provider whose key
 * they just pasted — and picking the wrong one produces `Failed to fetch`, a
 * message that names neither the cause nor the field. These two functions turn
 * that into something a person can act on.
 */

/**
 * Hosts that serve models, not this backend.
 *
 * Deliberately a short list of the providers this project actually speaks to
 * plus the three big first-party APIs, rather than a clever heuristic: a
 * guess that rejects someone's real backend is worse than one that misses.
 */
export const PROVIDER_HOSTS = [
  'openrouter.ai',
  'huggingface.co',
  'nousresearch.com',
  'opencode.ai',
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
];

/**
 * Name the provider when a URL points at one, otherwise the empty string.
 *
 * @param {string} url
 * @returns {string} The matched host, or '' when the URL is fine or unparseable.
 */
export function providerMistake(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  let host;
  try {
    host = new URL(trimmed).host.toLowerCase();
  } catch {
    return ''; // Not a URL at all; the input's own validation covers that.
  }
  return PROVIDER_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) || '';
}

/**
 * Turn a thrown error into a sentence that points at the fix.
 *
 * @param {unknown} error
 * @param {string} base The server the request was aimed at, for the message.
 * @returns {string}
 */
export function explain(error, base) {
  const message = String((error && error.message) || error || '').trim();
  const where = base || 'este mesmo servidor';

  // Every browser words a blocked or unreachable request differently, and all
  // of them are equally silent about which of the causes applied.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return (
      `Não consegui falar com ${where}. ` +
      'Confira o campo Servidor: ele é o endereço do Jarvis, não o do provedor ' +
      'de modelos. Deixe vazio para usar este mesmo servidor. ' +
      'Se o endereço estiver certo, o serviço pode estar acordando — espere e tente de novo.'
    );
  }
  if (/^401\b/.test(message)) {
    return (
      'Chave recusada (401). O campo Chave de API quer a chave do Jarvis ' +
      '(OPENJARVIS_API_KEY), não a do provedor — essa fica no backend.'
    );
  }
  if (/^404\b/.test(message)) {
    return `${where} respondeu 404. Esse endereço serve outra coisa, ou o Jarvis está num caminho diferente.`;
  }
  return message || 'Falhou sem dizer por quê.';
}
