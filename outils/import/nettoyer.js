#!/usr/bin/env node
/**
 * Supprime de Cloudinary les fichiers et images qui ne servent plus à aucun document d'unidev
 * (documents supprimés dans Modération, doublons retirés, envois abandonnés).
 *
 *   node nettoyer.js --essai   -> montre ce qui serait supprimé, sans rien toucher
 *   node nettoyer.js           -> supprime
 *
 * Sécurité : seuls les fichiers des dossiers unidev/ de plus de 48 h sont concernés
 * (un étudiant en train de publier ne perd jamais son fichier).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { comptes } from "./stockage.js";
import admin from "firebase-admin";
import { v2 as cloudinary } from "cloudinary";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ESSAI = process.argv.includes("--essai");
const AGE_MIN = 48 * 3600 * 1000;

if (!comptes().length) { console.error("Aucun compte Cloudinary : mets CLOUDINARY_COMPTES (ou CLOUDINARY_CLOUD_NAME, _API_KEY, _API_SECRET) dans .env"); process.exit(1); }
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

/** URL Cloudinary -> { type, id } (id sans extension pour les images, avec extension pour les fichiers « raw ») */
function depuisUrl(u) {
  const m = String(u || "").split("?")[0].match(/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(.+)$/);
  if (!m) return null;
  let reste = m[2];
  const v = reste.match(/(?:^|\/)v\d+\/(.+)$/);
  reste = v ? v[1] : reste.replace(/^([a-z]{1,3}_[^/]+\/)+/, ""); // retire les transformations (w_800,…)
  reste = decodeURIComponent(reste);
  return { type: m[1], id: m[1] === "raw" ? reste : reste.replace(/\.[a-z0-9]+$/i, "") };
}

process.on("unhandledRejection", (e) => { console.log(`Erreur : ${e?.error?.message || e?.message || e}`); process.exit(1); });

/* ---------- 1. Tout ce que les documents utilisent encore ---------- */
console.log("Lecture des documents d'unidev…");
const utilises = new Set();
const garder = (type, id) => id && utilises.add(`${type}:${id}`);
const docs = await db.collection("documents").get();
// Image actuelle, et ancienne image gardée par le déménagement vers R2 (tant qu'on n'a pas tout vérifié)
docs.forEach((s) => { for (const u of [s.data().imageUrl, s.data().ancienneImage]) { const r = depuisUrl(u); if (r) garder(r.type, r.id); } });
// Images des opportunités (carte + affiches)
(await db.collection("opportunites").get().catch(() => ({ docs: [] }))).docs.forEach((s) => { const r = depuisUrl(s.data().image); if (r) garder(r.type, r.id); });
const fichiers = await db.collectionGroup("prive").get();
fichiers.forEach((s) => {
  const f = s.data();
  for (const u of [f.fileUrl, ...(f.parts || []).map((p) => p.url), ...(f.images || []), f.ancien?.fileUrl, ...(f.ancien?.parts || []).map((p) => p.url)]) {
    const r = depuisUrl(u);
    if (r) { garder(r.type, r.id); if (r.type === "image") garder("image", r.id); }
  }
  // publicId enregistré : on le garde quel que soit le type
  for (const id of [f.publicId, ...(f.parts || []).map((p) => p.publicId)]) if (id) { garder("raw", id); garder("image", id); }
});
if (!docs.size) { console.log("Aucun document lu : nettoyage annulé par sécurité."); process.exit(0); }
console.log(`${docs.size} document(s), ${utilises.size} fichier(s) et image(s) utilisés.\n`);

/* ---------- 2. Tout ce qui est stocké sur Cloudinary (dossiers unidev/) ---------- */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
/** Cloudinary refuse parfois (trop de demandes, coupure) : on réessaie avant d'abandonner */
async function essayer(f, nom) {
  for (let i = 0; ; i++) {
    try { return await f(); }
    catch (e) {
      const msg = e?.error?.message || e?.message || String(e);
      if (i >= 4) throw new Error(`${nom} : ${msg}`);
      console.log(`   (${nom} : ${msg} — nouvel essai dans ${15 * (i + 1)} s)`);
      await attendre(15000 * (i + 1));
    }
  }
}
async function lister(type) {
  const out = [];
  let curseur;
  do {
    const r = await essayer(() => cloudinary.api.resources({ type: "upload", resource_type: type, prefix: "unidev/", max_results: 500, ...(curseur ? { next_cursor: curseur } : {}) }), "liste Cloudinary");
    out.push(...r.resources);
    curseur = r.next_cursor;
  } while (curseur);
  return out;
}

let total = 0, octets = 0;
let echecs = 0;
// Chaque compte Cloudinary à son tour
for (const compte of comptes()) {
cloudinary.config({ ...compte, secure: true });
if (comptes().length > 1) console.log(`\n=== Compte ${compte.cloud_name} ===`);
for (const type of ["raw", "image"]) {
  let tous;
  try { tous = await lister(type); } catch (e) { console.log(`Impossible de lister les ${type === "raw" ? "fichiers" : "images"} : ${e.message}`); echecs++; continue; }
  const orphelins = tous.filter((r) => !utilises.has(`${type}:${r.public_id}`) && Date.now() - Date.parse(r.created_at) > AGE_MIN);
  const taille = orphelins.reduce((a, r) => a + (r.bytes || 0), 0);
  console.log(`${type === "raw" ? "Fichiers" : "Images et PDF avec aperçu"} : ${tous.length} sur Cloudinary, ${orphelins.length} inutilisé(s) (${(taille / 1048576).toFixed(1)} Mo).`);
  orphelins.slice(0, 15).forEach((r) => console.log(`   - ${r.public_id}`));
  if (orphelins.length > 15) console.log(`   … et ${orphelins.length - 15} autre(s)`);
  total += orphelins.length; octets += taille;
  if (!ESSAI) {
    for (let i = 0; i < orphelins.length; i += 100) {
      try { await essayer(() => cloudinary.api.delete_resources(orphelins.slice(i, i + 100).map((r) => r.public_id), { resource_type: type, type: "upload" }), "suppression"); }
      catch (e) { console.log(`   ${e.message}`); echecs++; }
    }
  }
}
}

console.log(`\n${ESSAI ? "Seraient supprimés" : "Supprimés"} : ${total} élément(s), ${(octets / 1048576).toFixed(1)} Mo libérés.${ESSAI ? " (mode essai : rien n'a été touché)" : ""}${echecs ? ` ${echecs} étape(s) en échec : relance plus tard.` : ""}`);
process.exit(0);
