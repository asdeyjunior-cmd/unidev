// Séries : documents qui se suivent (« … 1 », « … 2 », « Partie 3 », « Tome II », « suite »…).
// Reconnues automatiquement à partir des titres, sans lecture Firestore en plus (catalogue déjà chargé).
import { getSearchIndex } from "./firebase.js";

const sansAccent = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ROMAINS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const MOTS = "partie|part|suite|tome|chapitre|chap|ch|volume|vol|fascicule|fasc|lecon|seance|module|episode|livre|sequence|n|no|numero";

/** Titre -> { base, rang } (rang = place dans la série) ou null si le titre ne se termine pas par un numéro */
// Code ajouté devant le nom par certains sites (« 612a0b117cf71sujet… ») : ignoré pour former les séries
function sansCodeDevant(t) {
  const m = t.match(/^[0-9a-f]+/);
  if (!m || m[0].length < 8) return t;
  let n = m[0].length >= 13 ? 13 : 0;
  if (!n) for (let i = m[0].length - 1; i >= 0; i--) if (/\d/.test(m[0][i])) { n = i + 1; break; }
  return n >= 8 && (m[0].slice(0, n).match(/\d/g) || []).length >= 3 && /^[a-z]/.test(t.slice(n)) ? t.slice(n) : t;
}
const normal = (titre) => sansCodeDevant(sansAccent(titre).replace(/\.(pdf|docx?|pptx?)$/, "")).replace(/[^a-z0-9]+/g, " ").trim();
export function cleSerie(titre) {
  let t = normal(titre);
  // « … suite » sans numéro : 2e partie
  let m = t.match(/^(.*?)\s+suite$/);
  if (m && m[1].length >= 6) return { base: m[1].trim(), rang: 2 };
  // « 1ere partie », « 2e partie », « 3eme partie »
  m = t.match(/^(.*?)\s+(\d{1,2})\s*(?:ere|er|e|eme|nd|nde)\s+(?:partie|part|tome|volume)$/);
  if (m && m[1].length >= 6) return { base: m[1].trim(), rang: Number(m[2]) };
  // « … partie 2 », « … tome II », « … 3 »
  m = t.match(new RegExp(`^(.*?)\\s+(?:(?:${MOTS})\\s*)?(\\d{1,3}|[ivx]{1,4})$`));
  if (!m || m[1].length < 6) return null;
  const n = /^\d+$/.test(m[2]) ? Number(m[2]) : ROMAINS[m[2]];
  if (!n || n > 60) return null;
  // Une année (« … 2018 ») n'est pas un numéro de série
  if (/^(19|20)\d\d$/.test(m[2])) return null;
  return { base: m[1].replace(new RegExp(`\\s+(?:${MOTS})$`), "").trim(), rang: n };
}

/** Documents publiés (catalogue mémorisé par la page Documents, sinon 1 lecture) */
let catalogue = null;
export function documentsPublies() {
  if (catalogue) return catalogue;
  try {
    const memo = JSON.parse(sessionStorage.getItem("unidev-recherche") || "null");
    if (memo?.docs?.length) return (catalogue = Promise.resolve(memo.docs));
  } catch {}
  return (catalogue = getSearchIndex().catch(() => []));
}

/* Deux façons de former une série :
   1. l'étudiant a indiqué « c'est la suite de… » en publiant (lien sûr) ;
   2. sinon, automatiquement : titres qui se suivent (« … 1 », « … 2 ») ET même matière, même filière, même type. */
const pareil = (a, b) => {
  const n = (v) => sansAccent(v).replace(/[^a-z0-9]+/g, " ").trim();
  const x = n(a), y = n(b);
  return !x || !y || x === "autre" || y === "autre" || x === y; // une info manquante ne bloque pas
};
const memesInfos = (a, b) => pareil(a.matiere, b.matiere) && pareil(a.filiere, b.filiere) && pareil(a.type, b.type);

/** Série par liens « suite de » : on remonte au 1er document puis on suit les suites */
function serieParLiens(d, tous) {
  const parId = new Map(tous.map((x) => [x.id, x]));
  if (!parId.has(d.id)) parId.set(d.id, d);
  const suivants = new Map(); // id -> documents qui en sont la suite
  for (const x of parId.values()) if (x.suiteDe && parId.has(x.suiteDe)) {
    if (!suivants.has(x.suiteDe)) suivants.set(x.suiteDe, []);
    suivants.get(x.suiteDe).push(x);
  }
  let debut = d; const vus = new Set([d.id]);
  while (debut.suiteDe && parId.has(debut.suiteDe) && !vus.has(debut.suiteDe)) { debut = parId.get(debut.suiteDe); vus.add(debut.id); }
  const chaine = [debut]; const pris = new Set([debut.id]);
  for (let x = debut; ;) {
    const s = (suivants.get(x.id) || []).find((y) => !pris.has(y.id));
    if (!s) break;
    chaine.push(s); pris.add(s.id); x = s;
  }
  if (chaine.length < 2 || !pris.has(d.id)) return null;
  return chaine.map((x, i) => ({ ...x, cle: { rang: i + 1 } }));
}

/** Les documents de la même série que d, dans l'ordre (null s'il n'y en a pas d'autre) */
export async function serieDe(d) {
  const tous = await documentsPublies();
  let docs = serieParLiens(d, tous);
  if (!docs) {
    // Un titre sans numéro (« Droit des affaires ») est le n°1 de sa série (« Droit des affaires suite »)
    const cle = cleSerie(d.titre) || { base: normal(d.titre), rang: 1 };
    if (cle.base.length < 6) return null;
    const liste = tous
      .map((x) => {
        if (x.id !== d.id && !memesInfos(x, d)) return null;
        const c = cleSerie(x.titre);
        if (c && c.base === cle.base) return { ...x, cle: c };
        if (normal(x.titre) === cle.base) return { ...x, cle: { base: cle.base, rang: 1 } };
        return null;
      })
      .filter(Boolean);
    if (!liste.some((x) => x.id === d.id)) liste.push({ ...d, cle });
    if (liste.length < 2) return null;
    // Un seul document par numéro, du plus petit au plus grand
    const parRang = new Map();
    for (const x of liste.sort((a, b) => a.cle.rang - b.cle.rang)) if (!parRang.has(x.cle.rang) || x.id === d.id) parRang.set(x.cle.rang, x);
    docs = [...parRang.values()];
    if (docs.length < 2) return null;
  }
  const i = docs.findIndex((x) => x.id === d.id);
  return { docs, index: i, precedent: docs[i - 1] || null, suivant: docs[i + 1] || null };
}

/** Sur les cartes de la liste : petite étiquette « Série · 2/4 » (ouvre la fiche avec les autres parties) */
const deja = new Map(); // id -> texte ou ""
export async function annoterSeries(zone, fiches = new Map()) {
  for (const b of zone.querySelectorAll("[data-serie]")) {
    const id = b.dataset.serie;
    if (!deja.has(id)) {
      const d = fiches.get(id) || (await documentsPublies()).find((x) => x.id === id);
      const s = d ? await serieDe(d).catch(() => null) : null;
      deja.set(id, s ? `Série · ${s.index + 1}/${s.docs.length}` : "");
    }
    const t = deja.get(id);
    if (t) { b.textContent = t; b.hidden = false; }
  }
}
