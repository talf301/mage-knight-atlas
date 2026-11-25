const cacheName = "mage-knight-atlas-5";
const files = [
  "./",
  "./index.html",
  "./app.js",
  "./artwork.js","./faces.json",
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
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(cacheName);
 await cache.addAll(files);
 const paths=[...new Set(Object.values(await (await cache.match("./faces.json")).json()))];
 for(let i=0;i<paths.length;i+=12)await cache.addAll(paths.slice(i,i+12));
})()));
self.addEventListener("activate", (event) =>
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("mage-knight-atlas-") && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })()),
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
