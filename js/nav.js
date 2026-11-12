// Affiche immédiatement la barre de navigation avec le profil de la dernière visite.
// Firebase la corrige ensuite (js/ui.js) si quelque chose a changé.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem("unidev-profil") || "null");
    if (!p) return;
    var c = document.getElementById("nav-credits");
    var a = document.getElementById("nav-admin");
    if (c) c.textContent = p.credits;
    if (a && p.isAdmin) a.classList.remove("hidden");
    var c2 = document.querySelector(".compte-btn span");
    if (c2) c2.textContent = "Compte";
  } catch (e) {}
})();
