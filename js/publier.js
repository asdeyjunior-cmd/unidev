import { createDocument, listMine, getSearchIndex, filieresPretes } from "./firebase.js";
import { toutesLesFilieres, canonFiliere } from "./filieres.js";
import { uploadFile, uploadDocument } from "./cloudinary.js";
import { photosEnPdf, photoLegere } from "./photos-pdf.js";
import { initLayout, docCard, fillSelect, toast, esc } from "./ui.js";
import { CATEGORIES, MAX_FILE_MB, ALLOWED_EXT, CREDITS_PAR_PUBLICATION, MAX_IMAGE_MB, IMAGE_EXT } from "./config.js";

const $ = (id) => document.getElementById(id);
const STATUS = { publie: "Publié", en_attente: "En attente", rejete: "Refusé" };
let me = null;
let profile = null;
let file = null;
let cover = null;
let photos = [];       // pages prises en photo (transformées en PDF à l'envoi)
let coverAuto = false; // vrai si l'image de couverture est la 1re photo

fillSelect($("type"), CATEGORIES.types, "Choisir…");
fillSelect($("niveau"), CATEGORIES.niveaux, "Choisir…");
$("drop-hint").textContent = `${ALLOWED_EXT.join(", ").toUpperCase()} — ${MAX_FILE_MB} Mo max`;

initLayout("publier", async (state) => {
  me = state.user; profile = state.profile;
  if (!me) {
    $("gate").innerHTML = `<p style="margin-bottom:14px">Connecte-toi pour publier un document. Chaque document validé te rapporte ${CREDITS_PAR_PUBLICATION} crédit de téléchargement.</p>
      <a class="btn" href="connexion.html?next=publier.html">Se connecter</a>`;
    $("form").classList.add("hidden");
    $("mine-wrap").classList.add("hidden");
    return;
  }
  $("gate").classList.add("hidden");
  $("form").classList.remove("hidden");
  loadMine();
  const remplirFilieres = (autres = []) => {
    const f = [...new Set([...toutesLesFilieres().filter((x) => x !== "Autre"), ...autres])].sort((a, b) => a.localeCompare(b, "fr"));
    $("filieres").innerHTML = f.map((v) => `<option value="${esc(v)}">`).join("");
  };
  remplirFilieres();
  filieresPretes.then(() => remplirFilieres());
  getSearchIndex().then((docs) => { remplirFilieres(docs.map((d) => d.filiere).filter(Boolean)); remplirSuites(docs); }).catch(() => {});
});

/* ---------- « C'est la suite de… » : le document précédent, choisi dans la liste ---------- */
const suites = new Map(); // titre affiché -> id
function remplirSuites(docs) {
  for (const d of docs) if (d.titre && !suites.has(d.titre)) suites.set(d.titre, d.id);
  $("suites").innerHTML = [...suites.keys()].sort((a, b) => a.localeCompare(b, "fr")).map((t) => `<option value="${esc(t)}">`).join("");
}
function suiteChoisie() {
  const v = $("suite").value.trim();
  if (!v) return { ok: true, id: "" };
  return suites.has(v) ? { ok: true, id: suites.get(v) } : { ok: false };
}
$("suite").addEventListener("input", () => {
  const r = suiteChoisie();
  $("suite-info").textContent = !$("suite").value.trim() ? "" : r.ok ? "Ton document sera affiché juste après celui-ci." : "Choisis le document dans la liste proposée.";
});

async function loadMine() {
  $("mine-wrap").classList.remove("hidden");
  $("mine").innerHTML = `<div class="loader"></div>`;
  try {
    const docs = await listMine(me.uid);
    remplirSuites(docs);
    $("mine").innerHTML = docs.length
      ? docs.map((d) => docCard(d, `<span class="status status-${d.statut}">${STATUS[d.statut] || d.statut}</span>`)).join("")
      : `<div class="empty">Tu n'as encore rien publié.</div>`;
  } catch (e) {
    $("mine").innerHTML = `<div class="empty">Impossible de charger tes publications.</div>`;
  }
}

/* ---------- Choix du fichier ---------- */
function pick(f) {
  if (!f) return;
  const ext = f.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return toast(`Format .${ext} non accepté.`, "err");
  if (f.size > MAX_FILE_MB * 1048576) return toast(`Fichier trop lourd (max ${MAX_FILE_MB} Mo).`, "err");
  file = f;
  if (photos.length) { photos = []; afficherPhotos(); }
  $("drop-label").textContent = `Fichier : ${f.name}`;
  if (!$("titre").value) $("titre").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

const drop = $("drop");
drop.onclick = () => $("file").click();
$("file").onchange = (e) => pick(e.target.files[0]);
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); };

/* ---------- Image de couverture ---------- */
function pickCover(f) {
  if (!f) return;
  const ext = f.name.split(".").pop().toLowerCase();
  if (!IMAGE_EXT.includes(ext)) return toast("L'image doit être en JPG, PNG ou WEBP.", "err");
  if (f.size > MAX_IMAGE_MB * 1048576) return toast(`Image trop lourde (max ${MAX_IMAGE_MB} Mo).`, "err");
  cover = f; coverAuto = false;
  const img = document.createElement("img");
  img.alt = "Aperçu";
  img.src = URL.createObjectURL(f);
  $("cover-preview").replaceChildren(img);
  $("cover-btn").textContent = "Changer l'image";
}
$("cover-btn").onclick = () => $("cover").click();
$("cover-preview").onclick = () => $("cover").click();
$("cover").onchange = (e) => pickCover(e.target.files[0]);

/* ---------- Photos des pages -> PDF ---------- */
function afficherPhotos() {
  const zone = $("photos-liste");
  zone.classList.toggle("hidden", !photos.length);
  zone.innerHTML = photos.map((f, i) => `
    <figure class="photo-page" data-i="${i}">
      <img src="${f._url || (f._url = URL.createObjectURL(f))}" alt="Page ${i + 1}" />
      <figcaption>Page ${i + 1}</figcaption>
      <span class="photo-act">
        <button type="button" data-a="g" ${i === 0 ? "disabled" : ""} aria-label="Avancer">&lsaquo;</button>
        <button type="button" data-a="x" aria-label="Retirer">&times;</button>
        <button type="button" data-a="d" ${i === photos.length - 1 ? "disabled" : ""} aria-label="Reculer">&rsaquo;</button>
      </span>
    </figure>`).join("") + (photos.length ? `<button type="button" class="photo-plus" id="photo-plus">+ Page</button>` : "");
  if (photos.length) {
    file = null;
    $("drop-label").textContent = `${photos.length} page${photos.length > 1 ? "s" : ""} en photo : le PDF sera créé à l'envoi`;
    // La 1re photo sert d'image du document, sauf si tu en as choisi une autre
    if (!cover || coverAuto) {
      cover = photos[0]; coverAuto = true;
      const img = document.createElement("img"); img.alt = "Aperçu"; img.src = photos[0]._url;
      $("cover-preview").replaceChildren(img);
      $("cover-aide").textContent = "La première photo sert d'image. Tu peux en choisir une autre.";
      $("cover-btn").textContent = "Changer l'image";
    }
  } else {
    if (!file) $("drop-label").textContent = "Glisse ton fichier ici ou clique pour choisir";
    if (coverAuto) {
      cover = null; coverAuto = false;
      $("cover-preview").innerHTML = "<span>Aucune image</span>";
      $("cover-btn").textContent = "Choisir une image";
    }
  }
}
function ajouterPhotos(liste) {
  const ok = [...liste].filter((f) => f.type.startsWith("image/"));
  if (ok.length < liste.length) toast("Seules les images sont acceptées ici.", "err");
  if (photos.length + ok.length > 40) return toast("40 pages maximum.", "err");
  photos.push(...ok);
  afficherPhotos();
}
$("photos-btn").onclick = () => $("photos").click();
$("photos").onchange = (e) => { ajouterPhotos(e.target.files); e.target.value = ""; };
$("photos-liste").onclick = (e) => {
  if (e.target.id === "photo-plus") return $("photos").click();
  const a = e.target.dataset.a; if (!a) return;
  const i = +e.target.closest("[data-i]").dataset.i;
  if (a === "x") photos.splice(i, 1);
  if (a === "g" && i > 0) [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
  if (a === "d" && i < photos.length - 1) [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]];
  if (coverAuto) cover = null; // la couverture suit la nouvelle 1re page
  afficherPhotos();
};

/* ---------- Envoi ---------- */
$("form").onsubmit = async (e) => {
  e.preventDefault();
  if (!file && !photos.length) return toast("Choisis un fichier ou prends tes pages en photo.", "err");
  if (!cover) return toast("Ajoute l'image du document.", "err");
  const suite = suiteChoisie();
  if (!suite.ok) return toast("« Suite de » : choisis le document précédent dans la liste, ou laisse vide.", "err");

  const btn = $("submit");
  const bar = $("progress");
  btn.disabled = true; btn.textContent = "Envoi de l'image…";
  bar.classList.remove("hidden");
  const setBar = (p) => (bar.firstElementChild.style.width = p + "%");

  try {
    if (!file && photos.length) {
      btn.textContent = "Création du PDF…";
      file = await photosEnPdf(photos, $("titre").value.trim() || "devoir", (p) => setBar(p * 0.1));
      if (file.size > MAX_FILE_MB * 1048576) throw new Error(`PDF trop lourd (max ${MAX_FILE_MB} Mo). Retire quelques pages.`);
    }
    const image = coverAuto ? await photoLegere(cover) : cover;
    const img = await uploadFile(image, (p) => setBar(10 + p * 0.1), "image");
    btn.textContent = "Envoi du fichier…";
    const up = await uploadDocument(file, (p) => setBar(20 + p * 0.8));
    btn.textContent = "Enregistrement…";
    await createDocument({
      titre: $("titre").value.trim(),
      matiere: $("matiere").value.trim(),
      filiere: canonFiliere($("filiere").value),
      type: $("type").value,
      niveau: $("niveau").value,
      annee: $("annee").value.trim(),
      universite: $("universite").value.trim(),
      description: $("description").value.trim(),
      ...(suite.id ? { suiteDe: suite.id } : {}),
      format: file.name.split(".").pop().toLowerCase(),
      taille: up.bytes || file.size,
      nomFichier: file.name,
      imageUrl: img.url,
      auteurId: me.uid,
      auteurNom: profile?.nom || me.email,
    }, { fileUrl: up.url, publicId: up.publicId, ...(up.parts ? { parts: up.parts } : {}) });
    toast(`Document envoyé. Tu gagneras ${CREDITS_PAR_PUBLICATION} crédit dès sa validation.`);
    $("form").reset(); $("suite-info").textContent = ""; file = null; cover = null; coverAuto = false; photos = []; afficherPhotos();
    $("cover-aide").textContent = "Photo ou capture de la première page. JPG, PNG ou WEBP, 10 Mo max.";
    $("cover-preview").innerHTML = "<span>Aucune image</span>";
    $("cover-btn").textContent = "Choisir une image";
    $("drop-label").textContent = "Glisse ton fichier ici ou clique pour choisir";
    loadMine();
  } catch (err) {
    console.error(err);
    if (photos.length) file = null; // le PDF sera recréé au prochain essai
    toast(err.message, "err");
  } finally {
    btn.disabled = false; btn.textContent = "Envoyer pour validation";
    bar.classList.add("hidden"); bar.firstElementChild.style.width = 0;
  }
};

// La filière tapée est corrigée tout de suite (majuscules, accents, fautes de frappe)
$("filiere").addEventListener("change", () => {
  const v = $("filiere").value, c = canonFiliere(v);
  if (c && c !== v.trim()) { $("filiere").value = c; toast(`Filière enregistrée sous : ${c}`); }
});
