/* =========================================================
   كراسة المعلم الليبي الرقمية — ملف العمل بلا إنترنت (Service Worker)
   ---------------------------------------------------------
   ⚠️ عند أي تعديل على ملفات التطبيق: ارفعي الرقم في السطر التالي
   ثم ارفعي الملفات إلى GitHub، وعندها يُحدَّث التطبيق على أجهزة المستخدمات.
   ========================================================= */
const CACHE = "kmt-cache-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./install.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png"
];

/* التثبيت: نحفظ كل ملفات التطبيق في الكاش (ولو فشل ملف واحد لا يفشل الباقي) */
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null)))
    )
  );
});

/* التشغيل: نحذف كاش النسخ القديمة */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("kmt-cache-") && n !== CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/* الجلب: نجيب من الكاش فورًا (يعمل بلا إنترنت) ونحدّث الكاش في الخلفية */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });

      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
            cache.put(req, res.clone()).catch(() => null);
          }
          return res;
        })
        .catch(() => null);

      // نسخة محفوظة: نعطيها فورًا ونجدّد الكاش في الخلفية
      if (cached) {
        networkPromise.then((r) => { if (!r) return null; });
        return cached;
      }

      const fresh = await networkPromise;
      if (fresh) return fresh;

      // بلا إنترنت: الصفحة الرئيسية من الكاش
      if (req.mode === "navigate") {
        const home = (await cache.match("./")) || (await cache.match("./index.html"));
        if (home) return home;
      }
      return new Response("غير متاح حاليًا (لا يوجد إنترنت)", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    })()
  );
});
