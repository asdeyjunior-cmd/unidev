#!/usr/bin/env node
/**
 * Déménagement des fichiers de Cloudinary vers Cloudflare R2 (via le serveur unidev).
 *
 *   node migrer.js --essai              -> compte ce qu'il y a à copier, sans rien modifier
 *   node migrer.js                      -> copie les fichiers et images du compte iugeyztf (le plus urgent)
 *   node migrer.js --compte nis5hqzo    -> un autre compte
 *   node migrer.js --tous               -> tous les comptes Cloudinary
 *
 * Pour chaque document : le fichier (ou ses morceaux) est copié dans R2, puis son lien est remplacé dans la base.
 * L'ancien lien est gardé (champ « ancien ») : rien n'est supprimé de Cloudinary par cet outil.
 * Reprenable : ce qui est déjà copié n'est pas recopié (journal migre.json + vérification côté serveur).
 *
 * Réglages : R2_URL (adresse du serveur, ex. https://unidev-paiement.asdeyjunior40.workers.dev) et OUTILS_SECRET.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { lireCatalogue, ecrireCatalogueDirect } from "./catalogue.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ESSAI = args.includes("--essai");
const TOUS = args.includes("--tous");
const COMPTE = opt("compte", "iugeyztf");
const R2 = String(process.env.R2_URL || "").trim().replace(/\/$/, "");
const SECRET = String(process.env.OUTILS_SECRET || "").trim();
const EN_PARALLELE = 4;

if (!R2 || !SECRET) { console.error("ERREUR : il manque R2_URL ou OUTILS_SECRET (secrets GitHub)."); process.exit(1); }
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

/* Le serveur doit répondre et avoir R2 avant de toucher à quoi que ce soit */
const etat = await fetch(R2).then((r) => r.json()).catch(() => ({}));
if (!etat.stockage || !etat.outils) {
  console.error(`ERREUR : le serveur ${R2} n'est pas prêt (stockage R2 : ${!!etat.stockage}, secret des outils : ${!!etat.outils}). Vérifie la liaison FICHIERS et OUTILS_SECRET dans Cloudflare.`);
  process.exit(1);
}

const aMigrer = (u) => {
  const m = /^https:\/\/res\.cloudinary\.com\/([^/]+)\//.exec(String(u || ""));
  return !!m && (TOUS || m[1] === COMPTE);
};
const JOURNAL = path.join(ICI, "migre.json");
let fait = new Set();
try { fait = new Set(JSON.parse(fs.readFileSync(JOURNAL, "utf8"))); } catch {}
const noter = (k) => { fait.add(k); try { fs.writeFileSync(JOURNAL, JSON.stringify([...fait])); } catch {} };
const nomDe = (u) => decodeURIComponent(String(u).split("?")[0].split("/").pop() || "fichier").replace(/[^\w.-]+/g, "-").slice(-80);

/** Copie un fichier Cloudinary dans R2 (3 essais). Renvoie le nouveau lien. */
async function copier(source, cleR2) {
  let derniere;
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(`${R2}/copier`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Secret": SECRET },
        body: JSON.stringify({ source, cle: cleR2 }), signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) return j.url;
      derniere = new Error(j.erreur || `serveur ${r.status}`);
      if (r.status === 404 || r.status === 401 || r.status === 400) break; // inutile de réessayer
    } catch (e) { derniere = e; }
    await new Promise((ok) => setTimeout(ok, 3000 * essai));
  }
  throw derniere;
}

/** Fait tourner les tâches EN_PARALLELE à la fois */
async function enParallele(taches) {
  let i = 0;
  await Promise.all(Array.from({ length: EN_PARALLELE }, async () => { while (i < taches.length) await taches[i++](); }));
}

const bilan = { fichiers: 0, images: 0, opps: 0, erreurs: 0, introuvables: 0 };

/* ---------- 1. Fichiers des documents (documents/<id>/prive/fichier) ---------- */
const prives = await db.collectionGroup("prive").get();
const fichiers = prives.docs.filter((s) => s.id === "fichier" && s.ref.parent.parent?.parent?.id === "documents");
const aFaire = fichiers.filter((s) => {
  const f = s.data();
  return !fait.has(`f:${s.ref.parent.parent.id}`) && [f.fileUrl, ...(f.parts || []).map((p) => p.url)].some(aMigrer);
});
console.log(`Fichiers : ${fichiers.length} document(s) en tout, ${aFaire.length} à copier ${TOUS ? "(tous les comptes)" : `(compte ${COMPTE})`}.`);

/* ---------- 2. Images des documents (aperçus) ---------- */
const catalogue = await lireCatalogue(db);
const attente = (await db.collection("documents").where("statut", "==", "en_attente").get()).docs.map((s) => [s.id, s.data().imageUrl]);
const images = [...Object.entries(catalogue).map(([id, e]) => [id, Array.isArray(e) ? e[5] : ""]), ...attente]
  .filter(([id, u]) => aMigrer(u) && !fait.has(`i:${id}`));
console.log(`Images : ${images.length} aperçu(s) à copier.`);

/* ---------- 3. Images des opportunités ---------- */
const opps = (await db.collection("opportunites").get().catch(() => ({ docs: [] }))).docs;
const details = prives.docs.filter((s) => s.id === "detail" && s.ref.parent.parent?.parent?.id === "opportunites");
const oppsAFaire = opps.filter((s) => aMigrer(s.data().image) && !fait.has(`o:${s.id}`));
const detailsAFaire = details.filter((s) => (s.data().images || []).some(aMigrer) && !fait.has(`d:${s.ref.parent.parent.id}`));
console.log(`Opportunités : ${oppsAFaire.length + detailsAFaire.length} à copier.\n`);

if (ESSAI) { console.log("(mode essai : rien n'a été copié ni modifié)"); process.exit(0); }

let n = 0;
const total = aFaire.length + images.length + oppsAFaire.length + detailsAFaire.length;
const avance = (txt) => console.log(`[${++n}/${total}] ${txt}`);

await enParallele(aFaire.map((s) => async () => {
  const id = s.ref.parent.parent.id;
  const f = s.data();
  try {
    const parts = f.parts?.length ? f.parts : null;
    const nouvelles = [];
    if (parts) {
      for (let i = 0; i < parts.length; i++) {
        nouvelles.push({ ...parts[i], url: aMigrer(parts[i].url) ? await copier(parts[i].url, `documents/migre/${id}/${i}-${nomDe(parts[i].url)}`) : parts[i].url });
      }
    }
    const fileUrl = parts ? nouvelles[0].url : aMigrer(f.fileUrl) ? await copier(f.fileUrl, `documents/migre/${id}/0-${nomDe(f.fileUrl)}`) : f.fileUrl;
    await s.ref.update({ fileUrl, ...(parts ? { parts: nouvelles } : {}), ancien: { fileUrl: f.fileUrl, parts: f.parts || null } });
    noter(`f:${id}`); bilan.fichiers++;
    avance(`fichier ${id} copié`);
  } catch (e) {
    if (/404/.test(e.message)) { bilan.introuvables++; avance(`fichier ${id} : déjà absent de Cloudinary`); }
    else { bilan.erreurs++; avance(`ERREUR fichier ${id} : ${e.message}`); }
  }
}));

// Images : la nouvelle adresse est notée dans la fiche du document puis, par lots, dans le catalogue
const nouvellesImages = {};
await enParallele(images.map(([id, u]) => async () => {
  try {
    const nu = await copier(u, `images/migre/${id}.jpg`);
    await db.collection("documents").doc(id).update({ imageUrl: nu, ancienneImage: u });
    if (catalogue[id]) nouvellesImages[id] = nu;
    noter(`i:${id}`); bilan.images++;
    avance(`aperçu ${id} copié`);
  } catch (e) { bilan.erreurs++; avance(`ERREUR aperçu ${id} : ${e.message}`); }
}));
const ids = Object.keys(nouvellesImages);
for (let i = 0; i < ids.length; i += 300) {
  const lot = {};
  for (const id of ids.slice(i, i + 300)) { const e = [...catalogue[id]]; e[5] = nouvellesImages[id]; lot[id] = e; }
  await ecrireCatalogueDirect(db, lot);
}

await enParallele([
  ...oppsAFaire.map((s) => async () => {
    try { await s.ref.update({ image: await copier(s.data().image, `opportunites/migre/${s.id}/carte.jpg`) }); noter(`o:${s.id}`); bilan.opps++; avance(`opportunité ${s.id}`); }
    catch (e) { bilan.erreurs++; avance(`ERREUR opportunité ${s.id} : ${e.message}`); }
  }),
  ...detailsAFaire.map((s) => async () => {
    const id = s.ref.parent.parent.id;
    try {
      const imgs = s.data().images || [], nouvelles = [];
      for (let i = 0; i < imgs.length; i++) nouvelles.push(aMigrer(imgs[i]) ? await copier(imgs[i], `opportunites/migre/${id}/${i}.jpg`) : imgs[i]);
      await s.ref.update({ images: nouvelles });
      noter(`d:${id}`); bilan.opps++; avance(`affiches de l'opportunité ${id}`);
    } catch (e) { bilan.erreurs++; avance(`ERREUR opportunité ${id} : ${e.message}`); }
  }),
]);

const reste = aFaire.length - bilan.fichiers - bilan.introuvables;
console.log(`\nTerminé : ${bilan.fichiers} fichier(s), ${bilan.images} aperçu(s), ${bilan.opps} opportunité(s) copiés dans R2.`
  + ` ${bilan.introuvables} fichier(s) déjà absents de Cloudinary, ${bilan.erreurs} erreur(s).`);
console.log(bilan.erreurs || reste > 0 ? "Relance l'outil : il reprendra seulement ce qui manque." : "Tout est copié pour ce compte.");
process.exit(0);
