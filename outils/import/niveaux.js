#!/usr/bin/env node
/**
 * Classe par niveau les documents déjà publiés qui n'en ont pas (« Autre ») :
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
import { niveauDe } from "./outils.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ESSAI = process.argv.includes("--essai");
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

const index = (await db.doc("index/catalogue").get()).data()?.docs || {};
const changements = [];
for (const [id, e] of Object.entries(index)) {
  if (!Array.isArray(e) || (e[4] && e[4] !== "Autre")) continue;
  const n = niveauDe(`${e[0]} ${e[1]} ${e[2]}`); // titre, matière, filière
  if (n) changements.push({ id, titre: e[0], niveau: n, entree: e });
}
const sans = Object.values(index).filter((e) => Array.isArray(e) && (!e[4] || e[4] === "Autre")).length;
console.log(`${Object.keys(index).length} document(s), ${sans} sans niveau, ${changements.length} classé(s) maintenant.\n`);
const parNiveau = {};
changements.forEach((c) => { parNiveau[c.niveau] = (parNiveau[c.niveau] || 0) + 1; });
Object.entries(parNiveau).forEach(([n, k]) => console.log(`  ${n} : ${k}`));
changements.slice(0, 20).forEach((c) => console.log(`  ${c.titre}  ->  ${c.niveau}`));
if (ESSAI) { console.log("\n(mode essai : rien n'a été modifié)"); process.exit(0); }

for (let i = 0; i < changements.length; i += 200) {
  const lot = changements.slice(i, i + 200);
  const entree = (c) => { const e = [...c.entree]; e[4] = c.niveau; return e; };
  const batch = db.batch();
  for (const c of lot) batch.update(db.collection("documents").doc(c.id), { niveau: c.niveau });
  batch.set(db.doc("index/catalogue"), { docs: Object.fromEntries(lot.map((c) => [c.id, entree(c)])) }, { merge: true });
  try { await batch.commit(); }
  catch {
    for (const c of lot) {
      try { await db.collection("documents").doc(c.id).update({ niveau: c.niveau }); await db.doc("index/catalogue").set({ docs: { [c.id]: entree(c) } }, { merge: true }); } catch {}
    }
  }
}
console.log(`\nTerminé : ${changements.length} document(s) classé(s) par niveau. Sur le site : filtre « Niveau ».`);
process.exit(0);
