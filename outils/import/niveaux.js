#!/usr/bin/env node
/**
 * Classe par niveau ET par type les documents déjà publiés qui n'en ont pas (« Autre ») :
 *   « Sujet corrigé BTS 2019 » -> Corrigé · « Série d'exercices » -> TD · « Aide-mémoire » -> Résumé
 *   « Sujet BTS 2019 » -> BTS 2 · « Examen L2 droit » -> Licence 2 · « Cours semestre 5 » -> Licence 3
 *
 *   node niveaux.js --essai   -> montre les changements sans rien modifier
 *   node niveaux.js           -> corrige
 *
 * Économe : 1 seule lecture Firestore (l'index). Un document dont le titre ne dit rien du niveau reste « Autre ».
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { niveauDe, typeDe, deviner } from "./outils.js";
import { canonFiliere, ajouterFilieres, FILIERES_AJOUTEES, toutesLesFilieres, appliquerRenommages } from "../../js/filieres.js";
import { lireCatalogue, ecrireCatalogue, ecrireCatalogueDirect, repartirCatalogue } from "./catalogue.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ESSAI = process.argv.includes("--essai");
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

// Filières en double (« Marketing digital » / « Marketing digitale »…) : la liste partagée est nettoyée,
// et chaque document reprend le nom unique de sa filière
const reglesFil = (await db.doc("index/filieres").get()).data() || {};
const listeAvant = reglesFil.liste || [];
ajouterFilieres(listeAvant);
appliquerRenommages(reglesFil.renommages || []); // renommages, fusions et suppressions faits par l'admin
const doublonsFilieres = listeAvant.length - FILIERES_AJOUTEES.length;
// Le catalogue est réparti en 4 morceaux (limite de 1 Mo par document Firestore) : on finit de déplacer les anciennes entrées
if (!ESSAI) { const n = await repartirCatalogue(db); if (n) console.log(`Catalogue : ${n} entrée(s) déplacée(s) dans leurs morceaux.`); }
const index = await lireCatalogue(db);
const changements = [];
const suspects = []; // peut-être dans la mauvaise filière : signalés, à vérifier dans l'admin (bouton « Modifier »)
const vide = (v) => !v || v === "Autre";
for (const [id, e] of Object.entries(index)) {
  if (!Array.isArray(e)) continue;
  const texte = `${e[0]} ${e[1]} ${e[2]}`; // titre, matière, filière
  // Filière « Autre » : rangé dans la filière que son titre indique
  const devinee = canonFiliere(deviner(`${e[0]} ${e[1]}`).filiere || "");
  const unique = vide(e[2]) ? "" : canonFiliere(e[2]);
  const filiere = vide(e[2]) && devinee && devinee !== "Autre" ? devinee : unique && unique !== e[2] ? unique : "";
  if (!filiere && devinee && devinee !== "Autre" && !vide(e[2]) && canonFiliere(e[2]) !== devinee) suspects.push({ titre: e[0], actuelle: e[2], devinee });
  if (!vide(e[3]) && !vide(e[4]) && !filiere) continue;
  const type = vide(e[3]) ? typeDe(texte) : "";
  const niveau = vide(e[4]) ? niveauDe(texte) : "";
  if (type || niveau || filiere) changements.push({ id, titre: e[0], type, niveau, filiere, entree: e });
}
const compter = (cle) => { const r = {}; changements.forEach((c) => { if (c[cle]) r[c[cle]] = (r[c[cle]] || 0) + 1; }); return r; };
const sansNiveau = Object.values(index).filter((e) => Array.isArray(e) && vide(e[4])).length;
const sansType = Object.values(index).filter((e) => Array.isArray(e) && vide(e[3])).length;
console.log(`${Object.keys(index).length} document(s) : ${sansNiveau} sans niveau, ${sansType} sans type. ${changements.length} classé(s) maintenant.\n`);
console.log(`Filières en double retirées de la liste : ${Math.max(0, doublonsFilieres)}`);
console.log(`Filières du site (${toutesLesFilieres().length}) : ${toutesLesFilieres().join(" | ")}`);
console.log("Niveaux :", Object.entries(compter("niveau")).map(([n, k]) => `${n} ${k}`).join(" · ") || "aucun");
console.log("Types   :", Object.entries(compter("type")).map(([n, k]) => `${n} ${k}`).join(" · ") || "aucun");
console.log("Filières :", Object.entries(compter("filiere")).map(([n, k]) => `${n} ${k}`).join(" · ") || "aucune");
changements.slice(0, 20).forEach((c) => console.log(`  ${c.titre}  ->  ${[c.filiere, c.type, c.niveau].filter(Boolean).join(" · ")}`));
if (suspects.length) {
  console.log(`\nPEUT-ÊTRE MAL PLACÉS : ${suspects.length} document(s). Admin > Publiés > cherche le titre > « Modifier » :`);
  suspects.slice(0, 40).forEach((x) => console.log(`  ${x.titre}  ·  rangé en ${x.actuelle}, plutôt ${x.devinee} ?`));
}
if (ESSAI) { console.log("\n(mode essai : rien n'a été modifié)"); process.exit(0); }

// merge : garde les renommages de l'admin
if (doublonsFilieres > 0) await db.doc("index/filieres").set({ liste: FILIERES_AJOUTEES }, { merge: true });
for (let i = 0; i < changements.length; i += 200) {
  const lot = changements.slice(i, i + 200);
  const entree = (c) => { const e = [...c.entree]; if (c.filiere) e[2] = c.filiere; if (c.type) e[3] = c.type; if (c.niveau) e[4] = c.niveau; return e; };
  const champs = (c) => ({ ...(c.filiere ? { filiere: c.filiere } : {}), ...(c.type ? { type: c.type } : {}), ...(c.niveau ? { niveau: c.niveau } : {}) });
  const batch = db.batch();
  for (const c of lot) batch.update(db.collection("documents").doc(c.id), champs(c));
  ecrireCatalogue(batch, db, Object.fromEntries(lot.map((c) => [c.id, entree(c)])));
  try { await batch.commit(); }
  catch {
    for (const c of lot) {
      try { await db.collection("documents").doc(c.id).update(champs(c)); await ecrireCatalogueDirect(db, { [c.id]: entree(c) }); } catch {}
    }
  }
}
console.log(`\nTerminé : ${changements.length} document(s) classé(s). Sur le site : filtres « Type » et « Niveau ».`);
process.exit(0);
