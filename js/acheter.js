import { createPaiement, payerAuto } from "./firebase.js";
import { initLayout, fillSelect, toast } from "./ui.js";
import { paymentConfig } from "./config.js";

const $ = (id) => document.getElementById(id);
const { url, prixPack, creditsParPack, operateurs, serveur } = paymentConfig;
let me = null;
let profile = null;

$("pack-desc").textContent = `1 pack = ${creditsParPack} crédits pour ${prixPack} FCFA. 1 crédit = 1 document téléchargé.`;
$("packs").innerHTML = [1, 2, 3, 4, 5, 10]
  .map((n) => `<option value="${n}">${n} pack${n > 1 ? "s" : ""} — ${n * creditsParPack} crédits</option>`).join("");
fillSelect($("operateur"), operateurs, "Choisir…");

const updateAmount = () => ($("montant").textContent = `${Number($("packs").value) * prixPack} FCFA`);
$("packs").onchange = updateAmount;
updateAmount();

if (url.startsWith("http")) $("pay").href = url;
else $("pay").onclick = (e) => { e.preventDefault(); toast("Lien de paiement non configuré (js/config.js).", "err"); };

/* Paiement automatique (Jèko) : un bouton par moyen de paiement ; le paiement manuel reste en secours, replié */
if (serveur) {
  const METHODES = [["wave", "Wave"], ["orange", "Orange Money"], ["mtn", "MTN MoMo"], ["moov", "Moov Money"]];
  $("methodes").innerHTML = METHODES.map(([m, nom]) => `<button type="button" class="btn btn-block pay-m pay-${m}" data-m="${m}">${nom}</button>`).join("");
  $("auto").classList.remove("hidden");
  $("etapes-auto").classList.remove("hidden");
  $("etapes-manuel").classList.add("hidden");
  $("manuel").open = false;
  $("manuel-titre").classList.remove("hidden");
  if (new URLSearchParams(location.search).has("echec")) toast("Le paiement n'a pas abouti. Tu peux réessayer.", "err");
  $("methodes").onclick = async (e) => {
    const b = e.target.closest("[data-m]");
    if (!b || !me) return;
    const tous = [...$("methodes").querySelectorAll("button")];
    tous.forEach((x) => (x.disabled = true));
    const texte = b.textContent; b.textContent = "Ouverture du paiement…";
    try {
      const r = await payerAuto(Number($("packs").value), b.dataset.m);
      location.href = r.url;
    } catch (err) {
      toast(err.message, "err");
      b.textContent = texte; tous.forEach((x) => (x.disabled = false));
      $("manuel").open = true;
    }
  };
}

initLayout("credits", (state) => {
  me = state.user; profile = state.profile;
  if (!me) {
    $("gate").innerHTML = `<p style="margin-bottom:14px">Connecte-toi pour acheter des crédits.</p>
      <a class="btn" href="connexion.html?next=acheter.html">Se connecter</a>`;
    $("gate").classList.remove("hidden");
    $("zone").classList.add("hidden");
    return;
  }
  $("gate").classList.add("hidden");
  $("zone").classList.remove("hidden");
});

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("submit");
  btn.disabled = true;
  try {
    await createPaiement(me, profile, {
      packs: Number($("packs").value),
      operateur: $("operateur").value,
      numero: $("numero").value.trim(),
      reference: $("reference").value.trim(),
    });
    toast("Paiement déclaré. Tes crédits arriveront après vérification.");
    setTimeout(() => (location.href = "credits.html"), 1500);
  } catch (err) {
    toast(err.message, "err");
    btn.disabled = false;
  }
};
