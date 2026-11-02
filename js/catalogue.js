import { listPublishedPage, listPublished, getSearchIndex, getDocsByIds, getFileInfo, getCredits, listUnlocked, unlockDocument, filieresPretes } from "./firebase.js";
import { thumb } from "./cloudinary.js";
import { ouvrirDemandeFiliere } from "./demande-filiere.js";
import { habiller } from "./choix.js";
import { initLayout, docCard, fillSelect, toast, esc, modal, setNavCredits, fileModal } from "./ui.js";
import { canonFiliere, toutesLesFilieres } from "./filieres.js";
import { CATEGORIES, paymentConfig, CREDITS_PAR_PUBLICATION } from "./config.js";

const $ = (id) => document.getElementById(id);
const els = { q: $("f-q"), type: $("f-type"), niveau: $("f-niveau"), filiere: $("f-filiere"), sort: $("f-sort"), list: $("list") };
let docs = [];
let me = null;
let credits = 0;
let unlocked = new Set();

initLayout("docs", async ({ user, profile }) => {
  me = user;
  credits = profile?.credits || 0;
  unlocked = user ? await listUnlocked(user.uid).catch(() => new Set()) : new Set();
  if (docs.length) render();
});

fillSelect(els.type, CATEGORIES.types, "Type");
// Libellés courts pour que le niveau choisi reste lisible dans la pastille
const COURT = { "Licence 1": "L1", "Licence 2": "L2", "Licence 3": "L3", "Master 1": "M1", "Master 2": "M2", "Doctorat": "Doctorat" };
els.niveau.innerHTML = `<option value="">Niveau</option>` +
  CATEGORIES.niveaux.map((v) => `<option value="${esc(v)}" data-court="${esc(COURT[v] || v)}">${esc(v)}</option>`).join("");
// Menus stylés (le <select> reste caché derrière)
habiller(els.type, { tous: "Tous les types" });
habiller(els.niveau, { tous: "Tous les niveaux" });
habiller(els.filiere, { tous: "Toutes les filières" });
habiller(els.sort, { icone: "tri" });

const norm = (s = "") => s.toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ---------- Chargement progressif : 8 documents à la fois ---------- */
// Téléphone : 8 documents à la fois ; PC (5 par ligne) : 20, pour remplir des lignes entières
const PAGE = matchMedia("(min-width: 1200px)").matches ? 20 : matchMedia("(min-width: 601px)").matches ? 16 : 8;
// Vrai si le bas de la liste est visible (ou presque) : il faut charger la suite
const procheDuBas = () => $("more").getBoundingClientRect().top < innerHeight + 600;
let cursor = null;
let done = false;
let loading = false;
let firstLoad = true;
const filieres = new Set();

const filtersActive = () => els.q.value.trim() || els.type.value || els.niveau.value || els.filiere.value;

function visibleDocs() {
  const q = norm(els.q.value.trim());
  return docs.filter((d) =>
    (!els.type.value || d.type === els.type.value) &&
    (!els.niveau.value || d.niveau === els.niveau.value) &&
    (!els.filiere.value || d.filiere === els.filiere.value) &&
    (!q || norm([d.titre, d.matiere, d.filiere, d.universite, d.description, d.annee].join(" ")).includes(q))
  );
}

function render() {
  if (firstLoad) return; // le spinner reste affiché jusqu'aux 8 premiers documents
  const out = visibleDocs();
  els.list.innerHTML = out.length
    ? out.map((d) => {
        const free = me && (unlocked.has(d.id) || d.auteurId === me.uid);
        return docCard(d, `<button class="btn btn-sm btn-dl ${free ? "" : "btn-ink"}" data-dl="${d.id}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/></svg><span>Télécharger</span>${free ? "" : `<span class="dl-cout"> · 1 crédit</span>`}</button>`, { prix: free ? "Débloqué" : "1 crédit" });
      }).join("")
    : done || (filtersActive() && (indexComplet || pagesFiltre >= 5))
      ? `<div class="empty">${filtersActive() ? (els.filiere.value && !els.q.value.trim() ? `Pas encore de documents en ${esc(els.filiere.value)}.` : "Aucun document ne correspond à ta recherche.") : "Aucun document pour le moment."}<br><a href="publier.html">Publie le premier !</a>${filtersActive() ? `<br><a href="#" data-demande-filiere>Ta filière n'est pas sur unidev ? Dis-le nous</a>` : ""}</div>`
      : "";
  $("more").innerHTML = loading ? `<div class="loader loader-sm"></div>` : "";
}

function updateFilieres(items) {
  items.forEach((d) => { if (d.filiere) d.filiere = canonFiliere(d.filiere); }); // aussi pour le cache de la dernière visite
  const before = filieres.size;
  items.forEach((d) => d.filiere && filieres.add(d.filiere));
  if (filieres.size !== before) remplirFilieres();
}
/* Choix « Filière » : toutes les filières tout de suite (sans attendre les documents, lents à venir sur téléphone),
   par ordre alphabétique, puis « Ma filière n'est pas là… » */
function remplirFilieres() {
  const liste = [...new Set([...filieres, ...toutesLesFilieres()])].filter((f) => f && f !== "Autre").sort((a, b) => a.localeCompare(b, "fr"));
  if (filieres.has("Autre")) liste.push("Autre");
  const current = els.filiere.value;
  els.filiere.innerHTML = `<option value="">Filière</option>${liste.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}<option value="__demande__">Ma filière n'est pas là…</option>`;
  if (current && ![...els.filiere.options].some((o) => o.value === current)) els.filiere.add(new Option(current, current), els.filiere.options[1]);
  els.filiere.value = current;
}
remplirFilieres();
filieresPretes.then(remplirFilieres).catch(() => {});

/* Cache de la dernière visite : les 8 premiers documents s'affichent tout de suite */
const CACHE_KEY = () => `unidev-accueil-${els.sort.value}`;
let fromCache = false;
function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY()) || "null"); } catch { return null; }
}
function writeCache(items) {
  try { localStorage.setItem(CACHE_KEY(), JSON.stringify(items)); } catch {}
}
function showCache() {
  const cached = readCache();
  if (!cached?.length) return;
  docs = cached; fromCache = true; firstLoad = false;
  updateFilieres(cached);
  render();
}

/* Connexion lente : message + bouton Réessayer au bout de 10 s */
let slowTimer = null;
function watchSlow() {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (!loading) return;
    const box = docs.length ? $("more") : els.list;
    box.innerHTML = `<div class="first-load"><div class="loader"></div>
      <p class="muted">Le chargement prend du temps. Vérifie ta connexion internet.</p>
      <button class="btn btn-sm btn-ghost-ink" id="retry" style="margin-top:8px">Réessayer</button></div>`;
    $("retry").onclick = () => location.reload();
  }, 10000);
}

/* « À la une » : un ordre différent chaque semaine (change le lundi), le même pour tout le monde pendant la semaine */
const semaine = () => Math.floor((Date.now() / 864e5 + 3) / 7); // n° de semaine, du lundi au dimanche
function melange(id, n) { // nombre « au hasard » mais fixe pour un document et une semaine
  let h = 2166136261;
  for (const c of `${id}:${n}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
let ordreSemaine = null, rangSemaine = 0;
async function pageDeLaSemaine() {
  if (!ordreSemaine) {
    const liste = await getPool();
    if (!indexComplet) return listPublishedPage("recent", cursor, PAGE); // pas d'index : les plus récents
    const n = semaine();
    ordreSemaine = liste.map((d) => [melange(d.id, n), d]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }
  const tranche = ordreSemaine.slice(rangSemaine, rangSemaine + PAGE);
  rangSemaine += tranche.length;
  const items = await completer(tranche); // fiches complètes : autant de lectures qu'avant
  return { items, cursor: rangSemaine, done: rangSemaine >= ordreSemaine.length };
}

let resteRecherche = [], pagesFiltre = 0; // résultats d'un filtre pas encore affichés (catalogue complet en mémoire)
async function loadPage() {
  // Filtre ou recherche avec le catalogue complet : on affiche la suite des résultats trouvés,
  // sans jamais parcourir toute la base (sinon chargement sans fin + milliers de lectures)
  if (filtersActive() && indexComplet) {
    if (loading || !resteRecherche.length) return;
    loading = true; render();
    try {
      const deja = new Set(docs.map((x) => x.id));
      const extra = await completer(resteRecherche.splice(0, PAGE).filter((x) => !deja.has(x.id)));
      docs.push(...extra);
    } catch (e) { console.error(e); }
    loading = false; render();
    return;
  }
  if (filtersActive() && pagesFiltre >= 5) return; // catalogue indisponible : on n'insiste pas
  if (loading || done) return;
  loading = true;
  render();
  watchSlow();
  try {
    const page = els.sort.value === "semaine" ? await pageDeLaSemaine() : await listPublishedPage(els.sort.value, cursor, PAGE);
    if (fromCache) { docs = []; fromCache = false; } // les données fraîches remplacent le cache
    const deja = new Set(docs.map((x) => x.id));
    docs.push(...page.items.filter((x) => !deja.has(x.id)));
    if (!cursor) writeCache(page.items);
    cursor = page.cursor;
    done = page.done;
    updateFilieres(page.items);
  } catch (e) {
    console.error(e);
    done = true;
    const msg = /index/i.test(e.message) ? "La liste se prépare (index Firestore en cours de création). Réessaie dans quelques minutes."
      : /offline|unavailable|network/i.test(e.message + e.code) ? "Pas de connexion internet."
      : e.message;
    toast(msg, "err");
  }
  clearTimeout(slowTimer);
  loading = false;
  firstLoad = false;
  render();
  // Avec un filtre ou une recherche, on continue tant qu'il y a moins de 8 résultats visibles
  // (5 pages au plus : on ne parcourt jamais toute la base pour un filtre)
  if (!done && filtersActive() && !indexComplet && visibleDocs().length < PAGE && ++pagesFiltre < 5) loadPage();
  // Si la page n'est pas encore remplie, on charge la suite
  // Le bas de la liste est encore visible (écran large, page courte) : on charge la suite tout de suite
  else if (!done && procheDuBas()) loadPage();
}

function resetAndLoad() {
  docs = []; cursor = null; done = false; firstLoad = true; fromCache = false;
  ordreSemaine = null; rangSemaine = 0;
  els.list.innerHTML = `<div class="first-load"><div class="loader"></div><p class="muted">Chargement des documents…</p></div>`;
  showCache();
  loadPage();
}

// La suite se charge quand on arrive près du bas de la liste
// Filet de sécurité : en descendant, on vérifie aussi à chaque défilement (certains PC ne relancent pas l'observateur)
let attenteScroll = null;
addEventListener("scroll", () => {
  if (attenteScroll) return;
  attenteScroll = setTimeout(() => { attenteScroll = null; if (!firstLoad && !done && !loading && procheDuBas()) loadPage(); }, 150);
}, { passive: true });

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && !firstLoad) loadPage();
}, { rootMargin: "400px" }).observe($("more"));

/* ---------- Téléchargement par crédits ---------- */

function showFile(d, info) {
  fileModal(d, info, {
    texte: "Ce document est débloqué pour ton compte : tu peux le retélécharger à tout moment.",
    apres: credits < 1 ? `<div class="out-of-credits">
      <p><strong>Tu n'as plus de crédits.</strong> Prends-en pour tes prochains téléchargements.</p>
      <a class="btn btn-ink btn-block" href="acheter.html">Acheter des crédits</a></div>` : "",
  });
}

function askCredits() {
  const { prixPack, creditsParPack } = paymentConfig;
  modal(`<h3>Il te faut 1 crédit</h3>
    <p class="muted" style="margin:6px 0 18px">Chaque téléchargement coûte 1 crédit. Deux façons d'en obtenir :</p>
    <div class="choice"><strong>Publier un document</strong><span class="muted">+${CREDITS_PAR_PUBLICATION} crédit dès qu'il est validé</span>
      <a class="btn btn-sm" href="publier.html">Publier</a></div>
    <div class="choice"><strong>Payer ${prixPack} FCFA</strong><span class="muted">+${creditsParPack} crédits après confirmation</span>
      <a class="btn btn-sm" href="acheter.html">Acheter</a></div>
    <button class="btn btn-ghost btn-block" data-close style="margin-top:8px">Fermer</button>`);
}

els.list.addEventListener("click", async (e) => {
  const id = e.target.dataset?.dl;
  if (!id) return;
  if (!me) return (location.href = "connexion.html?next=index.html");
  const d = docs.find((x) => x.id === id);
  const btn = e.target;

  try {
    btn.disabled = true;
    if (unlocked.has(id) || d.auteurId === me.uid) return showFile(d, await getFileInfo(id));

    credits = await getCredits(me.uid);
    setNavCredits(credits);
    if (credits < 1) return askCredits();
    if (!confirm(`Utiliser 1 crédit pour débloquer « ${d.titre} » ?\nIl te restera ${credits - 1} crédit(s).`)) return;

    await unlockDocument(me.uid, id);
    unlocked.add(id);
    credits -= 1;
    setNavCredits(credits);
    d.telechargements = (d.telechargements || 0) + 1;
    render();
    showFile(d, await getFileInfo(id));
  } catch (err) {
    console.error(err);
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

/* « Ma filière n'est pas là » : dernière ligne du choix de filière */
const DEMANDE = "__demande__";
let filiereAvant = "";
function optionDemande() { // appelée aussi avant cette ligne (cache de la dernière visite) : pas de constante ici
  if (![...els.filiere.options].some((o) => o.value === "__demande__")) els.filiere.add(new Option("Ma filière n'est pas là…", "__demande__"));
}
optionDemande();
els.filiere.addEventListener("focus", () => { filiereAvant = els.filiere.value; });
els.filiere.addEventListener("change", (e) => {
  if (els.filiere.value !== DEMANDE) { filiereAvant = els.filiere.value; return; }
  e.stopImmediatePropagation();
  els.filiere.value = els.filiere.dataset.avant ?? filiereAvant;
  ouvrirDemandeFiliere(els.filiere.dataset.recherche || ""); // reprend ce que l'étudiant a cherché
});
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-demande-filiere]");
  if (!a) return;
  e.preventDefault();
  ouvrirDemandeFiliere();
});

// Un filtre cherche dans TOUS les documents (index), pas seulement ceux déjà affichés
[els.type, els.niveau, els.filiere].forEach((el) => el.addEventListener("change", () => {
  render();
  if (filtersActive()) appliquerRecherche({ defiler: false });
}));

/* ---------- Recherche avec suggestions (comme une boutique en ligne) ---------- */
const sug = $("suggest");
const clearBtn = $("q-clear");
let pool = null;          // documents publiés chargés une fois pour les suggestions
let indexComplet = false; // l'index contient TOUS les documents publiés : inutile de parcourir la base page par page
let sugItems = [];        // éléments affichés (pour le clavier)
let sugIndex = -1;
let sugTimer = null;

// Mémorisé 10 minutes par onglet : évite de relire la base à chaque recherche (quota gratuit Firestore)
// Le filtre « Filière » est rempli tout de suite avec toutes les filières qui ont des documents
setTimeout(() => getPool().then(updateFilieres).catch(() => {}), 0);

const POOL_KEY = "unidev-recherche";
function getPool() {
  if (pool) return pool;
  try {
    const memo = JSON.parse(sessionStorage.getItem(POOL_KEY) || "null");
    if (memo && Date.now() - memo.t < 10 * 60 * 1000) { indexComplet = memo.docs.length > 150; return (pool = Promise.resolve(memo.docs)); }
  } catch {}
  // Index de recherche (1 lecture) ; s'il n'existe pas encore, on lit les 150 derniers documents
  pool = getSearchIndex()
    .then((idx) => { indexComplet = idx.length > 0; return idx.length ? idx : listPublished(150); })
    .then((list) => { try { sessionStorage.setItem(POOL_KEY, JSON.stringify({ t: Date.now(), docs: list })); } catch {} return list; })
    .catch((e) => { console.error(e); pool = null; return []; });
  return pool;
}
const surligne = (texte, q) => {
  const t = String(texte || "");
  const i = norm(t).indexOf(q);
  return i < 0 ? esc(t) : esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
};
const correspond = (d, q) => norm([d.titre, d.matiere, d.filiere, d.universite, d.description, d.type, d.niveau, d.annee].join(" ")).includes(q);

function tousLesDocs(extra) {
  const map = new Map();
  [...docs, ...(extra || [])].forEach((d) => map.set(d.id, d));
  return [...map.values()];
}

async function majSuggestions() {
  const brut = els.q.value.trim();
  clearBtn.hidden = !brut;
  if (!brut) return fermerSuggestions();
  const q = norm(brut);
  const liste = tousLesDocs(await getPool());
  if (norm(els.q.value.trim()) !== q) return; // la saisie a changé entre-temps
  // Les documents dont le titre correspond passent en premier
  const trouves = liste.filter((d) => correspond(d, q))
    .sort((a, b) => (norm(b.titre).includes(q) ? 1 : 0) - (norm(a.titre).includes(q) ? 1 : 0));

  // Catégories : types, filières et matières qui correspondent
  const cats = [];
  const vus = new Set();
  const ajouteCat = (genre, valeur) => {
    const cle = genre + valeur;
    if (!valeur || vus.has(cle) || !norm(valeur).includes(q) || cats.length >= 3) return;
    vus.add(cle);
    cats.push({ genre, valeur });
  };
  CATEGORIES.types.forEach((t) => ajouteCat("Type", t));
  liste.forEach((d) => { ajouteCat("Filière", d.filiere); ajouteCat("Matière", d.matiere); });

  const top = trouves.slice(0, 5);
  sugItems = [
    ...cats.map((c) => ({ kind: "cat", ...c })),
    ...top.map((d) => ({ kind: "doc", d })),
    { kind: "all" },
  ];
  sugIndex = -1;
  const ICON_CAT = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  sug.innerHTML = sugItems.map((it, i) => {
    if (it.kind === "cat") {
      return `<div class="sug-row sug-cat" role="option" data-i="${i}"><span class="sug-ico">${ICON_CAT}</span>
        <span class="sug-text">${it.genre} : <b>${surligne(it.valeur, q)}</b></span></div>`;
    }
    if (it.kind === "doc") {
      const d = it.d;
      const img = d.imageUrl ? `<img src="${esc(thumb(d.imageUrl, 96, 96))}" alt="" loading="lazy" />` : `<span>${esc((d.format || "doc").toUpperCase())}</span>`;
      return `<div class="sug-row" role="option" data-i="${i}"><span class="sug-thumb">${img}</span>
        <span class="sug-text"><span class="sug-title">${surligne(d.titre, q)}</span><small>${esc(d.matiere || "")}</small></span>
        <span class="sug-side">${esc([d.type, d.niveau].filter(Boolean).join(" · "))}</span></div>`;
    }
    return trouves.length
      ? `<div class="sug-row sug-all" role="option" data-i="${i}">Voir les ${trouves.length} résultat${trouves.length > 1 ? "s" : ""} pour « ${esc(brut)} »</div>`
      : `<div class="sug-row sug-none" data-i="${i}">Aucun document pour « ${esc(brut)} »</div>`;
  }).join("");
  sug.hidden = false;
  els.q.setAttribute("aria-expanded", "true");
}

function fermerSuggestions() {
  sug.hidden = true;
  sug.innerHTML = "";
  sugItems = [];
  sugIndex = -1;
  els.q.setAttribute("aria-expanded", "false");
}

/* Appliquer la recherche à la liste (avec tous les documents trouvés) */
async function completer(liste) {
  // Les entrées de l'index sont résumées : on charge la fiche complète (60 au maximum)
  const partiels = liste.filter((d) => d.partiel).slice(0, 60).map((d) => d.id);
  const complets = partiels.length ? await getDocsByIds(partiels) : [];
  const parId = new Map(complets.map((d) => [d.id, d]));
  return liste.filter((d) => !d.partiel || parId.has(d.id)).map((d) => parId.get(d.id) || d);
}

async function appliquerRecherche({ defiler = true } = {}) {
  fermerSuggestions();
  if (defiler) els.q.blur();
  const q = norm(els.q.value.trim());
  const trouves = (await getPool()).filter((d) => (!q || correspond(d, q))
    && (!els.type.value || d.type === els.type.value)
    && (!els.niveau.value || d.niveau === els.niveau.value)
    && (!els.filiere.value || d.filiere === els.filiere.value));
  resteRecherche = []; pagesFiltre = 0;
  if (filtersActive()) {
    const deja = new Set(docs.map((x) => x.id));
    const nouveaux = trouves.filter((x) => !deja.has(x.id));
    // Premiers résultats tout de suite ; la suite se charge en descendant
    const extra = await completer(nouveaux.slice(0, PAGE * 2));
    resteRecherche = nouveaux.slice(PAGE * 2);
    docs.push(...extra);
    updateFilieres(extra);
  }
  render();
  if (!done && filtersActive() && !indexComplet && visibleDocs().length < PAGE && ++pagesFiltre < 5) loadPage();
  if (defiler) els.list.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function choisir(i) {
  const it = sugItems[i];
  if (!it || it.kind === undefined) return;
  if (it.kind === "all") return appliquerRecherche();
  if (it.kind === "cat") {
    els.q.value = "";
    if (it.genre === "Type") els.type.value = it.valeur;
    else if (it.genre === "Filière") {
      if (![...els.filiere.options].some((o) => o.value === it.valeur)) els.filiere.add(new Option(it.valeur, it.valeur));
      els.filiere.value = it.valeur;
    } else els.q.value = it.valeur;
    clearBtn.hidden = !els.q.value;
    return appliquerRecherche();
  }
  // Document : on l'affiche seul et on lance le téléchargement
  let d = it.d;
  if (d.partiel) d = (await completer([d]))[0] || d;
  if (!docs.some((x) => x.id === d.id)) docs.push(d);
  els.q.value = d.titre;
  clearBtn.hidden = false;
  fermerSuggestions();
  render();
  requestAnimationFrame(() => els.list.querySelector(`[data-dl="${CSS.escape(d.id)}"]`)?.click());
}

function surbrillance(i) {
  const rows = [...sug.querySelectorAll(".sug-row[role=option]")];
  if (!rows.length) return;
  sugIndex = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle("active", k === sugIndex));
  rows[sugIndex].scrollIntoView({ block: "nearest" });
}

els.q.addEventListener("input", () => {
  clearTimeout(sugTimer);
  sugTimer = setTimeout(majSuggestions, 120);
  if (!els.q.value.trim()) { render(); }
});
els.q.addEventListener("focus", () => { if (els.q.value.trim()) majSuggestions(); });
els.q.addEventListener("keydown", (e) => {
  if (sug.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); surbrillance(sugIndex + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); surbrillance(sugIndex - 1); }
  else if (e.key === "Escape") fermerSuggestions();
});
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const rows = [...sug.querySelectorAll(".sug-row[role=option]")];
  if (sugIndex >= 0 && rows[sugIndex]) choisir(Number(rows[sugIndex].dataset.i));
  else appliquerRecherche();
});
sug.addEventListener("mousedown", (e) => e.preventDefault()); // garde le focus dans le champ
sug.addEventListener("click", (e) => {
  const row = e.target.closest(".sug-row[role=option]");
  if (row) choisir(Number(row.dataset.i));
});
clearBtn.addEventListener("click", () => {
  els.q.value = "";
  clearBtn.hidden = true;
  fermerSuggestions();
  render();
  els.q.focus();
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) fermerSuggestions(); });

els.sort.addEventListener("change", resetAndLoad);

showCache();
loadPage();

// Recherche reçue dans l'adresse (ex. depuis Google : index.html?q=comptabilite)
const qUrl = new URLSearchParams(location.search).get("q");
if (qUrl) { els.q.value = qUrl; clearBtn.hidden = false; appliquerRecherche(); }

// Venu d'une page de document (index.html?doc=ID) : on affiche ce document et on propose le téléchargement
const docUrl = new URLSearchParams(location.search).get("doc");
if (docUrl) {
  getDocsByIds([docUrl]).then(async ([d]) => {
    if (!d) return toast("Ce document n'est plus disponible.", "err");
    while (firstLoad) await new Promise((r) => setTimeout(r, 150));
    if (!docs.some((x) => x.id === d.id)) docs.push(d);
    els.q.value = d.titre; clearBtn.hidden = false;
    render();
    history.replaceState(null, "", "index.html?q=" + encodeURIComponent(d.titre));
    requestAnimationFrame(() => els.list.querySelector(`[data-dl="${CSS.escape(d.id)}"]`)?.click());
  }).catch(() => {});
}
