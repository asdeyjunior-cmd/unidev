#!/usr/bin/env node
/**
 * Agent automatique (chaque jour sur GitHub) :
 *  1. regarde les filières demandées par les étudiants (« Ta filière manque ? ») ;
 *  2. pour chacune, cherche des documents sur les sites partenaires (sites-partenaires.json, avec leur accord)
 *     puis sur les sources libres (HAL, Wikiversité, Wikilivres, Zenodo) ;
 *  3. les propose à l'admin : Modération > Documents à valider (rien n'est publié sans toi).
 *
 *   node agent.js                 -> 3 filières au plus, 10 documents chacune
 *   node agent.js --filieres 5 --max 15
 *   node agent.js --essai         -> montre ce qu'il ferait, sans rien envoyer
 *
 * Une filière déjà traitée n'est refaite qu'au bout de 7 jours (si elle est encore demandée).
 * Lectures Firestore : 1 requête sur les demandes (300 au plus) + 1 lecture du suivi de l'agent.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { canonFiliere, ajouterFilieres, appliquerRenommages } from "../../js/filieres.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ESSAI = args.includes("--essai");
const NB = Math.max(1, Number(opt("filieres", "3")) || 3);
const MAX = Math.max(10, Number(opt("max", "10")) || 10); // au moins 10 documents par filière (moins de 10 trouvés = retentée le lendemain)
const JOURS = 7;

const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();
// Filières ajoutées et renommages / fusions / suppressions décidés par l'admin
{ const r = (await db.doc("index/filieres").get().catch(() => null))?.data() || {}; ajouterFilieres(r.liste || []); appliquerRenommages(r.renommages || []); }

// Filières demandées, la plus demandée d'abord
const snap = await db.collection("demandes").orderBy("createdAt", "desc").limit(300).get();
const compte = new Map();
for (const s of snap.docs) {
  const f = canonFiliere(String(s.data().filiere || "").trim()) || String(s.data().filiere || "").trim();
  if (f.length >= 3) compte.set(f, (compte.get(f) || 0) + 1);
}
const suiviRef = db.doc("parametres/agent");
const faites = (await suiviRef.get()).data()?.faites || {};
const recent = (f) => faites[f] && Date.now() - new Date(faites[f]).getTime() < JOURS * 86400000;
const choix = [...compte.entries()].sort((a, b) => b[1] - a[1]).filter(([f]) => !recent(f)).slice(0, NB);

console.log(`${compte.size} filière(s) demandée(s). Aujourd'hui : ${choix.length ? choix.map(([f, n]) => `${f} (${n} demande${n > 1 ? "s" : ""})`).join(", ") : "rien de nouveau"}\n`);
if (!choix.length) { console.log("Terminé : aucune filière à traiter (toutes faites ces 7 derniers jours, ou aucune demande)."); process.exit(0); }

let ok = 0;
for (const [filiere] of choix) {
  console.log(`\n################ ${filiere} : ${MAX} documents au moins ################`);
  const r = spawnSync(process.execPath, ["importer.js", "filiere", "--filiere", filiere, "--max", String(MAX), "--attente", "--partenaires", ...(ESSAI ? ["--essai"] : [])],
    { cwd: ICI, stdio: "inherit", env: process.env });
  let faits = 0;
  try { const res = JSON.parse(fs.readFileSync(path.join(ICI, "resultat-filiere.json"), "utf8")); if (res.filiere === filiere) faits = res.faits; } catch {}
  if (r.status === 0 && faits >= MAX) { ok++; if (!ESSAI) faites[filiere] = new Date().toISOString(); console.log(`=> ${filiere} : ${faits} document(s) proposé(s)`); }
  else if (r.status === 0) console.log(`ATTENTION : ${filiere} : ${faits}/${MAX} seulement (pas assez de documents trouvés) : elle sera retentée demain.`);
  else console.log(`ERREUR : la recherche pour « ${filiere} » s'est arrêtée (code ${r.status}).`);
}
if (!ESSAI) await suiviRef.set({ faites, dernierPassage: new Date().toISOString() }, { merge: true });
console.log(`\nTerminé : ${ok}/${choix.length} filière(s) traitée(s). Les documents trouvés t'attendent dans Modération > Documents à valider.`);
process.exit(ok || !choix.length ? 0 : 1);
