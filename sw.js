/* ============================================================
   FitLife — Service Worker
   Версия: 2.0
   Файл: sw.js
   ============================================================ */

const CACHE_NAME = "fitlife-v2.0.0";
const RUNTIME_CACHE = "fitlife-runtime-v2.0.0";

// Файлы, которые кэшируются сразу при установке
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./data.js",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* ============================================================
   1. УСТАНОВКА — кэшируем основные файлы
   ============================================================ */
self.addEventListener("install", event => {
  console.log("🛠️ SW: install");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("📦 SW: precache");
        // Игнорируем ошибки отдельных файлов (например, если иконок ещё нет)
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => console.warn("Не закэшировано:", url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ============================================================
   2. АКТИВАЦИЯ — удаляем старые кэши
   ============================================================ */
self.addEventListener("activate", event => {
  console.log("✅ SW: activate");
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map(key => {
            console.log("🗑️ SW: удаляю старый кэш", key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

/* ============================================================
   3. FETCH — стратегия: cache-first для статики, network для API
   ============================================================ */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Firebase / Google API — всегда сеть, без кэша
  if (url.hostname.includes("firebase") ||
      url.hostname.includes("googleapis") ||
      url.hostname.includes("gstatic") ||
      url.hostname.includes("openfoodfacts")) {
    return; // пропускаем, идёт напрямую
  }

  // Только GET-запросы
  if (event.request.method !== "GET") return;

  // Стратегия: сначала сеть, при ошибке — кэш (для HTML)
  if (event.request.mode === "navigate" ||
      event.request.destination === "document") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  // Для остального: сначала кэш, потом сеть
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Кэшируем только успешные ответы с нашего origin
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Если совсем нет сети — возвращаем заглушку для картинок
        if (event.request.destination === "image") {
          return new Response("", { status: 200, headers: { "Content-Type": "image/svg+xml" } });
        }
      });
    })
  );
});

/* ============================================================
   4. СООБЩЕНИЯ ОТ КЛИЕНТА (обновление SW)
   ============================================================ */
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

console.log("🚀 SW: загружен");