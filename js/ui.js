import { watchUser, logout, cachedProfile } from "./firebase.js";
import { thumb, assembleParts, lienSur, recupererFichier } from "./cloudinary.js";

export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} Mo`;
}

export function formatDate(ts) {
  if (!ts?.seconds) return "";
  return new Date(ts.seconds * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function toast(msg, type = "ok") {
  let box = document.querySelector(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.append(box); }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), 4000);
}

export const fillSelect = (sel, values, first) =>
  (sel.innerHTML = (first ? `<option value="">${first}</option>` : "") +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(""));

export function setNavCredits(n) {
  const el = document.getElementById("nav-credits");
  if (el) el.textContent = n === null || n === undefined ? "" : n;
}

/** Fenêtre modale simple. Renvoie l'élément ; un clic sur [data-close] ou le fond la ferme. */
export function modal(html) {
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="modal-box">${html}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.dataset.close !== undefined) el.remove(); });
  document.body.append(el);
  return el;
}

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  docs: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  publier: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>'),
  credits: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10a2.5 2 0 0 1 2.5-2h.5a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h.5a2.5 2 0 0 0 2.5-2"/>'),
  admin: svg('<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  emploi: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17.5h2"/>'),
  compte: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
};

/** En-tête commun + suivi de session. onUser({user, profile}) appelé à chaque changement. */
export function initLayout(active, onUser = () => {}) {
  // L'en-tête, la barre du bas et le pied de page sont écrits dans chaque page HTML
  // (affichage instantané) ; on ne les crée ici que s'ils manquent.
  let header = document.querySelector(".topbar");
  if (!header) {
    header = document.createElement("header");
    header.className = "topbar";
    header.innerHTML = `<div class="wrap topbar-in"><a href="index.html" class="logo"><span class="logo-mark">u</span>unidev</a><div id="header-tools" class="header-tools"></div></div>`;
    document.body.prepend(header);
  }
  let nav = document.querySelector(".bottomnav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "bottomnav";
    nav.innerHTML = `
      <a href="index.html" data-k="docs">${ICONS.docs}<span>Documents</span></a>
      <a href="publier.html" data-k="publier">${ICONS.publier}<span>Publier</span></a>
      <a href="emploi.html" data-k="emploi">${ICONS.emploi}<span>Planning</span></a>
      <a href="credits.html" data-k="credits">${ICONS.credits}<span>Crédits</span><span class="pill" id="nav-credits"></span></a>
      <a href="admin.html" data-k="admin" class="hidden" id="nav-admin">${ICONS.admin}<span>Modération</span></a>
      <span id="nav-user"></span>`;
    document.body.append(nav);
    nav.querySelector(`[data-k="${active}"]`)?.classList.add("active");
  }
  if (!document.querySelector(".footer")) {
    const footer = document.createElement("footer");
    footer.className = "footer";
    footer.innerHTML = `<div class="wrap">©UNIDEV ASSOCIATION 2026</div>`;
    document.body.insertBefore(footer, nav);
  }

  // Affichage immédiat avec le profil de la dernière visite, corrigé dès que Firebase répond
  const memo = cachedProfile();
  if (memo) {
    nav.querySelector("#nav-admin").classList.toggle("hidden", !memo.isAdmin);
    setNavCredits(memo.credits);
    nav.querySelector("#nav-user").innerHTML = `<button id="btn-logout">${ICONS.compte}<span>Déconnexion</span></button>`;
  }

  watchUser((state) => {
    const slot = nav.querySelector("#nav-user");
    nav.querySelector("#nav-admin").classList.toggle("hidden", !state.profile?.isAdmin);
    setNavCredits(state.user ? state.profile?.credits || 0 : null);
    if (state.user) {
      slot.innerHTML = `<button id="btn-logout">${ICONS.compte}<span>Déconnexion</span></button>`;
      slot.querySelector("#btn-logout").onclick = async () => { await logout(); location.href = "index.html"; };
    } else {
      slot.innerHTML = `<a href="connexion.html" class="${active === "" ? "active" : ""}">${ICONS.compte}<span>Connexion</span></a>`;
    }
    onUser(state);
  });
}

const fichesCartes = new Map(); // id → document, pour la fenêtre « Voir plus »

export function docCard(d, actions = "", { prix = "" } = {}) {
  fichesCartes.set(d.id, d);
  const meta = [d.filiere, d.niveau, d.annee].filter(Boolean).map(esc).join(" · ");
  return `
    <article class="card" data-id="${d.id}">
      <div class="card-img">${d.imageUrl
        ? `<img src="${esc(thumb(d.imageUrl))}" alt="${esc(d.titre)}" loading="lazy" decoding="async" width="400" height="300"
             data-full="${esc(fullImage(d.imageUrl))}" role="button" tabindex="0" title="Voir l'image" />`
        : `<span>${esc((d.format || "doc").toUpperCase())}</span>`}
        ${d.format ? `<span class="img-format">${esc(d.format.toUpperCase())}</span>` : ""}</div>
      <p class="card-cat">${esc(d.filiere || d.type || "Document")}</p>
      <div class="card-top">
        <span class="badge b-type">${esc(d.type || "Document")}</span>
        <span class="badge b-fil">${esc(d.filiere || d.type || "Document")}</span>
        <span class="ext">${esc((d.format || "").toUpperCase())}</span>
      </div>
      <h3>${esc(d.titre)}</h3>
      <p class="subject">${esc(d.matiere || "")}<span class="sub-type">${d.type ? " · " + esc(d.type) : ""}</span></p>
      <div class="card-rows">
        <p class="row-ic"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg><span>${[d.niveau, d.annee].filter(Boolean).map(esc).join(" · ") || "—"}</span></p>
        <p class="row-ic row-split"><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>${formatSize(d.taille)}</span><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>${d.telechargements || 0} téléchargement${(d.telechargements || 0) > 1 ? "s" : ""}</span></p>
      </div>
      <p class="meta">${meta}</p>
      ${d.universite ? `<p class="meta">${esc(d.universite)}</p>` : ""}
      ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ""}
      <button type="button" class="voir-plus" data-voir="${d.id}">Voir plus</button>
      ${prix ? `<p class="card-prix">${esc(prix)}</p>` : ""}
      <p class="card-pills">${d.niveau ? `<span class="pill-ok">${esc(d.niveau)}</span>` : ""}${d.type ? `<span class="pill-alt">${esc(d.type)}</span>` : ""}</p>
      <div class="card-foot">
        <span class="muted">${formatSize(d.taille)} · ${d.telechargements || 0} téléch.</span>
        ${actions}
      </div>
    </article>`;
}

/* ---------- Application installable (PWA) ---------- */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {}));
  // Nouvelle version installée : on recharge une fois pour l'afficher tout de suite
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let recharge = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!avaitUneVersion || recharge) return;
    recharge = true;
    location.reload();
  });
}

const INSTALL_KEY = "unidev-install-masque";
const estInstallee = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const estIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
let promptInstall = null;

function masqueRecemment() {
  try { return Date.now() - Number(localStorage.getItem(INSTALL_KEY) || 0) < 7 * 864e5; } catch { return false; }
}

function proposerInstallation() {
  if (estInstallee() || masqueRecemment() || document.querySelector(".install")) return;
  const box = document.createElement("div");
  box.className = "install";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Installer unidev");
  box.innerHTML = `
    <img src="icons/icon-192.png" alt="" width="44" height="44" />
    <div class="install-text">
      <strong>Installer unidev</strong>
      <span>${estIOS && !promptInstall
        ? "Touche le bouton Partager, puis « Sur l'écran d'accueil »."
        : "Ouvre le site comme une appli, depuis ton écran d'accueil."}</span>
    </div>
    <div class="install-actions">
      ${promptInstall ? `<button class="btn btn-sm" data-i="ok">Installer</button>` : ""}
      <button class="install-close" data-i="non" aria-label="Plus tard">&times;</button>
    </div>`;
  box.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-i]")?.dataset.i;
    if (!a) return;
    if (a === "ok" && promptInstall) {
      promptInstall.prompt();
      await promptInstall.userChoice.catch(() => {});
      promptInstall = null;
    } else {
      try { localStorage.setItem(INSTALL_KEY, String(Date.now())); } catch {}
    }
    box.remove();
  });
  document.body.append(box);
}

// Android, Chrome, Edge : le navigateur signale que l'installation est possible
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promptInstall = e;
  document.querySelector(".install")?.remove();
  setTimeout(proposerInstallation, 1500);
});
addEventListener("appinstalled", () => {
  document.querySelector(".install")?.remove();
  toast("unidev est installé sur ton appareil.");
});
// iPhone / iPad : pas d'installation automatique, on affiche la marche à suivre
if (estIOS) setTimeout(proposerInstallation, 2500);

/* ---------- Ouverture d'un document (simple ou en plusieurs morceaux) ---------- */
const TYPES_MIME = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip", txt: "text/plain" };

/**
 * Affiche la fenêtre qui permet d'ouvrir ou de télécharger le document.
 * info = { fileUrl, parts } (getFileInfo) ; d = fiche du document (titre, nomFichier, format)
 */
/** Enregistre un fichier sur l'appareil (dossier Téléchargements du téléphone) */
export function enregistrer(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = String(nom || "document").replace(/[\\/:*?"<>|]+/g, " ").trim() || "document";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
export const typeMime = (ext) => TYPES_MIME[String(ext || "").toLowerCase()] || "application/octet-stream";
export const nomFichier = (d) => {
  const ext = (d.format || "pdf").toLowerCase();
  const base = d.nomFichier || d.titre || "document";
  return new RegExp(`\\.${ext}$`, "i").test(base) ? base : `${base}.${ext}`;
};

export function fileModal(d, info, { texte = "", bouton = "Ouvrir le document", apres = "" } = {}) {
  const morceaux = info.parts?.length > 1 ? info.parts.map((p) => p.url) : null;
  // Fichier unique : stocké en « raw » (envoi depuis le site) ou en « image » (PDF importés en masse)
  if (!(morceaux ? morceaux.every((u) => lienSur(u)) : (lienSur(info.fileUrl) || lienSur(info.fileUrl, "image")))) {
    toast("Ce fichier ne vient pas d'unidev : ouverture bloquée.", "err");
    return null;
  }
  const m = modal(`<h3>${esc(d.titre)}</h3>
    ${texte ? `<p class="muted" style="margin:6px 0 18px">${texte}</p>` : `<div style="height:14px"></div>`}
    ${morceaux
      ? `<button class="btn btn-block" id="dl-assemble">Télécharger le document</button>
         <div class="progress hidden" id="dl-progress"><div></div></div>
         <p class="muted" id="dl-etat" style="margin-top:8px;text-align:center"></p>`
      : `<a class="btn btn-block btn-lg" href="lire.html?doc=${encodeURIComponent(d.id)}">${bouton}</a>
         <button class="btn btn-ghost-ink btn-block" id="dl-direct" style="margin-top:8px">Télécharger sur mon téléphone</button>
         <div class="progress hidden" id="dl-progress"><div></div></div>
         <p class="muted" id="dl-etat" style="margin-top:8px;text-align:center"></p>`}
    ${morceaux ? `<a class="btn btn-ghost-ink btn-block" href="lire.html?doc=${encodeURIComponent(d.id)}" style="margin-top:8px">Lire sans télécharger</a>` : ""}
    ${apres}`);
  if (!morceaux) {
    // Téléchargement direct : le fichier est enregistré sur le téléphone (pas seulement ouvert)
    m.querySelector("#dl-direct").onclick = async (e) => {
      const btn = e.currentTarget, bar = m.querySelector("#dl-progress"), etat = m.querySelector("#dl-etat");
      btn.disabled = true; bar.classList.remove("hidden"); etat.textContent = "Téléchargement…";
      try {
        const blob = await recupererFichier(info, { type: typeMime(d.format), taille: d.taille, onProgress: (p) => (bar.firstElementChild.style.width = p + "%") });
        enregistrer(blob, nomFichier(d));
        etat.textContent = "Document enregistré dans tes téléchargements.";
        btn.textContent = "Télécharger à nouveau";
      } catch (err) {
        etat.textContent = `Interrompu (${err.message}). Réessaie.`;
        btn.textContent = "Réessayer";
      }
      btn.disabled = false;
    };
    return m;
  }

  m.querySelector("#dl-assemble").onclick = async (e) => {
    const btn = e.currentTarget;
    const bar = m.querySelector("#dl-progress");
    const etat = m.querySelector("#dl-etat");
    btn.disabled = true;
    bar.classList.remove("hidden");
    etat.textContent = `Téléchargement de ${morceaux.length} morceaux…`;
    try {
      const ext = (d.format || "").toLowerCase();
      const blob = await assembleParts(morceaux, (p) => (bar.firstElementChild.style.width = p + "%"), TYPES_MIME[ext], (t) => (etat.textContent = t));
      enregistrer(blob, nomFichier(d));
      etat.textContent = "Document téléchargé.";
      btn.textContent = "Télécharger à nouveau";
    } catch (err) {
      console.error(err);
      // Les morceaux déjà reçus sont gardés : « Reprendre » continue là où ça s'est arrêté
      etat.textContent = `Interrompu (${err.message}). Les morceaux déjà reçus sont gardés.`;
      btn.textContent = "Reprendre le téléchargement";
      toast("Connexion coupée pendant le téléchargement. Appuie sur « Reprendre ».", "err");
    }
    btn.disabled = false;
  };
  return m;
}

/* ---------- Voir l'image d'un document en grand ---------- */
function fullImage(url) {
  return url ? url.replace("/image/upload/", "/image/upload/c_limit,w_1600,h_1600,q_auto,f_auto/") : "";
}
function openImage(img) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", img.alt || "Image du document");
  box.innerHTML = `
    <button class="lightbox-close" aria-label="Fermer">&times;</button>
    <div class="lightbox-loader loader"></div>
    <img alt="${esc(img.alt || "")}" />
    ${img.alt ? `<p class="lightbox-title">${esc(img.alt)}</p>` : ""}`;
  const big = box.querySelector("img");
  big.onload = () => box.classList.add("ready");
  big.onerror = () => { big.src = img.src; box.classList.add("ready"); };
  big.src = img.dataset.full || img.src;
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  box.addEventListener("click", (e) => { if (e.target !== big) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(box);
  box.querySelector(".lightbox-close").focus();
}
document.addEventListener("click", (e) => {
  const img = e.target.closest?.(".card-img img[data-full]");
  if (img) { e.preventDefault(); openImage(img); }
});
document.addEventListener("keydown", (e) => {
  const img = e.target.closest?.(".card-img img[data-full]");
  if (img && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openImage(img); }
});

/* Message laissé par une page précédente (ex. après une inscription) */
try {
  const msg = sessionStorage.getItem("unidev-message");
  if (msg) { sessionStorage.removeItem("unidev-message"); setTimeout(() => toast(msg), 600); }
} catch {}

/* ---------- « Voir plus » : fiche détaillée d'un document ---------- */
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-voir]");
  if (!b) return;
  const d = fichesCartes.get(b.dataset.voir);
  if (!d) return;
  const ligne = (k, v) => (v ? `<div class="fiche-l"><span>${k}</span><b>${esc(v)}</b></div>` : "");
  const btn = document.querySelector(`[data-dl="${CSS.escape(d.id)}"]`);
  const m = modal(`
    ${d.imageUrl ? `<img class="fiche-img" src="${esc(thumb(d.imageUrl, 800, 450))}" alt="" />` : ""}
    <p class="card-cat" style="margin:12px 0 2px">${esc(d.filiere || d.type || "")}</p>
    <h3>${esc(d.titre)}</h3>
    ${d.description ? `<p class="fiche-desc">${esc(d.description)}</p>` : ""}
    <div class="fiche">
      ${ligne("Matière", d.matiere)}${ligne("Type", d.type)}${ligne("Niveau", d.niveau)}${ligne("Année", d.annee)}
      ${ligne("Université / école", d.universite)}${ligne("Format", (d.format || "").toUpperCase())}
      ${ligne("Taille", d.taille ? formatSize(d.taille) : "")}${ligne("Téléchargements", String(d.telechargements || 0))}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost-ink" data-close>Fermer</button>
      ${btn ? `<button class="btn" id="fiche-dl">${esc(btn.textContent.trim())}</button>` : ""}
    </div>`);
  m.querySelector("#fiche-dl")?.addEventListener("click", () => { m.remove(); btn.click(); });
});
