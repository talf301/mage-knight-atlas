const cacheName = "mage-knight-atlas-12";
const files = [
  "./",
  "./index.html",
  "./app.js",
  "./artwork.js",
  "./faces.json",
  "./gems/blue.webp",
  "./gems/red.webp",
  "./gems/white.webp",
  "./gems/green.webp",
  "./gems/black.webp",
  "./gems/gold.webp",
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
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(files.map(path => new Request(path, {cache: "reload"})));
      const paths = [
        ...new Set(
          Object.values(await (await cache.match("./faces.json")).json()),
        ),
      ];
      for (let i = 0; i < paths.length; i += 12) {
        await Promise.all(paths.slice(i, i + 12).map(async path => {
          const existing = await caches.match(path);
          if (existing) await cache.put(path, existing);
          else await cache.add(path);
        }));
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("mage-knight-atlas-") && key !== cacheName)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
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
          async (c) => (await c.match(event.request, {ignoreSearch: event.request.mode === "navigate"})) || fetch(event.request),
        ),
    );
});

self.addEventListener("message", event => {
  if (event.data === "activate-update") event.waitUntil(self.skipWaiting());
});
