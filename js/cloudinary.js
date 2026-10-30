import { cloudinaryConfig } from "./config.js";

const CHUNK = 6 * 1024 * 1024; // morceaux de 6 Mo (envoi fiable sur connexion mobile)

/**
 * Envoi non signé vers Cloudinary, découpé en morceaux pour les gros fichiers.
 * - document : resource_type "raw" (PDF, Word, PPT… livrés tels quels)
 * - image de couverture : resource_type "image"
 * onProgress(pourcentage) est appelé pendant l'envoi.
 */
export async function uploadFile(file, onProgress = () => {}, kind = "raw") {
  const { cloudName, uploadPreset, folder, imagePreset, imageFolder } = cloudinaryConfig;
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
  return typeof url === "string" && url.startsWith(`https://res.cloudinary.com/${cloudinaryConfig.cloudName}/${genre}/upload/`);
}

/** Télécharge les morceaux et les recolle en un seul fichier (Blob) */
export async function assembleParts(urls, onProgress = () => {}, type = "application/octet-stream") {
  if (!urls.length || urls.length > 12 || !urls.every((u) => lienSur(u))) throw new Error("Lien de fichier non autorisé.");
  const blobs = [];
  for (let i = 0; i < urls.length; i++) {
    const res = await fetch(urls[i]);
    if (!res.ok) throw new Error(`Morceau ${i + 1} introuvable (${res.status}).`);
    blobs.push(await res.blob());
    onProgress(Math.round(((i + 1) / urls.length) * 100));
  }
  return new Blob(blobs, { type });
}

/** Miniature recadrée et compressée par Cloudinary */
export function thumb(url, w = 400, h = 300) {
  return url ? url.replace("/image/upload/", `/image/upload/c_fill,g_north,w_${w},h_${h},q_auto:eco,f_auto,dpr_auto/`) : "";
}
