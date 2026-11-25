const cacheName = "mage-knight-atlas-2";
const files = [
  "./",
  "./index.html",
  "./app.js",
  "./engine.mjs",
  "./components.json",
  "./table.js",
  "./table.html",
  "./style.css",
  "./atlas.wasm",
  "./manifest.webmanifest",
  "./icon.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(files))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method === "GET" &&
    new URL(event.request.url).origin === location.origin
  )
    event.respondWith(
      caches
        .open(cacheName)
        .then(
          async (c) => (await c.match(event.request)) || fetch(event.request),
        ),
    );
});
