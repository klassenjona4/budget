/**
 * Service worker, written by hand. It precaches the build, serves it offline
 * and handles the daily wake up. There is no Workbox runtime and no network
 * request to anything outside this origin.
 *
 * It deliberately knows nothing about the user's data: the encryption key
 * only exists in the page while unlocked, so notifications shown from here
 * carry no figures.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

const MANIFEST = self.__WB_MANIFEST;

/** Cache name changes whenever any precached file changes. */
function cacheName(): string {
  let hash = 5381;
  for (const entry of MANIFEST) {
    const text = `${entry.url}|${entry.revision ?? ""}`;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    }
  }
  return `budget-${hash.toString(36)}`;
}

const CACHE = cacheName();
const INDEX = new URL("index.html", self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll rejects outright if the list holds the same URL twice.
      const urls = [...new Set(MANIFEST.map((entry) => new URL(entry.url, self.location.href).href))];
      await cache.addAll(urls);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // A GitHub Pages project site shares its origin with every other project
      // on the account, so only caches belonging to this scope are removed.
      // That covers the Workbox cache left by earlier versions of the app.
      const scope = self.registration.scope;
      for (const key of await caches.keys()) {
        if (key === CACHE) continue;
        if (key.startsWith("budget-") || key.includes(scope)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Every route is the same document, so a navigation falls back to it.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(INDEX);
        return cached ?? fetch(request);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached) return cached;
      return fetch(request);
    })(),
  );
});

/** The periodic sync event is not in the standard worker types yet. */
type PeriodicSyncEvent = ExtendableEvent & { tag: string };

const DAILY_TAG = "budget-daily";

/**
 * Chrome decides when this fires, so the hour is read at the moment it runs
 * and the message is chosen from it. The tag carries the date, so a repeat
 * within the same day replaces the notification instead of stacking another.
 */
function onPeriodicSync(event: PeriodicSyncEvent): void {
  if (event.tag !== DAILY_TAG) return;
  event.waitUntil(
    (async () => {
      const now = new Date();
      const stamp = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
      const morning = now.getHours() < 12;
      await self.registration.showNotification("Budget", {
        body: morning
          ? "Daily starter ready. Open the app to see what today allows."
          : "Evening recap ready. Open the app to see what today cost.",
        tag: morning ? `starter-${stamp}` : `recap-${stamp}`,
        icon: "icon-192.png",
        badge: "icon-192.png",
      });
    })(),
  );
}

self.addEventListener("periodicsync", onPeriodicSync as EventListener);

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.startsWith(new URL("./", self.location.href).href)) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(new URL("./", self.location.href).href);
    })(),
  );
});
