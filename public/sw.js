const CACHE_NAME = "spend-shell-v8";

const STATIC_PATHS = [
  "",
  "index.html",
  "manifest.webmanifest",
  "favicon.svg",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
];

function getScopeUrls() {
  const scope = self.registration.scope;
  return STATIC_PATHS.map((path) => new URL(path, scope).toString());
}

self.addEventListener("install", (event) => {
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
      .then(() => self.skipWaiting()),
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    const indexUrl = new URL("index.html", self.registration.scope).toString();
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(indexUrl, copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match(indexUrl);
          return cachedIndex || caches.match(request);
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
    body: "Review today's recurring expenses in Spend.",
    url: self.registration.scope,
    tag: "spend-recurring-reminder",
  };

  let payload = fallback;
  if (event.data) {
    try {
      payload = { ...fallback, ...event.data.json() };
    } catch {
      payload = { ...fallback, body: event.data.text() || fallback.body };
    }
  }

  const iconUrl = new URL(
    "icons/icon-192.png",
    self.registration.scope,
  ).toString();
  const badgeUrl = new URL(
    "icons/icon-192.png",
    self.registration.scope,
  ).toString();

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: iconUrl,
      badge: badgeUrl,
      tag: payload.tag || fallback.tag,
      renotify: false,
      data: {
        url: payload.url || self.registration.scope,
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

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const matchingClient = clients.find((client) =>
          client.url.startsWith(self.registration.scope),
        );
        if (matchingClient && "focus" in matchingClient) {
          return matchingClient.focus();
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
