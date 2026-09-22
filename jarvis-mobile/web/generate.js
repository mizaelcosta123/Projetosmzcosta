/**
 * Making a picture, with nothing to configure.
 *
 * Every other provider in this app needs a key, which means a person has to go
 * and get one before anything happens. Pollinations does not: the image is a
 * GET, the prompt is in the path, and the answer is the picture. That is the
 * only reason this can ship pre-configured, and it is worth being precise
 * about what that costs.
 *
 * **Anonymous traffic is rate-capped** — roughly one request every fifteen
 * seconds — and it is the first thing throttled when the service is busy. So
 * the app has to hold the button rather than let somebody press it four times
 * and conclude the feature is broken.
 *
 * **Video is not in the same category.** It exists on the same service and it
 * is metered by credits, with a free allowance measured in a handful per week.
 * Pretending otherwise would mean somebody waits a minute for a failure, so
 * the video entry says what it needs before it is used, not after.
 */

/** The image endpoint. Keyless by design: the prompt is the path. */
const IMAGE_HOST = 'https://image.pollinations.ai/prompt/';

/** The newer unified endpoint, which is where video lives. */
const GEN_HOST = 'https://gen.pollinations.ai/';

/** Anonymous requests are capped around this. Holding the button is kinder
 * than letting the service refuse and looking broken. */
export const COOLDOWN_MS = 15_000;

/** Sizes offered, rather than a free pair of numbers.
 *
 * A phone screen is portrait, a model reads square best, and anything above
 * ~1024 costs seconds of waiting for detail nobody sees on a handset. */
export const SIZES = {
  quadrado: { width: 1024, height: 1024 },
  retrato: { width: 768, height: 1152 },
  paisagem: { width: 1152, height: 768 },
};

/** Clamp to what the service will actually render. */
function bounded(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1536, Math.max(128, Math.round(number)));
}

/**
 * The URL that *is* the image.
 *
 * The prompt is encoded rather than interpolated: a slash, a question mark or
 * a `#` in somebody's sentence would otherwise end the path and silently
 * generate something else — or nothing.
 *
 * @param {string} prompt
 * @param {{size?: string, seed?: number, model?: string, logo?: boolean}} [options]
 * @returns {string}
 */
export function imageUrl(prompt, options = {}) {
  const text = String(prompt ?? '').trim();
  if (!text) throw new Error('Diga o que você quer ver.');

  const size = SIZES[options.size] ?? SIZES.quadrado;
  const query = new URLSearchParams({
    width: String(bounded(options.width, size.width)),
    height: String(bounded(options.height, size.height)),
  });

  // A seed makes the same prompt give the same picture, which is what "gere
  // outra" needs to *not* do — so the caller supplies a new one each time.
  if (Number.isFinite(Number(options.seed))) {
    query.set('seed', String(Math.trunc(Number(options.seed))));
  }
  if (options.model) query.set('model', String(options.model));
  // The free tier watermarks unless asked not to.
  if (!options.logo) query.set('nologo', 'true');
  // Nothing here should end up in somebody else's feed.
  query.set('private', 'true');

  return `${IMAGE_HOST}${encodeURIComponent(text)}?${query}`;
}

/** A fresh seed, so "another one" is another one. */
export function newSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * What each kind of generation needs before it can work.
 *
 * Exported as data so the interface can say it up front. The alternative is a
 * button that looks the same as the working one and fails after a minute.
 */
export const CAPABILITIES = {
  image: {
    label: 'Imagem',
    ready: true,
    note: 'Sem chave e sem cadastro. Uma imagem a cada ~15s.',
  },
  video: {
    label: 'Vídeo',
    ready: false,
    note:
      'Vídeo não é gratuito de verdade: o serviço mede por créditos, e o que ' +
      'se ganha por semana dá para poucos segundos. Precisa de uma conta e de ' +
      'créditos para valer a pena.',
    endpoint: GEN_HOST,
  },
};

/** True when this kind can be used right now with no setup. */
export function isReady(kind) {
  return CAPABILITIES[kind]?.ready === true;
}

/**
 * Turn a failure into something a person can act on.
 *
 * The two that actually happen are the rate cap and the service being busy,
 * and both arrive as a status nobody reads as "wait a moment".
 */
export function explainFailure(status) {
  if (status === 429) {
    return 'Muitos pedidos seguidos. O serviço gratuito aceita cerca de um a cada 15 segundos.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'O serviço gratuito está ocupado agora. Tente de novo em um minuto.';
  }
  if (status === 0) {
    return 'Não alcancei o serviço de imagens. Confira a sua conexão.';
  }
  return `O serviço de imagens respondeu ${status}.`;
}
