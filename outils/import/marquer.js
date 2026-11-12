#!/usr/bin/env node
/**
 * Pose le tampon unidev (petit logo + adresse en bas à droite de chaque page) sur les PDF déjà publiés.
 *
 *   node marquer.js --essai          -> compte ce qui reste à faire, sans rien modifier
 *   node marquer.js --max 300        -> traite 300 documents au plus (le reste la prochaine fois)
 *
 * Économe : la liste vient de l'index (1 lecture Firestore) et les documents déjà faits sont notés
 * dans marque-faits.json : chaque document n'est lu et renvoyé qu'une seule fois.
 * Non tamponnés : les fichiers qui ne sont pas des PDF, les PDF protégés et les licences « pas de modification » (CC BY-ND).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { comptes, choisirCompte, basculer, comptePlein } from "./stockage.js";
import admin from "firebase-admin";
import { v2 as cloudinary } from "cloudinary";
import { avecRelance, telecharger, decouper, TAILLE_MORCEAU, MAX_IMAGE_PDF } from "./outils.js";
import { tamponUnidev, sansModification } from "./marque.js";
import { lireCatalogue, ecrireCatalogue, ecrireCatalogueDirect } from "./catalogue.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ESSAI = args.includes("--essai");
const MAX = Math.max(1, Number(opt("max", "300")) || 300);

if (!comptes().length) { console.error("Aucun compte Cloudinary : mets CLOUDINARY_COMPTES (ou CLOUDINARY_CLOUD_NAME, _API_KEY, _API_SECRET) dans .env"); process.exit(1); }
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();
await choisirCompte(cloudinary); // le compte Cloudinary le plus libre

const envoyerUneFois = (buffer, options) => avecRelance(() => new Promise((ok, ko) => {
  cloudinary.uploader.upload_stream({ use_filename: false, unique_filename: true, overwrite: false, timeout: 600000, ...options },
    (err, res) => (err ? ko(err) : ok(res))).end(buffer);
}), { nom: "envoi Cloudinary" });
// Compte plein : on passe au compte suivant et on renvoie
const envoyer = async (buffer, options) => {
  for (;;) {
    try { return await envoyerUneFois(buffer, options); }
    catch (e) { if (comptePlein(e) && basculer(cloudinary)) continue; throw e; }
  }
};

/* ---------- Ce qui reste à faire ---------- */
const FAITS = path.join(ICI, "marque-faits.json");
let faits = new Set();
try { faits = new Set(JSON.parse(fs.readFileSync(FAITS, "utf8"))); } catch {}
const noter = (id) => { faits.add(id); fs.writeFileSync(FAITS, JSON.stringify([...faits])); };

const index = await lireCatalogue(db);
const restants = Object.keys(index).filter((id) => !faits.has(id) && String(index[id]?.[6] || "pdf").toLowerCase() === "pdf");
console.log(`${Object.keys(index).length} document(s) publié(s), ${restants.length} PDF sans tampon à traiter (${MAX} au plus cette fois).\n`);
if (ESSAI) { console.log("(mode essai : rien n'a été modifié)"); process.exit(0); }

let ok = 0, deja = 0, sautes = 0, erreurs = 0;
const lot = restants.slice(0, MAX);
for (let i = 0; i < lot.length; i += 50) {
  const snaps = await db.getAll(...lot.slice(i, i + 50).map((id) => db.collection("documents").doc(id)));
  for (const s of snaps) {
    const n = ok + deja + sautes + erreurs + 1;
    if (!s.exists) { noter(s.id); sautes++; continue; }
    const d = s.data();
    if (d.tampon) { noter(s.id); deja++; continue; }
    if (String(d.format || "pdf").toLowerCase() !== "pdf" || sansModification(d.description)) { noter(s.id); sautes++; continue; }
    console.log(`[${n}/${lot.length}] ${d.titre}`);
    try {
      const fichier = (await s.ref.collection("prive").doc("fichier").get()).data();
      if (!fichier?.fileUrl) { console.log("   fichier introuvable"); noter(s.id); sautes++; continue; }
      const morceaux = fichier.parts?.length ? fichier.parts.map((p) => p.url) : [fichier.fileUrl];
      const avant = Buffer.concat(await Promise.all(morceaux.map((u) => telecharger(u))));
      const t = await tamponUnidev(avant);
      if (t.impossible) { console.log(`   ignoré : ${t.impossible}`); noter(s.id); sautes++; continue; }
      if (t.deja) { await s.ref.update({ tampon: true }); console.log("   déjà tamponné"); noter(s.id); deja++; continue; }
      const pdf = t.buffer;

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
      // L'aperçu venait du fichier lui-même : il suit le nouveau fichier (sinon l'ancien ne pourrait pas être nettoyé)
      const apercuDuFichier = String(d.imageUrl || "").includes("/image/upload/") && String(d.imageUrl).includes("pg_1");
      const maj = { taille: pdf.length, tampon: true, ...(imageUrl && apercuDuFichier ? { imageUrl } : {}) };
      const batch = db.batch();
      batch.update(s.ref, maj);
      batch.set(s.ref.collection("prive").doc("fichier"), { ...nouveau, auteurId: fichier.auteurId || d.auteurId });
      if (d.statut === "publie" && maj.imageUrl) ecrireCatalogue(batch, db, { [s.id]: [d.titre || "", d.matiere || "", d.filiere || "", d.type || "", d.niveau || "", maj.imageUrl, d.format || "", d.universite || "", ...(d.suiteDe ? [d.suiteDe] : [])] });
      await batch.commit();
      noter(s.id);
      ok++;
      console.log(`   tamponné (${t.pages} page(s))`);
    } catch (e) {
      erreurs++;
      console.log(`   ERREUR : ${e.message}`);
    }
  }
}
const reste = restants.length - lot.length;
console.log(`\nTerminé : ${ok} tamponné(s), ${deja} déjà fait(s), ${sautes} ignoré(s) (pas PDF, protégé ou licence sans modification), ${erreurs} erreur(s).`);
console.log(reste > 0 ? `Il en reste ${reste} : ils seront faits aux prochains passages.` : "Tous les PDF publiés portent le tampon unidev.");
if (ok) console.log("Les anciens fichiers restent sur Cloudinary : le nettoyage mensuel les supprimera.");
process.exit(0);
