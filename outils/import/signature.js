#!/usr/bin/env node
/**
 * Remplace la signature d'un site partenaire par celle d'unidev dans les documents DÉJÀ sur unidev.
 * Le document garde sa place, son titre, ses téléchargements : seul son fichier PDF est remplacé.
 *
 *   node signature.js --site fomesoutra --remplacer "fomesoutra,fo me soutra" --essai
 *   node signature.js --site fomesoutra --remplacer "fomesoutra,fo me soutra"
 *   … --refaire   -> retraite aussi les documents déjà traités
 *
 * --site : documents dont la description contient « autorisation de <site> » (ajoutée par le choix 9 de l'import)
 * À utiliser UNIQUEMENT avec l'accord écrit du site concerné.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { v2 as cloudinary } from "cloudinary";
import { avecRelance, telecharger, decouper, TAILLE_MORCEAU, MAX_IMAGE_PDF, titreAReparer, sansCodeDevant } from "./outils.js";
import { remplacerSignature, tamponUnidev, sansModification, annulerAnciennesMarques } from "./marque.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ESSAI = args.includes("--essai");
const REFAIRE = args.includes("--refaire"); // retraite aussi les documents déjà traités (ex. après une correction de l'outil)
const site = (opt("site", "") || "").trim().toLowerCase();
const motifs = (opt("remplacer", "") || "").split(",").map((m) => m.trim()).filter((m) => m.length >= 4);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

if (site.length < 3 || !motifs.length) {
  console.log('Utilisation : node signature.js --site fomesoutra --remplacer "fomesoutra,fo me soutra" [--essai]');
  process.exit(1);
}
for (const k of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) if (!process.env[k]) { console.error(`${k} manque dans .env`); process.exit(1); }
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });

const envoyer = (buffer, options) => avecRelance(() => new Promise((ok, ko) => {
  cloudinary.uploader.upload_stream({ use_filename: false, unique_filename: true, overwrite: false, timeout: 600000, ...options },
    (err, res) => (err ? ko(err) : ok(res))).end(buffer);
}), { nom: "envoi Cloudinary" });

/* ---------- Documents concernés ---------- */
// --tous : TOUS les PDF du site (documents de Fomesoutra arrivés par d'autres chemins, anciennes marques ratées partout).
// Sans risque : seul le vrai logo Fomesoutra (reconnu à son aspect), les mots de sa signature et NOS anciens dessins sont touchés.
const TOUS = args.includes("--tous");
const VERSION = "réparation v4 (2 novembre)";
const snap = await db.collection("documents").get();
const concernes = snap.docs.filter((s) => {
  const d = s.data();
  if (String(d.format || "pdf").toLowerCase() !== "pdf") return false;
  if (TOUS) return true;
  const desc = norm(d.description);
  const duSite = desc.includes(`autorisation de ${norm(site)}`) || desc.includes(`autorisation de www.${norm(site)}`) || (desc.includes("autorisation de") && desc.includes(norm(site)));
  return (duSite || d.signatureRemplacee) && (REFAIRE || !d.signatureRemplacee);
});

// Adresse du fichier ORIGINAL de chaque document (notée par l'import dans import-journal.json)
const originaux = new Map();
try {
  const journal = JSON.parse(fs.readFileSync(path.join(ICI, "import-journal.json"), "utf8"));
  for (const [k, v] of Object.entries(journal)) if (k.startsWith("site:") && v?.id) originaux.set(v.id, k.slice(5));
} catch {}

console.log(`Outil : ${VERSION}`);
console.log(`${concernes.length} document(s) PDF à vérifier${TOUS ? " (tout le site)" : ` (« ${site} »)`} — signature cherchée : ${motifs.join(", ")}.`);
console.log(`${concernes.filter((s) => originaux.has(s.id)).length} avec l'adresse de leur fichier d'origine.\n`);
if (ESSAI) {
  concernes.slice(0, 50).forEach((s, i) => console.log(`[${i + 1}] ${s.data().titre}${originaux.has(s.id) ? "" : "  (fichier actuel)"}`));
  if (concernes.length > 50) console.log(`… et ${concernes.length - 50} autre(s)`);
  console.log("\n(mode essai : rien n'a été modifié)");
  process.exit(0);
}
// Les anciennes « empreintes de logo » se trompaient (elles prenaient des en-têtes d'écoles pour le logo) : on les efface.
await db.doc("parametres/logos").delete().catch(() => {});

const re = new RegExp(motifs.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s._-]*")).join("|"), "i");
const sansProvenance = (t) => String(t || "").replace(/Document partagé avec l'autorisation de \S+/gi, "").replace(/\s*Source\s*:\s*\S+/gi, "").replace(/\s{2,}/g, " ").trim();

/* ---------- Un document à la fois : récupérer, réparer, renvoyer ---------- */
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" };
let ok = 0, inchanges = 0, erreurs = 0, depuisOrigine = 0, repares = 0;
for (const [i, s] of concernes.entries()) {
  const d = s.data();
  try {
    // 1. Le fichier d'origine sur Fomesoutra ; sinon le fichier actuel, débarrassé de nos anciens dessins
    let avant = null, original = false, nettoye = false;
    if (originaux.has(s.id)) {
      try { avant = await telecharger(originaux.get(s.id), UA, { pdf: true }); original = true; } catch {}
    }
    const fichier = (await s.ref.collection("prive").doc("fichier").get()).data() || {};
    if (!avant) {
      if (!fichier.fileUrl) { inchanges++; continue; }
      const morceaux = fichier.parts?.length ? fichier.parts.map((p) => p.url) : [fichier.fileUrl];
      avant = Buffer.concat(await Promise.all(morceaux.map((u) => telecharger(u))));
      try { const a = await annulerAnciennesMarques(avant); if (a.pages) { avant = a.buffer; nettoye = true; } } catch {}
    }

    // 2. Signature et logo Fomesoutra -> unidev
    const r = await remplacerSignature(avant, motifs);
    const change = r.lignes || r.liens || r.logos;
    // Provenance jamais visible sur le site : description et nom de fichier nettoyés
    const champsPublics = {};
    if (/autorisation de/i.test(d.description || "")) champsPublics.description = sansProvenance(d.description);
    if (d.nomFichier && (re.test(d.nomFichier) || sansCodeDevant(d.nomFichier) !== d.nomFichier)) champsPublics.nomFichier = `${titreAReparer(d.titre) || d.titre}.pdf`.replace(/[\\/:*?"<>|]/g, " ");
    if (!change && !original && !nettoye) {
      inchanges++;
      if (!d.signatureRemplacee || Object.keys(champsPublics).length) await s.ref.update({ signatureRemplacee: true, ...champsPublics });
      continue; // rien à faire sur le fichier
    }
    console.log(`[${i + 1}/${concernes.length}] ${d.titre}`);
    let pdf = change ? r.buffer : avant;
    // 3. Petit logo unidev en bas de chaque page
    let tampon = false;
    if (!sansModification(d.description)) { try { const t = await tamponUnidev(pdf); pdf = t.buffer; tampon = !!(t.pages || t.deja); } catch {} }

    // 4. Envoi du fichier réparé
    let nouveau = null, imageUrl = null;
    if (pdf.length <= MAX_IMAGE_PDF) {
      try {
        const res = await envoyer(pdf, { resource_type: "image", folder: "unidev/documents" });
        nouveau = { fileUrl: res.secure_url, publicId: res.public_id };
        imageUrl = cloudinary.url(res.public_id, { resource_type: "image", secure: true, format: "jpg", transformation: [{ page: 1, width: 800, crop: "limit", quality: "auto" }] }).split("?")[0];
      } catch {}
    }
    if (!nouveau) {
      if (pdf.length <= TAILLE_MORCEAU) {
        const res = await envoyer(pdf, { resource_type: "raw", folder: "unidev/documents" });
        nouveau = { fileUrl: res.secure_url, publicId: res.public_id };
      } else {
        const parts = [];
        for (const m of decouper(pdf)) { const res = await envoyer(m, { resource_type: "raw", folder: "unidev/documents" }); parts.push({ url: res.secure_url, publicId: res.public_id }); }
        nouveau = { fileUrl: parts[0].url, publicId: parts[0].publicId, parts };
      }
    }
    // L'aperçu venait du fichier lui-même : il suit le nouveau fichier (l'ancien montrait les logos ratés)
    const apercuDuFichier = !d.imageUrl || (String(d.imageUrl).includes("/image/upload/") && String(d.imageUrl).includes("pg_1"));
    const titrePropre = titreAReparer(d.titre);
    if (titrePropre) d.titre = titrePropre;
    const maj = { ...champsPublics, taille: pdf.length, signatureRemplacee: true, titre: d.titre, ...(tampon ? { tampon: true } : {}), ...(imageUrl && apercuDuFichier ? { imageUrl } : {}) };
    const batch = db.batch();
    batch.update(s.ref, maj);
    batch.set(s.ref.collection("prive").doc("fichier"), { ...nouveau, auteurId: fichier.auteurId || d.auteurId });
    if (d.statut === "publie") batch.set(db.doc("index/catalogue"), { docs: { [s.id]: [d.titre || "", d.matiere || "", d.filiere || "", d.type || "", d.niveau || "", maj.imageUrl || d.imageUrl || "", d.format || "", d.universite || "", ...(d.suiteDe ? [d.suiteDe] : [])] } }, { merge: true });
    await batch.commit();
    ok++; if (original) depuisOrigine++; if (nettoye) repares++;
    console.log(`   ${change ? `remplacé : ${r.logos ? `${r.logos} logo(s), ` : ""}${r.lignes} ligne(s), ${r.liens} lien(s)` : "remis au propre"}${nettoye ? " · anciennes marques ratées retirées" : original ? " · depuis le fichier d'origine" : ""}`);
  } catch (e) {
    erreurs++;
    console.log(`[${i + 1}/${concernes.length}] ${d.titre}\n   ERREUR : ${e.message}`);
  }
}
console.log(`\nTerminé (${VERSION}) : ${ok} document(s) réparé(s) [${depuisOrigine} depuis Fomesoutra, ${repares} en retirant les anciennes marques ratées], ${inchanges} déjà propre(s), ${erreurs} erreur(s).`);
console.log("Les anciens fichiers restent sur Cloudinary : le nettoyage les supprimera.");
process.exit(erreurs && !ok ? 1 : 0);
