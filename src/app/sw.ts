/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

/**
 * SERVICE WORKER (Serwist). Reglas de caché — datos privados del negocio:
 *  - Shell (JS/CSS del build, fuentes, íconos): PRECACHE (inyectado en el build).
 *  - Páginas, RSC, Server Actions y /api/*: NETWORK-ONLY. Nunca se guarda
 *    HTML autenticado ni una mutación. Sin red, una navegación cae en /offline.
 *  - Imágenes de productos y PDFs (/api/publico/archivos): stale-while-revalidate,
 *    200 entradas / 30 días.
 *  - Sin cola offline: sin señal, el escáner solo CONSULTA el catálogo que la
 *    app guardó en IndexedDB (lo baja /api/p/{slug}/catalogo/offline).
 *  - Actualización: el SW nuevo queda ESPERANDO; la app muestra "Hay una
 *    versión nueva" y el usuario decide (nunca en medio de una venta).
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const esNavegacion = (r: Request) => r.mode === "navigate" || r.destination === "document";
const esRsc = (r: Request) =>
  r.headers.get("RSC") === "1" || r.headers.has("Next-Router-State-Tree");

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // El SW nuevo espera: lo activa el usuario desde el aviso de actualización.
  skipWaiting: false,
  clientsClaim: true,
  // La navegación sale a la red en paralelo al arranque del SW (NetworkOnly usa la respuesta precargada).
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [
    // Mutaciones (Server Actions incluidas): siempre a la red, nunca a un caché.
    {
      matcher: ({ request }) => request.method !== "GET",
      handler: new NetworkOnly(),
      method: "POST",
    },
    // Páginas y payloads RSC autenticados: network-only (sin red → /offline por el fallback).
    {
      matcher: ({ request }) => esNavegacion(request) || esRsc(request),
      handler: new NetworkOnly(),
    },
    // Imágenes y PDFs compartidos por link: se pueden ver sin señal si ya se abrieron.
    {
      matcher: ({ url, request }) =>
        url.origin === self.location.origin &&
        url.pathname.startsWith("/api/publico/archivos/") &&
        (request.destination === "image" || /\.(pdf|png|jpe?g|webp)$/i.test(url.pathname)),
      handler: new StaleWhileRevalidate({
        cacheName: "archivos",
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 })],
      }),
    },
    // Resto de la API (catálogo offline, etiquetas…): siempre a la red.
    { matcher: ({ url }) => url.pathname.startsWith("/api/"), handler: new NetworkOnly() },
    // Íconos, splash y capturas del manifest.
    {
      matcher: ({ url }) => /^\/(icons|splash|screenshots|brand)\//.test(url.pathname),
      handler: new CacheFirst({
        cacheName: "marca",
        plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 30 * 24 * 3600 })],
      }),
    },
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => esNavegacion(request) }],
  },
});

serwist.addEventListeners();
