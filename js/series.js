// Séries : documents qui se suivent (« … 1 », « … 2 », « Partie 3 », « Tome II », « suite »…).
// Reconnues automatiquement à partir des titres, sans lecture Firestore en plus (catalogue déjà chargé).
import { getSearchIndex } from "./firebase.js";

const sansAccent = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ROMAINS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const MOTS = "partie|part|suite|tome|chapitre|chap|ch|volume|vol|fascicule|fasc|lecon|seance|module|episode|livre|sequence|n|no|numero";

/** Titre -> { base, rang } (rang = place dans la série) ou null si le titre ne se termine pas par un numéro */
const normal = (titre) => sansAccent(titre).replace(/\.(pdf|docx?|pptx?)$/, "").replace(/[^a-z0-9]+/g, " ").trim();
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

/** Les documents de la même série que d, dans l'ordre (null s'il n'y en a pas d'autre) */
export async function serieDe(d) {
  // Un titre sans numéro (« Droit des affaires ») est le n°1 de sa série (« Droit des affaires suite »)
  const cle = cleSerie(d.titre) || { base: normal(d.titre), rang: 1 };
  if (cle.base.length < 6) return null;
  const liste = (await documentsPublies())
    .map((x) => {
      const c = cleSerie(x.titre);
      if (c && c.base === cle.base) return { ...x, cle: c };
      if (normal(x.titre) === cle.base) return { ...x, cle: { base: cle.base, rang: 1 } };
      return null;
    })
    .filter(Boolean);
  if (!liste.some((x) => x.id === d.id)) liste.push({ ...d, cle });
  if (liste.length < 2) return null;
  // Un seul document par numéro (le premier trouvé), du plus petit au plus grand
  const parRang = new Map();
  for (const x of liste.sort((a, b) => a.cle.rang - b.cle.rang)) if (!parRang.has(x.cle.rang) || x.id === d.id) parRang.set(x.cle.rang, x);
  const docs = [...parRang.values()];
  const i = docs.findIndex((x) => x.id === d.id);
  return { docs, index: i, precedent: docs[i - 1] || null, suivant: docs[i + 1] || null };
}
