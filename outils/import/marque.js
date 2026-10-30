// Remplace, dans un PDF, la signature d'un site partenaire (ex. « www.fomesoutra.com ») par celle d'unidev.
// À utiliser UNIQUEMENT avec l'accord écrit du site concerné. Les noms des auteurs ne sont jamais touchés.
//
// Ce qui est remplacé :
//   - les lignes de texte horizontales (en-têtes, pieds de page…) qui contiennent la signature : recouvertes
//     d'un fond blanc puis réécrites « unidev-2026.web.app » ;
//   - les liens cliquables vers le site : redirigés vers unidev.
// Ce qui ne peut pas l'être : un logo en image, ou un filigrane en diagonale (l'effacer abîmerait le texte du cours).
import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict, PDFRawStream, PDFRef, decodePDFRawStream, rgb, StandardFonts, setTextRenderingMode, TextRenderingMode, pushGraphicsState, popGraphicsState } from "pdf-lib";

const SITE = "https://unidev-2026.web.app";
const TEXTE = "unidev-2026.web.app";

/* ---------- Logo en image en haut de la 1re page ---------- */
// Lecture simplifiée du contenu d'une page : on suit q / Q / cm et les images dessinées (« /Nom Do »).
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
function texteDuFlux(ctx, ref) {
  const st = ctx.lookup(ref);
  if (!(st instanceof PDFRawStream)) return "";
  try { return Buffer.from(decodePDFRawStream(st).decode()).toString("latin1"); } catch { return ""; }
}
function imagesDessinees(ctx, contenu, ressources, depart, sortie, profondeur = 0) {
  const xo = ressources?.lookup?.(PDFName.of("XObject"), PDFDict);
  let ctm = depart; const pile = []; let nums = []; let nom = null;
  const re = /\((?:\\.|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s\/\[\]()<>{}%]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+/g;
  for (const m of contenu.matchAll(re)) {
    const t = m[0];
    if (/^[-+]?(\d|\.)/.test(t)) { nums.push(parseFloat(t)); continue; }
    if (t[0] === "/") { nom = t.slice(1); continue; }
    if (t === "q") pile.push(ctm);
    else if (t === "Q") ctm = pile.pop() || depart;
    else if (t === "cm" && nums.length >= 6) ctm = mul(nums.slice(-6), ctm);
    else if (t === "Do" && nom && xo) {
      const ref = xo.get(PDFName.of(nom));
      const obj = ref ? ctx.lookup(ref) : null;
      const dict = obj?.dict;
      const sous = dict?.get(PDFName.of("Subtype"))?.toString();
      if (sous === "/Image") {
        const w = dict.get(PDFName.of("Width"))?.asNumber?.() || 0, h = dict.get(PDFName.of("Height"))?.asNumber?.() || 0;
        sortie.push({ ref, ctm, empreinte: `${w}x${h}:${obj.contents?.length || 0}` });
      }
      else if (sous === "/Form" && profondeur < 2 && ref instanceof PDFRef) {
        const mat = dict.lookup(PDFName.of("Matrix"));
        const fm = mat instanceof PDFArray ? mat.asArray().map((x) => x.asNumber?.() ?? 0) : [1, 0, 0, 1, 0, 0];
        imagesDessinees(ctx, texteDuFlux(ctx, ref), dict.lookup(PDFName.of("Resources"), PDFDict) || ressources, mul(fm, ctm), sortie, profondeur + 1);
      }
    }
    if (!/^[-+]?(\d|\.)/.test(t)) nums = [];
  }
}
/** Rectangle occupé par l'image (repère de la page) */
function cadre(ctm) {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
// Logos déjà reconnus pendant cet import : la même image sera remplacée partout, dans tous les documents suivants
const LOGOS_CONNUS = new Set();

/**
 * Repère le logo du site, sur TOUTES les pages :
 *  - une image LARGE (2 fois plus large que haute au moins) et PETITE (moins de 70 % de la largeur, 15 % de la hauteur)
 *    placée en HAUT ou en BAS d'une page (en-tête, pied de page) ;
 *  - ou une petite image répétée au même endroit sur plusieurs pages (en-tête ou pied de page de chaque page) ;
 *  - ou une image identique à un logo déjà reconnu dans un document précédent.
 * Un logo d'école carré seul, une figure du cours ou une page scannée entière ne sont jamais touchés.
 */
function trouverLogos(doc) {
  const ctx = doc.context, pages = doc.getPages(), trouves = [];
  const parPage = pages.map((page) => {
    const c = page.node.get(PDFName.of("Contents"));
    const refs = c ? (ctx.lookup(c) instanceof PDFArray ? ctx.lookup(c).asArray() : [c]) : [];
    const contenu = refs.map((r) => texteDuFlux(ctx, r)).join("\n");
    const imgs = [];
    try { imagesDessinees(ctx, contenu, page.node.Resources(), [1, 0, 0, 1, 0, 0], imgs); } catch {}
    const { width: W, height: H } = page.getSize();
    return imgs.map((im) => ({ ...im, b: cadre(im.ctm), W, H }));
  });

  // Images répétées sur plusieurs pages (même image, même place à 10 points près)
  const reps = new Map();
  parPage.forEach((imgs, i) => imgs.forEach((im) => {
    const k = `${im.ref}|${Math.round(im.b.x / 10)}|${Math.round(im.b.y / 10)}`;
    if (!reps.has(k)) reps.set(k, new Set());
    reps.get(k).add(i);
  }));

  const logos = new Set(); // empreintes retenues pour ce document
  parPage.forEach((imgs, i) => imgs.forEach((im) => {
    const { b, W, H } = im;
    if (b.w < 30 || b.h < 8 || b.w > W * 0.8) return;
    const large = b.w / b.h >= 2, petit = b.w <= W * 0.7 && b.h <= H * 0.15;
    const bord = b.y + b.h >= H * 0.78 || b.y <= H * 0.22;
    const repetee = b.h <= H * 0.15 && (reps.get(`${im.ref}|${Math.round(b.x / 10)}|${Math.round(b.y / 10)}`)?.size || 0) >= 2 && bord;
    if ((large && petit && bord) || repetee || LOGOS_CONNUS.has(im.empreinte)) logos.add(im.empreinte);
  }));
  if (!logos.size) return trouves;
  logos.forEach((e) => LOGOS_CONNUS.add(e));
  parPage.forEach((imgs, i) => imgs.forEach((im) => { if (logos.has(im.empreinte) && im.b.w <= im.W * 0.8) trouves.push({ page: i, ...im.b }); }));
  return trouves;
}
/** Dessine le logo unidev dans le cadre (carré vert « u » + « unidev » + adresse) */
function dessinerLogo(page, b, gras) {
  page.drawRectangle({ x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4, color: rgb(1, 1, 1) });
  const vert = rgb(0.12, 0.62, 0.33), fonce = rgb(0.06, 0.24, 0.18);
  const cote = Math.min(b.h * 0.8, b.w * 0.22);
  let taille = cote * 0.95;
  const largeur = (t) => cote + cote * 0.3 + gras.widthOfTextAtSize("unidev", t);
  while (taille > 5 && largeur(taille) > b.w * 0.98) taille -= 0.5;
  const total = largeur(taille);
  const x0 = b.x + (b.w - total) / 2;
  const y0 = b.y + (b.h - cote) / 2 + (b.h > cote * 1.6 ? cote * 0.25 : 0);
  page.drawRectangle({ x: x0, y: y0, width: cote, height: cote, color: vert });
  const tu = cote * 0.8;
  page.drawText("u", { x: x0 + (cote - gras.widthOfTextAtSize("u", tu)) / 2, y: y0 + cote * 0.22, size: tu, font: gras, color: rgb(1, 1, 1) });
  page.drawText("unidev", { x: x0 + cote * 1.3, y: y0 + cote * 0.18, size: taille, font: gras, color: fonce });
  if (b.h > cote * 1.6) {
    const ts = Math.max(5, Math.min(cote * 0.35, 9));
    const adr = "unidev-2026.web.app";
    page.drawText(adr, { x: b.x + (b.w - gras.widthOfTextAtSize(adr, ts)) / 2, y: y0 - ts * 1.4, size: ts, font: gras, color: vert });
  }
}

/**
 * motifs : liste de mots à repérer, ex. ["fomesoutra", "fo me soutra"]
 * Renvoie { buffer, lignes, liens, ignores } (buffer inchangé si rien trouvé).
 */
export async function remplacerSignature(buffer, motifs, options = {}) {
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
  // Le contenu d'origine peut laisser derrière lui un état « piégé » (texte invisible des PDF scannés,
  // repère déplacé…) : on l'enferme entre q … Q pour que notre texte s'affiche toujours.
  const isolees = new Set();
  const isoler = (page) => {
    if (isolees.has(page)) return;
    isolees.add(page);
    const ctx = doc.context;
    const debut = ctx.register(ctx.stream("q\n"));
    const fin = ctx.register(ctx.stream("\nQ\n"));
    const actuel = page.node.get(PDFName.of("Contents"));
    const resolu = actuel ? ctx.lookup(actuel) : null;
    const liste = ctx.obj([]);
    liste.push(debut);
    if (resolu instanceof PDFArray) for (let i = 0; i < resolu.size(); i++) liste.push(resolu.get(i));
    else if (actuel) liste.push(actuel);
    liste.push(fin);
    page.node.set(PDFName.of("Contents"), liste);
  };
  for (const z of zones) {
    const page = pages[z.page];
    isoler(page);
    page.drawRectangle({ x: z.x - 1, y: z.y - z.h * 0.3, width: z.w + 2, height: z.h * 1.35, color: rgb(1, 1, 1) });
    let taille = Math.max(6, Math.min(z.h, 14));
    while (taille > 5 && police.widthOfTextAtSize(TEXTE, taille) > Math.max(z.w, 60)) taille -= 0.5;
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Fill));
    page.drawText(TEXTE, { x: z.x, y: z.y, size: taille, font: police, color: rgb(0.12, 0.62, 0.33) });
    page.pushOperators(popGraphicsState());
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

  // 4. Logo en image en haut de la 1re page -> logo unidev
  let logos = 0;
  if (options.logo !== false) {
    for (const b of trouverLogos(doc)) {
      const page = pages[b.page];
      isoler(page);
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Fill));
      dessinerLogo(page, b, police);
      page.pushOperators(popGraphicsState());
      logos++;
    }
  }

  if (!zones.length && !liens && !logos) return { buffer, lignes: 0, liens: 0, ignores, logos: 0 };
  const sortie = Buffer.from(await doc.save());
  return { buffer: sortie, lignes: zones.length, liens, ignores, logos };
}
