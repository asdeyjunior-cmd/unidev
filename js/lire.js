// Lecteur de document : affiche le PDF dans le site, avec un gros bouton « Télécharger » toujours visible.
// Le fichier n'est téléchargé qu'une fois : le même fichier sert à l'affichage et à l'enregistrement.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, getDocument, getFileInfo } from "./firebase.js";
import { recupererFichier } from "./cloudinary.js";
import { enregistrer, typeMime, nomFichier, toast, formatSize, esc, blocSerie } from "./ui.js";
import { serieDe } from "./series.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("doc") || "";
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";

// Retour : la page d'avant si elle est sur unidev, sinon la liste des documents
$("retour").addEventListener("click", (e) => {
  if (history.length > 1 && document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); }
});

function message(html, { chargement = false } = {}) {
  $("etat").hidden = false;
  $("etat").querySelector(".loader").hidden = !chargement;
  $("barre").hidden = !chargement;
  $("etat-texte").innerHTML = html;
}

async function demarrer() {
  if (!id) return message(`Document introuvable. <a href="index.html">Retour aux documents</a>`);
  const user = await new Promise((ok) => { const fin = onAuthStateChanged(auth, (u) => { fin(); ok(u); }); });
  if (!user) { location.href = `connexion.html?next=${encodeURIComponent(`lire.html?doc=${id}`)}`; return; }

  let d, info;
  try {
    [d, info] = await Promise.all([getDocument(id), getFileInfo(id)]);
  } catch (e) {
    const refuse = /permission|insufficient/i.test(e.code + e.message);
    return message(refuse
      ? `Ce document n'est pas encore débloqué sur ton compte.<br><a class="btn" style="margin-top:14px" href="index.html?doc=${encodeURIComponent(id)}">Le débloquer</a>`
      : `Impossible d'ouvrir le document (${esc(e.message)}).<br><a href="index.html">Retour aux documents</a>`);
  }
  if (!d || !info) return message(`Document introuvable. <a href="index.html">Retour aux documents</a>`);

  document.title = `${d.titre} — unidev`;
  $("titre").textContent = d.titre;
  const ext = (d.format || "pdf").toLowerCase();
  const taille = d.taille ? ` · ${formatSize(d.taille)}` : "";
  $("dl-texte").textContent = `Télécharger${taille}`;

  // Série : précédent / suivant (« Partie 2 sur 4 »)
  serieDe(d).then((s) => {
    if (!s) return;
    const lien = (x) => `lire.html?doc=${encodeURIComponent(x.id)}`;
    $("serie").innerHTML = blocSerie(s, lien);
    $("serie").hidden = false;
  }).catch(() => {});

  // 1. Récupérer le fichier (une seule fois)
  message("Chargement du document…", { chargement: true });
  let blob;
  try {
    blob = await recupererFichier(info, {
      type: typeMime(ext), taille: d.taille,
      onProgress: (p) => { $("barre").firstElementChild.style.width = `${p}%`; },
      onEtat: (t) => { $("etat-texte").textContent = t; },
    });
  } catch (e) {
    return message(`La connexion a coupé pendant le chargement.<br><button class="btn" style="margin-top:14px" onclick="location.reload()">Réessayer</button>`);
  }

  // 2. Le gros bouton enregistre le fichier sur le téléphone
  const bouton = $("telecharger");
  bouton.disabled = false;
  bouton.onclick = () => {
    enregistrer(blob, nomFichier(d));
    toast("Document enregistré dans tes téléchargements.");
  };

  // 3. Affichage (PDF seulement)
  if (ext !== "pdf") {
    return message(`<b>Fichier ${esc(ext.toUpperCase())}</b><br>Ce format ne s'affiche pas ici. Appuie sur <b>Télécharger</b> pour l'enregistrer et l'ouvrir sur ton téléphone.`);
  }
  try {
    await afficherPdf(blob);
  } catch (e) {
    console.error(e);
    message(`L'aperçu n'est pas disponible pour ce fichier. Appuie sur <b>Télécharger</b> pour l'ouvrir sur ton téléphone.`);
  }
}

async function afficherPdf(blob) {
  $("etat-texte").textContent = "Préparation de l'affichage…";
  const pdfjs = await import(`${PDFJS}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const n = pdf.numPages;
  const premiere = await pdf.getPage(1);
  const v1 = premiere.getViewport({ scale: 1 });
  const zone = $("feuilles");

  // Une feuille par page, à la bonne proportion ; le contenu n'est dessiné que près de l'écran
  const feuilles = [];
  for (let i = 1; i <= n; i++) {
    const f = document.createElement("div");
    f.className = "feuille";
    f.dataset.page = i;
    f.style.aspectRatio = `${v1.width} / ${v1.height}`;
    zone.append(f);
    feuilles.push(f);
  }
  $("etat").hidden = true;
  $("pages").textContent = `${n} page${n > 1 ? "s" : ""}`;

  const enCours = new Map(); // page -> tâche de dessin
  async function dessiner(f) {
    const i = Number(f.dataset.page);
    if (f.querySelector("canvas") || enCours.has(i)) return;
    const page = i === 1 ? premiere : await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    f.style.aspectRatio = `${base.width} / ${base.height}`;
    const qualite = Math.min(window.devicePixelRatio || 1, 2);
    const vue = page.getViewport({ scale: (f.clientWidth * qualite) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vue.width);
    canvas.height = Math.floor(vue.height);
    const tache = page.render({ canvasContext: canvas.getContext("2d"), viewport: vue });
    enCours.set(i, tache);
    try { await tache.promise; f.append(canvas); } catch {} finally { enCours.delete(i); }
  }
  function effacer(f) {
    const i = Number(f.dataset.page);
    enCours.get(i)?.cancel();
    const c = f.querySelector("canvas");
    if (c) { c.width = 0; c.height = 0; c.remove(); } // libère la mémoire (longs documents sur téléphone)
  }
  const proche = new IntersectionObserver((entrees) => {
    for (const e of entrees) (e.isIntersecting ? dessiner : effacer)(e.target);
  }, { rootMargin: "1200px 0px" });
  // Numéro de la page affichée
  const courante = new IntersectionObserver((entrees) => {
    for (const e of entrees) if (e.isIntersecting) $("pages").textContent = `Page ${e.target.dataset.page} / ${n}`;
  }, { rootMargin: "-45% 0px -45% 0px" });
  feuilles.forEach((f) => { proche.observe(f); courante.observe(f); });
}

demarrer();
