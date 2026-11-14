// Filières : une seule orthographe par filière, quelles que soient les majuscules, les accents
// ou les petites fautes de frappe. Utilisé par le site et par l'outil d'import.

/** Liste officielle affichée dans les suggestions. Ajoute ici une filière pour la proposer. */
export const FILIERES = [
  "Informatique de gestion",
  "Informatique développeur d'application",
  "Informatique",
  "Réseaux informatiques et télécommunications",
  "Finance-Comptabilité",
  "Gestion commerciale",
  "Gestion",
  "Banque-Assurance",
  "Marketing",
  "Communication",
  "Commerce international",
  "Logistique-Transport",
  "Ressources humaines",
  "Assistanat de direction",
  "Droit",
  "Économie",
  "Mathématiques",
  "Physique-Chimie",
  "Biologie",
  "Électrotechnique",
  "Électronique",
  "Génie civil",
  "Industries agroalimentaires et chimiques",
  "Langues",
  "Littérature",
  "Divertissement",
  "Autre",
];

// Les filières s'affichent toujours par leur nom complet ; les sigles (IAC, FCGE…) ne sont que des raccourcis
// reconnus à la saisie et aussitôt remplacés par le nom.
export const nomComplet = (f) => f || "";
export const libelleFiliere = (f) => f || "";

/** Autres façons d'écrire une filière de la liste (sans accents, en minuscules) */
const ALIAS = {
  "Informatique de gestion": ["ig", "informatique de gestion", "info de gestion", "informatique gestion", "ig"],
  "Informatique développeur d'application": ["ida", "informatique développeur d'application", "ida", "informatique developpement d applications", "informatique developpement application", "developpeur d application",
    "developpement d application", "informatique developpeur application", "developpement d applications informatiques", "informatique developpeur d applications"],
  "Industries agroalimentaires et chimiques": ["iac", "industries agroalimentaires et chimiques", "iac", "industrie agro alimentaire et chimique", "industries agro alimentaires et chimiques", "agro alimentaire et chimie",
    "iac controle", "iac option controle de qualite", "iac production", "agronomie option controle de qualite", "agronomie controle qualite",
    "controle de qualite", "controle qualite", "agroalimentaire", "agro alimentaire", "industries agroalimentaires", "industrie agroalimentaire et chimique"],
  "Informatique": ["info", "informatiques"],
  "Réseaux informatiques et télécommunications": ["rit", "réseaux informatiques et télécommunications", "rit", "reseaux informatiques", "reseaux et telecommunications", "reseau informatique et telecommunication", "reseaux telecoms"],
  "Finance-Comptabilité": ["fcge", "finance-comptabilité", "finance comptabilite", "comptabilite finance", "comptabilite", "compta", "finance compta", "compta finance", "fcge", "finance comptabilite et gestion des entreprises", "finances comptabilite", "comptabilite et finance"],
  "Gestion commerciale": ["gec", "gestion commerciale", "gestion commercial", "gc"],
  "Banque-Assurance": ["banque assurance", "banque", "assurance", "banque finance assurance"],
  "Marketing": ["mkt", "marketing communication"],
  "Commerce international": ["commerce inter", "ci"],
  "Logistique-Transport": ["log", "logistique-transport", "logistique", "transport", "logistique et transport", "transport logistique"],
  "Ressources humaines": ["rhc", "ressources humaines", "rh", "grh", "gestion des ressources humaines", "ressources humaines et communication", "rhc"],
  "Assistanat de direction": ["ad", "assistanat de direction", "assistant de direction", "assistante de direction", "secretariat", "ad"],
  "Économie": ["eco", "economie", "sciences economiques"],
  "Mathématiques": ["maths", "math", "mathematique"],
  "Physique-Chimie": ["physique chimie", "pc"],
  "Électrotechnique": ["electrotechnique"],
  "Électronique": ["electronique"],
  "Divertissement": ["divertissement", "divertissements", "loisirs", "lecture loisir", "livres divertissants", "romans divertissants", "contes", "bandes dessinees", "bd"],
  "Littérature": ["litterature", "lettres", "lettres modernes", "romans", "roman", "litterature francaise"],
};

// "BTS Finances - Comptabilité " -> même clé que "Comptabilité et finance" :
// sans accents ni ponctuation, sans petits mots ni « BTS / filière / option… », au singulier, mots triés.
const MOTS_VIDES = new Set(["et", "de", "des", "du", "la", "le", "les", "en", "d", "l", "a", "au", "aux", "pour", "un", "une",
  "bts", "dut", "licence", "master", "filiere", "filieres", "option", "specialite", "parcours", "departement", "section", "niveau"]);
const racine = (m) => { const sing = m.length > 3 ? m.replace(/[sx]$/, "") : m; return sing.length > 4 ? sing.replace(/e$/, "") : sing; };
export function cleFiliere(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((m) => m && !MOTS_VIDES.has(m) && !/^\d+$/.test(m)).map(racine).sort().join(" ");
}

const TABLE = new Map();
for (const f of FILIERES) TABLE.set(cleFiliere(f), f);
for (const [f, alias] of Object.entries(ALIAS)) for (const a of alias) TABLE.set(cleFiliere(a), f);

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prec = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = t;
    }
  }
  return d[b.length];
}

// Mots qui ne changent pas la filière (« Finance comptabilité et gestion des entreprises » = « Finance-Comptabilité »)
const FAIBLES = new Set(["entreprise", "general", "applique", "pme", "pmi", "organisation", "moderne", "professionnel"].map(racine));
const tolerance = (cle) => (cle.length <= 5 ? 0 : cle.length <= 8 ? 1 : cle.length <= 13 ? 2 : 3);
/** Filière déjà connue qui correspond à cette clé (même nom, faute de frappe, ou mots en plus sans importance), sinon null */
function rapprocher(cle) {
  if (TABLE.has(cle)) return TABLE.get(cle);
  const tol = tolerance(cle);
  let best = null, bd = 99;
  // Faute de frappe sur un nom d'un seul mot (pour plusieurs mots : comparaison mot à mot, plus bas)
  if (tol && !cle.includes(" ")) for (const [k, f] of TABLE) { if (k.length < 4 || k.includes(" ")) continue; const dd = distance(cle, k); if (dd < bd) { bd = dd; best = f; } }
  if (best && bd <= tol) return best;
  // Tous les mots d'une filière connue + seulement des mots sans importance (ou son sigle) : c'est elle
  const mots = cle.split(" ");
  let trouve = null, taille = 0;
  for (const [k, f] of TABLE) {
    const km = k.split(" ");
    if (km.length < taille || km.length >= mots.length || k.length < 4) continue;
    if (!km.every((m) => mots.includes(m))) continue;
    const enPlus = mots.filter((m) => !km.includes(m));
    if (enPlus.every((m) => FAIBLES.has(m) || TABLE.get(m) === f)) { trouve = f; taille = km.length; }
  }
  if (trouve) return trouve;
  // Mêmes mots à une terminaison près (« développement d'applications » / « développeur d'application »,
  // « gestion commerce » / « gestion commerciale ») : même filière. Seulement pour les noms de 2 mots et plus.
  if (mots.length >= 2) for (const [k, f] of TABLE) {
    const km = k.split(" ");
    if (km.length !== mots.length) continue;
    const libres = [...km];
    const ok = mots.every((m) => { const i = libres.findIndex((x) => memeMot(m, x)); if (i < 0) return false; libres.splice(i, 1); return true; });
    if (ok) return f;
  }
  return null;
}
/** Deux mots de même famille : identiques, à une faute de frappe près, ou même début sur au moins 75 % du plus court (6 lettres minimum) */
function memeMot(a, b) {
  if (a === b) return true;
  const court = Math.min(a.length, b.length);
  // faute de frappe : 1 lettre (2 pour un mot long)
  if (court >= 5 && distance(a, b) <= (court >= 10 ? 2 : 1)) return true;
  if (court < 6) return false;
  let i = 0; while (i < court && a[i] === b[i]) i++;
  return i >= 6 && i >= 0.75 * court;
}

/** Vrai si le texte ressemble à un sigle (« TH », « QHSE », « rit ») plutôt qu'à un nom de filière */
export function estSigle(v) {
  const t = String(v || "").trim();
  if (!t || /\s/.test(t.replace(/[.\-]/g, ""))) return false;
  const lettres = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return lettres.length <= 3 || (lettres.length <= 8 && lettres === lettres.toUpperCase()) || (lettres.length <= 5 && !/[aeiouyàâéèêëîïôöùûü]/i.test(lettres));
}
/** Pour les formulaires : { ok, nom } ou { ok: false, message }. Un sigle connu devient le nom complet ; un sigle inconnu est refusé. */
export function verifierFiliere(v) {
  const brut = String(v || "").replace(/\s+/g, " ").trim();
  if (brut.length < 2) return { ok: false, message: "Écris le nom de ta filière." };
  const connue = rapprocher(cleFiliere(brut));
  if (connue) return { ok: true, nom: connue };
  if (estSigle(brut)) return { ok: false, message: `« ${brut} » est un sigle. Écris le nom complet de la filière (ex : « Industries agroalimentaires et chimiques » au lieu de « IAC »).` };
  return { ok: true, nom: canonFiliere(brut) };
}

/** Filières ajoutées automatiquement (documents validés) : elles rejoignent la liste officielle */
export const FILIERES_AJOUTEES = [];
export function ajouterFilieres(liste = []) {
  for (const f of liste) {
    const cle = cleFiliere(f);
    if (!cle || TABLE.has(cle)) continue;
    // Presque le même nom qu'une filière existante : c'est la même (pas de doublon dans les listes)
    const meme = rapprocher(cle);
    if (meme) { TABLE.set(cle, meme); continue; }
    if (estSigle(f)) continue; // un sigle inconnu n'entre pas dans la liste des filières
    TABLE.set(cle, f);
    FILIERES_AJOUTEES.push(f);
  }
}
/** Toutes les filières connues (officielles + ajoutées), triées */
export const toutesLesFilieres = () => [...new Set([...FILIERES, ...FILIERES_AJOUTEES])].sort((a, b) => a.localeCompare(b, "fr"));
/** Vrai si la filière fait déjà partie de la liste */
export const filiereConnue = (f) => TABLE.has(cleFiliere(f)) && TABLE.get(cleFiliere(f)) === f;

// Filières hors liste déjà vues : la 1re orthographe rencontrée devient la référence
const vues = new Map();

/** Renvoie l'orthographe officielle d'une filière. */
export function canonFiliere(v) {
  const brut = String(v || "").replace(/\s+/g, " ").trim();
  if (!brut) return "";
  const cle = cleFiliere(brut);
  if (!cle) return brut;
  const connue = rapprocher(cle);
  if (connue) return connue;
  const tol = tolerance(cle);
  // Filière hors liste : même filière écrite autrement -> même nom
  for (const [k, f] of vues) if (k === cle || (tol && distance(cle, k) <= tol)) return f;
  const propre = brut.charAt(0).toUpperCase() + brut.slice(1).toLowerCase();
  vues.set(cle, propre);
  return propre;
}
