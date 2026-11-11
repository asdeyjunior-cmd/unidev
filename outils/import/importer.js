#!/usr/bin/env node
/**
 * Importation en masse de documents dans unidev.
 *
 *   node importer.js dossier <chemin> [--csv infos.csv] [--essai]
 *   node importer.js hal [--recherche "mots"] [--max 500] [--types LECTURE,MEM] [--essai]
 *   node importer.js wiki [--projet wikiversite|wikilivres] [--recherche "mots"] [--max 50] [--essai]
 *   node importer.js zenodo [--recherche "mots"] [--max 50] [--types lesson,presentation] [--essai]
 *   node importer.js tout --recherche "mots" [--max 20] [--essai]   (toutes les sources, --max par source)
 *
 * --essai : affiche ce qui serait importé, sans rien envoyer.
 * Les documents importés sont publiés directement (statut « publie »), au nom de l'admin.
 * Un journal (import-journal.json) évite d'importer deux fois le même fichier.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import "dotenv/config";
import { tamponUnidev, sansModification } from "./marque.js";
import { motsPourFiliere, FILIERES, niveauDe, typeDe } from "./outils.js";
import { comptes, choisirCompte, basculer, comptePlein } from "./stockage.js";
import {
  TYPES, NIVEAUX, EXTENSIONS, TAILLE_MORCEAU, MAX_IMAGE_PDF, MAX_FICHIER,
  infosDepuisChemin, lireCsv, normaliserNiveau, normaliserType, licenceAutorisee,
  filiereDepuisDomaines, couper, decouper, couvertureSvg, avecRelance, telecharger,
} from "./outils.js";
import { canonFiliere, ajouterFilieres, filiereConnue, nomComplet } from "../../js/filieres.js";

/* ---------- Arguments ---------- */
const args = process.argv.slice(2);
const mode = args[0];
const opt = (nom, def = null) => { const i = args.indexOf(`--${nom}`); return i >= 0 ? args[i + 1] : def; };
const ESSAI = args.includes("--essai");
// Erreur hors des boucles (ex. : quota Firestore épuisé dès la 1re lecture) : message clair dans le Résumé
const messageErreur = (e) => /RESOURCE_EXHAUSTED|quota|exhausted/i.test(String(e?.message) + String(e?.code))
  ? "QUOTA FIRESTORE DU JOUR ÉPUISÉ (50 000 lectures). Rien n'est cassé : relance après 8h00 (heure d'Abidjan), quand le quota revient à zéro."
  : /too many index entries/i.test(String(e?.message))
    ? "INDEX FIRESTORE PLEIN : lance « firebase deploy --only firestore » sur ton PC, attends 15 minutes et relance."
    : e?.message || String(e);
process.on("unhandledRejection", (e) => { console.error(`\nERREUR : ${messageErreur(e)}`); process.exit(1); });
// --attente : les documents sont proposés à l'admin (Modération > Documents à valider) au lieu d'être publiés
const ATTENTE = args.includes("--attente");
// --partenaires : cherche aussi sur les sites de sites-partenaires.json (sites qui ont donné leur accord)
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

if (!["dossier", "hal", "wiki", "zenodo", "tout", "filiere", "romans", "site"].includes(mode)) {
  console.log(`Utilisation :
  node importer.js filiere --filiere "Finance-Comptabilité" [--max 50] [--essai]   (vide = toutes les filières)
  node importer.js dossier <chemin> [--csv infos.csv] [--essai]
  node importer.js hal [--recherche "mots"] [--max 500] [--types LECTURE,MEM] [--essai]
  node importer.js wiki [--projet wikiversite|wikilivres] [--recherche "mots"] [--max 50] [--essai]
  node importer.js zenodo [--recherche "mots"] [--max 50] [--types lesson,presentation] [--essai]
  node importer.js tout --recherche "mots" [--max 20] [--essai]   (HAL + Wikiversité + Wikilivres + Zenodo)
  node importer.js romans [--recherche "titre ou auteur"] [--max 20] [--essai]   (Wikisource, domaine public)
  node importer.js site --url "https://..." [--profondeur 2] [--max 50] [--remplacer "mot1,mot2"] [--essai]   (site qui t'a donné son accord)`);
  process.exit(1);
}

/* ---------- Journal (reprise après coupure) ---------- */
const JOURNAL = path.resolve("import-journal.json");
const journal = fs.existsSync(JOURNAL) ? JSON.parse(fs.readFileSync(JOURNAL, "utf8")) : {};
const noter = (cle, valeur) => { journal[cle] = valeur; fs.writeFileSync(JOURNAL, JSON.stringify(journal, null, 2)); };

/* ---------- Connexions (seulement hors mode essai) ---------- */
let cloudinary, db, FieldValue, ADMIN_UID;
// Mode « filiere » : tous les documents trouvés sont rangés dans la filière demandée
let FILIERE_FORCEE = "";
// Recherche par filière : un document n'y est rangé que s'il en parle vraiment (sinon il était mal placé)
let PERTINENT = null;
let LOGOS = new Set(); // logos de sites partenaires reconnus par signature.js (parametres/logos)
async function connecter() {
  if (!process.env.FIREBASE_CLE) throw new Error("Variable manquante dans .env : FIREBASE_CLE");
  if (!comptes().length) throw new Error("Aucun compte Cloudinary : mets CLOUDINARY_COMPTES (ou CLOUDINARY_CLOUD_NAME, _API_KEY, _API_SECRET) dans .env");
  const cle = path.resolve(process.env.FIREBASE_CLE);
  if (!fs.existsSync(cle)) throw new Error(`Clé Firebase introuvable : ${cle}`);

  ({ v2: cloudinary } = await import("cloudinary"));
  await choisirCompte(cloudinary); // le compte Cloudinary le plus libre

  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
  db = admin.firestore();
  FieldValue = admin.firestore.FieldValue;
  ADMIN_UID = (await db.doc("parametres/admin").get()).data()?.uid;
  if (!ADMIN_UID) throw new Error("Document parametres/admin introuvable dans Firestore (voir README).");
  ajouterFilieres((await db.doc("index/filieres").get()).data()?.liste || []);
  // Documents déjà sur unidev : pour ne jamais publier deux fois le même
  // Économie de lectures Firestore : les documents publiés viennent de l'index (1 seule lecture),
  // plus ceux qui attendent la validation (peu nombreux)
  const index = (await db.doc("index/catalogue").get()).data()?.docs || {};
  for (const e of Object.values(index)) if (Array.isArray(e)) retenir({ titre: e[0], universite: e[7] });
  const attente = await db.collection("documents").where("statut", "==", "en_attente").select("titre", "universite").get();
  attente.docs.forEach((s) => retenir(s.data()));
  console.log(`${existants.size} titre(s) déjà sur unidev (les doublons seront sautés).\n`);
}

// Envoi vers Cloudinary : délai généreux (10 min) et nouvel essai si la connexion coupe
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

async function couvertureGenerique(infos) {
  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from(couvertureSvg(infos))).png().toBuffer();
  const res = await envoyer(png, { resource_type: "image", folder: "unidev/couvertures" });
  return res.secure_url;
}

/* ---------- Anti-doublons ---------- */
const existants = new Map(); // titre simplifié -> [{ taille, universite }]
const cleTitre = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function retenir(d) { const k = cleTitre(d.titre); if (!k) return; if (!existants.has(k)) existants.set(k, []); existants.get(k).push({ taille: d.taille || 0, universite: cleTitre(d.universite) }); }
/** Vrai si un document de même titre existe déjà sur unidev (même titre = doublon) */
function estDoublon(infos) {
  return existants.has(cleTitre(infos.titre));
}
const erreurDoublon = () => Object.assign(new Error("déjà sur unidev : ignoré (doublon)"), { doublon: true });

/** Envoie ta propre image de couverture (redimensionnée, 1200 px max, JPEG). */
async function envoyerImage(chemin) {
  const sharp = (await import("sharp")).default;
  const jpg = await sharp(fs.readFileSync(chemin)).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();
  const res = await envoyer(jpg, { resource_type: "image", folder: "unidev/couvertures" });
  return res.secure_url;
}

/** Envoie un document et crée sa fiche publiée. Renvoie l'ID Firestore. */
async function publier(buffer, nomFichier, infos, imageChemin = null) {
  // Toujours un type : d'abord le titre, la matière et le nom du fichier, sinon « Cours » pour les sources de cours
  if (!TYPES.includes(infos.type) || infos.type === "Autre") {
    infos.type = typeDe(`${infos.titre} ${infos.matiere} ${nomFichier}`)
      || (/wiki|zenodo|hal/i.test(String(infos.universite || "")) ? "Cours" : "Autre");
  }
  // Toujours un niveau : d'abord ce que disent le titre, la matière et la filière, sinon d'après la source
  if (!NIVEAUX.includes(infos.niveau) || infos.niveau === "Autre") {
    const src = String(infos.universite || "");
    infos.niveau = niveauDe(`${infos.titre} ${infos.matiere} ${infos.filiere} ${nomFichier}`)
      || (/wiki/i.test(src) ? "Licence 1" : /zenodo/i.test(src) ? "Licence 3" : /hal/i.test(src) ? "Master 1" : "Autre");
  }
  if (estDoublon(infos)) throw erreurDoublon();
  infos = { ...infos, filiere: canonFiliere(FILIERE_FORCEE || infos.filiere) || "Autre" };
  const ext = path.extname(nomFichier).slice(1).toLowerCase();
  // Tampon unidev en bas de chaque page (sauf licence « pas de modification »)
  let tampon = false;
  if (ext === "pdf" && !sansModification(infos.description)) {
    try { const t = await tamponUnidev(buffer); buffer = t.buffer; tampon = !!(t.pages || t.deja); }
    catch (e) { console.warn(`   (tampon unidev impossible : ${e.message})`); }
  }
  let fichier = null;
  let imageUrl = null;

  // Ta propre image si tu en as mis une à côté du fichier
  if (imageChemin) {
    try { imageUrl = await envoyerImage(imageChemin); }
    catch (e) { console.warn(`   (image illisible, couverture automatique : ${e.message})`); }
  }

  // PDF de 10 Mo max sans image : un seul envoi sert à la fois de fichier et d'image (1re page)
  if (!imageUrl && ext === "pdf" && buffer.length <= MAX_IMAGE_PDF) {
    try {
      const res = await envoyer(buffer, { resource_type: "image", folder: "unidev/documents" });
      fichier = { fileUrl: res.secure_url, publicId: res.public_id };
      imageUrl = cloudinary.url(res.public_id, {
        resource_type: "image", secure: true, format: "jpg",
        transformation: [{ page: 1, width: 800, crop: "limit", quality: "auto" }],
      }).split("?")[0];
    } catch (e) {
      console.warn(`   (aperçu impossible, envoi simple : ${e.message})`);
    }
  }
  if (!fichier) {
    if (buffer.length <= TAILLE_MORCEAU) {
      const res = await envoyer(buffer, { resource_type: "raw", folder: "unidev/documents" });
      fichier = { fileUrl: res.secure_url, publicId: res.public_id };
    } else {
      const parts = [];
      for (const morceau of decouper(buffer)) {
        const res = await envoyer(morceau, { resource_type: "raw", folder: "unidev/documents" });
        parts.push({ url: res.secure_url, publicId: res.public_id });
      }
      fichier = { fileUrl: parts[0].url, publicId: parts[0].publicId, parts };
    }
  }
  if (!imageUrl) imageUrl = await couvertureGenerique({ ...infos, format: ext });

  const ref = db.collection("documents").doc();
  const batch = db.batch();
  batch.set(ref, {
    titre: couper(infos.titre, 140),
    matiere: couper(infos.matiere || infos.filiere || "Divers", 80),
    filiere: couper(infos.filiere || "Autre", 80),
    type: TYPES.includes(infos.type) ? infos.type : "Autre",
    niveau: NIVEAUX.includes(infos.niveau) ? infos.niveau : "Autre",
    annee: couper(infos.annee || "", 20),
    universite: couper(infos.universite || "", 100),
    description: couper(infos.description || "", 600),
    format: ext,
    taille: buffer.length,
    nomFichier: couper(nomFichier, 200),
    imageUrl,
    auteurId: ADMIN_UID,
    auteurNom: process.env.AUTEUR_NOM || "unidev",
    statut: ATTENTE ? "en_attente" : "publie",
    telechargements: 0,
    creditAccorde: true,
    ...(ATTENTE ? { propose: "agent" } : {}),
    ...(tampon ? { tampon: true } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!ATTENTE && infos.filiere && infos.filiere !== "Autre" && !filiereConnue(infos.filiere)) {
    batch.set(db.doc("index/filieres"), { liste: FieldValue.arrayUnion(infos.filiere) }, { merge: true });
    ajouterFilieres([infos.filiere]);
  }
  batch.set(ref.collection("prive").doc("fichier"), { ...fichier, auteurId: ADMIN_UID });
  // En attente : il entrera dans le catalogue quand l'admin le validera
  if (!ATTENTE) batch.set(db.doc("index/catalogue"), { docs: { [ref.id]: [
    couper(infos.titre, 140), couper(infos.matiere || infos.filiere || "Divers", 80), couper(infos.filiere || "Autre", 80),
    TYPES.includes(infos.type) ? infos.type : "Autre", NIVEAUX.includes(infos.niveau) ? infos.niveau : "Autre",
    imageUrl, ext, couper(infos.universite || "", 100),
  ] } }, { merge: true });
  await batch.commit();
  retenir({ titre: infos.titre, taille: buffer.length, universite: infos.universite });
  return ref.id;
}

/* ---------- Mode 1 : dossier local ---------- */
function* parcourir(dossier, racine = dossier) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) yield* parcourir(p, racine);
    else if (EXTENSIONS.includes(path.extname(e.name).slice(1).toLowerCase())) yield { complet: p, relatif: path.relative(racine, p) };
  }
}

const IMAGES = ["jpg", "jpeg", "png", "webp"];
/** Image associée : même nom que le fichier (cours.pdf -> cours.jpg), ou colonne "image" du CSV. */
function trouverImage(complet, ligne, racine) {
  if (ligne?.image) {
    for (const base of [path.dirname(complet), racine, ...(csvDossier ? [csvDossier] : [])]) {
      const p = path.resolve(base, ligne.image);
      if (fs.existsSync(p)) return p;
    }
    console.warn(`   (image du CSV introuvable : ${ligne.image})`);
  }
  const base = complet.slice(0, -path.extname(complet).length);
  for (const e of IMAGES) for (const x of [e, e.toUpperCase()]) if (fs.existsSync(`${base}.${x}`)) return `${base}.${x}`;
  return null;
}
let csvDossier = null;

async function importerDossier() {
  const racine = path.resolve(args[1] || "");
  if (!args[1] || !fs.existsSync(racine)) throw new Error("Indique le dossier : node importer.js dossier <chemin>");
  // infos.csv créé par ranger.js dans le dossier rangé : utilisé automatiquement
  const csvChemin = opt("csv") || (fs.existsSync(path.join(racine, "infos.csv")) ? path.join(racine, "infos.csv") : null);
  const csv = new Map();
  if (csvChemin) {
    csvDossier = path.dirname(path.resolve(csvChemin));
    for (const l of lireCsv(fs.readFileSync(csvChemin, "utf8"))) if (l.fichier) csv.set(path.basename(l.fichier).toLowerCase(), l);
  }
  const fichiers = [...parcourir(racine)];
  console.log(`${fichiers.length} fichier(s) trouvé(s) dans ${racine}\n`);
  let ok = 0, sautes = 0, erreurs = 0, avecImage = 0;

  for (const [i, f] of fichiers.entries()) {
    const buffer = fs.readFileSync(f.complet);
    const empreinte = crypto.createHash("sha1").update(buffer).digest("hex");
    const cle = `fichier:${empreinte}`;
    const nom = path.basename(f.complet);
    const prefixe = `[${i + 1}/${fichiers.length}]`;
    if (journal[cle]) { sautes++; console.log(`${prefixe} déjà importé : ${f.relatif}`); continue; }
    if (buffer.length > MAX_FICHIER) { erreurs++; console.log(`${prefixe} trop lourd (> 100 Mo) : ${f.relatif}`); continue; }

    const infos = infosDepuisChemin(f.relatif);
    const ligne = csv.get(nom.toLowerCase());
    if (ligne) {
      for (const k of ["titre", "matiere", "filiere", "annee", "universite", "description"]) if (ligne[k]) infos[k] = ligne[k];
      if (ligne.type) infos.type = normaliserType(ligne.type) || ligne.type;
      if (ligne.niveau) infos.niveau = normaliserNiveau(ligne.niveau) || ligne.niveau;
    }
    infos.filiere = canonFiliere(infos.filiere);
    const image = trouverImage(f.complet, ligne, racine);
    if (image) avecImage++;
    console.log(`${prefixe} ${infos.titre}  ·  ${infos.filiere || "?"} · ${infos.niveau || "?"} · ${infos.type || "?"} · ${infos.matiere || "?"}  ·  image : ${image ? path.basename(image) : "automatique"}`);
    if (ESSAI) continue;
    try {
      const id = await publier(buffer, nom, infos, image);
      noter(cle, { id, source: f.relatif, date: new Date().toISOString() });
      ok++;
    } catch (e) {
      if (e.doublon) { noter(cle, { doublon: true }); sautes++; console.log("   doublon : déjà sur unidev, ignoré"); continue; }
      erreurs++;
      console.log(`   ERREUR : ${e.message}`);
    }
  }
  console.log(`\nTerminé : ${ok} importé(s), ${sautes} déjà présent(s), ${erreurs} erreur(s). ${avecImage} fichier(s) avec ta propre image.${ESSAI ? " (mode essai : rien n'a été envoyé)" : ""}`);
}

/* ---------- Mode 2 : archive ouverte HAL (documents sous licence libre) ---------- */
async function importerHal(rechercheImposee = null, maxImpose = null) {
  const recherche = rechercheImposee || opt("recherche", "*");
  const max = maxImpose || Number(opt("max", "200"));
  const types = opt("types", "LECTURE").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const typeSite = { LECTURE: "Cours", MEM: "Mémoire", THESE: "Mémoire", COURSE: "Cours" };
  const champs = "halId_s,title_s,licence_s,fileMain_s,authFullName_s,producedDateY_i,keyword_s,domain_s,abstract_s,docType_s,structName_s";
  let start = 0, ok = 0, refusees = 0, sautes = 0, erreurs = 0;

  console.log(`Recherche HAL : « ${recherche} » · types ${types.join(", ")} · ${max} documents au maximum\n`);
  while (ok < max) {
    const url = "https://api.archives-ouvertes.fr/search/?" + new URLSearchParams({
      q: recherche, wt: "json", rows: "100", start: String(start), fl: champs, sort: "producedDateY_i desc",
    }) + `&fq=language_s:fr&fq=submitType_s:file&fq=docType_s:(${types.join(" OR ")})`;
    const rep = await fetch(url);
    if (!rep.ok) throw new Error(`HAL a répondu ${rep.status}`);
    const json = await rep.json();
    const docs = json.response?.docs || [];
    if (!docs.length) break;
    if (start === 0) console.log(`${json.response.numFound} résultat(s) dans HAL, filtrage des licences…\n`);

    for (const d of docs) {
      if (ok >= max) break;
      const licence = licenceAutorisee(d.licence_s);
      if (!licence || !d.fileMain_s) { refusees++; continue; }
      const cle = `hal:${d.halId_s}`;
      if (journal[cle]) { sautes++; continue; }

      const auteurs = (d.authFullName_s || []).slice(0, 3).join(", ") + ((d.authFullName_s || []).length > 3 ? " et al." : "");
      const titre = (d.title_s || ["Sans titre"])[0];
      const resume = couper((d.abstract_s || [""])[0], 330);
      const infos = {
        titre,
        matiere: couper((d.keyword_s || [])[0] || filiereDepuisDomaines(d.domain_s), 80),
        filiere: filiereDepuisDomaines(d.domain_s),
        type: typeSite[d.docType_s] || "Cours",
        niveau: d.docType_s === "THESE" ? "Doctorat" : d.docType_s === "MEM" ? "Master 2" : niveauDe(`${titre} ${(d.keyword_s || []).join(" ")}`) || "Master 1",
        annee: d.producedDateY_i ? String(d.producedDateY_i) : "",
        universite: couper((d.structName_s || [])[0] || "Archive ouverte HAL", 100),
        description: `${resume}${resume ? "\n" : ""}Auteur(s) : ${auteurs || "inconnu"} · Licence : ${licence} · Source : https://hal.science/${d.halId_s}`,
      };
      if (PERTINENT && !PERTINENT(`${titre} ${(d.keyword_s || []).join(" ")}`, infos.filiere)) { sautes++; continue; }
      console.log(`[${ok + erreurs + 1}] ${titre}  ·  ${FILIERE_FORCEE || infos.filiere} · ${licence}`);
      if (ESSAI) { ok++; continue; }

      try {
        if (estDoublon(infos)) throw erreurDoublon(); // vérifié avant de télécharger
        const buffer = await telecharger(d.fileMain_s, {}, { pdf: true });
        if (buffer.length > MAX_FICHIER) throw new Error("fichier de plus de 100 Mo");
        const nom = `${d.halId_s}.pdf`;
        const id = await publier(buffer, nom, infos);
        noter(cle, { id, source: d.fileMain_s, licence, date: new Date().toISOString() });
        ok++;
      } catch (e) {
        if (e.doublon) { noter(cle, { doublon: true }); sautes++; console.log("   doublon : déjà sur unidev, ignoré"); continue; }
        erreurs++;
        console.log(`   ERREUR : ${e.message}`);
      }
      await pause(800); // reste poli avec le serveur HAL
    }
    start += docs.length;
  }
  console.log(`\nTerminé : ${ok} importé(s), ${sautes} déjà présent(s), ${refusees} écarté(s) (licence non libre ou sans fichier), ${erreurs} erreur(s).${ESSAI ? " (mode essai : rien n'a été envoyé)" : ""}`);
  return ok;
}

/* ---------- Modes 3 et 4 : Wikiversité / Wikilivres et Zenodo ---------- */
async function importerSource(nom, generateur, max, rechercheAffichee = null) {
  let ok = 0, erreurs = 0, doublons = 0;
  const ecartes = {};
  console.log(`${nom} : ${mode === "site" ? `page de départ ${opt("url")}` : `recherche « ${rechercheAffichee || opt("recherche", "cours")} »`} · ${max} documents au maximum\n`);
  const it = generateur({ deja: (cle) => !!journal[cle], onEcarte: (raison) => (ecartes[raison] = (ecartes[raison] || 0) + 1) });
  try {
  for await (const d of it) {
    const infos = { ...d.infos, filiere: canonFiliere(d.infos.filiere) || "Autre" };
    if (PERTINENT && !PERTINENT(`${d.titre} ${d.infos.matiere || ""} ${d.nomFichier || ""}`, infos.filiere)) {
      ecartes["hors de la filière"] = (ecartes["hors de la filière"] || 0) + 1; continue;
    }
    console.log(`[${ok + erreurs + 1}] ${d.titre}  ·  ${infos.filiere} · ${d.licence} · ${(d.buffer.length / 1048576).toFixed(1)} Mo`);
    if (ESSAI) { ok++; continue; }
    try {
      if (d.buffer.length > MAX_FICHIER) throw new Error("fichier de plus de 100 Mo");
      const id = await publier(d.buffer, d.nomFichier, infos);
      noter(d.cle, { id, source: d.source, licence: d.licence, date: new Date().toISOString() });
      ok++;
    } catch (e) {
      if (e.doublon) { noter(d.cle, { doublon: true }); doublons++; console.log("   doublon : déjà sur unidev, ignoré"); continue; }
      erreurs++;
      console.log(`   ERREUR : ${e.message}`);
    }
  }
  } catch (e) { console.log(`\nArrêt du parcours (${e.message}) : les documents déjà importés sont gardés.`); }
  const ec = Object.entries(ecartes).map(([k, v]) => `${v} ${k}`).join(", ");
  console.log(`\nTerminé : ${ok} ${ESSAI ? "trouvé(s)" : "importé(s)"}, ${doublons} doublon(s) sauté(s), ${erreurs} erreur(s).${ec ? ` Écartés : ${ec}.` : ""}${ESSAI ? " (mode essai : rien n'a été envoyé)" : ""}`);
  return ok;
}

/* ---------- Sites partenaires (fichier sites-partenaires.json) ---------- */
const sansAcc = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const MOTS_VIDES = new Set(["cours", "general", "generale", "gestion", "sciences", "science", "techniques", "technique", "introduction", "droit", "etudes"].map(sansAcc));
function partenaires() {
  try {
    const l = JSON.parse(fs.readFileSync(new URL("./sites-partenaires.json", import.meta.url), "utf8")).sites || [];
    return l.filter((p) => p.accord === true && /^https?:\/\//.test(p.url || ""));
  } catch { return []; }
}

/* ---------- Lancement ---------- */
// Une erreur imprévue dans un document ne doit jamais arrêter tout l'import
process.on("unhandledRejection", (e) => console.log(`   (erreur ignorée : ${e?.message || e})`));
try {
  if (!ESSAI) await connecter();
  if (mode === "dossier") await importerDossier();
  else if (mode === "hal") await importerHal();
  else if (mode === "filiere") {
    // Une filière -> on cherche son nom et ses matières dans toutes les sources libres, jusqu'au nombre demandé
    const { coursWiki, coursZenodo } = await import("./sources.js");
    const demandee = String(opt("filiere", "") || "").trim();
    const total = Math.max(1, Number(opt("max", "50")) || 50);
    // Filière vide : toutes les filières connues, chacune sa part
    const liste = demandee ? [canonFiliere(demandee) || demandee] : FILIERES;
    const part = demandee ? total : Math.max(2, Math.ceil(total / liste.length));
    if (!demandee) console.log(`Aucune filière indiquée : toutes les filières (${liste.length}), ${part} document(s) chacune.\n`);
    let grandTotal = 0;
    for (const filiere of liste) {
      if (grandTotal >= total) break;
      FILIERE_FORCEE = filiere;
      {
        const cles = [...motsPourFiliere(filiere), ...nomComplet(filiere).split(/[\s,-]+/)].map(sansAcc).filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));
        PERTINENT = (texte, devinee) => {
          // Le document dit lui-même appartenir à une autre filière connue : pas ici
          const f = canonFiliere(devinee || "");
          if (f && f !== "Autre" && f !== canonFiliere(filiere)) return false;
          const t = sansAcc(texte);
          return !cles.length || cles.some((c) => t.includes(c));
        };
      }
      const voulu = Math.min(part, total - grandTotal);
      const mots = motsPourFiliere(filiere);
      let faits = 0;
      const reste = () => Math.max(0, voulu - faits);
      // 1. Sites partenaires (avec leur accord) : seulement les documents qui parlent de la filière
      if (args.includes("--partenaires")) {
        const { documentsDuSite } = await import("./sources.js");
        const cles = [...mots, ...nomComplet(filiere).split(/[\s,-]+/)].map(sansAcc).filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));
        const filtre = (t) => { const x = sansAcc(t); return cles.some((c) => x.includes(c)); };
        // Chaque site partenaire (et les sources libres) a sa part : un seul site ne prend pas toute la place
        const sites = partenaires();
        const part = Math.max(1, Math.ceil(voulu / (sites.length + 1)));
        console.log(`\nSites partenaires : ${sites.map((p) => p.nom).join(", ") || "aucun"} (${part} document(s) chacun, le reste vient des sources libres)`);
        for (const p of sites) {
          if (!reste()) break;
          const quota = Math.min(part, reste());
          console.log(`\n========== ${p.nom} · « ${filiere} » ==========`);
          try {
            faits += (await importerSource(p.nom, (o) => documentsDuSite({ url: p.url, profondeur: p.profondeur || 3, max: quota, essai: ESSAI, remplacer: p.remplacer || [], logos: LOGOS, filtre, ...o }), quota, filiere)) || 0;
          } catch (e) { console.log(`${p.nom} indisponible : ${e.message}`); }
        }
      }
      console.log(`\n##### Filière « ${filiere} » : ${mots.join(", ")} (${voulu} au maximum)`);
      // Tant qu'il manque des documents, on élargit la recherche (le nombre demandé est un minimum) :
      // tour 1 = filière et matières ; tour 2 = « cours », « exercices corrigés », « examen », « TD » de chaque matière ;
      // tour 3 = sites partenaires fouillés plus en profondeur
      const tours = [mots, mots.flatMap((m) => [`${m} cours`, `${m} exercices corrigés`, `${m} examen`, `${m} TD`])];
      for (let t = 0; t < tours.length && reste(); t++) {
        if (t) console.log(`\n----- Il manque ${reste()} document(s) : recherche élargie -----`);
        for (const mot of tours[t]) {
          if (!reste()) break;
          const sources = [
            ["HAL", () => importerHal(mot, reste())],
            ["Wikiversité", () => importerSource("Wikiversité", (o) => coursWiki({ projet: "wikiversite", recherche: mot, max: reste(), ...o }), reste(), mot)],
            ["Wikilivres", () => importerSource("Wikilivres", (o) => coursWiki({ projet: "wikilivres", recherche: mot, max: reste(), ...o }), reste(), mot)],
            ["Zenodo", () => importerSource("Zenodo", (o) => coursZenodo({ recherche: mot, max: reste(), types: ["lesson", "presentation", "publication"], essai: ESSAI, ...o }), reste(), mot)],
          ];
          for (const [nom, lancer] of sources) {
            if (!reste()) break;
            console.log(`\n========== ${nom} · « ${mot} » ==========`);
            try { faits += (await lancer()) || 0; } catch (e) { console.log(`${nom} indisponible : ${e.message}`); }
          }
        }
      }
      if (reste() && args.includes("--partenaires")) {
        console.log(`\n----- Il manque encore ${reste()} document(s) : sites partenaires en profondeur -----`);
        const { documentsDuSite } = await import("./sources.js");
        const cles = [...mots, ...nomComplet(filiere).split(/[\s,-]+/)].map(sansAcc).filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));
        const filtre = (x) => { const y = sansAcc(x); return cles.some((c) => y.includes(c)); };
        for (const p of partenaires()) {
          if (!reste()) break;
          try { faits += (await importerSource(p.nom, (o) => documentsDuSite({ url: p.url, profondeur: 4, max: reste(), essai: ESSAI, remplacer: p.remplacer || [], logos: LOGOS, filtre, ...o }), reste(), filiere)) || 0; }
          catch (e) { console.log(`${p.nom} indisponible : ${e.message}`); }
        }
      }
      if (reste()) console.log(`ATTENTION : seulement ${faits}/${voulu} document(s) trouvé(s) pour « ${filiere} » : tout ce qui existe a été pris, la filière sera retentée.`);
      try { fs.writeFileSync("resultat-filiere.json", JSON.stringify({ filiere, faits, voulu })); } catch {}
      grandTotal += faits;
      console.log(`=== Filière « ${filiere} » : ${faits} document(s) ${ESSAI ? "trouvé(s)" : "importé(s)"} ===`);
    }
    console.log(`\n=== Terminé : ${grandTotal} document(s) ${ESSAI ? "trouvé(s)" : "importé(s)"} au total ===`);
  }
  else if (mode === "tout") {
    // Recherche partout : chaque source à son tour ; une source en panne n'arrête pas les autres
    const { coursWiki, coursZenodo } = await import("./sources.js");
    const max = Number(opt("max", "20"));
    const recherche = opt("recherche", "cours");
    const etapes = [
      ["HAL", () => importerHal()],
      ["Wikiversité", () => importerSource("Wikiversité", (o) => coursWiki({ projet: "wikiversite", recherche, max, ...o }), max)],
      ["Wikilivres", () => importerSource("Wikilivres", (o) => coursWiki({ projet: "wikilivres", recherche, max, ...o }), max)],
      ["Zenodo", () => importerSource("Zenodo", (o) => coursZenodo({ recherche, max, types: ["lesson", "presentation"], essai: ESSAI, ...o }), max)],
    ];
    for (const [nom, lancer] of etapes) {
      console.log(`\n========== ${nom} ==========`);
      try { await lancer(); } catch (e) { console.log(`${nom} indisponible : ${e.message}`); }
    }
  }
  else {
    const { coursWiki, coursZenodo, romansWikisource, documentsDuSite } = await import("./sources.js");
    const max = Number(opt("max", "50"));
    const recherche = opt("recherche", mode === "romans" ? "" : "cours");
    if (mode === "site") {
      const url = opt("url");
      if (!url || !/^https?:\/\//.test(url)) throw new Error('Indique la page de départ : --url "https://..."');
      const profondeur = Math.max(1, Math.min(4, Number(opt("profondeur", "3"))));
      // --remplacer "fomesoutra,fo me soutra" : remplace la signature du site par celle d'unidev (accord écrit du site obligatoire)
      const remplacer = (opt("remplacer", "") || "").split(",").map((m) => m.trim()).filter((m) => m.length >= 4);
      if (remplacer.length) console.log(`Signature remplacée par unidev dans les PDF : ${remplacer.join(", ")}\n`);
      await importerSource(`Site ${new URL(url).hostname}`, (o) => documentsDuSite({ url, profondeur, max, essai: ESSAI, remplacer, logos: LOGOS, ...o }), max);
    } else if (mode === "romans") {
      await importerSource("Romans (Wikisource)", (o) => romansWikisource({ recherche, max, essai: ESSAI, ...o }), max);
    } else if (mode === "wiki") {
      const projet = (opt("projet", "wikiversite") || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      await importerSource(projet === "wikilivres" ? "Wikilivres" : "Wikiversité", (o) => coursWiki({ projet, recherche, max, ...o }), max);
    } else {
      const types = opt("types", "lesson,presentation").split(",").map((t) => t.trim()).filter(Boolean);
      await importerSource("Zenodo", (o) => coursZenodo({ recherche, max, types, essai: ESSAI, ...o }), max);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(`\nERREUR : ${messageErreur(e)}`);
  process.exit(1);
}
