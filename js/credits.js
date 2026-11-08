import { listMyPaiements, getCredits, renvoyerVerification } from "./firebase.js";
import { initLayout, esc, formatDate, setNavCredits, toast } from "./ui.js";
import { paymentConfig } from "./config.js";

const $ = (id) => document.getElementById(id);
const { prixPack, creditsParPack } = paymentConfig;
const STATUS = { en_attente: "En attente", immediat: "Crédits reçus", confirme: "Confirmé", rejete: "Refusé" };
let me = null;
let profile = null;

initLayout("credits", async (state) => {
  me = state.user; profile = state.profile;
  const prof = $("cr-profile");
  if (prof && me) { prof.title = me.email || "Mon compte"; prof.href = "credits.html"; }
  if (!me) {
    $("gate").innerHTML = `<p style="margin-bottom:14px">Connecte-toi pour voir tes crédits.</p>
      <a class="btn" href="connexion.html?next=credits.html">Se connecter</a>`;
    $("gate").classList.remove("hidden");
    $("zone").classList.add("hidden");
    return;
  }
  $("gate").classList.add("hidden");
  $("zone").classList.remove("hidden");
  const attente = !!profile?.bonusEnAttente;
  $("verif").classList.toggle("hidden", !attente);
  if (attente) $("verif-texte").textContent = `Un lien a été envoyé à ${me.email}. Pense à regarder dans les spams.`;
  refresh();
});

async function refresh() {
  const solde = await getCredits(me.uid).catch(() => profile?.credits || 0);
  $("solde").textContent = solde;
  setNavCredits(solde);
  $("buy").classList.toggle("buy-empty", solde < 1);
  $("buy-hint").textContent = solde < 1
    ? `Tu n'as plus de crédits. ${creditsParPack} crédits pour ${prixPack} FCFA.`
    : `${creditsParPack} crédits pour ${prixPack} FCFA.`;

  $("history").innerHTML = `<div class="loader"></div>`;
  try {
    const list = await listMyPaiements(me.uid);
    $("history").innerHTML = list.length
      ? `<div class="pay-list">${list.map((p) => `
          <button type="button" class="pay-row" aria-expanded="false">
            <span class="pay-op"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg><b>${esc(String(p.operateur || "").split(" ")[0].toUpperCase())}</b></span>
            <span class="pay-info">
              <strong>${p.montant} FCFA</strong>
              <span class="pay-sub">${p.credits} crédits · ${esc(p.operateur)}</span>
              <span class="pay-ref">Réf. ${esc(p.reference)} · ${formatDate(p.createdAt)}</span>
              <span class="pay-more">Numéro utilisé : ${esc(p.numero || "—")} · ${p.packs} pack(s)</span>
            </span>
            <span class="status status-${p.statut}">${p.statut === "confirme" ? `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : ""}${STATUS[p.statut] || p.statut}</span>
            <span class="pay-chev"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
          </button>`).join("")}</div>`
      : `<div class="cr-empty"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3H14l5 5v3"/><path d="M14 3v5h5M8 9h3M8 12.5h5M8 16h3"/><circle cx="17.5" cy="17.5" r="4"/><path d="M17.5 15.5v2l1.4 1"/></svg><p>Aucun paiement déclaré.</p></div>`;
  } catch {
    $("history").innerHTML = `<p class="muted">Impossible de charger l'historique.</p>`;
  }
}

$("verif-renvoyer").onclick = async (e) => {
  e.target.disabled = true;
  try { await renvoyerVerification(); toast("E-mail de confirmation renvoyé."); }
  catch (err) { toast(err.code === "auth/too-many-requests" ? "Trop de demandes : réessaie dans quelques minutes." : err.message, "err"); }
  e.target.disabled = false;
};
$("verif-ok").onclick = () => location.reload();

// Détails d'un paiement : un appui sur la ligne les affiche
document.getElementById("history").addEventListener("click", (e) => {
  const row = e.target.closest(".pay-row");
  if (row) row.setAttribute("aria-expanded", row.getAttribute("aria-expanded") === "true" ? "false" : "true");
});
