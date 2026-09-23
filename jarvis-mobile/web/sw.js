/**
 * The service worker: the app opens with no signal, and can notify.
 *
 * Offline matters here more than for most web apps. The point of pointing
 * him at Ollama in Termux is that nothing leaves the phone -- and until this
 * file, opening the installed app on a train with no signal showed the
 * browser's dinosaur, although the model was right there on the device.
 *
 * **Network first, cache as fallback**, for this origin's own files only. A
 * cache-first worker is the classic way to ship an app that never updates:
 * the old `app.js` is served forever and a reload changes nothing. Here the
 * network always wins when there is one, and the cache is refreshed by every
 * successful load, so it is at most one visit stale and only when offline.
 *
 * **No list of files.** `deploy.py` records what happened the last time this
 * interface kept a list of its own modules: one was added, the list was not,
 * and the page went black. Instead the page tells the worker what it loaded
 * (see `app.js`), and everything fetched through the worker afterwards is
 * kept too.
 *
 * Never cached: anything under `/v1/` or `/api/`, `/health`, other origins,
 * and anything but GET. Those are conversations and status, and a stale
 * answer from yesterday served as today's would be a lie.
 */

const CACHE = 'jarvis-shell';

/** Requests this worker has any business answering. */
function ours(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return !/^\/(v1|api)\/|^\/health\b/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  // The page itself, so a cold start offline has something to open. The
  // rest arrives through the page's own message.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(['./', 'index.html']))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const { type, urls } = event.data ?? {};
  if (type !== 'cache' || !Array.isArray(urls)) return;
  const wanted = urls.filter((url) => {
    try {
      return ours(new Request(url));
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One at a time and forgiving: one 404 must not throw the rest away,
      // which is what `addAll` would do.
      Promise.all(wanted.map((url) => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!ours(request)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
        // A navigation to any path of this app is the app.
        if (request.mode === 'navigate') {
          const page = (await cache.match('index.html')) ?? (await cache.match('./'));
          if (page) return page;
        }
        return Response.error();
      })
  );
});

// A notification about a reply: bring the app forward, or open it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client);
      return open ? open.focus() : self.clients.openWindow('./');
    })
  );
});
