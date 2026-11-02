#!/usr/bin/env node
/**
 * Crée une page web par document publié (dossier d/ du site) + la page « Tous les documents »
 * + le sitemap.xml, pour que Google affiche chaque cours, TD ou examen dans ses résultats.
 *
 *   node pages.js
 *
 * À lancer avant chaque « firebase deploy » (METTRE-EN-LIGNE.bat le fait pour toi).
 * Utilise la même clé Firebase que l'outil d'import (.env -> FIREBASE_CLE).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { canonFiliere } from "../../js/filieres.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(ICI, "../..");
const DOSSIER = path.join(SITE, "d");
const URL_SITE = "https://unidev-2026.web.app";

const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}\nVoir LISEZMOI.md (Installation).`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

// Même version de feuille de style que le site
const VERSION_CSS = (fs.readFileSync(path.join(SITE, "index.html"), "utf8").match(/css\/style\.css\?v=(\d+)/) || [])[1] || "1";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const couper = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
const slug = (s) => String(s || "document").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "") || "document";
const taille = (o) => !o ? "" : o < 1048576 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1048576).toFixed(1).replace(".", ",")} Mo`;
const image = (u, w) => (u && u.includes("/image/upload/") ? u.replace("/image/upload/", `/image/upload/w_${w},c_limit,q_auto,f_auto/`) : u || "");
const date = (t) => (t?.toDate ? t.toDate() : null);

const ICO = {
  docs: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  publier: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  emploi: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17.5h2"/>',
  credits: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10a2.5 2 0 0 1 2.5-2h.5a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h.5a2.5 2 0 0 0 2.5-2"/>',
  admin: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  compte: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;

function gabarit({ titre, description, canonical, ogImage, jsonld, corps }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(titre)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="unidev" />
  <meta property="og:title" content="${esc(titre)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${canonical}" />
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : ""}
  <meta property="og:locale" content="fr_CI" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#ffffff" />
  <link rel="manifest" href="../manifest.webmanifest" />
  <link rel="icon" href="../icons/favicon-32.png" sizes="32x32" />
  <link rel="apple-touch-icon" href="../icons/apple-touch-icon.png" />
  <link rel="stylesheet" href="../css/style.css?v=${VERSION_CSS}" />
  ${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
  <header class="topbar"><div class="wrap topbar-in"><a href="../index.html" class="logo"><span class="logo-mark">u</span>unidev</a><div id="header-tools" class="header-tools"></div></div></header>
  <main class="page">
    <div class="wrap">
${corps}
    </div>
  </main>
  <footer class="footer"><div class="wrap footer-copy">©UNIDEV ASSOCIATION 2026 · <a href="../apropos.html">À propos</a> · <a href="index.html">Tous les documents</a></div></footer>
  <nav class="bottomnav">
    <a href="../index.html" data-k="docs" class="active">${svg("docs")}<span>Documents</span></a>
    <a href="../publier.html" data-k="publier">${svg("publier")}<span>Publier</span></a>
    <a href="../emploi.html" data-k="emploi">${svg("emploi")}<span>Planning</span></a>
    <a href="../credits.html" data-k="credits">${svg("credits")}<span>Crédits</span><span class="pill" id="nav-credits"></span></a>
    <a href="../admin.html" data-k="admin" class="hidden" id="nav-admin">${svg("admin")}<span>Modération</span></a>
    <span id="nav-user"><a href="../connexion.html">${svg("compte")}<span>Connexion</span></a></span>
  </nav>
  <script src="../js/nav.js"></script>
</body>
</html>
`;
}

/* ---------- Lecture des documents publiés ---------- */
// Économie de lectures Firestore (quota gratuit : 50 000 par jour) : la liste vient de l'index (1 seule lecture)
// et seules les fiches NOUVELLES sont lues ; les autres viennent de pages-cache.json (gardé d'une fois sur l'autre).
console.log("Lecture des documents publiés…");
const CACHE = path.join(ICI, "pages-cache.json");
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch {}
const CHAMPS = ["titre", "matiere", "filiere", "type", "niveau", "annee", "universite", "format", "taille", "telechargements", "description", "imageUrl"];
const resumer = (s) => {
  const d = s.data(); const o = { lu: Date.now(), cree: date(d.createdAt)?.getTime() || 0 };
  for (const k of CHAMPS) if (d[k] !== undefined && d[k] !== "") o[k] = d[k];
  return o;
};
// Quota Firestore épuisé (ou coupure) : on refait les pages avec la copie gardée, plutôt que d'échouer
const enPanne = (e) => {
  if (Object.keys(cache).length) {
    console.log(`Firestore ne répond pas (${e.code === 8 || /quota|exhausted/i.test(e.message) ? "quota du jour épuisé" : e.message}) : pages refaites avec la copie gardée (${Object.keys(cache).length} documents).`);
    return true;
  }
  console.error(`Firestore ne répond pas (${e.code === 8 || /quota|exhausted/i.test(e.message) ? "quota du jour épuisé : réessaie après 7 h" : e.message}) et aucune copie n'est gardée : mise en ligne annulée pour ne pas effacer les pages Google.`);
  process.exit(2);
};
let index = null, horsLigne = false;
try { index = (await db.doc("index/catalogue").get()).data()?.docs; } catch (e) { horsLigne = enPanne(e); }
let ids;
if (horsLigne) { /* on garde le cache tel quel */ }
else if (index && Object.keys(index).length) {
  ids = Object.keys(index);
  // Fiches à lire : les nouvelles, plus 150 des plus anciennes en cache (pour garder les compteurs à jour)
  const nouvelles = ids.filter((id) => !cache[id]);
  const vieilles = ids.filter((id) => cache[id]).sort((a, b) => cache[a].lu - cache[b].lu).slice(0, 150);
  const aLire = [...nouvelles, ...vieilles];
  try {
    for (let i = 0; i < aLire.length; i += 100) {
      const snaps = await db.getAll(...aLire.slice(i, i + 100).map((id) => db.collection("documents").doc(id)));
      for (const s of snaps) if (s.exists && s.data().statut === "publie") cache[s.id] = resumer(s); else delete cache[s.id];
    }
  } catch (e) { console.log(`Lecture des fiches interrompue (${e.message}) : celles déjà gardées sont utilisées.`); }
  console.log(`${aLire.length} fiche(s) lue(s) dans Firestore (${nouvelles.length} nouvelle(s)), le reste vient du cache.`);
  // L'index fait foi pour les infos visibles (titre, image…) ; un document retiré de l'index n'a plus de page
  const garder = new Set(ids);
  for (const id of Object.keys(cache)) if (!garder.has(id)) delete cache[id];
  for (const id of ids) {
    const e = index[id], c = cache[id];
    if (!c || !Array.isArray(e)) continue;
    [c.titre, c.matiere, c.filiere, c.type, c.niveau, c.imageUrl, c.format, c.universite] = e.map((v, k) => v || [c.titre, c.matiere, c.filiere, c.type, c.niveau, c.imageUrl, c.format, c.universite][k]);
  }
} else {
  // Pas d'index : lecture complète (ancienne méthode)
  let snap;
  try { snap = await db.collection("documents").where("statut", "==", "publie").get(); } catch (e) { enPanne(e); snap = null; }
  if (snap) {
  cache = {};
  snap.docs.forEach((s) => { cache[s.id] = resumer(s); });
  }
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
// Provenance des documents de sites partenaires jamais publiée (« autorisation de … », « Source : … »)
const sansProvenance = (t) => !/autorisation de/i.test(t || "") ? t : String(t).replace(/Document partagé avec l'autorisation de \S+/gi, "").replace(/\s*Source\s*:\s*\S+/gi, "").replace(/\s{2,}/g, " ").trim();
const docs = Object.entries(cache).map(([id, c]) => {
  const d = { id, ...c, description: sansProvenance(c.description) };
  d.filiere = canonFiliere(d.filiere) || "Autre";
  d.page = `${slug(d.titre)}-${d.id.slice(0, 8).toLowerCase()}.html`;
  d.date = c.cree ? new Date(c.cree) : null;
  return d;
}).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
console.log(`${docs.length} document(s) publié(s).`);

/* ---------- Une page par document ---------- */
fs.mkdirSync(DOSSIER, { recursive: true });
const gardees = new Set(["index.html"]);
for (const d of docs) {
  const meta = [d.type, d.niveau, d.filiere].filter((x) => x && x !== "Autre");
  const titre = couper(`${d.titre}${meta.length ? " — " + meta.join(" · ") : ""} | unidev`, 110);
  const resume = d.description
    ? couper(d.description, 155)
    : couper(`${d.type || "Document"} de ${d.matiere || d.filiere}${d.niveau && d.niveau !== "Autre" ? `, ${d.niveau}` : ""}${d.universite ? `, ${d.universite}` : ""}. À télécharger sur unidev, la bibliothèque des étudiants.`, 155);
  const canonical = `${URL_SITE}/d/${d.page}`;
  const similaires = docs.filter((x) => x.id !== d.id && x.filiere === d.filiere).slice(0, 8);
  const lignes = [
    ["Matière", d.matiere], ["Filière", d.filiere], ["Niveau", d.niveau], ["Type", d.type],
    ["Année", d.annee], ["Établissement", d.universite], ["Format", (d.format || "").toUpperCase()], ["Taille", taille(d.taille)],
    ["Téléchargements", String(d.telechargements || 0)],
  ].filter(([, v]) => v && v !== "Autre");

  const corps = `
      <nav class="fd-fil" aria-label="Fil d'Ariane"><a href="../index.html">Documents</a> › <a href="index.html#${esc(slug(d.filiere))}">${esc(d.filiere)}</a></nav>
      <article class="fd">
        <div class="fd-img">${d.imageUrl ? `<img src="${esc(image(d.imageUrl, 700))}" alt="${esc(d.titre)}" width="700" height="525" />` : ""}</div>
        <div class="fd-info">
          <p class="fd-cat">${esc([d.type, d.filiere].filter((x) => x && x !== "Autre").join(" · "))}</p>
          <h1>${esc(d.titre)}</h1>
          ${d.description ? `<p class="fd-desc">${esc(d.description)}</p>` : ""}
          <table class="fd-table">${lignes.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
          <a class="btn btn-block fd-dl" href="../index.html?doc=${encodeURIComponent(d.id)}">Télécharger · 1 crédit</a>
          <p class="muted fd-note">2 crédits offerts à l'inscription. 1 crédit = 1 document téléchargé, débloqué pour toujours.</p>
        </div>
      </article>
      ${similaires.length ? `<h2 class="fd-h2">Autres documents en ${esc(d.filiere)}</h2>
      <ul class="fd-liste">${similaires.map((x) => `<li><a href="${x.page}">${esc(x.titre)}</a><span>${esc([x.type, x.niveau].filter((y) => y && y !== "Autre").join(" · "))}</span></li>`).join("")}</ul>` : ""}`;

  const jsonld = {
    "@context": "https://schema.org", "@type": "LearningResource", name: d.titre, description: resume, url: canonical,
    inLanguage: "fr", learningResourceType: d.type || "Document", educationalLevel: d.niveau || undefined,
    about: d.matiere || d.filiere, image: d.imageUrl || undefined, datePublished: d.date ? d.date.toISOString().slice(0, 10) : undefined,
    provider: { "@type": "Organization", name: "unidev", url: URL_SITE + "/" },
    isAccessibleForFree: false,
  };
  fs.writeFileSync(path.join(DOSSIER, d.page), gabarit({ titre, description: resume, canonical, ogImage: image(d.imageUrl, 1200), jsonld, corps }));
  gardees.add(d.page);
}

/* ---------- Page « Tous les documents », classés par filière ---------- */
const parFiliere = new Map();
for (const d of docs) { if (!parFiliere.has(d.filiere)) parFiliere.set(d.filiere, []); parFiliere.get(d.filiere).push(d); }
const filieres = [...parFiliere.keys()].sort((a, b) => (a === "Autre") - (b === "Autre") || a.localeCompare(b, "fr"));
const corpsIndex = `
      <h1 class="page-title">Tous les documents</h1>
      <p class="muted" style="margin-bottom:18px">${docs.length} cours, TD, TP, examens, corrigés et mémoires classés par filière.</p>
      <nav class="fd-filieres">${filieres.map((f) => `<a href="#${esc(slug(f))}">${esc(f)} <span>${parFiliere.get(f).length}</span></a>`).join("")}</nav>
      ${filieres.map((f) => `<section class="fd-section" id="${esc(slug(f))}">
        <h2 class="fd-h2">${esc(f)}</h2>
        <ul class="fd-liste">${parFiliere.get(f).map((x) => `<li><a href="${x.page}">${esc(x.titre)}</a><span>${esc([x.type, x.niveau].filter((y) => y && y !== "Autre").join(" · "))}</span></li>`).join("")}</ul>
      </section>`).join("")}`;
fs.writeFileSync(path.join(DOSSIER, "index.html"), gabarit({
  titre: "Tous les documents — cours, TD, examens et corrigés | unidev",
  description: `Liste complète des ${docs.length} documents d'université sur unidev : cours, TD, TP, sujets d'examen, corrigés et mémoires de BTS, Licence et Master, classés par filière.`,
  canonical: `${URL_SITE}/d/index.html`, corps: corpsIndex,
}));

/* ---------- Pages des documents retirés : supprimées ---------- */
let suppr = 0;
for (const f of fs.readdirSync(DOSSIER)) if (f.endsWith(".html") && !gardees.has(f)) { fs.unlinkSync(path.join(DOSSIER, f)); suppr++; }

/* ---------- sitemap.xml ---------- */
const jour = new Date().toISOString().slice(0, 10);
const url = (loc, freq, prio, mod) => `  <url><loc>${loc}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}<changefreq>${freq}</changefreq><priority>${prio}</priority></url>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(`${URL_SITE}/`, "daily", "1.0", jour)}
${url(`${URL_SITE}/d/index.html`, "daily", "0.9", jour)}
${url(`${URL_SITE}/publier.html`, "monthly", "0.6")}
${url(`${URL_SITE}/emploi.html`, "monthly", "0.7")}
${url(`${URL_SITE}/apropos.html`, "monthly", "0.5")}
${url(`${URL_SITE}/connexion.html`, "monthly", "0.4")}
${docs.map((d) => url(`${URL_SITE}/d/${d.page}`, "monthly", "0.8", d.date ? d.date.toISOString().slice(0, 10) : null)).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(SITE, "sitemap.xml"), sitemap);

console.log(`Terminé : ${docs.length} page(s) de document, page « Tous les documents », sitemap.xml mis à jour.${suppr ? ` ${suppr} ancienne(s) page(s) supprimée(s).` : ""}`);
process.exit(0);
