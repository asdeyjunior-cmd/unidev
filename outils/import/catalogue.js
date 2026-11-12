// Lecture et écriture du catalogue réparti en morceaux (voir js/morceaux.js).
import admin from "firebase-admin";
import { NOMS_MORCEAUX, parMorceau } from "../../js/morceaux.js";

const SUPPR = () => admin.firestore.FieldValue.delete();

/** Tout le catalogue : { idDocument: [titre, matière, filière, type, niveau, image, format, université, (suiteDe)] } */
export async function lireCatalogue(db) {
  const snaps = await db.getAll(...NOMS_MORCEAUX.map((n) => db.doc(`index/${n}`)));
  const tout = {};
  // L'ancien document unique d'abord : une entrée déjà déplacée dans son morceau la remplace
  for (const s of snaps) Object.assign(tout, s.data()?.docs || {});
  return tout;
}

/** Les écritures à faire pour ces entrées (valeur null = retirer du catalogue) */
function ecritures(db, entrees) {
  const ops = [];
  const ancien = {};
  for (const [nom, lot] of Object.entries(parMorceau(entrees))) {
    const docs = Object.fromEntries(Object.entries(lot).map(([id, v]) => [id, v === null ? SUPPR() : v]));
    ops.push([db.doc(`index/${nom}`), { docs }]);
    // L'entrée quitte l'ancien document unique (sinon elle y resterait en double, périmée)
    if (nom !== "catalogue") for (const id of Object.keys(lot)) ancien[id] = SUPPR();
  }
  if (Object.keys(ancien).length) ops.push([db.doc("index/catalogue"), { docs: ancien }]);
  return ops;
}
/** Dans un lot d'écritures existant */
export function ecrireCatalogue(batch, db, entrees) {
  for (const [ref, data] of ecritures(db, entrees)) batch.set(ref, data, { merge: true });
}
/** Tout de suite */
export async function ecrireCatalogueDirect(db, entrees) {
  const batch = db.batch();
  ecrireCatalogue(batch, db, entrees);
  await batch.commit();
}

/** Déplace les entrées de l'ancien document unique vers leurs morceaux (par lots). Renvoie le nombre déplacé. */
export async function repartirCatalogue(db, { max = 3000 } = {}) {
  const ancien = (await db.doc("index/catalogue").get()).data()?.docs || {};
  const aDeplacer = Object.entries(ancien).filter(([id]) => Object.keys(parMorceau({ [id]: 1 }))[0] !== "catalogue").slice(0, max);
  for (let i = 0; i < aDeplacer.length; i += 300) await ecrireCatalogueDirect(db, Object.fromEntries(aDeplacer.slice(i, i + 300)));
  return aDeplacer.length;
}
