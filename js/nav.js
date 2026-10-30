// Affiche immédiatement la barre de navigation avec le profil de la dernière visite.
// Firebase la corrige ensuite (js/ui.js) si quelque chose a changé.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem("unidev-profil") || "null");
    if (!p) return;
    var c = document.getElementById("nav-credits");
    var a = document.getElementById("nav-admin");
    var u = document.getElementById("nav-user");
    if (c) c.textContent = p.credits;
    if (a && p.isAdmin) a.classList.remove("hidden");
    if (u) u.innerHTML = '<button id="btn-logout"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Déconnexion</span></button>';
  } catch (e) {}
})();
