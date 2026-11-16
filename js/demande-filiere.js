// « Ma filière n'est pas là » : l'étudiant indique sa filière, l'admin est prévenu.
import { demanderFiliere, filieresPretes } from "./firebase.js";
import { CATEGORIES } from "./config.js";
import { canonFiliere, toutesLesFilieres, verifierFiliere } from "./filieres.js";
import { modal, toast, esc } from "./ui.js";

export function ouvrirDemandeFiliere(texte = "") {
  const m = modal(`
    <h3>Ta filière n'est pas sur unidev ?</h3>
    <p class="muted" style="margin:6px 0 14px">Dis-nous laquelle : on cherchera des documents pour elle en priorité.</p>
    <form id="df-form" autocomplete="off">
      <div class="field"><label for="df-filiere">Ta filière *</label>
        <input id="df-filiere" required minlength="2" maxlength="80" list="df-liste" placeholder="Ex : Génie civil" value="${esc(texte)}" />
        <datalist id="df-liste"></datalist>
        <p class="muted df-info" id="df-info"></p></div>
      <div class="field"><label for="df-niveau">Ton niveau</label>
        <select id="df-niveau"><option value="">Choisir…</option>${CATEGORIES.niveaux.filter((n) => n !== "Autre").map((n) => `<option>${esc(n)}</option>`).join("")}</select></div>
      <div class="field"><label for="df-univ">Ton école ou université</label>
        <input id="df-univ" maxlength="100" placeholder="Ex : ESATIC, INP-HB…" /></div>
      <div class="field"><label for="df-doc">Un document précis que tu cherches ? (facultatif)</label>
        <input id="df-doc" maxlength="120" placeholder="Ex : Sujet BTS 2023 de comptabilité générale" /></div>
      <div class="field"><label for="df-contact">WhatsApp ou e-mail (facultatif)</label>
        <input id="df-contact" maxlength="120" placeholder="Pour te prévenir quand ce sera en ligne" /></div>
      <button class="btn btn-block" id="df-ok">Envoyer</button>
      <button type="button" class="btn btn-ghost-ink btn-block" data-close style="margin-top:8px">Annuler</button>
    </form>`);
  const $ = (id) => m.querySelector(`#${id}`);
  filieresPretes.then(() => { $("df-liste").innerHTML = toutesLesFilieres().map((f) => `<option value="${esc(f)}">`).join(""); }).catch(() => {});
  $("df-filiere").addEventListener("input", () => {
    const v = $("df-filiere").value.trim(), c = canonFiliere(v);
    $("df-info").textContent = c && toutesLesFilieres().includes(c) ? `Déjà connue sous le nom « ${c} » : envoie quand même, on saura qu'elle manque de documents.` : "";
  });
  setTimeout(() => $("df-filiere").focus(), 50);
  $("df-form").onsubmit = async (e) => {
    e.preventDefault();
    const filiere = $("df-filiere").value.replace(/\s+/g, " ").trim();
    const fil = verifierFiliere(filiere);
    if (!fil.ok) return toast(fil.message, "err");
    const btn = $("df-ok");
    btn.disabled = true; btn.textContent = "Envoi…";
    try {
      await demanderFiliere({
        filiere: fil.nom,
        niveau: $("df-niveau").value,
        universite: $("df-univ").value.trim(),
        contact: $("df-contact").value.trim(),
        document: $("df-doc").value.replace(/\s+/g, " ").trim(),
      });
      m.remove();
      toast("Merci ! Ta filière a bien été envoyée.");
    } catch (err) {
      toast("Envoi impossible pour le moment. Réessaie plus tard.", "err");
      btn.disabled = false; btn.textContent = "Envoyer";
    }
  };
}
