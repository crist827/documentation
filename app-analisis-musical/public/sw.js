// Service worker: permite abrir la app sin conexión.
// - Páginas: primero la red (para recibir actualizaciones) y, sin conexión, la copia guardada.
// - Recursos (JS/CSS con hash, iconos, worker): primero la copia guardada y se actualiza en segundo plano.
const CACHE = "entrenador-vocal-v1";
const BASICOS = ["./", "./index.html", "./manifest.webmanifest", "./icono.svg", "./icono-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copia));
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((guardada) => {
      const deRed = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() => guardada);
      return guardada || deRed;
    }),
  );
});
