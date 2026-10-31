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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { v2 as cloudinary } from "cloudinary";
import { avecRelance, telecharger, decouper, TAILLE_MORCEAU, MAX_IMAGE_PDF, titreDepuisFichier } from "./outils.js";
import { remplacerSignature, tamponUnidev, sansModification } from "./marque.js";

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
const snap = await db.collection("documents").get();
const concernes = snap.docs.filter((s) => {
  const d = s.data();
  return norm(d.description).includes(`autorisation de ${norm(site)}`) || norm(d.description).includes(`autorisation de www.${norm(site)}`)
    || (norm(d.description).includes("autorisation de") && norm(d.description).includes(norm(site)));
}).filter((s) => (REFAIRE || !s.data().signatureRemplacee) && String(s.data().format || "pdf").toLowerCase() === "pdf");

// Adresse du fichier ORIGINAL de chaque document (notée par l'import dans import-journal.json) :
// on repart toujours de l'original, ce qui répare aussi les documents abîmés par une version précédente de l'outil.
const originaux = new Map();
try {
  const journal = JSON.parse(fs.readFileSync(path.join(ICI, "import-journal.json"), "utf8"));
  for (const [k, v] of Object.entries(journal)) if (k.startsWith("site:") && v?.id) originaux.set(v.id, k.slice(5));
} catch {}

console.log(`${concernes.length} document(s) PDF de « ${site} » à traiter (signature : ${motifs.join(", ")}).`);
console.log(`${concernes.filter((s) => originaux.has(s.id)).length} avec leur fichier d'origine retrouvé (les autres partent du fichier actuel).\n`);

/* ---------- 1er passage : récupérer les fichiers (l'original de Fomesoutra quand c'est possible) ---------- */
// Le logo du site est reconnu à son ASPECT (modèles du dossier « logos ») : les logos d'écoles et les titres ne sont jamais touchés.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unidev-signature-"));
const sources = new Map(); // id -> { chemin, original }
for (const [i, s] of concernes.entries()) {
  const d = s.data();
  process.stdout.write(`\r   lecture ${i + 1}/${concernes.length}…`);
  try {
    let buffer, original = false;
    if (originaux.has(s.id)) {
      try { buffer = await telecharger(originaux.get(s.id), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" }, { pdf: true }); original = true; } catch {}
    }
    if (!buffer) {
      const fichier = (await s.ref.collection("prive").doc("fichier").get()).data();
      if (!fichier?.fileUrl) continue;
      const morceaux = fichier.parts?.length ? fichier.parts.map((p) => p.url) : [fichier.fileUrl];
      buffer = Buffer.concat(await Promise.all(morceaux.map((u) => telecharger(u))));
    }
    const chemin = path.join(TMP, `${s.id}.pdf`);
    fs.writeFileSync(chemin, buffer);
    sources.set(s.id, { chemin, original });
  } catch (e) { console.log(`\n   ${d.titre} : lecture impossible (${e.message})`); }
}
console.log("");
const sansOriginal = [...sources.values()].filter((x) => !x.original).length;
if (sansOriginal) console.log(`Attention : ${sansOriginal} document(s) sans fichier d'origine : s'ils ont été abîmés par l'ancienne version, ils ne pourront pas être réparés.\n`);
// Les anciennes « empreintes de logo » se trompaient (elles prenaient des en-têtes d'écoles pour le logo) : on les efface.
if (!ESSAI) await db.doc("parametres/logos").delete().catch(() => {});

if (ESSAI) {
  concernes.slice(0, 50).forEach((s, i) => console.log(`[${i + 1}] ${s.data().titre}${sources.get(s.id)?.original ? "" : "  (fichier actuel)"}`));
  if (concernes.length > 50) console.log(`… et ${concernes.length - 50} autre(s)`);
  console.log("\n(mode essai : rien n'a été modifié)");
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

/* ---------- 2e passage : remplacer et renvoyer ---------- */
let ok = 0, sansSignature = 0, erreurs = 0;
for (const [i, s] of concernes.entries()) {
  const d = s.data();
  const src = sources.get(s.id);
  if (!src) continue;
  console.log(`[${i + 1}/${concernes.length}] ${d.titre}`);
  try {
    const avant = fs.readFileSync(src.chemin);
    const r = await remplacerSignature(avant, motifs);
    const change = r.lignes || r.liens || r.logos;
    // Fichier d'origine récupéré : on le renvoie même sans signature trouvée (ça répare une ancienne version abîmée)
    if (!change && !src.original) {
      sansSignature++;
      console.log("   aucune signature trouvée : inchangé");
      await s.ref.update({ signatureRemplacee: true });
      continue;
    }
    let pdf = change ? r.buffer : avant;
    // Tampon unidev en bas de chaque page (repart de l'original : il faut le remettre)
    let tampon = false;
    if (!sansModification(d.description)) { try { const t = await tamponUnidev(pdf); pdf = t.buffer; tampon = !!(t.pages || t.deja); } catch {} }

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
    const fichier = (await s.ref.collection("prive").doc("fichier").get()).data() || {};
    const ancienneImageApercu = String(d.imageUrl || "").includes("/image/upload/") && String(d.imageUrl).includes("pg_1");
    // Titre resté au format « nom de fichier » (ex. 5d1254cf6corrige-etude-de-cas…) : on le rend lisible
    const titrePropre = titreDepuisFichier(d.titre || "");
    if (titrePropre && titrePropre !== d.titre && (/^[0-9a-f]{9}[a-z]/i.test(d.titre) || (!/\s/.test(d.titre) && /-.*-.*-/.test(d.titre)))) d.titre = titrePropre;
    const maj = { taille: pdf.length, signatureRemplacee: true, titre: d.titre, ...(tampon ? { tampon: true } : {}), ...(imageUrl && ancienneImageApercu ? { imageUrl } : {}) };
    const batch = db.batch();
    batch.update(s.ref, maj);
    batch.set(s.ref.collection("prive").doc("fichier"), { ...nouveau, auteurId: fichier.auteurId || d.auteurId });
    if (d.statut === "publie") batch.set(db.doc("index/catalogue"), { docs: { [s.id]: [d.titre || "", d.matiere || "", d.filiere || "", d.type || "", d.niveau || "", maj.imageUrl || d.imageUrl || "", d.format || "", d.universite || ""] } }, { merge: true });
    await batch.commit();
    ok++;
    console.log(`   ${change ? `remplacée : ${r.logos ? `${r.logos} logo(s), ` : ""}${r.lignes} ligne(s), ${r.liens} lien(s)` : "rétabli depuis l'original (aucune signature à remplacer)"}${src.original ? " · depuis le fichier d'origine" : ""}`);
  } catch (e) {
    erreurs++;
    console.log(`   ERREUR : ${e.message}`);
  }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nTerminé : ${ok} document(s) mis à jour, ${sansSignature} sans signature à remplacer, ${erreurs} erreur(s).`);
console.log("Les anciens fichiers restent sur Cloudinary : lance le nettoyage pour libérer la place.");
process.exit(0);
