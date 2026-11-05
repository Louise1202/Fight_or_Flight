// Keeps the judge pages on the phone, so a refresh with no signal still
// opens them. Only /judge pages, the app's own files and images are
// touched. Logins, the admin, every API call and all live data go straight
// to the network as if this file didn't exist.

const CACHE = "judge-pages-v1";
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isJudgePage(url) {
  return url.pathname === "/judge" || url.pathname.startsWith("/judge/");
}

// A redirect means the login has expired: that page must not be kept.
function worthKeeping(res) {
  return res && res.ok && !res.redirected && res.type === "basic";
}

async function keep(cache, key, res) {
  if (worthKeeping(res)) await cache.put(key, res.clone());
  return res;
}

// The newest page if the network answers in time, else the saved one.
async function pageFirstFromNetwork(request, url) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((res) => keep(cache, url.pathname, res));
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  const saved = await cache.match(url.pathname, { ignoreVary: true });
  return saved || network;
}

// These files have their version in the name, so a saved copy is always right.
async function fileFromCache(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreVary: true });
  if (saved) return saved;
  return keep(cache, request, await fetch(request));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && isJudgePage(url)) {
    event.respondWith(pageFirstFromNetwork(request, url));
  } else if (url.pathname.startsWith("/_next/static/") || request.destination === "image") {
    event.respondWith(fileFromCache(request));
  }
});

// Saves a page and every app file it needs, ahead of time.
async function savePage(cache, path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!worthKeeping(res)) return;
  await cache.put(path, res.clone());
  const html = await res.text();
  const files = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) || []);
  await Promise.all(
    [...files].map(async (file) => {
      if (await cache.match(file, { ignoreVary: true })) return;
      const r = await fetch(file).catch(() => null);
      if (worthKeeping(r)) await cache.put(file, r);
    })
  );
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "save-pages" && Array.isArray(data.paths)) {
    event.waitUntil(
      caches.open(CACHE).then((cache) => Promise.all(data.paths.map((p) => savePage(cache, p).catch(() => {}))))
    );
  } else if (data.type === "forget-pages") {
    event.waitUntil(caches.delete(CACHE));
  }
});
