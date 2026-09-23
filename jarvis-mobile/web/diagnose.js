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

  // Checked before the generic 404 below, and that order is the whole point.
  const routed = routingRefusal(message);
  if (routed) return routed;

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

/**
 * An aggregator that answered, understood the request, and routed it nowhere.
 *
 * This one is worth its own function because the status code lies. OpenRouter
 * returns **404** when a model exists but every provider serving it was
 * filtered out by the account's own guardrails or data policy, and the layer
 * underneath reads any 404 as "this port is not an OpenAI-compatible server".
 * So the message a person sees tells them to check whether the right service
 * is running on the port -- when the port is fine, the request was understood,
 * and the fix is a setting in a web console that the response body names, with
 * a link, which the wrapper then buries.
 *
 * Nothing in this app can fix it: the switch is in the account. What this can
 * do is stop sending somebody to look at the wrong thing.
 *
 * @param {string} message
 * @returns {string} The explanation, or '' when this is not that failure.
 */
export function routingRefusal(message) {
  const text = String(message ?? '');
  // Both halves required: "guardrail" alone could be any provider's wording,
  // and a routing failure without one is a different problem.
  if (!/guardrail|data policy/i.test(text)) return '';
  if (!/\b0 endpoints\b|endpoints out of|failed_routing_step|not allowed/i.test(text)) return '';

  const link = text.match(/https?:\/\/[^\s"'\\]+guardrails[^\s"'\\]*/i)?.[0]
    ?? 'https://openrouter.ai/settings/preferences';
  const privacy = /data policy|training|privacy/i.test(text);

  return (
    'O provedor recebeu o pedido e entendeu, mas não achou nenhum endpoint ' +
    'liberado para esse modelo: as regras da sua conta barraram o único que ' +
    'existia. Não é o endereço nem a chave, e não tem conserto aqui — é uma ' +
    `configuração no painel: ${link}\n\n` +
    'Costuma ser uma destas duas:\n' +
    (privacy
      ? '1. A política de dados bloqueia provedores que podem treinar com o que você manda. Modelos ":free" quase sempre são servidos por esses, então ficam de fora.\n'
      : '1. O provedor que serve esse modelo está fora da lista permitida.\n') +
    '2. O modelo tem um único provedor, então basta ele ser barrado para sobrar zero.\n\n' +
    'Saídas: liberar aquele provedor no painel, ou escolher outro modelo em ' +
    'Configurações → Escolher modelos. Um modelo pago costuma ter vários ' +
    'provedores e não depende de um só.'
  );
}
