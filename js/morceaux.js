// Le catalogue (résumé de tous les documents publiés) est réparti sur plusieurs documents Firestore :
// un seul document est limité à 1 Mo (environ 3 000 documents). Avec 4 morceaux : environ 12 000.
// Chaque document va toujours dans le même morceau, calculé à partir de son identifiant.
// Utilisé par le site (js/firebase.js) et par les outils (outils/import/catalogue.js) : la règle doit rester la même.
export const NB_MORCEAUX = 4;
export const nomMorceau = (i) => (i ? `catalogue-${i}` : "catalogue"); // le morceau 0 est l'ancien document unique
export const NOMS_MORCEAUX = Array.from({ length: NB_MORCEAUX }, (_, i) => nomMorceau(i));
export function morceauDe(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return nomMorceau(h % NB_MORCEAUX);
}
/** { idDocument: valeur } -> { nomDuMorceau: { idDocument: valeur } } */
export function parMorceau(entrees) {
  const r = {};
  for (const [id, v] of Object.entries(entrees)) (r[morceauDe(id)] ||= {})[id] = v;
  return r;
}
