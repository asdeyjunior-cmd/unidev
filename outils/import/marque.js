// Remplace, dans un PDF, la signature d'un site partenaire (ex. « www.fomesoutra.com ») par celle d'unidev.
// À utiliser UNIQUEMENT avec l'accord écrit du site concerné. Les noms des auteurs ne sont jamais touchés.
//
// Ce qui est remplacé :
//   - les lignes de texte horizontales (en-têtes, pieds de page…) qui contiennent la signature : recouvertes
//     d'un fond blanc puis réécrites « unidev-2026.web.app » ;
//   - les liens cliquables vers le site : redirigés vers unidev.
// Ce qui ne peut pas l'être : un logo en image, ou un filigrane en diagonale (l'effacer abîmerait le texte du cours).
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from "pdf-lib";

const SITE = "https://unidev-2026.web.app";
const TEXTE = "unidev-2026.web.app";

/**
 * motifs : liste de mots à repérer, ex. ["fomesoutra", "fo me soutra"]
 * Renvoie { buffer, lignes, liens, ignores } (buffer inchangé si rien trouvé).
 */
export async function remplacerSignature(buffer, motifs) {
  const re = new RegExp(motifs.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s._-]*")).join("|"), "i");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let lecture;
  try {
    lecture = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  } catch { return { buffer, lignes: 0, liens: 0, ignores: 0 }; }

  // 1. Repérer les lignes concernées, page par page
  const zones = []; // { page, x, y, w, h }
  let ignores = 0;
  for (let p = 1; p <= lecture.numPages; p++) {
    const page = await lecture.getPage(p);
    const { items } = await page.getTextContent();
    const lignes = new Map(); // ordonnée arrondie -> éléments horizontaux
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const [a, b] = it.transform;
      if (Math.abs(b) > 0.01 || a <= 0) { if (re.test(it.str)) ignores++; continue; } // texte penché : on n'y touche pas
      const y = Math.round(it.transform[5]);
      if (!lignes.has(y)) lignes.set(y, []);
      lignes.get(y).push(it);
    }
    for (const elts of lignes.values()) {
      elts.sort((u, v) => u.transform[4] - v.transform[4]);
      const texte = elts.map((e) => e.str).join(" ");
      if (!re.test(texte)) continue;
      // Ligne courte (signature, en-tête, pied de page) : on la remplace entièrement.
      // Ligne longue (phrase du cours) : on ne remplace que les morceaux qui contiennent la signature.
      const cibles = texte.length <= 90 ? elts : elts.filter((e) => re.test(e.str));
      if (!cibles.length) { ignores++; continue; }
      const x = Math.min(...cibles.map((e) => e.transform[4]));
      const fin = Math.max(...cibles.map((e) => e.transform[4] + e.width));
      const h = Math.max(...cibles.map((e) => e.height || Math.abs(e.transform[3]) || 10));
      zones.push({ page: p - 1, x, y: cibles[0].transform[5], w: fin - x, h });
    }
  }

  // 2. Recouvrir et réécrire avec pdf-lib
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const police = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  for (const z of zones) {
    const page = pages[z.page];
    page.drawRectangle({ x: z.x - 1, y: z.y - z.h * 0.3, width: z.w + 2, height: z.h * 1.35, color: rgb(1, 1, 1) });
    let taille = Math.max(6, Math.min(z.h, 14));
    while (taille > 5 && police.widthOfTextAtSize(TEXTE, taille) > Math.max(z.w, 60)) taille -= 0.5;
    page.drawText(TEXTE, { x: z.x, y: z.y, size: taille, font: police, color: rgb(0.12, 0.62, 0.33) });
  }

  // 3. Liens cliquables vers le site partenaire -> unidev
  let liens = 0;
  for (const page of pages) {
    const annots = page.node.Annots?.();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      const action = a?.lookup?.(PDFName.of("A"));
      const uri = action?.lookup?.(PDFName.of("URI"));
      const valeur = uri?.decodeText?.() ?? uri?.asString?.() ?? "";
      if (valeur && re.test(valeur)) { action.set(PDFName.of("URI"), PDFString.of(SITE)); liens++; }
    }
  }

  if (!zones.length && !liens) return { buffer, lignes: 0, liens: 0, ignores };
  const sortie = Buffer.from(await doc.save());
  return { buffer: sortie, lignes: zones.length, liens, ignores };
}
