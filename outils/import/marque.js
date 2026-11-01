// Remplace, dans un PDF, la signature d'un site partenaire (ex. « www.fomesoutra.com ») par celle d'unidev.
// À utiliser UNIQUEMENT avec l'accord écrit du site concerné. Les noms des auteurs ne sont jamais touchés.
//
// Ce qui est remplacé :
//   - les lignes de texte horizontales (en-têtes, pieds de page…) qui contiennent la signature : recouvertes
//     d'un fond blanc puis réécrites « unidev-2026.web.app » ;
//   - les liens cliquables vers le site : redirigés vers unidev.
//   - le logo du site en image (même découpé en morceaux ou posé en tampon), reconnu en le COMPARANT aux modèles
//     du dossier « logos » : les autres images (logos d'écoles, titres…) ne sont jamais touchées.
//   - un seul remplacement propre par endroit : les morceaux voisins sont réunis avant de dessiner.
// Ce qui ne peut pas l'être : un filigrane en diagonale (l'effacer abîmerait le texte du cours).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict, PDFRawStream, PDFRef, decodePDFRawStream, rgb, StandardFonts, setTextRenderingMode, TextRenderingMode, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";

const SITE = "https://unidev-2026.web.app";
const TEXTE = "unidev-2026.web.app";

/* ---------- Images du PDF ---------- */
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
      if (sous === "/Image") sortie.push({ obj, ctm });
      else if (sous === "/Form" && profondeur < 4 && ref instanceof PDFRef) {
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
const contenuPage = (ctx, page) => {
  const c = page.node.get(PDFName.of("Contents"));
  const refs = c ? (ctx.lookup(c) instanceof PDFArray ? ctx.lookup(c).asArray() : [c]) : [];
  return refs.map((r) => texteDuFlux(ctx, r)).join("\n");
};

/* ---------- Lire les pixels d'une image du PDF ---------- */
const nomFiltre = (d) => {
  const f = d.lookup(PDFName.of("Filter"));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map((x) => x.toString());
  return [f.toString()];
};
const num = (d, k, def = 0) => d.lookup(PDFName.of(k))?.asNumber?.() ?? def;
/** Pixels en niveaux de gris (fond blanc) : { data, w, h } — ou null si format non géré */
async function pixelsGris(ctx, obj) {
  const d = obj.dict;
  if (d.get(PDFName.of("ImageMask"))?.toString() === "true") return null;
  const w = num(d, "Width"), h = num(d, "Height");
  if (!w || !h || w * h > 1.2e7) return null;
  const filtres = nomFiltre(d);
  let gris;
  try {
    if (filtres.includes("/JPXDecode") || filtres.includes("/JBIG2Decode") || filtres.includes("/CCITTFaxDecode")) return null;
    if (filtres.length === 1 && filtres[0] === "/DCTDecode") {
      const r = await sharp(Buffer.from(obj.contents)).flatten({ background: "#ffffff" }).grayscale().raw().toBuffer({ resolveWithObject: true });
      if (r.info.width !== w || r.info.height !== h) return { data: r.data, w: r.info.width, h: r.info.height };
      gris = r.data;
    } else {
      const brut = decodePDFRawStream(obj).decode();
      const bpc = num(d, "BitsPerComponent", 8);
      let cs = d.lookup(PDFName.of("ColorSpace"));
      let palette = null, n = 1;
      const canaux = (c) => {
        if (!c) return 1;
        if (c instanceof PDFArray) {
          const t = c.get(0)?.toString();
          if (t === "/ICCBased") { const st = ctx.lookup(c.get(1)); return st?.dict?.lookup(PDFName.of("N"))?.asNumber?.() || 3; }
          if (t === "/CalRGB" || t === "/Lab") return 3;
          if (t === "/CalGray") return 1;
          return 0;
        }
        const t = c.toString();
        return t === "/DeviceRGB" ? 3 : t === "/DeviceGray" ? 1 : t === "/DeviceCMYK" ? 4 : 0;
      };
      if (cs instanceof PDFArray && cs.get(0)?.toString() === "/Indexed") {
        n = canaux(ctx.lookup(cs.get(1)));
        const tab = ctx.lookup(cs.get(3));
        palette = tab instanceof PDFRawStream ? decodePDFRawStream(tab).decode() : Uint8Array.from(Buffer.from(tab?.asBytes?.() ?? tab?.decodeText?.() ?? [], "latin1"));
        if (!n) return null;
      } else n = canaux(cs);
      if (!n) return null;
      const par = palette ? 1 : n;
      const ligne = Math.ceil((w * par * bpc) / 8);
      if (brut.length < ligne * h) return null;
      gris = Buffer.alloc(w * h);
      const lire = (y, i) => {
        if (bpc === 8) return brut[y * ligne + i];
        const bit = i * bpc, oct = brut[y * ligne + (bit >> 3)];
        const v = (oct >> (8 - bpc - (bit & 7))) & ((1 << bpc) - 1);
        return palette ? v : Math.round((v * 255) / ((1 << bpc) - 1));
      };
      const lum = (c) => (n === 1 ? c[0] : n === 3 ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
        : 255 - Math.min(255, 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] + c[3]));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let c;
        if (palette) { const k = lire(y, x) * n; c = Array.from(palette.subarray(k, k + n)); }
        else { c = []; for (let j = 0; j < n; j++) c.push(lire(y, x * n + j)); }
        gris[y * w + x] = lum(c);
      }
    }
    // Transparence : on pose l'image sur du blanc
    const sm = d.lookup(PDFName.of("SMask"));
    if (sm instanceof PDFRawStream) {
      const a = await pixelsGris(ctx, sm);
      if (a && a.w === w && a.h === h) for (let i = 0; i < w * h; i++) gris[i] = Math.round((gris[i] * a.data[i] + 255 * (255 - a.data[i])) / 255);
    }
    return { data: gris, w, h };
  } catch { return null; }
}

/* ---------- Reconnaître un logo par son ASPECT (comparaison avec les modèles du dossier logos/) ---------- */
const LW = 64, LH = 16;
/** Recadre sur la partie dessinée puis réduit à 64×16 : { ratio, v } */
async function signatureVisuelle({ data, w, h }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 - x0 < 8 || y1 - y0 < 3) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const v = await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 1 } })
    .extract({ left: x0, top: y0, width: cw, height: ch }).resize(LW, LH, { fit: "fill", kernel: "cubic" }).blur(0.6).toColourspace("b-w").raw().toBuffer();
  const f = Float32Array.from(v); const moy = f.reduce((a, b) => a + b, 0) / f.length;
  let n2 = 0; for (let i = 0; i < f.length; i++) { f[i] -= moy; n2 += f[i] * f[i]; }
  if (n2 < 1) return null;
  const k = Math.sqrt(n2); for (let i = 0; i < f.length; i++) f[i] /= k;
  return { ratio: cw / ch, v: f };
}
const ressemblance = (a, b) => {
  if (!a || !b) return 0;
  const r = a.ratio / b.ratio;
  if (r < 0.7 || r > 1.45) return 0;
  let s = 0; for (let i = 0; i < a.v.length; i++) s += a.v[i] * b.v[i];
  return s;
};
export const SEUIL_LOGO = 0.6; // logo Fomesoutra : 0,89 à 1 ; autres images d'en-tête : 0,40 au plus

let MODELES = null;
/** Modèles de logos à remplacer : images PNG/JPG du dossier « logos » à côté de ce fichier */
async function modeles() {
  if (MODELES) return MODELES;
  MODELES = [];
  const dossier = path.join(path.dirname(fileURLToPath(import.meta.url)), "logos");
  for (const f of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue;
    try {
      const r = await sharp(path.join(dossier, f)).flatten({ background: "#ffffff" }).grayscale().raw().toBuffer({ resolveWithObject: true });
      const s = await signatureVisuelle({ data: r.data, w: r.info.width, h: r.info.height });
      if (!s) continue;
      // Image du modèle recadrée (pour le chercher À L'INTÉRIEUR d'une page scannée)
      const { data, info } = r; let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const gris = await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } })
        .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
      MODELES.push({ nom: f, ...s, gris });
    } catch {}
  }
  return MODELES;
}
const meilleur = (sig, mods) => Math.max(0, ...mods.map((m) => ressemblance(sig, m)));

/**
 * Cherche le logo À L'INTÉRIEUR d'une grande image (page scannée) : en haut et en bas de l'image,
 * à plusieurs tailles. Renvoie { score, x, y, w, h } en fractions de l'image (0 à 1), ou null.
 */
export const SEUIL_SCAN = 0.66; // logo Fomesoutra dans une page scannée : 0,79 à 0,96 ; autres pages : 0,50 au plus
/** Image en gris + tables cumulées (moyenne et variance d'un rectangle en 4 opérations) */
async function preparer(px, L) {
  const H = Math.max(1, Math.round((px.h * L) / px.w));
  const img = Float32Array.from(await sharp(Buffer.from(px.data), { raw: { width: px.w, height: px.h, channels: 1 } })
    .resize(L, H, { fit: "fill" }).toColourspace("b-w").raw().toBuffer());
  const W1 = L + 1, S = new Float64Array(W1 * (H + 1)), Q = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) { let a = 0, b = 0; for (let x = 0; x < L; x++) { const v = img[y * L + x]; a += v; b += v * v; S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + a; Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + b; } }
  const somme = (T, x, y, w, h) => T[(y + h) * W1 + x + w] - T[y * W1 + x + w] - T[(y + h) * W1 + x] + T[y * W1 + x];
  return { img, L, H, S, Q, somme };
}
async function modeleA(m, tw, th) {
  const t = Float32Array.from(await sharp(m.gris).resize(tw, th, { fit: "fill" }).toColourspace("b-w").raw().toBuffer());
  const n = tw * th; let moy = 0; for (const v of t) moy += v; moy /= n;
  let nt = 0; for (let i = 0; i < n; i++) { t[i] -= moy; nt += t[i] * t[i]; }
  nt = Math.sqrt(nt); if (nt < 1) return null;
  for (let i = 0; i < n; i++) t[i] /= nt;
  return t;
}
function correlation(P, t, tw, th, x, y) {
  const n = tw * th, sm = P.somme(P.S, x, y, tw, th), sq = P.somme(P.Q, x, y, tw, th);
  const v = sq - (sm * sm) / n;
  if (v < n * 25) return 0; // zone presque unie : pas un logo
  let dot = 0;
  for (let j = 0; j < th; j++) { const o = (y + j) * P.L + x, ot = j * tw; for (let i = 0; i < tw; i++) dot += t[ot + i] * P.img[o + i]; }
  return dot / Math.sqrt(v);
}
/**
 * Cherche le logo À L'INTÉRIEUR d'une grande image (page scannée), en haut et en bas, à plusieurs tailles :
 * recherche rapide en petit, puis vérification fine en grand autour des meilleurs endroits.
 * Renvoie { score, x, y, w, h } en fractions de l'image (0 à 1), ou null.
 */
async function chercherDansScan(px, mods) {
  const P = await preparer(px, 300);
  const bandes = [[0, Math.round(P.H * 0.24)], [Math.round(P.H * 0.84), P.H]];
  const candidats = [];
  for (const m of mods) {
    if (!m.gris) continue;
    for (const frac of [0.18, 0.23, 0.28, 0.34, 0.41, 0.5]) {
      const tw = Math.round(P.L * frac), th = Math.max(6, Math.round(tw / m.ratio));
      const t = await modeleA(m, tw, th); if (!t) continue;
      for (const [y0, y1] of bandes) for (let y = y0; y + th <= y1; y += 2) for (let x = 0; x + tw <= P.L; x += 2) {
        const score = correlation(P, t, tw, th, x, y);
        if (score > 0.45) candidats.push({ score, m, x: x / P.L, y: y / P.H, w: tw / P.L, h: th / P.H });
      }
    }
  }
  if (!candidats.length) return null;
  candidats.sort((a, b) => b.score - a.score);
  // Vérification fine (image 2,5 fois plus grande) sur les 4 meilleurs endroits
  const G = await preparer(px, Math.min(750, Math.max(300, px.w)));
  let best = null;
  for (const c of candidats.slice(0, 4)) {
    for (const k of [0.9, 0.95, 1, 1.05, 1.1]) {
      const tw = Math.round(c.w * G.L * k), th = Math.max(8, Math.round(tw / c.m.ratio));
      const t = await modeleA(c.m, tw, th); if (!t) continue;
      const cx = Math.round(c.x * G.L - (tw - c.w * G.L) / 2), cy = Math.round(c.y * G.H - (th - c.h * G.H) / 2);
      for (let y = Math.max(0, cy - 8); y <= Math.min(G.H - th, cy + 8); y++) for (let x = Math.max(0, cx - 8); x <= Math.min(G.L - tw, cx + 8); x++) {
        const score = correlation(G, t, tw, th, x, y);
        if (!best || score > best.score) best = { score, x: x / G.L, y: y / G.H, w: tw / G.L, h: th / G.H };
      }
    }
  }
  return best;
}

/** Assemble plusieurs images voisines (logo découpé en tranches) en une seule image en gris */
async function assembler(morceaux) {
  const X = Math.min(...morceaux.map((m) => m.b.x)), Y = Math.min(...morceaux.map((m) => m.b.y));
  const X2 = Math.max(...morceaux.map((m) => m.b.x + m.b.w)), Y2 = Math.max(...morceaux.map((m) => m.b.y + m.b.h));
  const e = Math.min(4, 1200 / Math.max(1, X2 - X));
  const W = Math.max(1, Math.round((X2 - X) * e)), H = Math.max(1, Math.round((Y2 - Y) * e));
  const couches = [];
  for (const m of morceaux) {
    const w = Math.max(1, Math.round(m.b.w * e)), h = Math.max(1, Math.round(m.b.h * e));
    const img = await sharp(Buffer.from(m.px.data), { raw: { width: m.px.w, height: m.px.h, channels: 1 } }).resize(w, h, { fit: "fill" }).png().toBuffer();
    couches.push({ input: img, left: Math.round((m.b.x - X) * e), top: Math.round((Y2 - m.b.y - m.b.h) * e) });
  }
  const r = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(couches).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { data: r.data, w: r.info.width, h: r.info.height };
}
const proches = (a, b, marge) => a.x <= b.x + b.w + marge && b.x <= a.x + a.w + marge && a.y <= b.y + b.h + marge && b.y <= a.y + a.h + marge;

/**
 * Emplacements du logo du site dans le document : on compare chaque image (et chaque groupe d'images collées,
 * au cas où le logo est découpé en tranches) avec les modèles. Les autres images (logo d'école, titres…) ne sont pas touchées.
 */
async function trouverLogos(doc) {
  const mods = await modeles();
  const trouves = [];
  if (!mods.length) return trouves;
  const ctx = doc.context;
  const cache = new Map(); // objet image -> { px, sig }
  const lire = async (obj) => {
    if (!cache.has(obj)) {
      let px = await pixelsGris(ctx, obj);
      // On garde une version réduite (peu de mémoire, même pour les gros PDF)
      if (px && px.w > 600) {
        const h = Math.max(1, Math.round((px.h * 600) / px.w));
        px = { data: await sharp(Buffer.from(px.data), { raw: { width: px.w, height: px.h, channels: 1 } }).resize(600, h, { fit: "fill" }).toColourspace("b-w").raw().toBuffer(), w: 600, h };
      }
      cache.set(obj, { px, sig: px ? await signatureVisuelle(px) : null });
    }
    return cache.get(obj);
  };
  const pages = doc.getPages();
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const { width: W, height: H } = page.getSize();
    const imgs = [];
    try { imagesDessinees(ctx, contenuPage(ctx, page), page.node.Resources(), [1, 0, 0, 1, 0, 0], imgs); } catch {}
    const cands = [];
    for (const im of imgs) {
      const b = cadre(im.ctm);
      if ((b.w > W * 0.85 || b.h > H * 0.2) && b.w > W * 0.5 && b.h > H * 0.4 && (p === 0 || p === pages.length - 1)) {
        // Page scannée : le logo peut être DANS l'image (1re et dernière page seulement)
        const l = await lire(im.obj);
        if (!l.px) continue;
        const r = await chercherDansScan(l.px, mods);
        if (process.env.DEBUG_LOGO) console.log(`   p${p + 1} page scannée : ressemblance ${r ? r.score.toFixed(2) : "-"}`);
        if (r && r.score >= SEUIL_SCAN) {
          const x = b.x + r.x * b.w, w = r.w * b.w, h = r.h * b.h, y = b.y + b.h - (r.y + r.h) * b.h;
          const marge = Math.min(w, h) * 0.12;
          trouves.push({ page: p, x: x - marge, y: y - marge, w: w + 2 * marge, h: h + 2 * marge, logo: true, fond: await couleurFond(im.obj, r, l.px) });
        }
        continue;
      }
      if (b.w < 8 || b.h < 3 || b.w > W * 0.85 || b.h > H * 0.2) continue; // pas une page scannée ni une grande figure
      if (b.y > H * 0.3 && b.y + b.h < H * 0.7) continue; // un logo de site est en haut ou en bas de page
      const l = await lire(im.obj);
      if (!l.px) continue;
      cands.push({ b, ...l });
    }
    const pris = new Set();
    // 1) une image qui ressemble au logo
    if (process.env.DEBUG_LOGO) for (const c of cands) console.log(`   p${p + 1} image ${Math.round(c.b.w)}x${Math.round(c.b.h)} ressemblance ${meilleur(c.sig, mods).toFixed(2)}`);
    for (const c of cands) if (meilleur(c.sig, mods) >= SEUIL_LOGO) { trouves.push({ page: p, ...c.b, logo: true }); pris.add(c); }
    // 2) un groupe d'images collées qui, ensemble, ressemblent au logo
    const restes = cands.filter((c) => !pris.has(c));
    const vus = new Set();
    for (const c of restes) {
      if (vus.has(c)) continue;
      const groupe = [c]; vus.add(c);
      for (let i = 0; i < groupe.length; i++) for (const d of restes) if (!vus.has(d) && proches(groupe[i].b, d.b, 2)) { vus.add(d); groupe.push(d); }
      if (groupe.length < 2 || groupe.length > 40) continue;
      const sig = await signatureVisuelle(await assembler(groupe));
      if (meilleur(sig, mods) >= SEUIL_LOGO) {
        const x = Math.min(...groupe.map((g) => g.b.x)), y = Math.min(...groupe.map((g) => g.b.y));
        trouves.push({ page: p, x, y, w: Math.max(...groupe.map((g) => g.b.x + g.b.w)) - x, h: Math.max(...groupe.map((g) => g.b.y + g.b.h)) - y, logo: true });
      }
    }
  }
  return trouves;
}

/** Couleur du papier tout AUTOUR du logo (page scannée jaunie, grise…) : le cache se fond dans la page */
async function couleurFond(obj, r, px) {
  const bandes = (w, h) => {
    const x0 = Math.round(r.x * w), y0 = Math.round(r.y * h), x1 = Math.round((r.x + r.w) * w), y1 = Math.round((r.y + r.h) * h);
    const e = Math.max(2, Math.round(0.012 * h));
    return [[x0, y0 - e, x1 - x0, e], [x0, y1, x1 - x0, e], [x0 - e, y0, e, y1 - y0], [x1, y0, e, y1 - y0]]
      .map(([x, y, bw, bh]) => { const l = Math.max(0, Math.min(w - 1, x)), t = Math.max(0, Math.min(h - 1, y)); return { left: l, top: t, width: Math.max(1, Math.min(w - l, bw)), height: Math.max(1, Math.min(h - t, bh)) }; });
  };
  const mediane = (v) => { const a = [...v].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] ?? 255; };
  try {
    const filtres = nomFiltre(obj.dict);
    if (filtres.length === 1 && filtres[0] === "/DCTDecode") {
      const src = Buffer.from(obj.contents);
      const { width: w, height: h } = await sharp(src).metadata();
      const R = [], G = [], B = [];
      for (const z of bandes(w, h)) {
        const { data, info } = await sharp(src).extract(z).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
        for (let i = 0; i + 2 < data.length; i += info.channels) { R.push(data[i]); G.push(data[i + 1]); B.push(data[i + 2]); }
      }
      return [mediane(R) / 255, mediane(G) / 255, mediane(B) / 255];
    }
    if (px) {
      const v = [];
      for (const z of bandes(px.w, px.h)) for (let y = z.top; y < z.top + z.height; y++) for (let x = z.left; x < z.left + z.width; x++) v.push(px.data[y * px.w + x]);
      const g = mediane(v) / 255;
      return [g, g, g];
    }
  } catch {}
  return null;
}

/** Compatibilité : n'est plus utilisé (l'ancienne reconnaissance « même image dans plusieurs documents » se trompait) */
export async function empreintesImages() { return []; }

/** Dessine le logo unidev dans le cadre (carré vert « u » + « unidev » + adresse si la place le permet) */
function dessinerLogo(page, b, gras, { adresse = true } = {}) {
  const vert = rgb(0.12, 0.62, 0.33), fonce = rgb(0.06, 0.24, 0.18);
  const avecAdresse = adresse && b.h >= 26;
  const cote = Math.min(avecAdresse ? b.h * 0.55 : b.h * 0.85, b.w * 0.22, 40);
  let taille = cote * 0.95;
  const largeur = (t) => cote + cote * 0.3 + gras.widthOfTextAtSize("unidev", t);
  while (taille > 5 && largeur(taille) > b.w * 0.95) taille -= 0.5;
  const total = largeur(taille);
  const ts = Math.max(5, Math.min(cote * 0.38, 10));
  const hauteur = cote + (avecAdresse ? ts * 1.5 : 0);
  const x0 = b.x + (b.w - total) / 2;
  const y0 = b.y + (b.h - hauteur) / 2 + (avecAdresse ? ts * 1.5 : 0);
  page.drawRectangle({ x: x0, y: y0, width: cote, height: cote, color: vert });
  const tu = cote * 0.8;
  page.drawText("u", { x: x0 + (cote - gras.widthOfTextAtSize("u", tu)) / 2, y: y0 + cote * 0.22, size: tu, font: gras, color: rgb(1, 1, 1) });
  page.drawText("unidev", { x: x0 + cote * 1.3, y: y0 + cote * 0.18, size: taille, font: gras, color: fonce });
  if (avecAdresse) {
    let t = ts; while (t > 4 && gras.widthOfTextAtSize(TEXTE, t) > b.w * 0.95) t -= 0.5;
    page.drawText(TEXTE, { x: b.x + (b.w - gras.widthOfTextAtSize(TEXTE, t)) / 2, y: y0 - t * 1.35, size: t, font: gras, color: vert });
  }
}

/** Réunit les zones qui se touchent ou se chevauchent (un seul remplacement par endroit) */
function fusionner(zones, marge = 8) {
  const parPage = new Map();
  for (const z of zones) { if (!parPage.has(z.page)) parPage.set(z.page, []); parPage.get(z.page).push({ ...z }); }
  const sortie = [];
  for (const liste of parPage.values()) {
    let change = true;
    while (change) {
      change = false;
      for (let i = 0; i < liste.length && !change; i++) for (let j = i + 1; j < liste.length; j++) {
        const a = liste[i], b = liste[j];
        if (!proches(a, b, a.mot || b.mot ? 0 : marge)) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        liste[i] = { page: a.page, x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, logo: a.logo || b.logo, mot: a.mot && b.mot, fond: a.fond || b.fond };
        liste.splice(j, 1); change = true; break;
      }
    }
    sortie.push(...liste);
  }
  return sortie;
}

/**
 * motifs : liste de mots à repérer, ex. ["fomesoutra", "fo me soutra"]
 * Renvoie { buffer, lignes, liens, ignores, logos } (buffer inchangé si rien trouvé).
 */
export async function remplacerSignature(buffer, motifs, options = {}) {
  const echap = (m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s._-]*");
  // Slogans qui accompagnent le nom du site (ex. Fomesoutra : « ça soutra ! », « Docs à portée de main »)
  const extras = motifs.some((m) => /soutra/i.test(m)) ? ["ça soutra", "ca soutra", "docs à portée de main", "docs a portee de main"] : [];
  const re = new RegExp([...motifs, ...extras].map(echap).join("|"), "i");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let lecture;
  try {
    lecture = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  } catch { return { buffer, lignes: 0, liens: 0, ignores: 0, logos: 0 }; }

  // 1. Lignes de texte qui contiennent la signature
  const mesure = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const zones = []; // { page, x, y, w, h, logo? } — rectangle à recouvrir (repère de la page)
  let ignores = 0, lignes = 0;
  for (let p = 1; p <= lecture.numPages; p++) {
    const page = await lecture.getPage(p);
    const { items } = await page.getTextContent();
    page.cleanup();
    const parLigne = new Map(); // ordonnée arrondie -> éléments horizontaux
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const [a, b] = it.transform;
      if (Math.abs(b) > 0.01 || a <= 0) { if (re.test(it.str)) ignores++; continue; } // texte penché : on n'y touche pas
      const y = Math.round(it.transform[5]);
      if (!parLigne.has(y)) parLigne.set(y, []);
      parLigne.get(y).push(it);
    }
    for (const elts of parLigne.values()) {
      elts.sort((u, v) => u.transform[4] - v.transform[4]);
      const texte = elts.map((e) => e.str).join("");
      if (!re.test(texte) && !re.test(elts.map((e) => e.str).join(" "))) continue;
      // Ligne courte (signature, en-tête, pied de page) : remplacée entièrement.
      // Ligne longue (phrase du cours) : seulement les morceaux qui contiennent la signature.
      if (texte.length <= 90) {
        const x = Math.min(...elts.map((e) => e.transform[4]));
        const fin = Math.max(...elts.map((e) => e.transform[4] + e.width));
        const h = Math.max(...elts.map((e) => e.height || Math.abs(e.transform[3]) || 10));
        const y = elts[0].transform[5];
        zones.push({ page: p - 1, x: x - 1, y: y - h * 0.3, w: fin - x + 2, h: h * 1.35 });
        lignes++;
        continue;
      }
      // Phrase longue : on ne couvre QUE le mot de la signature (ex. « www.fomesoutra.com »), le reste du cours reste lisible
      const mot = new RegExp(`(?:https?://)?(?:www\\.)?(?:${re.source})(?:\\.[a-z]{2,4})?(?:/\\S*)?`, "gi");
      let trouve = false;
      for (const e of elts) {
        const n = e.str.length || 1, h = e.height || Math.abs(e.transform[3]) || 10;
        // Position du mot dans le morceau de texte : estimée avec les largeurs de lettres d'Helvetica
        const larg = (t) => { try { return mesure.widthOfTextAtSize(t, 10); } catch { return t.length * 5; } };
        const total = larg(e.str) || 1, lettre = e.width / n;
        for (const m of e.str.matchAll(mot)) {
          const x = e.transform[4] + (e.width * larg(e.str.slice(0, m.index))) / total - lettre * 0.4;
          const w = (e.width * larg(m[0])) / total + lettre * 0.8;
          zones.push({ page: p - 1, x: x - 1, y: e.transform[5] - h * 0.3, w: w + 2, h: h * 1.35, mot: true });
          trouve = true;
        }
      }
      if (trouve) lignes++; else ignores++;
    }
  }

  try { await lecture.destroy(); } catch {} // libère la mémoire (sinon elle s'accumule document après document)

  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const police = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const ctx = doc.context;

  // Pages scannées avec texte invisible (reconnaissance de caractères) : ce texte ne se voit pas,
  // le recouvrir ferait apparaître un rectangle et un logo au milieu de la page. On n'y touche pas.
  const scannees = pages.map((page) => {
    const contenu = contenuPage(ctx, page);
    if (!/(^|[\s\]])3\s+Tr\b/.test(contenu)) return [];
    const imgs = [];
    try { imagesDessinees(ctx, contenu, page.node.Resources(), [1, 0, 0, 1, 0, 0], imgs); } catch {}
    const { width: W, height: H } = page.getSize();
    return imgs.map((im) => cadre(im.ctm)).filter((b) => b.w > W * 0.5 && b.h > H * 0.4);
  });
  const dedans = (z, b) => z.x >= b.x - 2 && z.y >= b.y - 2 && z.x + z.w <= b.x + b.w + 2 && z.y + z.h <= b.y + b.h + 2;
  for (let i = zones.length - 1; i >= 0; i--) {
    if (scannees[zones[i].page]?.some((b) => dedans(zones[i], b))) { zones.splice(i, 1); lignes--; ignores++; }
  }

  // 2. Logo du site en image (reconnu à son aspect, même découpé en plusieurs morceaux)
  const logosTrouves = await trouverLogos(doc);
  zones.push(...logosTrouves);

  // 3. Annotations : liens -> unidev ; tampons / cadres contenant la signature ou le logo -> retirés et remplacés
  let liens = 0, tampons = 0;
  const mods = await modeles();
  for (const [p, page] of pages.entries()) {
    const annots = page.node.Annots?.();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const action = a.lookup(PDFName.of("A"));
      const uri = action?.lookup?.(PDFName.of("URI"));
      const valeur = uri?.decodeText?.() ?? uri?.asString?.() ?? "";
      if (valeur && re.test(valeur)) { action.set(PDFName.of("URI"), PDFString.of(SITE)); liens++; }
      if (a.get(PDFName.of("Subtype"))?.toString() === "/Link") continue;
      // Apparence de l'annotation : texte et images
      let marque = false;
      const txt = a.lookup(PDFName.of("Contents"));
      if (re.test(txt?.decodeText?.() ?? "")) marque = true;
      const ap = a.lookup(PDFName.of("AP"), PDFDict)?.get(PDFName.of("N"));
      const apObj = ap ? ctx.lookup(ap) : null;
      if (!marque && apObj instanceof PDFRawStream && mods.length) {
        const contenu = texteDuFlux(ctx, ap);
        if (re.test(contenu)) marque = true;
        const imgs = [];
        try { imagesDessinees(ctx, contenu, apObj.dict.lookup(PDFName.of("Resources"), PDFDict), [1, 0, 0, 1, 0, 0], imgs); } catch {}
        for (const im of imgs) {
          if (marque) break;
          const px = await pixelsGris(ctx, im.obj);
          if (px && meilleur(await signatureVisuelle(px), mods) >= SEUIL_LOGO) marque = true;
        }
      }
      if (!marque) continue;
      const r = a.lookup(PDFName.of("Rect"));
      const v = r instanceof PDFArray ? r.asArray().map((x) => x.asNumber?.() ?? 0) : null;
      annots.remove(i);
      tampons++;
      if (v) zones.push({ page: p, x: Math.min(v[0], v[2]), y: Math.min(v[1], v[3]), w: Math.abs(v[2] - v[0]), h: Math.abs(v[3] - v[1]), logo: true });
    }
  }

  if (!zones.length && !liens && !tampons) return { buffer, lignes: 0, liens: 0, ignores, logos: 0 };

  // 4. UN SEUL remplacement par endroit : les zones qui se touchent (morceaux d'un même en-tête, logo + adresse…)
  //    sont réunies, recouvertes d'un fond blanc, puis on dessine une seule fois la marque unidev.
  // Le contenu d'origine peut laisser derrière lui un état « piégé » (texte invisible des PDF scannés,
  // repère déplacé…) : on l'enferme entre q … Q pour que notre dessin s'affiche toujours.
  const isolees = new Set();
  const isoler = (page) => {
    if (isolees.has(page)) return;
    isolees.add(page);
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
  const vert = rgb(0.12, 0.62, 0.33);
  for (const z0 of fusionner(zones)) {
    const page = pages[z0.page];
    const { width: W, height: H } = page.getSize();
    // On reste dans la page (un logo peut dépasser du bord)
    const x = Math.max(0, z0.x), y = Math.max(0, z0.y);
    const z = { ...z0, x, y, w: Math.min(W, z0.x + z0.w) - x, h: Math.min(H, z0.y + z0.h) - y };
    if (z.w < 4 || z.h < 3) continue;
    isoler(page);
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Fill));
    // Fond : couleur du papier pour une page scannée, blanc sinon
    page.drawRectangle({ x: z.x - 1, y: z.y - 1, width: z.w + 2, height: z.h + 2, color: z.fond ? rgb(...z.fond) : rgb(1, 1, 1) });
    if (!z.mot && (z.logo || z.h >= 18) && z.w >= 50) dessinerLogo(page, z, police, { adresse: !z.fond });
    else {
      let taille = Math.max(5, Math.min(z.h * 0.75, 14));
      while (taille > 3 && police.widthOfTextAtSize(TEXTE, taille) > (z.mot ? z.w : Math.max(z.w, 60))) taille -= 0.5;
      page.drawText(TEXTE, { x: z.x + Math.max(0, (z.w - police.widthOfTextAtSize(TEXTE, taille)) / 2), y: z.y + (z.h - taille) / 2 + taille * 0.18, size: taille, font: police, color: vert });
    }
    page.pushOperators(popGraphicsState());
  }

  const sortie = Buffer.from(await doc.save());
  return { buffer: sortie, lignes: Math.max(0, lignes), liens, ignores, logos: logosTrouves.length + tampons };
}

/* ======================================================================
 * Tampon unidev sur TOUS les documents : petite pastille en bas à droite de chaque page
 * ([u] unidev · unidev-2026.web.app), cliquable vers le site. Posée une seule fois par fichier.
 * ==================================================================== */
const MARQUEUR = "UnidevTampon";

/** Matrice qui place l'origine en bas à gauche de la page TELLE QU'ON LA VOIT (pages tournées comprises) */
function repereVisible(page) {
  const b = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  if (rot === 90) return { m: [0, 1, -1, 0, b.x + b.width, b.y], W: b.height, H: b.width };
  if (rot === 180) return { m: [-1, 0, 0, -1, b.x + b.width, b.y + b.height], W: b.width, H: b.height };
  if (rot === 270) return { m: [0, -1, 1, 0, b.x, b.y + b.height], W: b.height, H: b.width };
  return { m: [1, 0, 0, 1, b.x, b.y], W: b.width, H: b.height };
}
const appliquer = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export async function tamponUnidev(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) return { buffer, pages: 0, impossible: "PDF protégé" };
  const info = doc.getInfoDict();
  if (info.get(PDFName.of(MARQUEUR))) return { buffer, pages: 0, deja: true };
  const ctx = doc.context;
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const vert = rgb(0.12, 0.62, 0.33), fonce = rgb(0.06, 0.24, 0.18);
  const pages = doc.getPages();
  for (const page of pages) {
    // Le contenu d'origine est enfermé entre q … Q : notre dessin s'affiche toujours au bon endroit
    const debut = ctx.register(ctx.stream("q\n")), fin = ctx.register(ctx.stream("\nQ\n"));
    const actuel = page.node.get(PDFName.of("Contents"));
    const resolu = actuel ? ctx.lookup(actuel) : null;
    const liste = ctx.obj([]);
    liste.push(debut);
    if (resolu instanceof PDFArray) for (let i = 0; i < resolu.size(); i++) liste.push(resolu.get(i));
    else if (actuel) liste.push(actuel);
    liste.push(fin);
    page.node.set(PDFName.of("Contents"), liste);

    const { m, W, H } = repereVisible(page);
    // Taille proportionnée à la page (A4 ≈ 595 pt de large)
    const k = Math.max(0.7, Math.min(1.6, Math.min(W, H) / 595));
    const t = 7 * k, cote = 10 * k, pad = 4 * k;
    const mot1 = "unidev", mot2 = "unidev-2026.web.app";
    const l1 = gras.widthOfTextAtSize(mot1, t * 1.1), l2 = normal.widthOfTextAtSize(mot2, t);
    const largeur = pad + cote + 4 * k + l1 + 5 * k + l2 + pad, hauteur = cote + 2 * pad - 2 * k;
    const x = W - largeur - 12 * k, y = 8 * k;

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), setTextRenderingMode(TextRenderingMode.Fill));
    // Pas de cadre blanc : le logo se pose directement sur la page, quelle que soit la couleur du papier
    const yc = y + (hauteur - cote) / 2;
    page.drawRectangle({ x: x + pad, y: yc, width: cote, height: cote, color: vert });
    page.drawText("u", { x: x + pad + (cote - gras.widthOfTextAtSize("u", cote * 0.85)) / 2, y: yc + cote * 0.2, size: cote * 0.85, font: gras, color: rgb(1, 1, 1) });
    page.drawText(mot1, { x: x + pad + cote + 4 * k, y: yc + cote * 0.22, size: t * 1.1, font: gras, color: fonce });
    page.drawText(mot2, { x: x + pad + cote + 4 * k + l1 + 5 * k, y: yc + cote * 0.24, size: t, font: normal, color: vert });
    page.pushOperators(popGraphicsState());

    // Lien cliquable vers unidev
    const coins = [[x, y], [x + largeur, y], [x, y + hauteur], [x + largeur, y + hauteur]].map(([a, b]) => appliquer(m, a, b));
    const xs = coins.map((c) => c[0]), ys = coins.map((c) => c[1]);
    const lien = ctx.register(ctx.obj({
      Type: "Annot", Subtype: "Link", Border: [0, 0, 0],
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      A: { Type: "Action", S: "URI", URI: PDFString.of(SITE) },
    }));
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) annots.push(lien);
    else page.node.set(PDFName.of("Annots"), ctx.obj([lien]));
  }
  info.set(PDFName.of(MARQUEUR), PDFString.of("1"));
  return { buffer: Buffer.from(await doc.save()), pages: pages.length };
}

/** Vrai si la licence interdit toute modification (CC BY-ND) : on ne tamponne pas ces documents */
export const sansModification = (description = "") => /\bBY[- ]?ND\b|NoDeriv|pas de modification/i.test(String(description));

/**
 * Retire tout ce que unidev a dessiné sur un PDF (anciens remplacements ratés, tampon) pour retrouver le document
 * tel qu'il était : nos dessins sont toujours ajoutés APRÈS le contenu d'origine, enfermé entre « q » et « Q ».
 * Sert quand le fichier d'origine n'est plus téléchargeable : on répare à partir du fichier abîmé.
 * Renvoie { buffer, pages } (pages = nombre de pages nettoyées ; buffer inchangé si rien à retirer).
 */
export async function annulerAnciennesMarques(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  const texte = (r) => texteDuFlux(ctx, r).trim();
  let pages = 0;
  for (const page of doc.getPages()) {
    const c = page.node.get(PDFName.of("Contents"));
    const arr = c ? ctx.lookup(c) : null;
    if (!(arr instanceof PDFArray)) continue;
    let refs = arr.asArray(), touche = false;
    // a) versions récentes : [q] … contenu d'origine … [Q] puis nos dessins
    let n = 0;
    while (n < refs.length && texte(refs[n]) === "q") n++;
    if (n) {
      let fin = -1;
      for (let j = n; j < refs.length; j++) if (texte(refs[j]) === "Q") { fin = j; break; }
      if (fin > n) { refs = refs.slice(n, fin); touche = true; }
    }
    // b) toutes premières versions (sans q/Q) : nos dessins sont les derniers blocs, écrits avec la police
    //    « Helvetica-…-1234567890 » de l'outil ou contenant le mot « unidev » ; jamais d'image dedans
    const notreDessin = (t) => !/\sDo\b/.test(t) && (/\/Helvetica(?:-Bold)?-\d{6,}\s/.test(t) || /<756e69646576/i.test(t));
    while (refs.length > 1 && notreDessin(texteDuFlux(ctx, refs[refs.length - 1]))) { refs = refs.slice(0, -1); touche = true; }
    if (!touche) continue;
    page.node.set(PDFName.of("Contents"), ctx.obj(refs));
    pages++;
  }
  if (!pages) return { buffer, pages: 0 };
  // Le marqueur du tampon est retiré : le tampon sera reposé proprement
  doc.getInfoDict().delete(PDFName.of(MARQUEUR));
  return { buffer: Buffer.from(await doc.save()), pages };
}
