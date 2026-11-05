// Transforme des photos de pages (devoir, cours écrit à la main…) en un seul PDF, directement dans le navigateur.

const LARGEUR_MAX = 1654; // ≈ A4 à 200 ppp : lisible et léger

// Tous les formats d'image : ceux que le navigateur lit (JPG, PNG, WEBP, GIF, BMP, AVIF, SVG, ICO…)
// + HEIC/HEIF (photos d'iPhone) et TIFF (scanners), convertis avec une petite bibliothèque chargée à la demande.
export const FORMATS_IMAGE = ["jpg", "jpeg", "jfif", "png", "webp", "gif", "bmp", "avif", "svg", "ico", "heic", "heif", "tif", "tiff"];
export const ACCEPT_IMAGES = "image/*,.heic,.heif,.tif,.tiff,.jfif,.avif";
export const estImage = (f) => !!f && (f.type.startsWith("image/") || FORMATS_IMAGE.includes(String(f.name).split(".").pop().toLowerCase()));
const ext = (f) => String(f.name || "").split(".").pop().toLowerCase();

const scripts = new Map();
function chargerScript(url, nom) {
  if (window[nom]) return Promise.resolve(window[nom]);
  if (!scripts.has(url)) scripts.set(url, new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = url; s.async = true;
    s.onload = () => (window[nom] ? ok(window[nom]) : ko(new Error("bibliothèque d'images indisponible")));
    s.onerror = () => ko(new Error("connexion impossible pour lire ce format d'image"));
    document.head.append(s);
  }));
  return scripts.get(url);
}

/** HEIC / TIFF -> image lisible par le navigateur */
async function versFormatLisible(f) {
  const e = ext(f), t = (f.type || "").toLowerCase();
  if (["heic", "heif"].includes(e) || /heic|heif/.test(t)) {
    const heic2any = await chargerScript("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js", "heic2any");
    const r = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.9 });
    return Array.isArray(r) ? r[0] : r;
  }
  if (["tif", "tiff"].includes(e) || /tiff/.test(t)) {
    const UTIF = await chargerScript("https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js", "UTIF");
    const buf = await f.arrayBuffer();
    const ifds = UTIF.decode(buf);
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const cv = document.createElement("canvas");
    cv.width = ifds[0].width; cv.height = ifds[0].height;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), cv.width, cv.height), 0, 0);
    return await new Promise((r) => cv.toBlob(r, "image/png"));
  }
  return f;
}

async function chargerImage(f0) {
  const f = await versFormatLisible(f0);
  if (window.createImageBitmap) {
    try { return await createImageBitmap(f, { imageOrientation: "from-image" }); } catch {}
  }
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      // SVG sans taille : on lui en donne une
      if (!img.width || !img.height) { img.width = 1200; img.height = 1600; }
      ok(img);
    };
    img.onerror = () => ko(new Error(`Image illisible : ${f0.name}`));
    img.src = URL.createObjectURL(f);
  });
}

/** Une photo -> JPEG compressé { octets, largeur, hauteur } */
async function versJpeg(f) {
  const img = await chargerImage(f);
  const w0 = img.width, h0 = img.height;
  const k = Math.min(1, LARGEUR_MAX / w0);
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h);
  img.close?.();
  const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.8));
  return { octets: new Uint8Array(await blob.arrayBuffer()), largeur: w, hauteur: h };
}

/** Assemble les pages (JPEG) en PDF : une photo par page, largeur A4 */
function assembler(pages) {
  const E = new TextEncoder(), Q = [], pos = [];
  let n = 0;
  const a = (x) => { x = typeof x === "string" ? E.encode(x) : x; Q.push(x); n += x.length; };
  const nb = pages.length;
  // Objets : 1 catalogue, 2 pages, puis pour chaque page : page, contenu, image
  const idPage = (i) => 3 + i * 3, idCont = (i) => 4 + i * 3, idImg = (i) => 5 + i * 3;
  a("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  pos[1] = n; a("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n");
  pos[2] = n; a(`2 0 obj<</Type/Pages/Kids[${pages.map((_, i) => idPage(i) + " 0 R").join(" ")}]/Count ${nb}>>endobj\n`);
  pages.forEach((p, i) => {
    const pw = 595.28, ph = +(pw * p.hauteur / p.largeur).toFixed(2);
    const cs = `q ${pw} 0 0 ${ph} 0 0 cm /I Do Q`;
    pos[idPage(i)] = n; a(`${idPage(i)} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw} ${ph}]/Contents ${idCont(i)} 0 R/Resources<</XObject<</I ${idImg(i)} 0 R>>>>>>endobj\n`);
    pos[idCont(i)] = n; a(`${idCont(i)} 0 obj<</Length ${cs.length}>>stream\n${cs}\nendstream endobj\n`);
    pos[idImg(i)] = n; a(`${idImg(i)} 0 obj<</Type/XObject/Subtype/Image/Width ${p.largeur}/Height ${p.hauteur}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${p.octets.length}>>stream\n`);
    a(p.octets); a("\nendstream endobj\n");
  });
  const total = 3 + nb * 3, x0 = n;
  a(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) a(String(pos[i]).padStart(10, "0") + " 00000 n \n");
  a(`trailer<</Size ${total}/Root 1 0 R>>\nstartxref\n${x0}\n%%EOF`);
  return new Blob(Q, { type: "application/pdf" });
}

/** photos (File[]) -> File PDF. onProgress(0..100) */
export async function photosEnPdf(photos, nom = "document", onProgress = () => {}) {
  const pages = [];
  for (const [i, f] of photos.entries()) {
    pages.push(await versJpeg(f));
    onProgress(Math.round(((i + 1) / photos.length) * 100));
  }
  const propre = nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "document";
  return new File([assembler(pages)], `${propre}.pdf`, { type: "application/pdf" });
}

/** Version légère d'une photo (pour l'image du document) */
export async function photoLegere(f, largeur = 1200) {
  const img = await chargerImage(f);
  const k = Math.min(1, largeur / img.width);
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  img.close?.();
  const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.82));
  return new File([blob], "couverture.jpg", { type: "image/jpeg" });
}

/* ---------- Image du document créée automatiquement (quand l'étudiant n'en met pas) ---------- */
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";

/** 1re page du PDF -> JPEG ; autre format -> couverture verte avec le titre */
export async function couvertureAuto(fichier, titre = "") {
  if (/\.pdf$/i.test(fichier?.name || "")) {
    try {
      const pdfjs = await import(`${PDFJS}pdf.min.mjs`);
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
      // Les 5 premiers Mo suffisent souvent pour la 1re page ; sinon le fichier entier
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()), isEvalSupported: false }).promise;
      const page = await pdf.getPage(1);
      const v0 = page.getViewport({ scale: 1 });
      const vue = page.getViewport({ scale: Math.min(2, 1000 / v0.width) });
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vue.width); cv.height = Math.floor(vue.height);
      const x = cv.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: x, viewport: vue }).promise;
      pdf.destroy?.();
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.82));
      if (blob) return new File([blob], "couverture.jpg", { type: "image/jpeg" });
    } catch (e) { console.warn("Aperçu PDF impossible, couverture générique :", e); }
  }
  return couvertureGenerique(fichier, titre);
}

function couvertureGenerique(fichier, titre) {
  const W = 900, H = 1200, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  x.fillStyle = "#eaf7ef"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#1f9d55"; x.fillRect(0, 0, W, 300);
  x.fillStyle = "#fff"; x.font = "bold 150px Georgia, serif"; x.textAlign = "center";
  x.fillText(String(fichier?.name || "").split(".").pop().toUpperCase().slice(0, 5) || "DOC", W / 2, 210);
  x.fillStyle = "#0f3d2e"; x.font = "bold 58px Helvetica, Arial, sans-serif";
  const mots = String(titre || "Document").split(/\s+/); const lignes = []; let l = "";
  for (const m of mots) { const t = l ? `${l} ${m}` : m; if (x.measureText(t).width > W - 120) { lignes.push(l); l = m; } else l = t; }
  if (l) lignes.push(l);
  lignes.slice(0, 7).forEach((t, i) => x.fillText(t, W / 2, 470 + i * 78));
  x.fillStyle = "#1f9d55"; x.font = "bold 40px Helvetica, Arial, sans-serif"; x.fillText("unidev", W / 2, H - 80);
  return new Promise((r) => cv.toBlob((b) => r(new File([b], "couverture.jpg", { type: "image/jpeg" })), "image/jpeg", 0.85));
}
