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
import { niveauDe, typeDe } from "./outils.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ESSAI = process.argv.includes("--essai");
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

const index = (await db.doc("index/catalogue").get()).data()?.docs || {};
const changements = [];
const vide = (v) => !v || v === "Autre";
for (const [id, e] of Object.entries(index)) {
  if (!Array.isArray(e) || (!vide(e[3]) && !vide(e[4]))) continue;
  const texte = `${e[0]} ${e[1]} ${e[2]}`; // titre, matière, filière
  const type = vide(e[3]) ? typeDe(texte) : "";
  const niveau = vide(e[4]) ? niveauDe(texte) : "";
  if (type || niveau) changements.push({ id, titre: e[0], type, niveau, entree: e });
}
const compter = (cle) => { const r = {}; changements.forEach((c) => { if (c[cle]) r[c[cle]] = (r[c[cle]] || 0) + 1; }); return r; };
const sansNiveau = Object.values(index).filter((e) => Array.isArray(e) && vide(e[4])).length;
const sansType = Object.values(index).filter((e) => Array.isArray(e) && vide(e[3])).length;
console.log(`${Object.keys(index).length} document(s) : ${sansNiveau} sans niveau, ${sansType} sans type. ${changements.length} classé(s) maintenant.\n`);
console.log("Niveaux :", Object.entries(compter("niveau")).map(([n, k]) => `${n} ${k}`).join(" · ") || "aucun");
console.log("Types   :", Object.entries(compter("type")).map(([n, k]) => `${n} ${k}`).join(" · ") || "aucun");
changements.slice(0, 20).forEach((c) => console.log(`  ${c.titre}  ->  ${[c.type, c.niveau].filter(Boolean).join(" · ")}`));
if (ESSAI) { console.log("\n(mode essai : rien n'a été modifié)"); process.exit(0); }

for (let i = 0; i < changements.length; i += 200) {
  const lot = changements.slice(i, i + 200);
  const entree = (c) => { const e = [...c.entree]; if (c.type) e[3] = c.type; if (c.niveau) e[4] = c.niveau; return e; };
  const champs = (c) => ({ ...(c.type ? { type: c.type } : {}), ...(c.niveau ? { niveau: c.niveau } : {}) });
  const batch = db.batch();
  for (const c of lot) batch.update(db.collection("documents").doc(c.id), champs(c));
  batch.set(db.doc("index/catalogue"), { docs: Object.fromEntries(lot.map((c) => [c.id, entree(c)])) }, { merge: true });
  try { await batch.commit(); }
  catch {
    for (const c of lot) {
      try { await db.collection("documents").doc(c.id).update(champs(c)); await db.doc("index/catalogue").set({ docs: { [c.id]: entree(c) } }, { merge: true }); } catch {}
    }
  }
}
console.log(`\nTerminé : ${changements.length} document(s) classé(s). Sur le site : filtres « Type » et « Niveau ».`);
process.exit(0);
