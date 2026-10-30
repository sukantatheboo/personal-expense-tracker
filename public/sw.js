const CACHE_NAME = "spend-app-v6";
const APP_FILES = [
  "./",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_FILES);
      const appShell = await cache.match("./");
      if (!appShell) throw new Error("The app shell was not cached.");
      const html = await appShell.text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
        .map(([, path]) => new URL(path, self.location.origin))
        .filter((url) => url.origin === self.location.origin)
        .map((url) => url.href);
      await cache.addAll(assets);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith("spend-app-") && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }
  const title =
    typeof payload.title === "string" ? payload.title : "Spend reminder";
  const tag =
    typeof payload.tag === "string" ? payload.tag : "spend-notification";
  const targetTab = payload.tab || "activity";
  const options = {
    body:
      typeof payload.body === "string"
        ? payload.body
        : "A recurring expense is due.",
    icon: new URL("./icons/icon-192.png", self.registration.scope).href,
    badge: new URL("./icons/icon-180.png", self.registration.scope).href,
    tag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: payload.url || self.registration.scope,
      tab: targetTab,
      action: payload.action || "view",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetTab = notifData.tab || "activity";
  const target = new URL(
    notifData.url || self.registration.scope,
    self.registration.scope,
  );
  if (targetTab) {
    target.searchParams.set("tab", targetTab);
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === target.origin,
        );
        if (existing) {
          existing.postMessage({
            type: "NAVIGATE_TAB",
            tab: targetTab,
          });
          return existing.focus();
        }
        return self.clients.openWindow(target.href);
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const appPath = new URL(self.registration.scope).pathname;
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(appPath)
  )
    return;

  // 1. Immutable hashed assets: Cache-First for instant 0ms launch from device storage
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // 2. Navigation / App Shell: Stale-While-Revalidate
  // Serves cached shell immediately to minimize splash display time, updates in background
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./").then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put("./", copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      }),
    );
    return;
  }

  // 3. Static shell metadata and icons: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    }),
  );
});
