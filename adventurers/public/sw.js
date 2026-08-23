/* Service worker del Club de Aventureros.

   Objetivo: que los juegos abran sin señal (wifi de campamento) sin servir
   nunca contenido viejo cuando sí hay red.

   - Navegaciones: red primero, caché como respaldo. Así un deploy se ve al
     instante estando en línea, y sin señal se abre lo último que se vio.
   - Estáticos propios y fuentes: caché primero, revalidando en segundo plano.
   - /api/*: nunca se cachea. Si falla, profile.js encola los puntos.

   Al cambiar VERSION se borran las cachés viejas y se toma el control de las
   pestañas abiertas.
*/
const VERSION = "v1";
const SHELL = `aventureros-shell-${VERSION}`;
const RUNTIME = `aventureros-runtime-${VERSION}`;

const GAMES = [
  "pr39",
  "pr39-prueba10",
  "pr39-nombres",
  "pr39-rompecabezas",
  "pr39-colorear",
  "pr41",
  "pr41-estatua",
  "pr41-horno",
  "pr41-secuencia",
  "pr41-versiculo",
  "pr44",
  "pr44-reloj",
  "pr44-quien-lo-dijo",
  "pr44-laberinto",
  "pr44-diferencias",
];

const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/shared/profile.css",
  "/shared/profile.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  ...GAMES.map((g) => `/conexion-biblica-${g}/`),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Una página que falle no puede tumbar la instalación completa.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

const isFont = (url) =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      // Las fuentes responden opacas (CORS): igual sirven cacheadas.
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await update;
  if (fresh) return fresh;
  throw new Error("sin red y sin caché");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL).catch(async () => {
        const cache = await caches.open(SHELL);
        return (await cache.match("/")) || Response.error();
      })
    );
    return;
  }

  if (isFont(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
