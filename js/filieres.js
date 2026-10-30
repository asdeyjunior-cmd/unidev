// Filières : une seule orthographe par filière, quelles que soient les majuscules, les accents
// ou les petites fautes de frappe. Utilisé par le site et par l'outil d'import.

/** Liste officielle affichée dans les suggestions. Ajoute ici une filière pour la proposer. */
export const FILIERES = [
  "Informatique de gestion",
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
  "Langues",
  "Littérature",
  "Autre",
];

/** Autres façons d'écrire une filière de la liste (sans accents, en minuscules) */
const ALIAS = {
  "Informatique de gestion": ["info de gestion", "informatique gestion", "ig"],
  "Informatique": ["info", "informatiques"],
  "Réseaux informatiques et télécommunications": ["rit", "reseaux informatiques", "reseaux et telecommunications", "reseau informatique et telecommunication", "reseaux telecoms"],
  "Finance-Comptabilité": ["finance comptabilite", "comptabilite finance", "comptabilite", "compta", "finance compta", "compta finance", "fcge", "finance comptabilite et gestion des entreprises", "finances comptabilite", "comptabilite et finance"],
  "Gestion commerciale": ["gestion commercial", "gc"],
  "Banque-Assurance": ["banque assurance", "banque", "assurance", "banque finance assurance"],
  "Marketing": ["mkt", "marketing communication"],
  "Commerce international": ["commerce inter", "ci"],
  "Logistique-Transport": ["logistique", "transport", "logistique et transport", "transport logistique"],
  "Ressources humaines": ["rh", "grh", "gestion des ressources humaines", "ressources humaines et communication", "rhc"],
  "Assistanat de direction": ["assistant de direction", "assistante de direction", "secretariat", "ad"],
  "Économie": ["eco", "economie", "sciences economiques"],
  "Mathématiques": ["maths", "math", "mathematique"],
  "Physique-Chimie": ["physique chimie", "pc"],
  "Électrotechnique": ["electrotechnique"],
  "Électronique": ["electronique"],
  "Littérature": ["litterature", "lettres", "lettres modernes", "romans", "roman", "litterature francaise"],
};

// "Finance - Comptabilité " -> "finance comptabilite" (sans accents, sans ponctuation, sans "et/de/des")
const MOTS_VIDES = new Set(["et", "de", "des", "du", "la", "le", "les", "en", "d", "l"]);
export function cleFiliere(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((m) => m && !MOTS_VIDES.has(m)).join(" ");
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

/** Filières ajoutées automatiquement (documents validés) : elles rejoignent la liste officielle */
export const FILIERES_AJOUTEES = [];
export function ajouterFilieres(liste = []) {
  for (const f of liste) {
    const cle = cleFiliere(f);
    if (!cle || TABLE.has(cle)) continue;
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
  if (TABLE.has(cle)) return TABLE.get(cle);
  // Faute de frappe : 1 lettre de différence pour un mot court, jusqu'à 3 pour un long
  const tol = cle.length <= 5 ? 0 : cle.length <= 8 ? 1 : cle.length <= 13 ? 2 : 3;
  let best = null, bd = 99;
  if (tol) for (const [k, f] of TABLE) { if (k.length < 4) continue; const dd = distance(cle, k); if (dd < bd) { bd = dd; best = f; } }
  if (best && bd <= tol) return best;
  // Filière hors liste : même filière écrite autrement -> même nom
  for (const [k, f] of vues) if (k === cle || (tol && distance(cle, k) <= tol)) return f;
  const propre = brut.charAt(0).toUpperCase() + brut.slice(1).toLowerCase();
  vues.set(cle, propre);
  return propre;
}
