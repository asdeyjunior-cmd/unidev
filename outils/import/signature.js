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
import { avecRelance, telecharger, decouper, TAILLE_MORCEAU, MAX_IMAGE_PDF } from "./outils.js";
import { remplacerSignature } from "./marque.js";

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

console.log(`${concernes.length} document(s) PDF de « ${site} » à traiter (signature : ${motifs.join(", ")}).\n`);
if (ESSAI) {
  concernes.slice(0, 50).forEach((s, i) => console.log(`[${i + 1}] ${s.data().titre}`));
  if (concernes.length > 50) console.log(`… et ${concernes.length - 50} autre(s)`);
  console.log("\n(mode essai : rien n'a été modifié)");
  process.exit(0);
}

let ok = 0, sansSignature = 0, erreurs = 0;
for (const [i, s] of concernes.entries()) {
  const d = s.data();
  console.log(`[${i + 1}/${concernes.length}] ${d.titre}`);
  try {
    // 1. Récupérer le PDF actuel (en un ou plusieurs morceaux)
    const fichier = (await s.ref.collection("prive").doc("fichier").get()).data();
    if (!fichier?.fileUrl) throw new Error("fichier introuvable");
    const morceaux = fichier.parts?.length ? fichier.parts.map((p) => p.url) : [fichier.fileUrl];
    const avant = Buffer.concat(await Promise.all(morceaux.map((u) => telecharger(u))));

    // 2. Remplacer la signature
    const r = await remplacerSignature(avant, motifs);
    if (!r.lignes && !r.liens && !r.logos) {
      sansSignature++;
      console.log("   aucune signature trouvée (filigrane penché ou logo de forme inhabituelle ?) : inchangé");
      await s.ref.update({ signatureRemplacee: true });
      continue;
    }
    const pdf = r.buffer;

    // 3. Envoyer le nouveau PDF (avec aperçu de la 1re page si possible)
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

    // 4. Mettre à jour la fiche (l'ancienne image de 1re page montrait encore l'ancienne signature)
    const ancienneImageApercu = String(d.imageUrl || "").includes("/image/upload/") && String(d.imageUrl).includes("pg_1");
    const maj = { taille: pdf.length, signatureRemplacee: true, ...(imageUrl && ancienneImageApercu ? { imageUrl } : {}) };
    const batch = db.batch();
    batch.update(s.ref, maj);
    batch.set(s.ref.collection("prive").doc("fichier"), { ...nouveau, auteurId: fichier.auteurId || d.auteurId });
    if (d.statut === "publie" && maj.imageUrl) batch.set(db.doc("index/catalogue"), { docs: { [s.id]: [d.titre || "", d.matiere || "", d.filiere || "", d.type || "", d.niveau || "", maj.imageUrl, d.format || "", d.universite || ""] } }, { merge: true });
    await batch.commit();
    ok++;
    console.log(`   remplacée : ${r.logos ? `${r.logos} logo(s), ` : ""}${r.lignes} ligne(s), ${r.liens} lien(s)${r.ignores ? ` · ${r.ignores} filigrane(s) penché(s) laissé(s)` : ""}`);
  } catch (e) {
    erreurs++;
    console.log(`   ERREUR : ${e.message}`);
  }
}
console.log(`\nTerminé : ${ok} document(s) mis à jour, ${sansSignature} sans signature à remplacer, ${erreurs} erreur(s).`);
console.log("Les anciens fichiers restent sur Cloudinary : lance NETTOYER-CLOUDINARY.bat pour libérer la place.");
process.exit(0);
