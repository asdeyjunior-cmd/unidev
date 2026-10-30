#!/usr/bin/env node
/**
 * Range un dossier « en vrac » (ex. export Telegram) en dossiers Filière / Niveau / Type / Matière,
 * prêts pour importer.js. Les fichiers sont COPIÉS : ton dossier d'origine ne change pas.
 * Pour chaque document, l'outil te montre le classement deviné et te demande son image.
 *
 *   node ranger.js <dossier-en-vrac> [dossier-range]
 *
 * Export Telegram au format JSON (result.json) : la légende du message sert de titre et de description,
 * et la photo envoyée juste avant le fichier est proposée comme image.
 * Un journal permet d'arrêter (Ctrl+C) et de reprendre plus tard là où tu t'étais arrêté.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { canonFiliere, FILIERES as LISTE_OFFICIELLE } from "../../js/filieres.js";
import { EXTENSIONS, TYPES, NIVEAUX, FILIERES, deviner, nomDossier, titreDepuisFichier, couper, normaliserNiveau, normaliserType } from "./outils.js";

const IMAGES = ["jpg", "jpeg", "png", "webp"];
const ext = (p) => path.extname(p).slice(1).toLowerCase();

const source = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(source)) {
  console.log("Utilisation : node ranger.js <dossier-en-vrac> [dossier-range]");
  process.exit(1);
}
const dest = path.resolve(process.argv[3] || `${source.replace(/[\\/]+$/, "")}-range`);
fs.mkdirSync(dest, { recursive: true });

const JOURNAL = path.join(dest, "rangement-journal.json");
const journal = fs.existsSync(JOURNAL) ? JSON.parse(fs.readFileSync(JOURNAL, "utf8")) : { faits: {} };
const sauver = () => fs.writeFileSync(JOURNAL, JSON.stringify(journal));
const CSV = path.join(dest, "infos.csv");
if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, "﻿fichier;titre;description\n");
const csvCel = (s) => `"${String(s || "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

/* ---------- Inventaire ---------- */
function* parcourir(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (p !== dest) yield* parcourir(p); }
    else yield p;
  }
}
const tous = [...parcourir(source)];
let documents = tous.filter((p) => EXTENSIONS.includes(ext(p)));

/* ---------- Export Telegram (result.json) : légendes et photos voisines ---------- */
const telegram = new Map(); // chemin complet du fichier -> { legende, photo }
const resultJson = tous.find((p) => path.basename(p).toLowerCase() === "result.json");
if (resultJson) {
  try {
    const data = JSON.parse(fs.readFileSync(resultJson, "utf8"));
    const base = path.dirname(resultJson);
    const texte = (t) => (Array.isArray(t) ? t.map((x) => (typeof x === "string" ? x : x.text || "")).join("") : String(t || "")).trim();
    let dernierePhoto = null;
    for (const m of data.messages || []) {
      if (m.type !== "message") continue;
      const date = Date.parse(m.date) || 0;
      if (m.photo && !String(m.photo).startsWith("(")) dernierePhoto = { chemin: path.resolve(base, m.photo), date, de: m.from_id };
      if (m.file && !String(m.file).startsWith("(")) {
        const complet = path.resolve(base, m.file);
        const photo = dernierePhoto && dernierePhoto.de === m.from_id && date - dernierePhoto.date <= 10 * 60 * 1000 && fs.existsSync(dernierePhoto.chemin)
          ? dernierePhoto.chemin : null;
        telegram.set(complet, { legende: texte(m.text), photo });
        if (photo) dernierePhoto = null; // une photo ne sert qu'à un document
      }
    }
    // Ordre du groupe Telegram (plus naturel pour répondre aux questions)
    const ordre = [...telegram.keys()];
    const rang = new Map(ordre.map((p, i) => [p, i]));
    documents.sort((a, b) => (rang.get(a) ?? 1e9) - (rang.get(b) ?? 1e9));
    console.log(`Export Telegram détecté : ${telegram.size} fichier(s) avec leur message.`);
  } catch (e) { console.log(`(result.json illisible, ignoré : ${e.message})`); }
}

/* ---------- Image déjà présente à côté du fichier (même nom) ---------- */
function imageVoisine(p) {
  const b = p.slice(0, -path.extname(p).length);
  for (const e of IMAGES) for (const x of [e, e.toUpperCase()]) if (fs.existsSync(`${b}.${x}`)) return `${b}.${x}`;
  return null;
}

/* ---------- Copie sans écraser ---------- */
const nomsPris = new Set(Object.values(journal.faits).map((f) => f?.nom?.toLowerCase()).filter(Boolean));
function nomUnique(nom) {
  const e = path.extname(nom), b = nom.slice(0, -e.length);
  let n = nom, i = 2;
  while (nomsPris.has(n.toLowerCase())) n = `${b} (${i++})${e}`;
  nomsPris.add(n.toLowerCase());
  return n;
}

// Lecture ligne par ligne (fiable aussi quand on colle plusieurs lignes d'un coup)
const rl = readline.createInterface({ input: stdin, terminal: false });
const lignes = [], attentes = [];
let fini = false;
rl.on("line", (l) => (attentes.length ? attentes.shift()(l) : lignes.push(l)));
rl.on("close", () => { fini = true; while (attentes.length) attentes.shift()("q"); });
const lire = () => (lignes.length ? Promise.resolve(lignes.shift()) : fini ? Promise.resolve("q") : new Promise((r) => attentes.push(r)));
const demander = async (q) => { stdout.write(q); return (await lire()).trim().replace(/^["']|["']$/g, "").replace(/^& '|'$/g, ""); };

async function choisir(question, liste, actuel) {
  console.log(`   ${question} :`);
  liste.forEach((v, i) => console.log(`     ${String(i + 1).padStart(2)} - ${v}`));
  const r = await demander(`   Numéro, ou texte libre (Entrée = ${actuel || "aucun"}) : `);
  if (!r) return actuel;
  const n = Number(r);
  return Number.isInteger(n) && n >= 1 && n <= liste.length ? liste[n - 1] : r;
}

/* ---------- Boucle principale ---------- */
const restants = documents.filter((p) => !journal.faits[path.relative(source, p)]);
console.log(`\n${documents.length} document(s) trouvé(s), ${documents.length - restants.length} déjà rangé(s), ${restants.length} à ranger.`);
console.log(`Dossier rangé : ${dest}\n`);
console.log(`Pour chaque document :
  Entrée      = valider (avec l'image proposée, sinon couverture automatique)
  glisse une image dans la fenêtre puis Entrée = utiliser cette image
  n           = pas d'image (couverture automatique)
  c           = corriger le classement
  p           = même classement que le document précédent
  s           = sauter ce document (il ne sera pas importé)
  auto        = ne plus poser de questions : tout le reste est rangé avec le classement deviné
  q           = quitter (tu pourras reprendre plus tard)\n`);

let auto = false;
let precedent = null;
let ranges = 0, sautes = 0, avecImage = 0;
const filieresVues = new Set(Object.values(journal.faits).map((f) => f?.filiere).filter(Boolean));

for (const [i, complet] of restants.entries()) {
  const rel = path.relative(source, complet);
  const nom = path.basename(complet);
  const tg = telegram.get(complet) || {};
  const legende = tg.legende || "";
  const infos = deviner(`${nom} ${legende}`);
  infos.filiere = canonFiliere(infos.filiere);
  let image = imageVoisine(complet) || tg.photo || null;
  const titre = legende && legende.length <= 140 && !legende.includes("\n") ? legende : titreDepuisFichier(nom);

  if (!auto) {
    for (;;) {
      const classement = [infos.filiere || "Autre", infos.niveau || "niveau ?", infos.type || "type ?", infos.matiere].filter(Boolean).join(" / ");
      console.log(`[${i + 1}/${restants.length}] ${nom}${legende ? `\n   Message : ${couper(legende, 120)}` : ""}`);
      console.log(`   Classement : ${classement}`);
      console.log(`   Image      : ${image ? path.basename(image) : "aucune (couverture automatique)"}`);
      const r = await demander("   > ");
      const low = r.toLowerCase();
      if (low === "q") { rl.close(); console.log(`\nArrêté. ${ranges} rangé(s). Relance la même commande pour reprendre.`); process.exit(0); }
      if (low === "auto") { auto = true; break; }
      if (low === "s") { infos.sauter = true; break; }
      if (low === "n") { image = null; break; }
      if (low === "p" && precedent) { Object.assign(infos, precedent); continue; }
      if (low === "c") {
        infos.filiere = canonFiliere(await choisir("Filière", [...new Set([...LISTE_OFFICIELLE, ...FILIERES, ...filieresVues].map(canonFiliere))].sort((a, b) => a.localeCompare(b, "fr")), infos.filiere));
        const nv = await choisir("Niveau", NIVEAUX, infos.niveau);
        infos.niveau = normaliserNiveau(nv) || (NIVEAUX.includes(nv) ? nv : infos.niveau);
        const ty = await choisir("Type", TYPES, infos.type);
        infos.type = normaliserType(ty) || (TYPES.includes(ty) ? ty : infos.type);
        infos.matiere = (await demander(`   Matière (Entrée = ${infos.matiere || "aucune"}) : `)) || infos.matiere;
        continue;
      }
      if (r && IMAGES.includes(ext(r))) {
        if (fs.existsSync(r)) { image = path.resolve(r); break; }
        console.log("   Image introuvable, réessaie.");
        continue;
      }
      if (!r) break;
      console.log("   Réponse non comprise.");
    }
  }

  if (infos.sauter) {
    journal.faits[rel] = { saute: true }; sauver(); sautes++;
    console.log("   -> sauté\n");
    continue;
  }

  const dossier = path.join(dest, ...[infos.filiere || "Autre", infos.niveau, infos.type, infos.matiere].filter(Boolean).map(nomDossier));
  fs.mkdirSync(dossier, { recursive: true });
  const nouveau = nomUnique(nom);
  fs.copyFileSync(complet, path.join(dossier, nouveau));
  if (image) {
    fs.copyFileSync(image, path.join(dossier, nouveau.slice(0, -path.extname(nouveau).length) + path.extname(image).toLowerCase()));
    avecImage++;
  }
  const description = legende && legende !== titre ? legende : "";
  if (titre !== titreDepuisFichier(nom) || description) fs.appendFileSync(CSV, `${csvCel(nouveau)};${csvCel(titre)};${csvCel(couper(description, 600))}\n`);

  precedent = { filiere: infos.filiere, niveau: infos.niveau, type: infos.type, matiere: infos.matiere };
  if (infos.filiere) filieresVues.add(infos.filiere);
  journal.faits[rel] = { nom: nouveau, filiere: infos.filiere || "Autre" };
  sauver();
  ranges++;
  if (!auto) console.log(`   -> ${path.relative(dest, path.join(dossier, nouveau))}\n`);
  else if (ranges % 200 === 0) console.log(`   ${ranges} rangé(s)…`);
}

rl.close();
console.log(`\nTerminé : ${ranges} rangé(s), ${avecImage} avec image, ${sautes} sauté(s).`);
console.log(`Dossier prêt à importer : ${dest}`);
console.log(`Titres et descriptions des messages : ${CSV} (utilisé automatiquement par IMPORTER.bat)`);
