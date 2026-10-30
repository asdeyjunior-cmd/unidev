// Sources libres supplémentaires pour l'outil d'import :
//   - Wikiversité et Wikilivres (cours et manuels en français, licence CC BY-SA)
//   - Zenodo (supports de cours sous licence CC BY / CC0)
// Chaque source fournit des documents { cle, titre, nomFichier, buffer, infos } prêts à publier.
import PDFDocument from "pdfkit";
import { deviner, couper, avecRelance, telecharger, semblaAnglais, EXTENSIONS, titreDepuisFichier } from "./outils.js";

// Le titre décide en priorité ; le thème cherché ne sert que pour compléter ce qui manque
function devinerAvecTheme(texte, theme) {
  const a = deviner(texte), b = deviner(theme || "");
  return { filiere: a.filiere || b.filiere, matiere: a.filiere ? a.matiere : a.matiere || b.matiere, type: a.type || b.type, niveau: a.niveau || b.niveau };
}

const UA = "unidev-import/1.0 (https://unidev-2026.web.app; outil d'import de cours libres)";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  return avecRelance(async () => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
    if (r.ok) return r.json();
    throw new Error(`${new URL(url).host} a répondu ${r.status}${r.status >= 500 || r.status === 429 ? " 503" : ""}`);
  }, { nom: new URL(url).host });
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Hors sujet si ni le titre ne contient le thème, ni le titre seul ne permet de deviner une filière */
function horsSujet(titre, theme) {
  const t = norm(titre), mots = norm(theme).split(/[^a-z0-9]+/).filter((m) => m.length > 3);
  if (mots.some((m) => t.includes(m.slice(0, Math.max(4, m.length - 2))))) return false;
  return !deviner(titre).filiere;
}
const PAGES_A_EVITER = /^(accueil|sommaire|portail|aide|bienvenue|francais|wikilivres|wikiversite)\b/;

/* ---------- PDF texte (pour les cours wiki) ---------- */
// Les polices standard du PDF ne connaissent que l'alphabet latin : on remplace le reste proprement.
const REMPLACE = { "≤": "<=", "≥": ">=", "≠": "!=", "→": "->", "←": "<-", "⇒": "=>", "⇔": "<=>", "×": "x", "∞": "infini", "√": "racine", "∑": "somme", "∫": "integrale", "π": "pi", "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "λ": "lambda", "μ": "mu", "σ": "sigma", "Δ": "Delta", "Ω": "Omega", "•": "-", "▪": "-", " ": " ", " ": " " };
const WIN = /[^\x09\x0a\x0d\x20-\x7e\xa0-\xffŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g;
const propre = (t) => String(t || "").normalize("NFC").replace(/[≤≥≠→←⇒⇔×∞√∑∫παβγδλμσΔΩ•▪  ]/g, (c) => REMPLACE[c]).replace(WIN, "");

/** Fabrique un PDF lisible : page de garde verte puis les chapitres */
export function pdfTexte({ titre, sousTitre, chapitres, mentions, etiquette = "COURS" }) {
  return new Promise((ok, ko) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: propre(titre), Creator: "unidev" } });
    const morceaux = [];
    doc.on("data", (c) => morceaux.push(c));
    doc.on("end", () => ok(Buffer.concat(morceaux)));
    doc.on("error", ko);
    const W = doc.page.width;

    // Page de garde (sert aussi d'image du document)
    doc.rect(0, 0, W, 300).fill("#1f9d55");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13).text(etiquette, 64, 90, { characterSpacing: 3 });
    doc.fontSize(30).text(propre(titre), 64, 120, { width: W - 128 });
    doc.fillColor("#0f3d2e").font("Helvetica").fontSize(14).text(propre(sousTitre), 64, 340, { width: W - 128 });
    doc.moveDown(2).fontSize(10).fillColor("#555555").text(propre(mentions), { width: W - 128 });
    doc.font("Helvetica-Bold").fontSize(26).fillColor("#1f9d55").text("unidev", 64, doc.page.height - 110);

    for (const ch of chapitres) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f3d2e").text(propre(ch.titre));
      doc.moveDown(0.6);
      for (const ligne of propre(ch.texte).split("\n")) {
        const l = ligne.trimEnd();
        const titreSection = l.match(/^(={2,})\s*(.+?)\s*\1$/);
        if (titreSection) {
          doc.moveDown(0.5).font("Helvetica-Bold").fontSize(titreSection[1].length <= 2 ? 14 : 12).fillColor("#177a42").text(titreSection[2]);
          doc.moveDown(0.2);
        } else if (l.trim()) {
          doc.font("Helvetica").fontSize(11).fillColor("#111111").text(l, { align: "justify", lineGap: 2 });
        } else doc.moveDown(0.4);
      }
    }
    doc.end();
  });
}

/* ---------- Wikiversité / Wikilivres ---------- */
const WIKIS = {
  wikiversite: { hote: "fr.wikiversity.org", nom: "Wikiversité", type: "Cours" },
  wikilivres: { hote: "fr.wikibooks.org", nom: "Wikilivres", type: "Cours" },
};

/**
 * Cherche des cours sur un wiki et assemble chaque cours (page principale + ses chapitres) en un PDF.
 * opts : { projet, recherche, max, deja(cle) -> bool }
 */
export async function* coursWiki({ projet = "wikiversite", recherche, max = 50, deja = () => false }) {
  const w = WIKIS[projet];
  if (!w) throw new Error(`Projet inconnu : ${projet} (choisis wikiversite ou wikilivres)`);
  const api = (p) => `https://${w.hote}/w/api.php?format=json&formatversion=2&${new URLSearchParams(p)}`;
  const vus = new Set();
  let offset = 0, rendus = 0;

  while (rendus < max) {
    const res = await json(api({ action: "query", list: "search", srsearch: recherche || "cours", srnamespace: "0", srlimit: "50", sroffset: String(offset) }));
    const hits = res.query?.search || [];
    if (!hits.length) break;
    offset += hits.length;

    for (const h of hits) {
      if (rendus >= max) break;
      const racine = h.title.split("/")[0];
      if (vus.has(racine)) continue;
      vus.add(racine);
      if (PAGES_A_EVITER.test(norm(racine)) || horsSujet(racine, recherche)) continue;
      const cle = `wiki:${w.hote}:${racine}`;
      if (deja(cle)) continue;

      // Chapitres : sous-pages du cours (ordre alphabétique), après la page principale
      const sous = await json(api({ action: "query", list: "allpages", apprefix: racine + "/", apnamespace: "0", aplimit: "100" }));
      const pages = [racine, ...(sous.query?.allpages || []).map((p) => p.title)].slice(0, 60);
      const chapitres = [];
      let total = 0;
      for (const t of pages) {
        const ex = await json(api({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", titles: t, redirects: "1" }));
        const texte = (ex.query?.pages?.[0]?.extract || "").trim();
        if (texte.length > 200) {
          chapitres.push({ titre: t === racine ? racine : t.slice(racine.length + 1).replace(/\//g, " — "), texte });
          total += texte.length;
        }
        if (total > 400000) break;
        await pause(250);
      }
      if (total < 3000) continue; // ébauche trop courte : pas assez utile

      const source = `https://${w.hote}/wiki/${encodeURIComponent(racine.replace(/ /g, "_"))}`;
      const mentions = `Source : ${w.nom}, ${source}\nAuteurs : les contributeurs de ${w.nom} (voir l'historique de la page).\nLicence : Creative Commons Attribution - Partage dans les mêmes conditions 4.0 (CC BY-SA 4.0). Ce document peut être copié et modifié à condition de citer les auteurs et de garder la même licence.\nMis en page par unidev.`;
      const devine = devinerAvecTheme(racine, recherche);
      const buffer = await pdfTexte({ titre: racine, sousTitre: `${w.nom} · ${chapitres.length} chapitre(s)`, chapitres, mentions });
      rendus++;
      yield {
        cle, titre: racine, nomFichier: `${racine}.pdf`.replace(/[\\/:*?"<>|]/g, " "), buffer,
        infos: {
          titre: racine, matiere: devine.matiere || racine, filiere: devine.filiere || "Autre", type: w.type, niveau: devine.niveau || "Autre",
          annee: "", universite: w.nom,
          description: `Cours libre de ${w.nom} (${chapitres.length} chapitres). Licence CC BY-SA 4.0 · Auteurs : contributeurs de ${w.nom} · Source : ${source}`,
        },
        licence: "CC BY-SA 4.0", source,
      };
    }
  }
}

/* ---------- Zenodo ---------- */
function licenceZenodo(id) {
  const l = String(id || "").toLowerCase();
  if (!l) return null;
  if (/^cc0|cc-zero|public-domain|pddl/.test(l)) return "Domaine public (CC0)";
  if (!l.startsWith("cc-by") || l.includes("nc")) return null; // NC interdit : unidev vend des crédits
  if (l.startsWith("cc-by-sa")) return "CC BY-SA";
  if (l.startsWith("cc-by-nd")) return "CC BY-ND";
  return "CC BY";
}
const sansHtml = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Supports de cours Zenodo sous licence libre (PDF). opts : { recherche, max, types, deja } */
export async function* coursZenodo({ recherche, max = 50, types = ["lesson", "presentation"], deja = () => false, onEcarte = () => {}, essai = false }) {
  let rendus = 0;
  for (const type of types) {
    for (let page = 1; rendus < max && page <= 40; page++) {
      const res = await json(`https://zenodo.org/api/records?${new URLSearchParams({ q: recherche || "cours", type, size: "25", page: String(page), sort: "bestmatch" })}`);
      const hits = res.hits?.hits || [];
      if (!hits.length) break;
      for (const h of hits) {
        if (rendus >= max) break;
        const m = h.metadata || {};
        const cle = `zenodo:${h.id}`;
        if (deja(cle)) continue;
        const licence = licenceZenodo(m.license?.id || m.license);
        const lang = String(m.language || "").toLowerCase();
        if ((lang && !["fra", "fre", "fr"].includes(lang)) || (!lang && semblaAnglais(m.title))) { onEcarte("langue"); continue; }
        if (horsSujet(m.title, recherche)) { onEcarte("hors sujet"); continue; }
        if (!licence) { onEcarte("licence"); continue; }
        const pdf = (h.files || []).find((f) => /\.pdf$/i.test(f.key || f.filename || "") && (f.size || 0) <= 100 * 1048576);
        if (!pdf) { onEcarte("sans PDF"); continue; }
        const lien = pdf.links?.self || pdf.links?.download;
        if (!lien) { onEcarte("sans PDF"); continue; }
        let buffer = Buffer.alloc(pdf.size || 0); // en mode essai : pas de téléchargement
        if (!essai) {
          try { buffer = await telecharger(lien, { "User-Agent": UA }, { pdf: true }); }
          catch (e) { onEcarte("téléchargement impossible"); continue; }
        }
        const auteurs = (m.creators || []).map((c) => c.name).filter(Boolean);
        const qui = auteurs.slice(0, 3).join(", ") + (auteurs.length > 3 ? " et al." : "");
        const source = h.links?.html || (h.doi ? `https://doi.org/${h.doi}` : `https://zenodo.org/records/${h.id}`);
        const titre = couper(m.title || "Sans titre", 140);
        const devine = devinerAvecTheme(`${titre} ${(m.keywords || []).join(" ")}`, recherche);
        const resume = couper(sansHtml(m.description), 330);
        rendus++;
        yield {
          cle, titre, nomFichier: (pdf.key || `${h.id}.pdf`).replace(/[\\/:*?"<>|]/g, " "), buffer,
          infos: {
            titre, matiere: couper(devine.matiere || (m.keywords || [])[0] || devine.filiere || "Divers", 80), filiere: devine.filiere || "Autre",
            type: type === "presentation" ? "Cours" : devine.type || "Cours", niveau: devine.niveau || "Autre",
            annee: String(m.publication_date || "").slice(0, 4), universite: "Zenodo",
            description: `${resume}${resume ? "\n" : ""}Auteur(s) : ${qui || "inconnu"} · Licence : ${licence} · Source : ${source}`,
          },
          licence, source,
        };
        await pause(500);
      }
    }
  }
}

/* ---------- Romans du domaine public : Wikisource (fr) ---------- */
// Wikisource en français ne publie que des œuvres du domaine public en France (auteur mort depuis plus de 70 ans),
// la même règle qu'en Côte d'Ivoire. La transcription est sous licence CC BY-SA.
const WS = "fr.wikisource.org";
const wsApi = (p) => `https://${WS}/w/api.php?format=json&formatversion=2&${new URLSearchParams(p)}`;

/** Liens vers les sous-pages d'une page, dans l'ordre de la table des matières */
async function sousPagesDansOrdre(titre) {
  const r = await json(wsApi({ action: "parse", page: titre, prop: "text", redirects: "1" }));
  const html = r.parse?.text || "";
  // On compare les titres décodés (MediaWiki n'encode pas « : », « , »… de la même façon que JavaScript)
  const prefixe = titre + "/";
  const vus = new Set(), liste = [];
  for (const m of html.matchAll(/href="\/wiki\/([^"#?]+)/g)) {
    let t;
    try { t = decodeURIComponent(m[1].replace(/&amp;/g, "&")).replace(/_/g, " "); } catch { continue; }
    if (!t.startsWith(prefixe) || vus.has(t)) continue;
    vus.add(t); liste.push(t);
  }
  return liste;
}

/** Chapitres (feuilles) d'un roman, dans l'ordre, jusqu'à 3 niveaux (Tome > Livre > Chapitre) */
async function chapitresRoman(titre, profondeur = 0, compteur = { n: 0 }) {
  if (compteur.n > 400) return [];
  const sous = profondeur < 3 ? await sousPagesDansOrdre(titre) : [];
  if (!sous.length) { compteur.n++; return [titre]; }
  const out = [];
  for (const s of sous) { out.push(...await chapitresRoman(s, profondeur + 1, compteur)); await pause(120); }
  return out;
}

/** Essaie l'export PDF officiel de Wikisource (rapide, avec la mise en page d'origine) */
// Un seul essai (5 min max) : si le service est en panne, on passe tout de suite au plan B
async function pdfWsExport(titre) {
  const url = `https://ws-export.wmcloud.org/?${new URLSearchParams({ lang: "fr", title: titre, page: titre, format: "pdf-a4" })}`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`export ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (!b.subarray(0, 1024).toString("latin1").includes("%PDF")) throw new Error("export non PDF");
  return b;
}

/** Romans de Wikisource. opts : { recherche, max, deja, onEcarte, essai } */
export async function* romansWikisource({ recherche, max = 20, deja = () => false, onEcarte = () => {}, essai = false }) {
  const theme = String(recherche || "").trim();
  const sansTheme = !theme || /^romans?$/i.test(theme);
  let titres = [];

  // 1. Trouver des romans : la catégorie « Romans », ou une recherche (titre, auteur…) limitée aux romans
  if (sansTheme) {
    let suite = {};
    while (titres.length < max * 4) {
      const r = await json(wsApi({ action: "query", list: "categorymembers", cmtitle: "Catégorie:Romans", cmtype: "page", cmnamespace: "0", cmlimit: "200", ...suite }));
      titres.push(...(r.query?.categorymembers || []).map((m) => m.title));
      if (!r.continue) break;
      suite = { cmcontinue: r.continue.cmcontinue };
    }
  } else {
    for (const q of [`${theme} incategory:Romans`, `${theme} roman`]) {
      const r = await json(wsApi({ action: "query", list: "search", srsearch: q, srnamespace: "0", srlimit: "100" }));
      titres = (r.query?.search || []).map((h) => h.title);
      if (titres.length) break;
    }
  }
  titres = [...new Set(titres.map((t) => t.split("/")[0]))];

  let rendus = 0;
  for (const titre of titres) {
    if (rendus >= max) break;
    const cle = `wikisource:${titre}`;
    if (deja(cle)) continue;

    // Auteur : premier lien vers une page « Auteur: »
    const l = await json(wsApi({ action: "query", prop: "links", titles: titre, plnamespace: "102", pllimit: "5" }));
    const auteur = (l.query?.pages?.[0]?.links?.[0]?.title || "").replace(/^Auteur:/, "") || "Auteur inconnu";
    const source = `https://${WS}/wiki/${encodeURIComponent(titre.replace(/ /g, "_"))}`;

    let buffer = Buffer.alloc(0), nbChap = 0;
    if (!essai) {
      // 2a. Export officiel en PDF
      try { buffer = await pdfWsExport(titre); }
      catch {
        // 2b. Sinon : on assemble nous-mêmes le texte des chapitres
        const chap = await chapitresRoman(titre);
        const chapitres = [];
        let total = 0;
        for (const t of chap) {
          const ex = await json(wsApi({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", titles: t, redirects: "1" }));
          const texte = (ex.query?.pages?.[0]?.extract || "").trim();
          if (texte.length > 100) { chapitres.push({ titre: t === titre ? titre : t.slice(titre.length + 1).replace(/\//g, " — "), texte }); total += texte.length; }
          if (total > 3_000_000) break;
          await pause(150);
        }
        if (total < 20000) { onEcarte("trop court ou introuvable"); continue; }
        nbChap = chapitres.length;
        buffer = await pdfTexte({
          titre, sousTitre: `${auteur} · roman`, chapitres,
          mentions: `Œuvre du domaine public.\nTexte : Wikisource, ${source}\nTranscription : contributeurs de Wikisource, licence CC BY-SA 4.0.\nMis en page par unidev.`,
          etiquette: "ROMAN",
        });
      }
    }
    rendus++;
    yield {
      cle, titre, nomFichier: `${titre} - ${auteur}.pdf`.replace(/[\\/:*?"<>|]/g, " "), buffer,
      infos: {
        titre, matiere: auteur, filiere: "Littérature", type: "Roman", niveau: "Autre", annee: "", universite: "Wikisource",
        description: `Roman de ${auteur}. Œuvre du domaine public${nbChap ? ` (${nbChap} chapitres)` : ""}. Texte de Wikisource (transcription sous licence CC BY-SA 4.0) · Source : ${source}`,
      },
      licence: "Domaine public", source,
    };
    await pause(500);
  }
}

/* ---------- Site autorisé (ex. Fomesoutra) : tous les documents liés depuis une page ---------- */
// À utiliser UNIQUEMENT sur un site qui t'a donné son accord. L'outil va doucement (1 page par seconde).
const NAV = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 unidev-import";
const ext = (u) => (decodeURIComponent(new URL(u).pathname).match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
const PAS_DES_PAGES = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mp4|mp3|woff2?|ttf|xml|json)$/i;
const VIDE = /^(t[ée]l[ée]charger|download|cliquez ici|ici|lire|voir|pdf|lien)$/i;
const html2txt = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

/** Type réel d'un fichier d'après ses premiers octets */
function genreFichier(b) {
  const debut = b.subarray(0, 1024).toString("latin1");
  if (debut.includes("%PDF")) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip";       // docx, pptx, xlsx, odt, zip
  if (b[0] === 0xd0 && b[1] === 0xcf) return "office";    // doc, ppt, xls anciens
  if (/<html|<!doctype/i.test(debut)) return "html";
  return "autre";
}

async function lirePage(url) {
  return avecRelance(async () => {
    const r = await fetch(url, { headers: { "User-Agent": NAV, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(60000), redirect: "follow" });
    if (!r.ok) throw new Error(`page ${r.status}${r.status >= 500 || r.status === 429 ? " 503" : ""}`);
    const type = r.headers.get("content-type") || "";
    const buffer = Buffer.from(await r.arrayBuffer());
    return { type, buffer, final: r.url, dispo: r.headers.get("content-disposition") || "" };
  }, { nom: new URL(url).host });
}

/**
 * Parcourt un site à partir d'une page et récupère les documents liés (PDF, Word, PowerPoint…).
 * opts : { url, profondeur (1 = seulement cette page), max, deja, onEcarte, essai }
 */
export async function* documentsDuSite({ url, profondeur = 3, max = 50, deja = () => false, onEcarte = () => {}, essai = false, remplacer = [], logos = new Set() }) {
  const depart = new URL(url);
  const memeSite = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return h === depart.hostname.replace(/^www\./, ""); } catch { return false; } };
  const file = [{ url: depart.href, niveau: 1, dossiers: [] }];
  // On reste DANS le dossier de départ : seules les pages dont l'adresse commence comme la sienne sont visitées
  // (sous-dossiers, pages suivantes). Adresse en « ?id=… » (pas de chemin) : tout le site, comme avant.
  const base = depart.pathname.replace(/\/(index\.(html?|php))?$/i, "").replace(/\.(html?|php)$/i, "");
  const dansLeDossier = (u) => {
    if (base.split("/").filter(Boolean).length < 1) return true;
    const p = new URL(u).pathname;
    return p === depart.pathname || p.startsWith(base + "/") || p.startsWith(base + "?") || p.replace(/\.(html?|php)$/i, "") === base;
  };
  const titreDossier = (t) => t.length > 2 && t.length < 90 && !/^(accueil|cours|retour|suivant|précédent|precedent|\d+)$/i.test(t);
  const pagesVues = new Set(), docsVus = new Set();
  let rendus = 0, pagesLues = 0;

  while (file.length && rendus < max && pagesLues < 800) {
    const { url: page, niveau, dossiers = [] } = file.shift();
    if (pagesVues.has(page)) continue;
    pagesVues.add(page);
    let res;
    try { res = await lirePage(page); } catch (e) { onEcarte("page illisible"); continue; }
    pagesLues++;
    const html = res.buffer.toString("utf8");
    const titrePage = html2txt((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).replace(/\s*[-|–]\s*[^-|–]*$/, "");
    console.log(`   page lue : ${page}`);

    // Tous les liens de la page, avec leur texte
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (rendus >= max) break;
      let lien;
      try { lien = new URL(m[1].replace(/&amp;/g, "&"), res.final).href; } catch { continue; }
      if (!/^https?:/.test(lien)) continue;
      const texte = html2txt(m[2]);
      const e = ext(lien);
      const estDoc = EXTENSIONS.includes(e) || /t[ée]l[ée]charg|download|wpdmdl|dl=|\/download\//i.test(texte + " " + lien);

      // Pages suivantes de la même liste (« Suivant », « 2 », « » », ?page=2, /page/2/…) : suivies sans compter de niveau
      const pagination = memeSite(lien) && !estDoc && (
        /\brel\s*=\s*["']?next/i.test(m[0])
        || /^(suivant(e)?|page suivante|next|»|›|>|>>|\d{1,3})$/i.test(texte)
        || (/([?&](page|p|paged|pg|start|debut)=\d+|\/page\/\d+\/?$)/i.test(lien) && /\d|suiv|next|»|›/i.test(texte)));
      if (pagination) {
        if (!pagesVues.has(lien) && !file.some((x) => x.url === lien)) file.unshift({ url: lien, niveau, dossiers });
        continue;
      }
      if (!estDoc) {
        // Sous-dossier (ex. « ANALYSE NUMERIQUE ») : visité, et son nom sert à classer les documents qu'il contient
        if (niveau < profondeur && memeSite(lien) && dansLeDossier(lien) && !PAS_DES_PAGES.test(new URL(lien).pathname) && !pagesVues.has(lien) && !file.some((x) => x.url === lien))
          file.push({ url: lien, niveau: niveau + 1, dossiers: titreDossier(texte) ? [...dossiers, texte] : dossiers });
        continue;
      }
      if (!memeSite(lien) && !EXTENSIONS.includes(e)) continue;
      if (docsVus.has(lien)) continue;
      docsVus.add(lien);
      const cle = `site:${lien}`;
      if (deja(cle)) continue;

      // Titre : texte du lien s'il est parlant, sinon titre de la page ou nom du fichier
      const nomUrl = decodeURIComponent(new URL(lien).pathname.split("/").pop() || "");
      const titreFichier = EXTENSIONS.includes(e) ? titreDepuisFichier(nomUrl) : "";
      const fichierParlant = titreFichier.replace(/[^a-zà-ÿ]/gi, "").length >= 8;
      // Titre = le nom du fichier tel que le site le fournit ; sinon le texte du lien, puis le titre de la page
      let titre = fichierParlant ? titreFichier : (texte && !VIDE.test(texte) && texte.length > 6 ? texte : titrePage) || titreFichier || "Document";
      titre = couper(titre.replace(/\s*\(?\s*(pdf|docx?|pptx?)\s*\)?\s*$/i, ""), 140);

      let buffer = Buffer.alloc(0), format = e || "pdf", nomFichier = nomUrl || `${titre}.${format}`;
      if (!essai) {
        let f;
        try { f = await lirePage(lien); } catch { onEcarte("téléchargement impossible"); continue; }
        const genre = genreFichier(f.buffer);
        if (genre === "html") {
          // Page de téléchargement intermédiaire : on la visitera pour trouver le vrai fichier
          if (memeSite(f.final) && !pagesVues.has(f.final)) file.unshift({ url: f.final, niveau: Math.min(niveau + 1, profondeur), dossiers });
          continue;
        }
        if (genre === "autre") { onEcarte("format inconnu"); continue; }
        if (f.buffer.length > 100 * 1048576) { onEcarte("plus de 100 Mo"); continue; }
        buffer = f.buffer;
        // Signature du site partenaire -> unidev (seulement si demandé, et seulement dans les PDF)
        if (remplacer.length && genre === "pdf") {
          try {
            const { remplacerSignature } = await import("./marque.js");
            const r = await remplacerSignature(buffer, remplacer, { logos });
            buffer = r.buffer;
            if (r.lignes || r.liens || r.logos) console.log(`   signature remplacée : ${r.logos ? `${r.logos} logo(s), ` : ""}${r.lignes} ligne(s), ${r.liens} lien(s)${r.ignores ? ` · ${r.ignores} filigrane(s) penché(s) laissé(s)` : ""}`);
          } catch (e) { console.log(`   (signature non remplacée : ${e.message})`); }
        }
        const nomDispo = (f.dispo.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1];
        if (nomDispo) nomFichier = decodeURIComponent(nomDispo);
        const eDispo = (nomFichier.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
        format = genre === "pdf" ? "pdf" : EXTENSIONS.includes(eDispo) ? eDispo : genre === "zip" ? "docx" : "doc";
        if (!/\.[a-z0-9]{2,5}$/i.test(nomFichier)) nomFichier += "." + format;
        // Le vrai nom du fichier envoyé par le site (souvent plus précis que le lien) devient le titre
        const titreReel = titreDepuisFichier(nomFichier);
        if (titreReel.replace(/[^a-zà-ÿ]/gi, "").length >= 8) titre = couper(titreReel, 140);
      }

      // Le titre décide en priorité ; la page et l'adresse complètent (sans « .html », « .php »…)
      const chemin = (u) => decodeURIComponent(new URL(u).pathname).replace(/\.(html?|php|aspx?)\b/gi, " ").replace(/[\/_-]+/g, " ");
      const devine = devinerAvecTheme(titre, `${dossiers.join(" ")} ${titrePage} ${chemin(page)}`);
      // Nom du dossier le plus proche (« ANALYSE NUMERIQUE ») = la matière, si le titre ne la donne pas
      const dossierProche = dossiers.length ? dossiers[dossiers.length - 1] : "";
      const enPhrase = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
      rendus++;
      yield {
        cle, titre, nomFichier: nomFichier.replace(/[\\/:*?"<>|]/g, " "), buffer, licence: `autorisation de ${depart.hostname}`, source: page,
        infos: {
          titre, matiere: deviner(titre).matiere || (dossierProche ? enPhrase(dossierProche) : "") || devine.matiere || devine.filiere || "Divers", filiere: devine.filiere || "Autre", type: devine.type || "Autre",
          niveau: devine.niveau || "Autre", annee: (titre.match(/\b(20\d\d|19\d\d)\b/) || [])[1] || "", universite: "",
          description: `Document partagé avec l'autorisation de ${depart.hostname.replace(/^www\./, "")}. Source : ${page}`,
        },
      };
      await pause(1000);
    }
    await pause(1000);
  }
}
