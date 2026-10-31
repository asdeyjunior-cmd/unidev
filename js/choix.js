// Menus de tri et de filtre stylés (remplacent la liste grise du téléphone).
// Le <select> d'origine reste en place (caché) : le reste du site continue de lire et d'écrire sa valeur.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const CHEVRON = '<svg class="choix-chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COCHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const TRI = '<svg class="choix-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let ouvert = null; // menu affiché

function fermer() {
  if (!ouvert) return;
  ouvert.fond.remove();
  ouvert.bouton.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", ouvert.clavier);
  window.removeEventListener("resize", fermer);
  ouvert = null;
}

/**
 * select : le <select> à habiller
 * options : { tous: "Toutes les filières" (texte de l'option vide), icone: "tri" }
 */
export function habiller(select, { tous = "", icone = "" } = {}) {
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "choix";
  bouton.setAttribute("aria-haspopup", "listbox");
  bouton.setAttribute("aria-expanded", "false");
  select.classList.add("choix-natif");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.after(bouton);

  const titre = () => select.options[0]?.value === "" ? select.options[0].text : select.getAttribute("aria-label") || "";
  function maj() {
    const o = select.selectedOptions[0];
    const actif = !!select.value && select.options[0]?.value === "";
    bouton.classList.toggle("on", actif);
    bouton.innerHTML = `${icone === "tri" ? TRI : ""}<span>${esc(o && select.value ? o.dataset.court || o.text : titre())}</span>${CHEVRON}`;
    bouton.setAttribute("aria-label", `${select.getAttribute("aria-label") || titre()} : ${o ? o.text : ""}`);
  }
  // Le site change parfois la valeur par programme (select.value = …) : on suit aussi ces changements
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(select, "value", { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); maj(); } });
  select.addEventListener("change", maj);
  new MutationObserver(maj).observe(select, { childList: true, subtree: true });
  maj();

  bouton.addEventListener("click", () => {
    if (ouvert?.bouton === bouton) return fermer();
    fermer();
    ouvrir();
  });

  function ouvrir() {
    const opts = [...select.options];
    const long = opts.length > 12;
    const fond = document.createElement("div");
    fond.className = "choix-fond";
    fond.innerHTML = `
      <div class="choix-menu" role="listbox" aria-label="${esc(titre())}">
        <div class="choix-tete"><b>${esc(select.getAttribute("aria-label") || titre())}</b><button type="button" class="choix-x" aria-label="Fermer">&times;</button></div>
        ${long ? `<div class="choix-cherche"><input type="search" placeholder="Rechercher…" aria-label="Rechercher" /></div>` : ""}
        <div class="choix-liste">${opts.map((o, i) => {
          const special = o.value.startsWith("__");
          const texte = o.value === "" && i === 0 ? (tous || o.text) : o.text;
          const choisi = o.value === select.value && !(o.value === "" && i !== 0);
          return `<button type="button" role="option" class="choix-opt${special ? " choix-special" : ""}${choisi ? " sel" : ""}" data-i="${i}" aria-selected="${choisi}" data-n="${esc(norm(texte))}">
            <span>${esc(texte)}</span>${special ? PLUS : choisi ? COCHE : ""}</button>`;
        }).join("")}<p class="choix-vide" hidden>Aucune filière ne correspond.</p></div>
      </div>`;
    document.body.append(fond);
    const menu = fond.querySelector(".choix-menu");

    // Grand écran : menu sous le bouton ; téléphone : panneau qui monte du bas
    if (matchMedia("(min-width: 601px)").matches) {
      const r = bouton.getBoundingClientRect();
      menu.style.minWidth = `${Math.max(r.width, 220)}px`;
      const gauche = Math.min(r.left, innerWidth - Math.max(r.width, 220) - 12);
      menu.style.left = `${Math.max(12, gauche)}px`;
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.maxHeight = `${Math.max(200, innerHeight - r.bottom - 24)}px`;
    }
    requestAnimationFrame(() => fond.classList.add("vu"));

    const choisir = (i) => {
      fermer();
      const v = select.options[i]?.value;
      if (v === undefined) return;
      if (v !== select.value || v.startsWith("__")) {
        select.dataset.avant = select.value; // valeur d'avant (une option spéciale peut vouloir y revenir)
        select.value = v;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      bouton.focus();
    };
    fond.addEventListener("click", (e) => {
      if (e.target === fond || e.target.closest(".choix-x")) return fermer();
      const b = e.target.closest(".choix-opt");
      if (b) choisir(Number(b.dataset.i));
    });
    const champ = fond.querySelector(".choix-cherche input");
    champ?.addEventListener("input", () => {
      const q = norm(champ.value.trim());
      let n = 0;
      fond.querySelectorAll(".choix-opt").forEach((b) => {
        const ok = !q || b.classList.contains("choix-special") || b.dataset.n.includes(q);
        b.hidden = !ok; if (ok && !b.classList.contains("choix-special")) n++;
      });
      fond.querySelector(".choix-vide").hidden = n > 0;
    });
    const clavier = (e) => {
      if (e.key === "Escape") { fermer(); bouton.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const vis = [...fond.querySelectorAll(".choix-opt:not([hidden])")];
        const i = vis.indexOf(document.activeElement);
        const j = e.key === "ArrowDown" ? Math.min(vis.length - 1, i + 1) : Math.max(0, i - 1);
        vis[j]?.focus(); e.preventDefault();
      }
    };
    document.addEventListener("keydown", clavier);
    window.addEventListener("resize", fermer);
    bouton.setAttribute("aria-expanded", "true");
    ouvert = { fond, bouton, clavier };
    // Affiche l'option choisie ; le clavier n'apparaît pas tout seul sur téléphone
    fond.querySelector(".choix-opt.sel")?.scrollIntoView({ block: "center" });
    if (champ && matchMedia("(min-width: 601px)").matches) champ.focus();
  }
}
