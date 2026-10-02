/**
 * Asking the backend what a sentence is asking for.
 *
 * The rules in `conjure.js` draw a cube in the frame you ask for it, and that
 * is the whole reason they exist -- "a second and a half for an endpoint to
 * agree is not augmented reality, it is a form with a delay". They decline
 * anything they do not fully understand, and the sentence then goes to the
 * chat model, which costs seconds.
 *
 * This is for that middle, and only for it. "faz aí um cubo grandão pra mim"
 * has a verb and a shape and two words no table knows; the rules decline, and
 * a decision model settles it in milliseconds instead of the chat model
 * settling it in seconds. So this never runs *before* the rules -- it runs
 * instead of the slow path, which is why adding it cannot make the app slower
 * than it was.
 *
 * Three things it must never do, because a classifier is an optional extra:
 *
 *  1. **Never block the fast path.** It is asked only once the rules have
 *     already declined.
 *  2. **Never hang.** A short timeout, past which the slow path we were
 *     avoiding would have been the quicker answer anyway.
 *  3. **Never keep asking.** A backend with no decision model says so once;
 *     asking again every message would spend a round trip per message to be
 *     told the same no.
 */

/** Past this, the chat model would have been the faster answer. */
const TIMEOUT = 1200;

/**
 * How sure the model has to be before the app acts without the chat model.
 *
 * Calibrated probabilities are the point of these models, so this is a real
 * threshold and not decoration: at 0.51 the answer is a coin toss dressed as
 * a decision, and acting on it would draw cubes at people who asked a
 * question. Below it, the sentence goes where it went before.
 */
export const SURE = 0.75;

/** What the backend last said about having a decision model. */
let ready = null;

/** Forget it -- the endpoint may have changed under us. */
export function reset() {
  ready = null;
}

/**
 * What is this sentence asking for?
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.base] The backend's origin. Empty means this page.
 * @param {object} [options.headers] Whatever the endpoint needs, from `headersFor`.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeout]
 * @returns {Promise<{choice: string, confidence: number, probabilities: object}|null>}
 *   null whenever nothing could decide, which callers must treat as ordinary.
 */
export async function classify(text, {
  base = '',
  headers = {},
  fetchImpl = globalThis.fetch,
  timeout = TIMEOUT,
} = {}) {
  if (!text || !text.trim()) return null;
  // Asked and told no: stop spending round trips on it.
  if (ready === false) return null;
  if (typeof fetchImpl !== 'function') return null;

  let response;
  try {
    response = await fetchImpl(`${String(base).replace(/\/+$/, '')}/v1/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined,
    });
  } catch {
    // Offline, blocked, timed out, or an endpoint that is not a Jarvis. None
    // of those are worth a second attempt on the next message.
    ready = false;
    return null;
  }
  if (!response?.ok) {
    // A 404 is the ordinary answer from a backend older than this route, and
    // from every provider endpoint. Remember it and stop.
    ready = false;
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    ready = false;
    return null;
  }

  if (!payload?.available) {
    // The route exists but nothing is installed behind it. Still a no, and
    // still not worth asking again this session.
    ready = false;
    return null;
  }
  ready = true;

  const decision = payload.pedido;
  if (!decision || typeof decision.choice !== 'string') return null;
  return {
    choice: decision.choice,
    confidence: Number(decision.confidence) || 0,
    probabilities: decision.probabilities ?? {},
  };
}

/**
 * The decision, only when it is sure enough to act on.
 *
 * Separate from `classify` so the threshold is one named thing rather than a
 * number repeated at every call site.
 *
 * @returns {Promise<string|null>} The chosen option, or null to carry on as before.
 */
export async function intent(text, options = {}) {
  const decision = await classify(text, options);
  if (!decision) return null;
  return decision.confidence >= (options.sure ?? SURE) ? decision.choice : null;
}
