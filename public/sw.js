const CACHE_NAME = "spend-shell-v11";

const STATIC_PATHS = [
  "",
  "index.html",
  "manifest.webmanifest",
  "favicon.svg",
  "icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

const scheduledTimers = new Map();

function clearScheduledTimers() {
  for (const timerId of scheduledTimers.values()) {
    clearTimeout(timerId);
  }
  scheduledTimers.clear();
}

function getScopeUrls() {
  const scope = self.registration.scope;
  return STATIC_PATHS.map((path) => new URL(path, scope).toString());
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

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
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
            .catch(() => {})
            .finally(resolve);
        }, delayMs);
      }),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
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

  // Always bypass cache for version manifest and service worker script
  if (
    url.pathname.endsWith("/version.json") ||
    url.pathname.endsWith("/sw.js")
  ) {
    event.respondWith(
      fetch(request.url, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    const indexUrl = new URL("index.html", self.registration.scope).toString();
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.match(indexUrl))
        .then(
          (cachedIndex) =>
            cachedIndex ||
            fetch(request, { cache: "no-store" })
              .then((response) => {
                if (response.ok) {
                  const copy = response.clone();
                  caches
                    .open(CACHE_NAME)
                    .then((cache) => cache.put(indexUrl, copy));
                }
                return response;
              })
              .catch(async () => {
                const fallback = await caches.match(indexUrl);
                return fallback || caches.match(request);
              }),
        ),
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
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
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
