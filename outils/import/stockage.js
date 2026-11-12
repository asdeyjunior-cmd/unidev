// Plusieurs comptes Cloudinary : les nouveaux fichiers vont sur le compte qui a le plus de place libre,
// et on passe au suivant tout seul quand un compte est plein. Les fichiers déjà envoyés restent où ils sont
// (chaque document garde l'adresse complète de son fichier).
//
// Réglage (fichier .env ou secret GitHub CLOUDINARY_COMPTES), un compte par ligne :  nom:clé:secret
//   iugeyztf:123456789012345:AbCdEf...
//   moncompte2:543210987654321:XyZ...
// Sans CLOUDINARY_COMPTES, l'ancien réglage (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET) est utilisé.

export function comptes() {
  const liste = String(process.env.CLOUDINARY_COMPTES || "")
    .split(/[\n;,]+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [cloud_name, api_key, api_secret] = l.split(":").map((x) => x.trim()); return { cloud_name, api_key, api_secret }; })
    .filter((c) => c.cloud_name && c.api_key && c.api_secret);
  if (!liste.length && process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    liste.push({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  }
  return liste;
}

let ordre = []; // comptes du plus libre au plus rempli
let actuel = 0;

/** Remplissage d'un compte (0 à 100 %), d'après Cloudinary ; 100 si on ne peut pas le savoir */
async function remplissage(cloudinary, c) {
  try {
    const u = await cloudinary.api.usage({ ...c });
    const p = u?.credits?.used_percent ?? (u?.storage?.limit ? (100 * u.storage.usage) / u.storage.limit : null);
    return typeof p === "number" ? p : 50;
  } catch { return 100; }
}

/** Choisit le compte le plus libre et règle Cloudinary dessus. Renvoie son nom. */
// Comptes pleins ou bientôt fermés : encore lisibles, mais on n'y envoie plus rien (CLOUDINARY_PLEINS, séparés par des virgules)
const pleins = () => String(process.env.CLOUDINARY_PLEINS ?? "iugeyztf").split(/[\s,;]+/).filter(Boolean);
export async function choisirCompte(cloudinary, { afficher = true } = {}) {
  const tous = comptes();
  const liste = tous.filter((c) => !pleins().includes(c.cloud_name)).length ? tous.filter((c) => !pleins().includes(c.cloud_name)) : tous;
  if (!liste.length) throw new Error("Aucun compte Cloudinary réglé (CLOUDINARY_COMPTES ou CLOUDINARY_CLOUD_NAME…)");
  const mesures = [];
  for (const c of liste) mesures.push({ c, p: liste.length > 1 ? await remplissage(cloudinary, c) : 0 });
  ordre = mesures.sort((a, b) => a.p - b.p);
  actuel = 0;
  cloudinary.config({ ...ordre[0].c, secure: true });
  if (afficher && liste.length > 1) console.log(`Stockage : ${ordre.map((m) => `${m.c.cloud_name} ${Math.round(m.p)} %`).join(" · ")} → envoi sur ${ordre[0].c.cloud_name}\n`);
  return ordre[0].c.cloud_name;
}

/** Compte plein : on passe au suivant. Renvoie false s'il n'y en a plus. */
export function basculer(cloudinary) {
  if (actuel + 1 >= ordre.length) return false;
  actuel++;
  cloudinary.config({ ...ordre[actuel].c, secure: true });
  console.log(`   (compte plein : envoi désormais sur ${ordre[actuel].c.cloud_name})`);
  return true;
}

// Compte plein OU inutilisable (clé fausse, compte désactivé…) : on passe au suivant
export const comptePlein = (e) => /storage|quota|limit|exceed|plan|credits|api_key|api key|signature|unauthori|forbidden|disabled|suspend|not allowed|401|403/i.test(e?.error?.message || e?.message || String(e?.http_code || ""));

/** Réglages d'un compte pour une adresse de fichier (pour supprimer ou lister au bon endroit) */
export function compteDeUrl(url) {
  const m = String(url || "").match(/res\.cloudinary\.com\/([^/]+)\//);
  return m ? comptes().find((c) => c.cloud_name === m[1]) || null : null;
}

/* ---------- Stockage principal : Cloudflare R2, via le serveur unidev ----------
   Réglages : R2_URL (adresse du serveur) et OUTILS_SECRET. Sans eux, tout reste sur Cloudinary comme avant. */
const R2 = () => String(process.env.R2_URL || "").trim().replace(/\/$/, "");
const SECRET = () => String(process.env.OUTILS_SECRET || "").trim().replace(/^["']+|["']+$/g, "");
export const r2Actif = () => !!(R2() && SECRET());
export const MAX_R2 = 95 * 1024 * 1024; // un seul envoi jusqu'à 95 Mo (limite du serveur : 100 Mo)

const typeDe = (buf) => {
  const d = buf.subarray(0, 8).toString("latin1");
  if (d.startsWith("%PDF")) return ["application/pdf", "pdf"];
  if (d.startsWith("\x89PNG")) return ["image/png", "png"];
  if (d.startsWith("\xff\xd8")) return ["image/jpeg", "jpg"];
  if (d.startsWith("PK")) return ["application/zip", "zip"];
  if (d.startsWith("\xd0\xcf\x11\xe0")) return ["application/msword", "doc"];
  return ["application/octet-stream", "bin"];
};
const aleatoire = () => [...Array(20)].map(() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/** Dépose un fichier dans R2. Renvoie la même forme qu'un envoi Cloudinary : { secure_url, public_id, bytes } */
export async function deposerR2(buffer, { dossier = "documents", nom = "", type = "" } = {}) {
  const [t, ext] = typeDe(buffer);
  const cle = `${dossier}/outils/${aleatoire()}/${(nom || `fichier.${ext}`).replace(/[^\w.-]+/g, "-").slice(-80)}`;
  let derniere;
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const r = await fetch(`${R2()}/deposer?cle=${encodeURIComponent(cle)}`, {
        method: "POST", headers: { "X-Secret": SECRET(), "Content-Type": type || t }, body: buffer, signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) return { secure_url: j.url, public_id: "", bytes: buffer.length };
      derniere = new Error(`stockage R2 : ${j.erreur || r.status}`);
      if (r.status === 401 || r.status === 400) break;
    } catch (e) { derniere = e; }
    await new Promise((ok) => setTimeout(ok, 2000 * essai));
  }
  throw derniere;
}

/** Remplace un envoi Cloudinary (mêmes options) par un dépôt dans R2 */
export function envoyerR2(buffer, options = {}) {
  const image = options.resource_type === "image";
  return deposerR2(buffer, { dossier: image ? "images" : "documents" });
}

/** Aperçu (1re page en JPEG) d'un PDF : rendu par Cloudinary le temps d'une seconde, puis rangé dans R2 et effacé de Cloudinary */
export async function apercuPdfR2(cloudinary, pdf) {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const une = await PDFDocument.create();
  const [p] = await une.copyPages(src, [0]);
  une.addPage(p);
  const petit = Buffer.from(await une.save());
  const res = await new Promise((ok, ko) => cloudinary.uploader.upload_stream({ resource_type: "image", folder: "unidev/temporaire", timeout: 120000 },
    (err, r) => (err ? ko(err) : ok(r))).end(petit));
  try {
    const url = cloudinary.url(res.public_id, { resource_type: "image", secure: true, format: "jpg", transformation: [{ page: 1, width: 800, crop: "limit", quality: "auto" }] }).split("?")[0];
    const r = await fetch(url);
    if (!r.ok) throw new Error(`aperçu ${r.status}`);
    return (await deposerR2(Buffer.from(await r.arrayBuffer()), { dossier: "images", nom: "apercu.jpg", type: "image/jpeg" })).secure_url;
  } finally {
    cloudinary.uploader.destroy(res.public_id, { resource_type: "image" }).catch(() => {});
  }
}
