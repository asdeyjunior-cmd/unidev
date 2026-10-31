// Service worker unidev : ouverture rapide, icônes et images en cache, page hors connexion.
// Changer VERSION à chaque mise en ligne force la mise à jour du cache.
const VERSION = "unidev-v62";
const SHELL = [
  "./", "index.html", "publier.html", "connexion.html", "credits.html", "acheter.html", "apropos.html", "emploi.html", "offline.html",
  "css/style.css?v=44", "manifest.webmanifest",
  "js/config.js", "js/nav.js", "js/firebase.js", "js/cloudinary.js", "js/ui.js", "js/filieres.js",
  "js/catalogue.js", "js/publier.js", "js/credits.js", "js/acheter.js", "js/photos-pdf.js", "js/emploi.js", "js/demande-filiere.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png", "icons/apple-touch-icon.png",
];
const RUNTIME = `${VERSION}-runtime`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages et code du site : toujours la version en ligne d'abord.
  // La mémoire ne sert que si internet ne répond pas (hors connexion ou réseau très lent).
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await Promise.race([
          fetch(req, { cache: "no-cache" }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("lent")), 6000)),
        ]);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
        return hit || (req.mode === "navigate" ? caches.match("offline.html") : Response.error());
      }
    })());
    return;
  }

  // Polices, SDK Firebase et images de couverture : cache d'abord (ne changent pas)
  const statique =
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ||
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) ||
    (url.hostname === "res.cloudinary.com" && url.pathname.includes("/image/upload/"));
  if (statique) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
  // Le reste (Firestore, connexion, envoi Cloudinary, documents) passe directement par le réseau.
});
