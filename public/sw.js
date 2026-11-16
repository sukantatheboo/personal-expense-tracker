const CACHE_NAME = "spend-shell-v13";
const SW_BUILD_ID = "dev";
const SW_VERSION = "2.0.0";
const SW_COMMIT = "";
const SW_BUILT_AT = "";
const PRECACHE_ASSETS = [];

const STATIC_PATHS = [
  "",
  "index.html",
  "manifest.webmanifest",
  "fonts/fonts.css",
  "favicon.svg",
  "icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "sounds/reminder.wav",
  "sounds/welcome.wav",
];

const scheduledTimers = new Map();

function clearScheduledTimers() {
  for (const timerId of scheduledTimers.values()) {
    clearTimeout(timerId);
  }
  scheduledTimers.clear();
}

function notifyClientsToPlaySound(tone = "reminder") {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      const matching = clients.filter((client) =>
        client.url.startsWith(self.registration.scope),
      );
      if (!matching.length) return;
      const target =
        matching.find((client) => client.focused) ||
        matching.find((client) => client.visibilityState === "visible") ||
        matching[0];
      target.postMessage({ type: "PLAY_NOTIFICATION_SOUND", tone });
    })
    .catch(() => {});
}

function getScopeUrls() {
  const scope = self.registration.scope;
  const allPaths = [...new Set([...STATIC_PATHS, ...PRECACHE_ASSETS])];
  return allPaths.map((path) => new URL(path, scope).toString());
}

function cacheCompleteResponse(request, response) {
  if (response?.status !== 200 || response.type !== "basic") {
    return Promise.resolve();
  }
  return caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, response.clone()))
    .catch(() => {});
}

self.addEventListener("install", (event) => {
  const hasActiveController = Boolean(self.registration?.active);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          getScopeUrls().map((url) =>
            cache.add(new Request(url, { cache: "reload" })),
          ),
        ),
      )
      .then(() => {
        // Activate immediately on first install; when updating an existing install,
        // wait in the installed state so the app can prompt the user with the Update modal.
        if (!hasActiveController) {
          return self.skipWaiting();
        }
        return undefined;
      }),
  );
});

function cleanRedirectedResponse(response) {
  if (!response || !response.redirected) return Promise.resolve(response);
  return response.blob().then(
    (body) =>
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      }),
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key !== CACHE_NAME)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.registration.navigationPreload
        ? self.registration.navigationPreload.disable().catch(() => {})
        : Promise.resolve(),
    ]).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "GET_VERSION_INFO") {
    const payload = {
      type: "VERSION_INFO",
      buildId: SW_BUILD_ID,
      version: SW_VERSION,
      commit: SW_COMMIT,
      builtAt: SW_BUILT_AT,
      cacheName: CACHE_NAME,
    };
    if (event.ports?.[0]) {
      event.ports[0].postMessage(payload);
    } else {
      event.source?.postMessage?.(payload);
    }
    return;
  }
  if (event.data?.type === "SYNC_SCHEDULED_NOTIFICATIONS") {
    clearScheduledTimers();
    const items = Array.isArray(event.data.items) ? event.data.items : [];
    const now = Date.now();
    const iconUrl = new URL(
      "icons/icon-192.png",
      self.registration.scope,
    ).toString();
    const badgeUrl = new URL(
      "icons/icon-192.png",
      self.registration.scope,
    ).toString();

    for (const item of items) {
      const delay = Number(item.fireAt) - now;
      if (!Number.isFinite(delay) || delay <= 0 || delay > 24 * 60 * 60 * 1000)
        continue;
      const key = item.tag || `${item.title}:${item.fireAt}`;
      const timerId = setTimeout(() => {
        scheduledTimers.delete(key);
        const targetUrl = new URL(
          item.url || self.registration.scope,
          self.registration.scope,
        ).toString();
        self.registration
          .showNotification(item.title, {
            body: item.body,
            icon: iconUrl,
            badge: badgeUrl,
            tag: key,
            renotify: false,
            vibrate: [200, 100, 200],
            data: {
              url: targetUrl,
              tab: item.tab || "home",
            },
          })
          .then(() => notifyClientsToPlaySound(item.tone || "reminder"))
          .catch(() => {});
      }, delay);
      scheduledTimers.set(key, timerId);
    }
  } else if (event.data?.type === "SCHEDULE_TEST_NOTIFICATION") {
    const delayMs = Number(event.data.delayMs) || 4000;
    const iconUrl = new URL(
      "icons/icon-192.png",
      self.registration.scope,
    ).toString();
    const badgeUrl = new URL(
      "icons/icon-192.png",
      self.registration.scope,
    ).toString();
    const targetUrl = new URL(
      "./?tab=home",
      self.registration.scope,
    ).toString();

    event.waitUntil(
      new Promise((resolve) => {
        setTimeout(() => {
          self.registration
            .showNotification(
              event.data.title || "Spend background test reminder",
              {
                body:
                  event.data.body ||
                  "Background notifications are working while Spend is inactive!",
                icon: iconUrl,
                badge: badgeUrl,
                tag: `spend-bg-test-${Date.now()}`,
                renotify: true,
                vibrate: [200, 100, 200],
                data: {
                  url: targetUrl,
                  tab: "home",
                },
              },
            )
            .then(() => notifyClientsToPlaySound(event.data.tone || "reminder"))
            .catch(() => {})
            .finally(resolve);
        }, delayMs);
      }),
    );
  }
});

self.addEventListener("fetch", (event) => {
  // Always settle navigation preload responses if the browser initiated one
  // so Chromium/WebKit never log an unhandled preload cancellation error.
  if (event.preloadResponse) {
    event.waitUntil(Promise.resolve(event.preloadResponse).catch(() => {}));
  }

  const { request } = event;
  if (request.method !== "GET") return;
  // Let the browser handle byte-range requests directly. Partial (206)
  // responses are not valid Cache Storage entries.
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request)
            .then((response) => {
              if (response && (response.ok || response.type === "opaque")) {
                const copy = response.clone();
                caches
                  .open(STATIC_CACHE)
                  .then((cache) => cache.put(request, copy))
                  .catch(() => {});
              }
              return response;
            })
            .catch(() => new Response("", { status: 200 })),
      ),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  // Never intercept Vite dev-server module requests in local development
  if (
    url.pathname.includes("/src/") ||
    url.pathname.includes("/@") ||
    url.pathname.includes("/node_modules/")
  ) {
    return;
  }

  // Always bypass Service Worker caching for version manifest and service worker script
  if (
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/sw.js")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    const indexUrl = new URL("index.html", self.registration.scope).toString();
    const isExplicitUpdate = url.searchParams.has("__update");

    if (isExplicitUpdate) {
      event.respondWith(
        fetch(indexUrl, { cache: "no-store" })
          .then(async (response) => {
            const clean = await cleanRedirectedResponse(response);
            await cacheCompleteResponse(indexUrl, clean);
            return clean;
          })
          .catch(async () => {
            const fallback =
              (await caches.match(indexUrl)) || (await caches.match(request));
            return cleanRedirectedResponse(fallback);
          }),
      );
      return;
    }

    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.match(indexUrl))
        .then((cachedIndex) => {
          if (cachedIndex) {
            return cleanRedirectedResponse(cachedIndex);
          }
          return fetch(indexUrl, { cache: "no-store" })
            .then(async (response) => {
              const clean = await cleanRedirectedResponse(response);
              await cacheCompleteResponse(indexUrl, clean);
              return clean;
            })
            .catch(async () => {
              const fallback =
                (await caches.match(indexUrl)) || (await caches.match(request));
              return cleanRedirectedResponse(fallback);
            });
        }),
    );
    return;
  }

  // Immutable content-hashed build assets under /assets/ use Cache-First
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            void cacheCompleteResponse(request, response);
            return response;
          }),
      ),
    );
    return;
  }

  const fetchOpts =
    request.cache === "no-store" || request.cache === "reload"
      ? { cache: "no-store" }
      : undefined;

  event.respondWith(
    fetch(request, fetchOpts)
      .then((response) => {
        void cacheCompleteResponse(request, response);
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Spend reminder",
    body: "Open Spend to review today's expenses and reminders.",
    url: self.registration.scope,
    tab: "home",
    tag: "spend-reminder",
  };

  let payload = fallback;
  if (event.data) {
    try {
      payload = { ...fallback, ...event.data.json() };
    } catch {
      payload = { ...fallback, body: event.data.text() || fallback.body };
    }
  }

  const tag = payload.tag || fallback.tag;
  if (scheduledTimers.has(tag)) {
    clearTimeout(scheduledTimers.get(tag));
    scheduledTimers.delete(tag);
  }

  const iconUrl = new URL(
    "icons/icon-192.png",
    self.registration.scope,
  ).toString();
  const badgeUrl = new URL(
    "icons/icon-192.png",
    self.registration.scope,
  ).toString();

  const targetUrl = new URL(
    payload.url || self.registration.scope,
    self.registration.scope,
  ).toString();

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: iconUrl,
        badge: badgeUrl,
        tag,
        renotify: Boolean(payload.renotify),
        vibrate: [200, 100, 200],
        data: {
          url: targetUrl,
          tab: payload.tab || fallback.tab,
        },
      }),
      notifyClientsToPlaySound(payload.tone || "reminder"),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || self.registration.scope,
    self.location.origin,
  ).toString();
  const targetTab =
    event.notification.data?.tab ||
    new URL(targetUrl).searchParams.get("tab") ||
    "";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const matchingClient = clients.find((client) =>
          client.url.startsWith(self.registration.scope),
        );
        if (matchingClient) {
          if (targetTab) {
            matchingClient.postMessage({
              type: "NAVIGATE_TAB",
              tab: targetTab,
            });
          }
          if ("focus" in matchingClient) {
            return matchingClient.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
