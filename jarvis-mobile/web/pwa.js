/**
 * The installed-app parts: the service worker, and telling you when he
 * answered while you were somewhere else.
 *
 * The permissions panel has offered notifications "to say when a long task
 * finished" since it was built, and nothing ever sent one. On Android that
 * was not even possible from the page: Chrome there refuses
 * `new Notification()` outright ("Illegal constructor") and only allows
 * `registration.showNotification()` -- which needs a service worker. So the
 * two arrive together.
 */

/**
 * Register the worker, and tell it what this page loaded so it can keep a
 * copy for offline. Never throws: an app without offline is still an app.
 *
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerWorker({ nav = globalThis.navigator, perf = globalThis.performance, url = 'sw.js' } = {}) {
  if (!nav?.serviceWorker?.register) return null;
  try {
    const registration = await nav.serviceWorker.register(url);
    // `ready`, not `registration.active`: on a first visit the worker is
    // still installing when `register` resolves.
    const ready = await nav.serviceWorker.ready;
    const urls = loaded(perf);
    ready.active?.postMessage({ type: 'cache', urls });
    return registration;
  } catch {
    return null;
  }
}

/** Every same-origin file this page fetched, plus the page itself. */
export function loaded(perf = globalThis.performance, here = globalThis.location) {
  const origin = here?.origin;
  const urls = new Set(here?.href ? [here.href.split('#')[0]] : []);
  for (const entry of perf?.getEntriesByType?.('resource') ?? []) {
    try {
      const url = new URL(entry.name);
      if (url.origin === origin) urls.add(url.href);
    } catch {
      /* Not a URL; nothing to keep. */
    }
  }
  return [...urls];
}

/**
 * Say that a reply arrived -- only if you are not looking at it.
 *
 * A notification for something already on the screen in front of you is
 * noise, and noise is how people learn to turn notifications off.
 *
 * @param {string} text The reply.
 * @returns {Promise<boolean>} Whether one was shown.
 */
export async function notifyReply(text, {
  doc = globalThis.document,
  Notice = globalThis.Notification,
  nav = globalThis.navigator,
} = {}) {
  if (!doc?.hidden) return false;
  if (!Notice || Notice.permission !== 'granted') return false;
  const body = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!body) return false;
  const options = {
    body: body.length > 160 ? `${body.slice(0, 157)}…` : body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    // One at a time: a second reply replaces the first instead of stacking.
    tag: 'jarvis-reply',
    renotify: true,
  };
  try {
    const registration = await nav?.serviceWorker?.getRegistration?.();
    if (registration?.showNotification) {
      await registration.showNotification('Jarvis', options);
      return true;
    }
  } catch {
    /* Fall through to the page's own constructor. */
  }
  try {
    new Notice('Jarvis', options); // eslint-disable-line no-new
    return true;
  } catch {
    return false;
  }
}
