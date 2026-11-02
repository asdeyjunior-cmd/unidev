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
export async function choisirCompte(cloudinary, { afficher = true } = {}) {
  const liste = comptes();
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

export const comptePlein = (e) => /storage|quota|limit|exceed|plan|credits/i.test(e?.error?.message || e?.message || "");

/** Réglages d'un compte pour une adresse de fichier (pour supprimer ou lister au bon endroit) */
export function compteDeUrl(url) {
  const m = String(url || "").match(/res\.cloudinary\.com\/([^/]+)\//);
  return m ? comptes().find((c) => c.cloud_name === m[1]) || null : null;
}
