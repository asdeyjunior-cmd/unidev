// Page Opportunités : liste publique (6 à la fois, bouton « Voir plus »), détail débloqué pour 2 crédits.
import { listOpportunites, listOppsDebloquees, getOpportuniteDetail, debloquerOpportunite, getCredits, COUT_OPPORTUNITE } from "./firebase.js";
import { initLayout, esc, toast, modal, setNavCredits } from "./ui.js";
import { lienSur } from "./cloudinary.js";

const $ = (id) => document.getElementById(id);
$("opp-cout").textContent = COUT_OPPORTUNITE;
let me = null, admin = false, credits = 0, debloquees = new Set();
let opps = [], cursor = null, fini = false, charge = false;

const jour = (iso) => { const [a, m, j] = String(iso || "").split("-"); return a && m && j ? `${j}/${m}/${a}` : ""; };
const passee = (o) => o.dateLimite && o.dateLimite < new Date().toISOString().slice(0, 10);
const ouverte = (o) => admin || debloquees.has(o.id);

function carte(o) {
  const infos = [o.organisme, o.lieu].filter(Boolean).map(esc).join(" · ");
  return `<article class="opp${passee(o) ? " opp-passee" : ""}">
    ${/^https:\/\//.test(o.image || "") ? `<img class="opp-img" src="${esc(o.image)}" alt="" loading="lazy" />` : ""}
    <div class="opp-tete"><span class="opp-type">${esc(o.type || "Opportunité")}</span>
      ${o.dateLimite ? `<span class="opp-date">${passee(o) ? "Terminée le" : "Jusqu'au"} ${jour(o.dateLimite)}</span>` : ""}</div>
    <h2 class="opp-titre">${esc(o.titre)}</h2>
    ${infos ? `<p class="opp-infos">${infos}</p>` : ""}
    ${o.apercu ? `<p class="opp-apercu">${esc(o.apercu)}</p>` : ""}
    ${o.nbImages ? `<p class="opp-infos">${o.nbImages} image${o.nbImages > 1 ? "s" : ""} jointe${o.nbImages > 1 ? "s" : ""}</p>` : ""}
    <button type="button" class="btn ${ouverte(o) ? "btn-ghost-ink" : ""}" data-opp="${esc(o.id)}">${ouverte(o) ? "Ouvrir" : `Voir l'opportunité · ${COUT_OPPORTUNITE} crédits`}</button>
  </article>`;
}
function afficher() {
  $("opps").innerHTML = opps.length ? opps.map(carte).join("")
    : charge ? `<div class="loader"></div>` : `<div class="empty">Aucune opportunité pour le moment. Reviens bientôt.</div>`;
  $("opp-plus").classList.toggle("hidden", fini || !opps.length);
}
async function suite() {
  if (charge || fini) return;
  charge = true; $("opp-plus").disabled = true;
  try {
    const p = await listOpportunites(cursor);
    opps.push(...p.items); cursor = p.cursor; fini = p.done;
  } catch (e) {
    fini = true;
    toast(/permission/i.test(e.message + e.code) ? "Les opportunités ne sont pas encore activées." : "Impossible de charger les opportunités. Réessaie plus tard.", "err");
  }
  charge = false; $("opp-plus").disabled = false;
  afficher();
}
$("opp-plus").onclick = suite;

function montrer(o, d) {
  const lien = /^https?:\/\//i.test(d.lien || "") ? d.lien : "";
  modal(`<p class="opp-type" style="display:inline-block">${esc(o.type || "Opportunité")}</p>
    <h3 style="margin-top:8px">${esc(o.titre)}</h3>
    <p class="muted" style="margin:4px 0 12px">${[o.organisme, o.lieu, o.dateLimite ? `jusqu'au ${jour(o.dateLimite)}` : ""].filter(Boolean).map(esc).join(" · ")}</p>
    <div class="opp-texte">${esc(d.description || "").replace(/\n/g, "<br>")}</div>
    ${(d.images || []).filter((u) => /^https:\/\//.test(u)).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="opp-affiche" src="${esc(u)}" alt="Image de l'annonce" loading="lazy" /></a>`).join("")}
    ${(d.images || []).filter((u) => lienSur(u, "image")).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="opp-image" src="${esc(u)}" alt="" loading="lazy" /></a>`).join("")}
    ${d.contact ? `<p style="margin-top:12px"><b>Contact :</b> ${esc(d.contact)}</p>` : ""}
    <div class="modal-actions"><button class="btn btn-ghost-ink" data-close>Fermer</button>
      ${lien ? `<a class="btn" href="${esc(lien)}" target="_blank" rel="noopener">Postuler / voir le site</a>` : ""}</div>`);
}

$("opps").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-opp]");
  if (!b) return;
  const o = opps.find((x) => x.id === b.dataset.opp);
  if (!o) return;
  if (!me) return (location.href = "connexion.html?next=opportunites.html");
  b.disabled = true;
  try {
    if (ouverte(o)) return montrer(o, await getOpportuniteDetail(o.id));
    // Avant de faire payer : si le détail s'ouvre déjà (déjà débloquée), c'est gratuit
    try { const d = await getOpportuniteDetail(o.id); debloquees.add(o.id); afficher(); return montrer(o, d); }
    catch (err) { if (err?.code !== "permission-denied") throw err; }
    if (credits < COUT_OPPORTUNITE) {
      modal(`<h3>Crédits insuffisants</h3>
        <p class="muted" style="margin:8px 0 16px">Il faut ${COUT_OPPORTUNITE} crédits pour ouvrir une opportunité. Tu en as ${credits}.</p>
        <div class="modal-actions"><button class="btn btn-ghost-ink" data-close>Fermer</button><a class="btn" href="acheter.html">Acheter des crédits</a></div>`);
      return;
    }
    const m = modal(`<h3>Ouvrir cette opportunité ?</h3>
      <p class="muted" style="margin:8px 0 16px">${esc(o.titre)}<br>Coût : ${COUT_OPPORTUNITE} crédits (il t'en restera ${credits - COUT_OPPORTUNITE}). Elle restera ouverte sur ton compte.</p>
      <div class="modal-actions"><button class="btn btn-ghost-ink" data-close>Annuler</button><button class="btn" id="opp-ok">Ouvrir</button></div>`);
    m.querySelector("#opp-ok").onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        await debloquerOpportunite(me.uid, o.id);
        credits -= COUT_OPPORTUNITE; setNavCredits(credits); debloquees.add(o.id);
        m.remove(); afficher();
        montrer(o, await getOpportuniteDetail(o.id));
      } catch (err) { toast(err.code === "permission-denied" ? "Déblocage refusé : vérifie tes crédits." : err.message, "err"); ev.currentTarget.disabled = false; }
    };
  } catch (err) { toast(err.message, "err"); }
  finally { b.disabled = false; }
});

initLayout("opportunites", async (state) => {
  me = state.user; admin = !!state.profile?.isAdmin; credits = state.profile?.credits || 0;
  if (me) {
    debloquees = await listOppsDebloquees(me.uid);
    credits = await getCredits(me.uid).catch(() => credits);
  }
  afficher();
});
suite();
