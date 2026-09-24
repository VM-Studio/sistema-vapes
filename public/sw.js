/*
 * Service worker mínimo y seguro para una app con datos privados:
 * - NO cachea páginas ni respuestas de API (tienen datos de negocio y dependen
 *   de la sesión): siempre van a la red.
 * - Si una navegación falla por falta de conexión, muestra /offline.html.
 */
const CACHE = "gestion-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())),
  );
});
