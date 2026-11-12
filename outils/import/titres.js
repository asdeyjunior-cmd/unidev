#!/usr/bin/env node
/**
 * Rend lisibles les titres des documents déjà publiés, pour qu'on les retrouve et que leurs séries se forment :
 *   « 612a0b117cf71sujet-corrige-etude-de-cas » -> « Sujet corrige etude de cas »
 *   « Le-secret-de-la-cybersécurité »          -> « Le secret de la cybersécurité »
 *
 *   node titres.js --essai   -> montre les changements sans rien modifier
 *   node titres.js           -> corrige
 *
 * Économe : 1 seule lecture Firestore (l'index) ; seuls les documents à corriger sont modifiés.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { titreAReparer } from "./outils.js";
import { lireCatalogue, ecrireCatalogue, ecrireCatalogueDirect } from "./catalogue.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ESSAI = process.argv.includes("--essai");
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

const index = await lireCatalogue(db);
const changements = [];
for (const [id, e] of Object.entries(index)) {
  if (!Array.isArray(e)) continue;
  const nouveau = titreAReparer(e[0]);
  if (nouveau) changements.push({ id, avant: e[0], apres: nouveau.slice(0, 140), entree: e });
}
console.log(`${Object.keys(index).length} document(s) publié(s), ${changements.length} titre(s) à rendre lisible(s).\n`);
changements.slice(0, 40).forEach((c) => console.log(`  ${c.avant}\n   -> ${c.apres}`));
if (changements.length > 40) console.log(`  … et ${changements.length - 40} autre(s)`);
if (ESSAI) { console.log("\n(mode essai : rien n'a été modifié)"); process.exit(0); }

// Par lots : la fiche du document et son entrée dans l'index
for (let i = 0; i < changements.length; i += 200) {
  const batch = db.batch();
  const lot = changements.slice(i, i + 200);
  for (const c of lot) batch.update(db.collection("documents").doc(c.id), { titre: c.apres });
  ecrireCatalogue(batch, db, Object.fromEntries(lot.map((c) => [c.id, [c.apres, ...c.entree.slice(1)]])));
  try { await batch.commit(); }
  catch (e) {
    // Un document disparu entre-temps fait échouer le lot : on refait un par un
    for (const c of lot) {
      try { await db.collection("documents").doc(c.id).update({ titre: c.apres }); await ecrireCatalogueDirect(db, { [c.id]: [c.apres, ...c.entree.slice(1)] }); }
      catch {}
    }
  }
}
console.log(`\nTerminé : ${changements.length} titre(s) corrigé(s). Les séries (1, 2, 3…) se forment maintenant d'elles-mêmes sur le site.`);
process.exit(0);
