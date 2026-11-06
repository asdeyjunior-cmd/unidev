// Fonctions sans connexion réseau (testables) utilisées par importer.js

export const TYPES = ["Cours", "TD", "TP", "Examen", "Corrigé", "Mémoire", "Résumé", "Roman", "Autre"];
export const NIVEAUX = ["Licence 1", "Licence 2", "Licence 3", "Master 1", "Master 2", "BTS 1", "BTS 2", "Doctorat", "Autre"];
export const EXTENSIONS = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "txt", "zip"];
export const TAILLE_MORCEAU = 9 * 1024 * 1024; // comme le site : chaque morceau reste sous 10 Mo
export const MAX_IMAGE_PDF = 10 * 1024 * 1024;  // plan gratuit Cloudinary
export const MAX_FICHIER = 100 * 1024 * 1024;

const norm = (s = "") => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** "l1", "Licence 1", "licence-1", "M2", "bts2"… → valeur de la liste du site */
export function normaliserNiveau(v) {
  const n = norm(v).replace(/\s+/g, "");
  const table = {
    l1: "Licence 1", licence1: "Licence 1", l2: "Licence 2", licence2: "Licence 2", l3: "Licence 3", licence3: "Licence 3",
    m1: "Master 1", master1: "Master 1", m2: "Master 2", master2: "Master 2",
    bts1: "BTS 1", bts2: "BTS 2", doctorat: "Doctorat", these: "Doctorat",
  };
  return table[n] || null;
}

/** "td", "examens", "corrige", "Mémoire"… → valeur de la liste du site */
export function normaliserType(v) {
  const n = norm(v);
  const table = {
    cours: "Cours", td: "TD", tds: "TD", tp: "TP", tps: "TP", examen: "Examen", examens: "Examen", exam: "Examen",
    sujet: "Examen", sujets: "Examen", corrige: "Corrigé", corriges: "Corrigé", correction: "Corrigé", corrections: "Corrigé",
    memoire: "Mémoire", memoires: "Mémoire", resume: "Résumé", resumes: "Résumé", fiche: "Résumé", fiches: "Résumé",
  };
  return table[n] || null;
}

/** Nom de fichier → titre lisible */
/** Retire le code ajouté devant le nom par certains sites (ex. « 612a0b117cf71sujet… », « 5d1254cf6corrige… ») */
export function sansCodeDevant(t) {
  // Reste d'un code collé devant un mot connu (« B77eepreuve commune… » -> « epreuve commune… »)
  const court = String(t || "").match(/^([0-9a-f]*\d[0-9a-f]*?\d[0-9a-f]*?)(epreuve|épreuve|sujet|corrig|examen|cours|devoir|td|tp|bts|exercice|correction|memoire|mémoire|rapport|composition|technique|introduction|chapitre|module|fiche)/i);
  if (court && court[1].length <= 7) return String(t).slice(court[1].length);
  const m = String(t || "").match(/^[0-9a-f]+/i);
  if (!m || m[0].length < 8) return t;
  const run = m[0];
  let n = run.length >= 13 ? 13 : 0;
  if (!n) for (let i = run.length - 1; i >= 0; i--) if (/\d/.test(run[i])) { n = i + 1; break; }
  const code = run.slice(0, n), reste = t.slice(n);
  if (n < 8 || (code.match(/\d/g) || []).length < 3 || !/^[a-zà-ÿ]/i.test(reste)) return t;
  return reste;
}
/** Titre lisible à partir d'un nom de fichier (ou d'un titre resté au format « nom de fichier ») */
export function titreDepuisFichier(nom) {
  let t = sansCodeDevant(String(nom || "").replace(/\.(pdf|docx?|pptx?|xlsx?|odt|txt|zip)$/i, ""));
  // Nom « en-tirets » sans espace : les tirets deviennent des espaces
  if (!/\s/.test(t) && (t.match(/-/g) || []).length >= 2) t = t.replace(/-+/g, " ");
  t = t.replace(/[_]+/g, " ").replace(/\s+-\s+|\s*-{2,}\s*/g, " — ").replace(/\s{2,}/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Chemin relatif d'un fichier → informations.
 * Dossiers reconnus, dans l'ordre : Filière / Niveau / Type / Matière / fichier
 * Chaque dossier est facultatif ; un niveau ou un type est aussi reconnu à n'importe quelle position.
 */
export function infosDepuisChemin(cheminRelatif) {
  const parts = cheminRelatif.split(/[\\/]+/).filter(Boolean);
  const fichier = parts.pop();
  const infos = { filiere: "", niveau: "", type: "", matiere: "", titre: titreDepuisFichier(fichier) };
  const restes = [];
  for (const p of parts) {
    const niv = normaliserNiveau(p);
    const typ = normaliserType(p);
    if (niv && !infos.niveau) infos.niveau = niv;
    else if (typ && !infos.type) infos.type = typ;
    else restes.push(p.trim());
  }
  if (restes[0]) infos.filiere = restes[0];
  if (restes[1]) infos.matiere = restes[1];
  return infos;
}

/** Lecture d'un CSV simple (séparateur ; ou ,) avec une ligne d'en-tête */
export function lireCsv(texte) {
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lignes.length) return [];
  const sep = (lignes[0].match(/;/g) || []).length >= (lignes[0].match(/,/g) || []).length ? ";" : ",";
  const decoupe = (l) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const tete = decoupe(lignes[0]).map((h) => norm(h).replace(/\s+/g, ""));
  return lignes.slice(1).map((l) => {
    const v = decoupe(l);
    return Object.fromEntries(tete.map((h, i) => [h, v[i] ?? ""]));
  });
}

/** Licences qui autorisent la rediffusion, y compris sur un site qui vend des crédits */
export function licenceAutorisee(licence) {
  const l = String(licence || "").toLowerCase();
  if (!l) return null;
  if (/publicdomain|domaine public|cc0/.test(l)) return "Domaine public";
  if (/etalab|licence ouverte|open licence/.test(l)) return "Licence Ouverte";
  const m = l.match(/creativecommons\.org\/licenses\/([a-z-]+)/);
  if (!m) return null;
  const code = m[1];
  if (code.includes("nc")) return null; // « pas d'utilisation commerciale » : interdit (le site vend des crédits)
  return { by: "CC BY", "by-sa": "CC BY-SA", "by-nd": "CC BY-ND" }[code] || null;
}

/** Domaines HAL → filière lisible */
const DOMAINES = [
  ["shs.eco", "Économie"], ["shs.gestion", "Gestion"], ["shs.droit", "Droit"], ["shs.socio", "Sociologie"],
  ["shs.hist", "Histoire"], ["shs.geo", "Géographie"], ["shs.langue", "Langues"], ["shs.litt", "Lettres"],
  ["shs.edu", "Sciences de l'éducation"], ["shs.psy", "Psychologie"], ["shs.info", "Communication"], ["shs.phil", "Philosophie"],
  ["shs.scipo", "Sciences politiques"], ["shs", "Sciences humaines"],
  ["info", "Informatique"], ["math", "Mathématiques"], ["stat", "Statistiques"], ["phys", "Physique"], ["chim", "Chimie"],
  ["sdv", "Biologie"], ["sde", "Environnement"], ["sdu", "Sciences de la Terre"], ["spi", "Sciences de l'ingénieur"],
  ["qfin", "Finance"], ["nlin", "Physique"],
];
export function filiereDepuisDomaines(domaines = []) {
  for (const d of domaines) {
    const code = String(d).replace(/^\d+\./, "");
    const trouve = DOMAINES.find(([k]) => code === k || code.startsWith(k + "."));
    if (trouve) return trouve[1];
  }
  return "Autre";
}

/** Coupe un texte proprement à `max` caractères */
export function couper(texte, max) {
  const t = String(texte || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/** Découpe un fichier (Buffer) en morceaux de 9 Mo */
export function decouper(buffer, taille = TAILLE_MORCEAU) {
  const out = [];
  for (let i = 0; i < buffer.length; i += taille) out.push(buffer.subarray(i, i + taille));
  return out;
}

const echapXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

/** Couverture générique (SVG 600×800) quand la première page ne peut pas servir d'image */
export function couvertureSvg({ titre, type, matiere, format }) {
  const mots = String(titre || "Document").split(/\s+/);
  const lignes = [];
  let cur = "";
  for (const m of mots) {
    if ((cur + " " + m).trim().length > 19) { if (cur) lignes.push(cur); cur = m; } else cur = (cur + " " + m).trim();
    if (lignes.length === 6) break;
  }
  if (cur && lignes.length < 6) lignes.push(cur);
  const texte = lignes.map((l, i) => `<text x="60" y="${300 + i * 54}" font-size="40" font-weight="700" fill="#0f3d2e">${echapXml(l)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <rect width="600" height="800" fill="#eaf7ef"/>
  <rect x="40" y="40" width="520" height="720" rx="18" fill="#ffffff"/>
  <rect x="40" y="40" width="520" height="150" rx="18" fill="#1f9d55"/>
  <rect x="40" y="150" width="520" height="40" fill="#1f9d55"/>
  <text x="60" y="110" font-size="40" font-weight="700" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">${echapXml((type || "Document").toUpperCase())}</text>
  <text x="60" y="160" font-size="26" fill="#d9f3e4" font-family="DejaVu Sans, Arial, sans-serif">${echapXml(couper(matiere || "", 34))}</text>
  <g font-family="DejaVu Sans, Arial, sans-serif">${texte}</g>
  <rect x="60" y="660" width="140" height="56" rx="10" fill="#0f3d2e"/>
  <text x="130" y="698" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif">${echapXml((format || "pdf").toUpperCase())}</text>
  <text x="540" y="704" font-size="30" font-weight="700" fill="#1f9d55" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif">unidev</text>
</svg>`;
}

/* ---------- Devinette du classement à partir du nom d'un fichier (outil de rangement) ---------- */
// [mot-clé (sans accents, minuscules), filière, matière]
const MOTS_FILIERES = [
  ["algorithm", "Informatique", "Algorithmique"], ["programmation", "Informatique", "Programmation"],
  ["python", "Informatique", "Python"], ["java", "Informatique", "Java"], ["langage c", "Informatique", "Langage C"],
  ["php", "Informatique", "Développement web"], ["html", "Informatique", "Développement web"], ["javascript", "Informatique", "Développement web"],
  ["web", "Informatique", "Développement web"], ["sql", "Informatique", "Bases de données"], ["base de donnee", "Informatique", "Bases de données"],
  ["bdd", "Informatique", "Bases de données"], ["merise", "Informatique", "Merise"], ["uml", "Informatique", "UML"],
  ["reseau", "Informatique", "Réseaux"], ["telecom", "Informatique", "Télécommunications"], ["linux", "Informatique", "Systèmes"],
  ["systeme d exploitation", "Informatique", "Systèmes"], ["securite informatique", "Informatique", "Sécurité"],
  ["cybersecurite", "Informatique", "Sécurité"], ["informatique", "Informatique", ""], ["excel", "Informatique", "Bureautique"],
  ["bureautique", "Informatique", "Bureautique"],
  ["ordinateur", "Informatique", "Architecture des ordinateurs"], ["pc", "Informatique", "Architecture des ordinateurs"],
  ["assembleur", "Informatique", "Assembleur"], ["architecture des ordinateurs", "Informatique", "Architecture des ordinateurs"],
  ["patrons de conception", "Informatique", "Génie logiciel"], ["design pattern", "Informatique", "Génie logiciel"], ["genie logiciel", "Informatique", "Génie logiciel"],
  ["unicode", "Informatique", "Codage de l'information"], ["ascii", "Informatique", "Codage de l'information"],
  ["pyqt", "Informatique", "Python"], ["qt", "Informatique", "Programmation"], ["gtk", "Informatique", "Programmation"], ["sdl", "Informatique", "Programmation"],
  ["scilab", "Informatique", "Calcul scientifique"], ["octave", "Informatique", "Calcul scientifique"], ["matlab", "Informatique", "Calcul scientifique"],
  ["pascal", "Informatique", "Pascal"], ["scheme", "Informatique", "Programmation"], ["c sharp", "Informatique", "C#"], ["net", "Informatique", "Programmation"],
  ["infographie", "Informatique", "Infographie"], ["openrefine", "Informatique", "Données"], ["donnees", "Informatique", "Données"],
  ["intelligence artificielle", "Informatique", "Intelligence artificielle"], ["numerique", "Informatique", ""],
  ["comptabilite analytique", "Finance-Comptabilité", "Comptabilité analytique"], ["comptabilite generale", "Finance-Comptabilité", "Comptabilité générale"],
  ["comptabilite", "Finance-Comptabilité", "Comptabilité"], ["compta", "Finance-Comptabilité", "Comptabilité"],
  ["syscohada", "Finance-Comptabilité", "SYSCOHADA"], ["fiscalite", "Finance-Comptabilité", "Fiscalité"], ["audit", "Finance-Comptabilité", "Audit"],
  ["controle de gestion", "Finance-Comptabilité", "Contrôle de gestion"], ["analyse financiere", "Finance-Comptabilité", "Analyse financière"],
  ["mathematiques financieres", "Finance-Comptabilité", "Mathématiques financières"], ["maths financieres", "Finance-Comptabilité", "Mathématiques financières"], ["math financiere", "Finance-Comptabilité", "Mathématiques financières"], ["finance", "Finance-Comptabilité", "Finance"],
  ["banque", "Banque-Assurance", "Banque"], ["assurance", "Banque-Assurance", "Assurance"],
  ["marketing", "Marketing", "Marketing"], ["vente", "Marketing", "Techniques de vente"], ["commerce international", "Commerce international", "Commerce international"],
  ["import export", "Commerce international", "Import-export"], ["douane", "Commerce international", "Douane"],
  ["logistique", "Logistique-Transport", "Logistique"], ["transport", "Logistique-Transport", "Transport"],
  ["ressources humaines", "Ressources humaines", "GRH"], ["grh", "Ressources humaines", "GRH"],
  ["management", "Gestion", "Management"], ["gestion de projet", "Gestion", "Gestion de projet"], ["entrepreneuriat", "Gestion", "Entrepreneuriat"],
  ["gestion", "Gestion", ""],
  ["droit", "Droit", "Droit"], ["juridique", "Droit", "Droit"],
  ["microeconomie", "Économie", "Microéconomie"], ["macroeconomie", "Économie", "Macroéconomie"], ["economie", "Économie", "Économie"],
  ["communication", "Communication", "Communication"], ["journalisme", "Communication", "Journalisme"],
  ["secretariat", "Assistanat de direction", "Secrétariat"], ["assistanat", "Assistanat de direction", ""],
  ["statistique", "Mathématiques", "Statistiques"], ["probabilite", "Mathématiques", "Probabilités"], ["algebre", "Mathématiques", "Algèbre"],
  ["analyse", "Mathématiques", "Analyse"], ["mathematique", "Mathématiques", ""], ["maths", "Mathématiques", ""],
  ["electrotechnique", "Électrotechnique", ""], ["electronique", "Électronique", ""], ["genie civil", "Génie civil", ""],
  ["anglais", "Langues", "Anglais"], ["english", "Langues", "Anglais"], ["espagnol", "Langues", "Espagnol"],
  ["physique", "Physique-Chimie", "Physique"], ["chimie", "Physique-Chimie", "Chimie"], ["biologie", "Biologie", ""],
];
const MOTS_TYPES = [
  ["corrige", "Corrigé"], ["correction", "Corrigé"], ["solution", "Corrigé"],
  ["memoire", "Mémoire"], ["rapport de stage", "Mémoire"], ["these", "Mémoire"],
  ["examen", "Examen"], ["exam", "Examen"], ["partiel", "Examen"], ["devoir", "Examen"], ["sujet", "Examen"], ["session", "Examen"],
  ["epreuve", "Examen"], ["bts blanc", "Examen"], ["interrogation", "Examen"],
  ["td", "TD"], ["travaux diriges", "TD"], ["exercice", "TD"], ["tp", "TP"], ["travaux pratiques", "TP"],
  ["resume", "Résumé"], ["fiche", "Résumé"], ["synthese", "Résumé"], ["roman", "Roman"], ["romans", "Roman"],
  ["cours", "Cours"], ["chapitre", "Cours"], ["support", "Cours"], ["module", "Cours"], ["introduction", "Cours"],
];
// Du plus précis au plus général (le 1er qui correspond gagne)
const MOTS_NIVEAUX = [
  [/\b(l1|licence (1|i|1ere annee|premiere annee)|(1ere|premiere) annee (de )?licence|semestres? (1|2)|s1|s2)\b/, "Licence 1"],
  [/\b(l2|licence (2|ii|2e annee|2eme annee|deuxieme annee)|(2e|2eme|deuxieme) annee (de )?licence|semestres? (3|4)|s3|s4)\b/, "Licence 2"],
  [/\b(l3|licence (3|iii|3e annee|3eme annee|troisieme annee|professionnelle|pro)|(3e|3eme|troisieme) annee (de )?licence|semestres? (5|6)|s5|s6|memoire de (fin de )?licence)\b/, "Licence 3"],
  [/\b(m1|master (1|i|1ere annee|premiere annee)|(1ere|premiere) annee (de )?master|semestres? (7|8))\b/, "Master 1"],
  [/\b(m2|master (2|ii|2e annee|deuxieme annee)|(2e|2eme|deuxieme) annee (de )?master|memoire de (fin d etudes? de )?master|dea|dess|semestres? (9|10))\b/, "Master 2"],
  [/\b(bts (1|i|1ere annee|premiere annee)|(1ere|premiere) annee (de )?bts)\b/, "BTS 1"],
  [/\b(bts (2|ii|2e annee|2eme annee|deuxieme annee)|(2e|2eme|deuxieme) annee (de )?bts)\b/, "BTS 2"],
  [/\b(doctorat|these de doctorat|phd|doctoral)\b/, "Doctorat"],
  // Sans numéro : l'examen du BTS se passe en 2e année ; « master » seul = 1re année
  [/\b(bts|dts|dut|brevet de technicien superieur)\b/, "BTS 2"],
  [/\b(master|mastere)\b/, "Master 1"],
];
/** Niveau d'après un texte (titre, matière, dossier…). "" si rien ne l'indique. */
export function niveauDe(texte) {
  const t = " " + norm(texte) + " ";
  return MOTS_NIVEAUX.find(([re]) => re.test(t))?.[1] || "";
}

/** Devine filière, matière, niveau et type d'après un texte (nom de fichier, légende Telegram…). Vide si inconnu. */
export function deviner(texte) {
  const t = " " + norm(texte) + " ";
  const contient = (mot) => t.includes(" " + mot) || t.includes(mot + " ");
  const f = MOTS_FILIERES.find(([m]) => contient(m));
  const ty = MOTS_TYPES.find(([m]) => new RegExp(`(^|\\s)${m}s?(\\s|\\d|$)`).test(t));
  return { filiere: f?.[1] || "", matiere: f?.[2] || "", type: ty?.[1] || "", niveau: niveauDe(texte) };
}

/** Nom de dossier valide sous Windows */
export const nomDossier = (s) => String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60);
export const FILIERES = [...new Set(MOTS_FILIERES.map((m) => m[1]))].sort((a, b) => a.localeCompare(b, "fr"));

/* ---------- Connexion instable : on réessaie avant d'abandonner ---------- */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
/** Lance fn() jusqu'à `essais` fois (attente croissante : 5 s, 15 s, 30 s…) si le réseau coupe */
export async function avecRelance(fn, { essais = 4, nom = "" } = {}) {
  const delais = [5000, 15000, 30000, 60000];
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e?.message || e?.error?.message || e);
      const reseau = /timeout|timed out|fetch failed|terminated|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|503|502|504|429/i.test(msg + (e?.http_code || ""));
      if (!reseau || i >= essais) throw e;
      console.log(`   (connexion coupée${nom ? " : " + nom : ""}, nouvel essai ${i + 1}/${essais} dans ${delais[i - 1] / 1000} s)`);
      await attendre(delais[i - 1]);
    }
  }
}

/** Télécharge un fichier (avec relances, 10 min max par essai). pdf: true -> vérifie que c'est un vrai PDF */
export async function telecharger(url, entetes = {}, { pdf = false } = {}) {
  const buffer = await avecRelance(async () => {
    const r = await fetch(url, { headers: entetes, signal: AbortSignal.timeout(600000) });
    if (!r.ok) { const e = new Error(`téléchargement ${r.status}`); if (r.status >= 500 || r.status === 429) e.message += " 503"; throw e; }
    return Buffer.from(await r.arrayBuffer());
  }, { nom: "téléchargement" });
  // Un « PDF » qui ne commence pas par %PDF est en fait une page web (accès restreint, erreur…) : on ne le publie pas
  if (pdf && !buffer.subarray(0, 1024).toString("latin1").includes("%PDF")) throw new Error("le fichier reçu n'est pas un PDF (document non accessible) : ignoré");
  return buffer;
}

/** Titre en anglais ? (Zenodo mélange les langues) */
export function semblaAnglais(t) {
  const n = " " + String(t || "").toLowerCase() + " ";
  const en = (n.match(/ (the|of|and|for|with|from|to|in|on|an|a|is|are|using|towards|new|what's|how) /g) || []).length;
  const fr = (n.match(/ (le|la|les|des|du|de|et|pour|avec|une|un|sur|dans|aux|au|à|d'|l')|[éèêàùçôî]/g) || []).length;
  return en >= 2 && en > fr;
}

/** Titre déjà enregistré mais illisible (code devant, mots-en-tirets) -> titre propre ; null s'il est déjà bon */
export function titreAReparer(titre) {
  const t = String(titre || "").trim();
  const code = sansCodeDevant(t) !== t, tirets = !/\s/.test(t) && (t.match(/-/g) || []).length >= 2;
  if (!code && !tirets) return null;
  const propre = titreDepuisFichier(t);
  return propre && propre !== t && propre.length >= 3 ? propre : null;
}

/** Mots à chercher pour une filière : son nom puis ses matières (ex. Finance-Comptabilité -> Comptabilité générale, Fiscalité…) */
export function motsPourFiliere(filiere) {
  const cle = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const f = cle(filiere);
  const matieres = MOTS_FILIERES.filter(([, fil]) => cle(fil) === f).map(([, , m]) => m).filter(Boolean);
  const mots = [String(filiere).replace(/-/g, " "), ...matieres];
  const vus = new Set();
  return mots.filter((m) => { const k = cle(m); if (!k || vus.has(k)) return false; vus.add(k); return true; }).slice(0, 10);
}
