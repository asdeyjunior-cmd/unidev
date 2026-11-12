import { cloudinaryConfig, stockageConfig } from "./config.js";

const CHUNK = 6 * 1024 * 1024; // morceaux de 6 Mo (envoi fiable sur connexion mobile)

/**
 * Envoi non signé vers Cloudinary, découpé en morceaux pour les gros fichiers.
 * - document : resource_type "raw" (PDF, Word, PPT… livrés tels quels)
 * - image de couverture : resource_type "image"
 * onProgress(pourcentage) est appelé pendant l'envoi.
 */
/* ---------- Plusieurs comptes Cloudinary ----------
   Le compte le plus libre est indiqué chaque jour par l'outil « Choisir le compte Cloudinary » (parametres/stockage).
   Si un compte est plein, l'envoi repart tout seul sur le suivant. */
const COMPTES = (cloudinaryConfig.comptes || [cloudinaryConfig.cloudName]).filter((c) => c && !/^COMPTE_/.test(c));
// Comptes où l'on envoie encore (les comptes pleins restent lisibles, mais ne reçoivent plus rien)
const COMPTES_ENVOI = COMPTES.filter((c) => !(stockageConfig?.pleins || []).includes(c));
let comptePrefere = null;
async function ordreDesComptes() {
  if (!comptePrefere) {
    try { const { compteDeStockage } = await import("./firebase.js"); comptePrefere = await compteDeStockage(); } catch {}
    if (!COMPTES_ENVOI.includes(comptePrefere)) comptePrefere = COMPTES_ENVOI[0] || COMPTES[0];
  }
  return [comptePrefere, ...COMPTES_ENVOI.filter((c) => c !== comptePrefere)];
}

/* ---------- Stockage principal : Cloudflare R2, via le serveur unidev ----------
   Téléchargements gratuits et sans limite. Si le serveur n'est pas prêt, on repasse par Cloudinary. */
const SERVEUR = String(stockageConfig?.serveur || "").replace(/\/$/, "");
let r2EnPanne = false;
function envoyerSurR2(file, onProgress, genre) {
  return new Promise(async (resolve, reject) => {
    let jeton = "";
    try { const { jetonConnexion } = await import("./firebase.js"); jeton = await jetonConnexion(); } catch {}
    if (!jeton) return reject(Object.assign(new Error("Connecte-toi d'abord."), { r2: true }));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVEUR}/envoyer?genre=${genre}&nom=${encodeURIComponent(file.name || "fichier")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${jeton}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && res.url) return resolve({ url: res.url, publicId: "", bytes: res.bytes || file.size });
      // 413 = trop lourd, 4xx = refus : on le dit ; 5xx = serveur pas prêt : on repassera par Cloudinary
      reject(Object.assign(new Error(res.erreur || `Échec de l'envoi (${xhr.status})`), { definitif: xhr.status >= 400 && xhr.status < 500 && xhr.status !== 401 }));
    };
    xhr.onerror = () => reject(Object.assign(new Error("Connexion impossible. Vérifie ta connexion internet."), { reseau: true }));
    xhr.send(file);
  });
}
async function essayerR2(file, onProgress, genre) {
  if (!SERVEUR || r2EnPanne) return null;
  try { return await envoyerSurR2(file, onProgress, genre); }
  catch (e) {
    if (e.definitif || e.reseau) throw e;
    r2EnPanne = true; // serveur pas prêt : la suite de la visite passe par Cloudinary
    return null;
  }
}
const comptePlein = (e) => /limit|quota|exceed|storage|credits|suspend|disabled/i.test(e?.message || "");

export async function uploadFile(file, onProgress = () => {}, kind = "raw") {
  const r2 = await essayerR2(file, onProgress, kind === "image" ? "image" : "doc");
  if (r2) return r2;
  const ordre = await ordreDesComptes();
  for (let i = 0; ; i++) {
    try { return await uploadSurCompte(ordre[i], file, onProgress, kind); }
    catch (e) {
      // Compte plein ou mal réglé (preset absent, livraison PDF bloquée…) : on essaie le compte suivant.
      // Seuls une coupure internet ou un fichier trop lourd arrêtent l'envoi.
      const pasLeCompte = /Connexion impossible|trop lourd/i.test(e?.message || "");
      if ((comptePlein(e) || !pasLeCompte) && i + 1 < ordre.length) { comptePrefere = ordre[i + 1]; continue; }
      throw e;
    }
  }
}

async function uploadSurCompte(cloudName, file, onProgress, kind) {
  const { uploadPreset, folder, imagePreset, imageFolder } = cloudinaryConfig;
  const isImage = kind === "image";
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/${isImage ? "image" : "raw"}/upload`;
  const uploadId = `unidev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const total = file.size;
  let res = null;

  for (let start = 0; start < total || (total === 0 && !res); start += CHUNK) {
    const end = Math.min(start + CHUNK, total);
    const form = new FormData();
    form.append("file", file.slice(start, end), file.name);
    form.append("upload_preset", isImage ? imagePreset : uploadPreset);
    form.append("folder", isImage ? imageFolder : folder);

    res = await sendChunk(url, form, total > CHUNK ? {
      "X-Unique-Upload-Id": uploadId,
      "Content-Range": `bytes ${start}-${end - 1}/${total}`,
    } : {}, (loaded) => onProgress(Math.round(((start + loaded) / total) * 100)));
    if (total === 0) break;
  }
  return { url: res.secure_url, publicId: res.public_id, bytes: res.bytes };
}

function sendChunk(url, form, headers, onLoaded) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onLoaded(e.loaded);
    xhr.onload = () => {
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(res);
      const msg = res.error?.message || "";
      if (/too large|file size/i.test(msg)) {
        return reject(new Error("Fichier trop lourd pour l'offre Cloudinary actuelle (10 Mo maximum sur le plan gratuit)."));
      }
      reject(new Error(msg || `Échec de l'envoi (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Connexion impossible avec Cloudinary. Vérifie ta connexion internet."));
    xhr.send(form);
  });
}

/* ---------- Gros fichiers : découpage en morceaux de 9 Mo ----------
   Le plan gratuit Cloudinary refuse les fichiers de plus de 10 Mo, mais accepte
   autant de fichiers de moins de 10 Mo que l'on veut. Un gros document est donc
   envoyé en plusieurs morceaux, puis recollé sur l'appareil au téléchargement. */
export const TAILLE_MORCEAU = 9 * 1024 * 1024;

export async function uploadDocument(file, onProgress = () => {}) {
  // R2 : un seul envoi, jusqu'à 100 Mo, sans morceaux
  const r2 = await essayerR2(file, onProgress, "doc");
  if (r2) return { ...r2, parts: null };
  if (file.size <= TAILLE_MORCEAU) {
    const up = await uploadFile(file, onProgress, "raw");
    return { ...up, parts: null };
  }
  const point = file.name.lastIndexOf(".");
  const base = point > 0 ? file.name.slice(0, point) : file.name;
  const ext = point > 0 ? file.name.slice(point) : "";
  const total = Math.ceil(file.size / TAILLE_MORCEAU);
  const parts = [];
  for (let i = 0; i < total; i++) {
    const debut = i * TAILLE_MORCEAU;
    const morceau = new File([file.slice(debut, Math.min(debut + TAILLE_MORCEAU, file.size))], `${base}_partie${i + 1}${ext}`);
    const up = await uploadFile(morceau, (p) => onProgress(Math.round(((i + p / 100) / total) * 100)), "raw");
    parts.push({ url: up.url, publicId: up.publicId });
  }
  return { url: parts[0].url, publicId: parts[0].publicId, bytes: file.size, parts };
}

/** Vrai seulement pour un fichier de TON compte Cloudinary (protège contre un lien piégé) */
export function lienSur(url, genre = "raw") {
  if (typeof url !== "string") return false;
  if (SERVEUR && url.startsWith(`${SERVEUR}/f/`)) return true;
  return COMPTES.some((c) => url.startsWith(`https://res.cloudinary.com/${c}/${genre}/upload/`));
}

/** Télécharge les morceaux et les recolle en un seul fichier (Blob) */
// Morceaux déjà reçus : si la connexion coupe, « Réessayer » reprend là où ça s'est arrêté
const morceauxRecus = new Map();

/** Télécharge un morceau, avec la progression octet par octet et jusqu'à 4 essais */
async function morceau(url, onOctets) {
  if (morceauxRecus.has(url)) { onOctets(morceauxRecus.get(url).size); return morceauxRecus.get(url); }
  let derniere;
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw Object.assign(new Error(`erreur ${res.status}`), { definitive: res.status === 404 || res.status === 403 });
      let blob;
      if (res.body && res.body.getReader) {
        const lecteur = res.body.getReader(), parts = [];
        let recu = 0;
        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          parts.push(value); recu += value.length; onOctets(recu);
        }
        blob = new Blob(parts);
      } else { blob = await res.blob(); onOctets(blob.size); }
      morceauxRecus.set(url, blob);
      return blob;
    } catch (e) {
      derniere = e;
      onOctets(0);
      if (e.definitive) break;
      await new Promise((r) => setTimeout(r, 1500 * essai));
    }
  }
  throw derniere;
}

/** Reconstitue un gros fichier envoyé en plusieurs morceaux (2 morceaux à la fois, reprise possible) */
export async function assembleParts(urls, onProgress = () => {}, type = "application/octet-stream", onEtat = () => {}) {
  if (!urls.length || urls.length > 15 || !urls.every((u) => lienSur(u))) throw new Error("Lien de fichier non autorisé.");
  const TAILLE = 9 * 1024 * 1024; // taille d'un morceau (le dernier est plus petit)
  const total = urls.length * TAILLE;
  const recus = new Array(urls.length).fill(0);
  const maj = () => onProgress(Math.min(99, Math.round((recus.reduce((a, b) => a + b, 0) / total) * 100)));
  const blobs = new Array(urls.length);
  let suivant = 0, finis = 0;
  const travailleur = async () => {
    while (suivant < urls.length) {
      const i = suivant++;
      try {
        blobs[i] = await morceau(urls[i], (o) => { recus[i] = o; maj(); });
      } catch (e) { throw new Error(`Morceau ${i + 1} sur ${urls.length} : ${e.message}`); }
      finis++;
      onEtat(`${finis} morceau(x) sur ${urls.length} reçus…`);
    }
  };
  await Promise.all([travailleur(), travailleur()]);
  onProgress(100);
  return new Blob(blobs, { type });
}

/** Miniature recadrée et compressée par Cloudinary */
export function thumb(url, w = 400, h = 300) {
  if (!url) return "";
  // Image sur R2 : déjà allégée à l'envoi, servie telle quelle
  if (!url.startsWith("https://res.cloudinary.com/")) return url;
  return url.replace("/image/upload/", `/image/upload/c_fill,g_north,w_${w},h_${h},q_auto:eco,f_auto,dpr_auto/`);
}

/**
 * Récupère le fichier complet d'un document (un seul fichier ou plusieurs morceaux) sous forme de Blob.
 * info = { fileUrl, parts } ; taille = taille attendue (pour la barre de progression)
 */
export async function recupererFichier(info, { type = "application/octet-stream", taille = 0, onProgress = () => {}, onEtat = () => {} } = {}) {
  const morceaux = info.parts?.length > 1 ? info.parts.map((p) => p.url) : null;
  if (morceaux) return assembleParts(morceaux, onProgress, type, onEtat);
  if (!(lienSur(info.fileUrl) || lienSur(info.fileUrl, "image"))) throw new Error("Lien de fichier non autorisé.");
  const blob = await morceau(info.fileUrl, (o) => onProgress(taille ? Math.min(99, Math.round((o / taille) * 100)) : 0));
  onProgress(100);
  return blob.type === type ? blob : new Blob([blob], { type });
}
