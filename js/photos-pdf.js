// Transforme des photos de pages (devoir, cours écrit à la main…) en un seul PDF, directement dans le navigateur.

const LARGEUR_MAX = 1654; // ≈ A4 à 200 ppp : lisible et léger

async function chargerImage(f) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(f, { imageOrientation: "from-image" }); } catch {}
  }
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error(`Image illisible : ${f.name}`));
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
