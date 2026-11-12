#!/usr/bin/env node
/**
 * Sauvegarde de la base (chaque semaine sur GitHub) + classement des contributeurs.
 *   node sauvegarde.js   -> écrit sauvegarde/<collection>.json (gardés 30 jours dans GitHub, dépôt privé)
 * Pour restaurer un élément : ouvre le fichier .json, retrouve-le, et recrée-le dans la console Firebase.
 * Lectures : toute la base une fois (quelques milliers), d'où le rythme hebdomadaire.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();
const DOSSIER = path.join(ICI, "sauvegarde");
fs.mkdirSync(DOSSIER, { recursive: true });

const lisible = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : Array.isArray(v) ? v.map(lisible)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lisible(x)])) : v);
const tout = {};
for (const nom of ["documents", "users", "paiements", "demandes", "parrainages", "signalements", "index", "parametres"]) {
  const snap = await db.collection(nom).get();
  tout[nom] = Object.fromEntries(snap.docs.map((s) => [s.id, lisible(s.data())]));
  fs.writeFileSync(path.join(DOSSIER, `${nom}.json`), JSON.stringify(tout[nom]));
  console.log(`${nom} : ${snap.size}`);
}
// Liens des fichiers (documents/<id>/prive/fichier) et achats des étudiants
for (const [groupe, nom] of [["prive", "fichiers"], ["achats", "achats"]]) {
  const snap = await db.collectionGroup(groupe).get();
  fs.writeFileSync(path.join(DOSSIER, `${nom}.json`), JSON.stringify(Object.fromEntries(snap.docs.map((s) => [s.ref.path, lisible(s.data())]))));
  console.log(`${nom} : ${snap.size}`);
}

/* Classement des contributeurs (documents publiés par étudiant, hors admin), affiché sur la page Publier */
const parAuteur = {};
for (const d of Object.values(tout.documents)) if (d.statut === "publie" && d.auteurId) parAuteur[d.auteurId] = (parAuteur[d.auteurId] || 0) + 1;
const nomPublic = (u) => { const p = String(u?.nom || "Étudiant").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
const classement = Object.entries(parAuteur)
  .filter(([uid]) => tout.users[uid] && tout.users[uid].role !== "admin" && uid !== tout.parametres?.admin?.uid)
  .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([uid, n]) => ({ nom: nomPublic(tout.users[uid]), n }));
await db.doc("parametres/vitrine").set({ classement, classementLe: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
console.log(`\nSauvegarde terminée. Classement : ${classement.map((c) => `${c.nom} (${c.n})`).join(", ") || "aucun contributeur pour l'instant"}`);
process.exit(0);
