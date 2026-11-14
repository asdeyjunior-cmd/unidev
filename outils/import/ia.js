#!/usr/bin/env node
/**
 * L'IA de unidev (Google Gemini, offre gratuite). Tourne sur GitHub, aucun serveur à créer.
 *
 *   node ia.js --verifier            -> lit les documents envoyés (Modération) : avis + infos pré-remplies
 *   node ia.js --ranger [--max 150]  -> relit les documents publiés et corrige filière, matière, type, niveau, titre
 *   node ia.js --ranger --essai      -> montre ce qu'elle changerait, sans rien modifier
 *
 * Réglage : GEMINI_API_KEY (clé gratuite sur https://aistudio.google.com/apikey), GEMINI_MODELE (facultatif).
 * L'IA lit les 3 premières pages de chaque PDF (même scanné). Les documents déjà lus sont notés dans ia-faits.json.
 * Elle ne change une info que si elle est sûre d'elle (confiance >= 0,75) ; elle ne publie et ne supprime jamais rien.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
// pdf-lib est un module CommonJS : on prend l'objet entier puis ses parties (marche avec toutes les versions de Node)
import pdfLib from "pdf-lib";
const { PDFDocument } = pdfLib;
import { telecharger } from "./outils.js";
import { toutesLesFilieres, canonFiliere } from "../../js/filieres.js";
import { CATEGORIES } from "../../js/config.js";
import { lireCatalogue, ecrireCatalogue, ecrireCatalogueDirect } from "./catalogue.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ESSAI = args.includes("--essai");
const MAX = Math.max(1, Number(opt("max", "150")) || 150);
const CLE_IA = process.env.GEMINI_API_KEY;
const MODELES = [process.env.GEMINI_MODELE, "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"].filter(Boolean);
const PAUSE = 7000; // une question toutes les 7 secondes : reste sous la limite gratuite par minute
const SEUIL = 0.75;

if (!CLE_IA) { console.error("ERREUR : pas de clé GEMINI_API_KEY (secret GitHub). Crée-la gratuitement sur https://aistudio.google.com/apikey"); process.exit(1); }
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();

const FILIERES = toutesLesFilieres();
const { types: TYPES, niveaux: NIVEAUX } = CATEGORIES;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const sansAcc = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/* ---------- Documents déjà lus ---------- */
const FAITS = path.join(ICI, "ia-faits.json");
let faits = new Set();
try { faits = new Set(JSON.parse(fs.readFileSync(FAITS, "utf8"))); } catch {}
const noter = (id) => { faits.add(id); try { fs.writeFileSync(FAITS, JSON.stringify([...faits])); } catch {} };

/* ---------- Le fichier : 3 premières pages en PDF (léger, lisible par l'IA même si scanné) ---------- */
async function extrait(docId, format) {
  if (String(format || "pdf").toLowerCase() !== "pdf") return null;
  const f = (await db.collection("documents").doc(docId).collection("prive").doc("fichier").get()).data();
  if (!f?.fileUrl) return null;
  const morceaux = f.parts?.length ? f.parts.map((p) => p.url) : [f.fileUrl];
  const buffer = Buffer.concat(await Promise.all(morceaux.map((u) => telecharger(u))));
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const n = src.getPageCount();
    const sortie = await PDFDocument.create();
    (await sortie.copyPages(src, [...Array(Math.min(3, n)).keys()])).forEach((p) => sortie.addPage(p));
    const pdf = Buffer.from(await sortie.save());
    return { pdf: pdf.length < 15e6 ? pdf : null, pages: n, taille: buffer.length };
  } catch {
    return { pdf: buffer.length < 15e6 ? buffer : null, pages: 0, taille: buffer.length };
  }
}

/* ---------- Question à Gemini (réponse en JSON) ---------- */
let modele = 0;
class QuotaIA extends Error {}
async function demander(consigne, pdf) {
  const parts = [...(pdf ? [{ inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } }] : []), { text: consigne }];
  for (let essai = 0; essai < 4; essai++) {
    const nom = MODELES[modele];
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${nom}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": CLE_IA },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
      signal: AbortSignal.timeout(120000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.ok) {
      const j = await r.json();
      const texte = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      try { return JSON.parse(texte.replace(/^```(json)?|```$/g, "").trim()); } catch { throw new Error("réponse de l'IA illisible"); }
    }
    const msg = await r.text();
    if (r.status === 404 && modele + 1 < MODELES.length) { modele++; console.log(`   (modèle ${nom} indisponible : ${MODELES[modele]} à la place)`); continue; }
    if (r.status === 429) {
      if (/per ?day|PerDay|daily/i.test(msg)) throw new QuotaIA("quota gratuit du jour atteint");
      await attendre(60000); continue; // limite par minute : on patiente
    }
    if (r.status === 400 && pdf && /document|pdf|mime|inline/i.test(msg)) { parts.shift(); continue; } // PDF refusé : titre seul
    if (r.status === 401 || r.status === 403) throw new QuotaIA("clé Gemini refusée (vérifie le secret GEMINI_API_KEY)");
    if (r.status >= 500 || r.status === 0) { await attendre(15000); continue; }
    throw new Error(`Gemini ${r.status} : ${msg.slice(0, 160)}`);
  }
  throw new Error("Gemini ne répond pas");
}

const LISTES = `Filières possibles : ${FILIERES.join(" | ")}
Types possibles : ${TYPES.join(" | ")}
Niveaux possibles : ${NIVEAUX.join(" | ")}
(BTS 2 = examen national du BTS ivoirien ; S1/S2 = Licence 1, S3/S4 = Licence 2, S5/S6 = Licence 3.)`;

const CONSIGNE_RANGER = (d) => `Tu ranges des documents d'étudiants ivoiriens (BTS, université) sur le site unidev.
Lis le document joint (s'il y en a un) et ses infos actuelles, puis réponds UNIQUEMENT en JSON :
{"titre": "titre clair en français, 6 à 12 mots, sans code ni nom de site", "filiere": "...", "matiere": "matière précise (ex : Comptabilité générale)", "type": "...", "niveau": "...", "confiance": 0.0 à 1.0}
Choisis filiere, type et niveau EXACTEMENT dans les listes. Si le document ne dit rien du niveau, mets "Autre". Ne devine pas : baisse la confiance si tu hésites.
${LISTES}
Infos actuelles : titre « ${d.titre} » · filière « ${d.filiere} » · matière « ${d.matiere} » · type « ${d.type} » · niveau « ${d.niveau} »`;

const CONSIGNE_VERIFIER = (d) => `Tu aides le modérateur du site unidev (documents de cours pour étudiants ivoiriens) à vérifier un document envoyé par un étudiant.
Lis le document joint (3 premières pages) et réponds UNIQUEMENT en JSON :
{"avis": "ok" | "douteux" | "refuser",
 "raisons": ["courtes raisons en français, vides si ok"],
 "lisible": true|false, "educatif": true|false,
 "titre": "titre clair, 6 à 12 mots", "filiere": "...", "matiere": "...", "type": "...", "niveau": "...", "confiance": 0.0 à 1.0,
 "resume": "1 phrase qui dit ce que contient le document"}
"refuser" : page blanche, illisible, sans rapport avec les études, publicité, contenu choquant, ou document qui ne correspond pas du tout à son titre.
"douteux" : incomplet, très flou, ou infos (filière, type…) fausses. Sinon "ok".
${LISTES}
Infos données par l'étudiant : titre « ${d.titre} » · filière « ${d.filiere} » · matière « ${d.matiere} » · type « ${d.type} » · niveau « ${d.niveau} » · description « ${String(d.description || "").slice(0, 300)} »`;

/** Garde seulement des valeurs valides */
function propre(r) {
  const filiere = canonFiliere(r?.filiere || "");
  return {
    titre: String(r?.titre || "").replace(/\s+/g, " ").trim().slice(0, 140),
    filiere: FILIERES.includes(filiere) ? filiere : "",
    matiere: String(r?.matiere || "").replace(/\s+/g, " ").trim().slice(0, 80),
    type: TYPES.includes(r?.type) ? r.type : "",
    niveau: NIVEAUX.includes(r?.niveau) ? r.niveau : "",
    confiance: Math.max(0, Math.min(1, Number(r?.confiance) || 0)),
  };
}
const vide = (v) => !v || v === "Autre";
// Un titre est remplacé seulement s'il est illisible (code, tirets, nom de fichier)
const titreMoche = (t) => /^[0-9a-f]{6,}|[-_]{2,}|\w+-\w+-\w+-\w+|\.(pdf|docx?)$|^(scan|img|document|doc|fichier|file)[\s_-]*\d*$/i.test(String(t || "")) || String(t || "").length < 6;

/* ---------- 1. Vérifier les documents envoyés (Modération) ---------- */
async function verifier() {
  const snap = await db.collection("documents").where("statut", "==", "en_attente").limit(60).get();
  const aLire = snap.docs.filter((s) => !s.data().ia);
  console.log(`${snap.size} document(s) à valider, ${aLire.length} pas encore lu(s) par l'IA.\n`);
  const titres = new Set();
  try { Object.values(await lireCatalogue(db)).forEach((e) => titres.add(sansAcc(e?.[0]))); } catch {}
  let n = 0;
  for (const s of aLire) {
    const d = s.data();
    console.log(`[${++n}/${aLire.length}] ${d.titre}`);
    try {
      const ex = await extrait(s.id, d.format).catch(() => null);
      const r = await demander(CONSIGNE_VERIFIER(d), ex?.pdf);
      const p = propre(r);
      const raisons = (Array.isArray(r.raisons) ? r.raisons : []).map((x) => String(x).slice(0, 120)).slice(0, 4);
      if (titres.has(sansAcc(d.titre))) raisons.unshift("même titre qu'un document déjà publié (doublon ?)");
      if (!ex?.pdf && String(d.format || "pdf").toLowerCase() !== "pdf") raisons.push("fichier non PDF : contenu non lu, avis d'après le titre");
      const avis = ["ok", "douteux", "refuser"].includes(r.avis) ? r.avis : "douteux";
      const ia = { avis: raisons.length && avis === "ok" ? "douteux" : avis, raisons, resume: String(r.resume || "").slice(0, 200), le: new Date().toISOString() };
      // Pré-remplit seulement ce que l'étudiant n'a pas indiqué (ou a mis « Autre »)
      const maj = { ia };
      if (p.confiance >= SEUIL) {
        if (vide(d.filiere) && p.filiere) maj.filiere = p.filiere;
        if (!d.matiere && p.matiere) maj.matiere = p.matiere;
        if (vide(d.type) && p.type) maj.type = p.type;
        if (vide(d.niveau) && p.niveau && p.niveau !== "Autre") maj.niveau = p.niveau;
        if (titreMoche(d.titre) && p.titre) maj.titre = p.titre;
      }
      console.log(`   ${ia.avis.toUpperCase()}${raisons.length ? " : " + raisons.join(" ; ") : ""}${Object.keys(maj).length > 1 ? ` · complété : ${Object.keys(maj).filter((k) => k !== "ia").join(", ")}` : ""}`);
      if (!ESSAI) await s.ref.update(maj);
    } catch (e) {
      if (e instanceof QuotaIA) { console.log(`ARRÊT : ${e.message}. La suite au prochain passage.`); return; }
      console.log(`   ERREUR : ${e.message}`);
    }
    await attendre(PAUSE);
  }
}

/* ---------- 2. Ranger les documents publiés ---------- */
async function ranger() {
  const index = await lireCatalogue(db);
  // D'abord ceux qui en ont le plus besoin : infos manquantes ou titre illisible
  const besoin = ([, e]) => (vide(e[2]) ? 3 : 0) + (vide(e[3]) ? 2 : 0) + (vide(e[4]) ? 1 : 0) + (titreMoche(e[0]) ? 3 : 0) + (!e[1] ? 1 : 0);
  const restants = Object.entries(index).filter(([id, e]) => Array.isArray(e) && !faits.has(id)).sort((a, b) => besoin(b) - besoin(a));
  const lot = restants.slice(0, MAX);
  console.log(`${Object.keys(index).length} document(s) publié(s), ${restants.length} jamais relu(s) par l'IA, ${lot.length} cette fois.\n`);
  let changes = 0, n = 0;
  const bilan = {};
  for (const [id, e] of lot) {
    const d = { titre: e[0], matiere: e[1], filiere: e[2], type: e[3], niveau: e[4], format: e[6] };
    console.log(`[${++n}/${lot.length}] ${d.titre}`);
    try {
      const ex = await extrait(id, d.format).catch(() => null);
      const p = propre(await demander(CONSIGNE_RANGER(d), ex?.pdf));
      if (p.confiance < SEUIL) { console.log(`   pas sûre (${p.confiance}) : rien changé`); noter(id); await attendre(PAUSE); continue; }
      const maj = {};
      if (p.filiere && p.filiere !== canonFiliere(d.filiere)) maj.filiere = p.filiere;
      if (p.matiere && sansAcc(p.matiere) !== sansAcc(d.matiere) && (!d.matiere || maj.filiere)) maj.matiere = p.matiere;
      if (p.type && p.type !== d.type) maj.type = p.type;
      if (p.niveau && p.niveau !== "Autre" && p.niveau !== d.niveau) maj.niveau = p.niveau;
      if (p.titre && titreMoche(d.titre)) maj.titre = p.titre;
      if (Object.keys(maj).length) {
        changes++;
        Object.keys(maj).forEach((k) => (bilan[k] = (bilan[k] || 0) + 1));
        console.log(`   -> ${Object.entries(maj).map(([k, v]) => `${k} : ${d[k] || "?"} => ${v}`).join(" · ")}`);
        if (!ESSAI) {
          const ent = [...e];
          if (maj.titre) ent[0] = maj.titre; if (maj.matiere) ent[1] = maj.matiere; if (maj.filiere) ent[2] = maj.filiere;
          if (maj.type) ent[3] = maj.type; if (maj.niveau) ent[4] = maj.niveau;
          const batch = db.batch();
          batch.update(db.collection("documents").doc(id), { ...maj, rangeParIA: true });
          ecrireCatalogue(batch, db, { [id]: ent });
          await batch.commit();
        }
      } else console.log("   bien rangé");
      if (!ESSAI) noter(id);
    } catch (err) {
      if (err instanceof QuotaIA) { console.log(`ARRÊT : ${err.message}. La suite au prochain passage.`); break; }
      console.log(`   ERREUR : ${err.message}`);
    }
    await attendre(PAUSE);
  }
  console.log(`\nTerminé : ${changes} document(s) reclassé(s)${Object.keys(bilan).length ? ` (${Object.entries(bilan).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}. Il en reste ${Math.max(0, restants.length - n)} à relire.${ESSAI ? " (mode essai : rien n'a été modifié)" : ""}`);
}

if (args.includes("--verifier")) await verifier();
if (args.includes("--ranger")) await ranger();
if (!args.includes("--verifier") && !args.includes("--ranger")) console.log("Utilisation : node ia.js --verifier | --ranger [--max 150] [--essai]");
process.exit(0);
