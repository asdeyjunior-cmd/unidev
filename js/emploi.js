// Créateur d'emploi du temps (page emploi.html). Tout reste sur l'appareil (localStorage).
import { initLayout, toast, esc } from "./ui.js";

initLayout("emploi");

const $ = (id) => document.getElementById(id);
const K = "unidev-edt";
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const PAL = ["#1f9d55", "#2d9cdb", "#f2994a", "#9b51e0", "#eb5757", "#e2b93b", "#16a085", "#56ccf2", "#bb6bd9", "#e67e22"];
const TP = {
  classique: { nom: "Classique", bg: "#ffffff", fg: "#111111", hb: "T", hf: "#0f3d2e", grid: "#1d2b25", lw: 1.2, ca: "40", rad: 0 },
  moderne: { nom: "Moderne", bg: "#f4faf6", fg: "#0f3d2e", hb: "A", hf: "#ffffff", grid: "#cfe6d8", lw: 1, ca: "55", rad: 8 },
  minimal: { nom: "Minimal", bg: "#ffffff", fg: "#1d2b25", hb: "#ffffff", hf: "A", grid: "#d9ebe1", lw: 1, ca: "30", rad: 0 },
  nuit: { nom: "Nuit", bg: "#0f241b", fg: "#eafff2", hb: "A", hf: "#ffffff", grid: "#2c4a3c", lw: 1, ca: "aa", rad: 6 },
};
const FONTS = { sans: 'Inter, "Segoe UI", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", monospace' };
const SLOTS_TYPES = "07:30-09:00\n09:15-10:45\n11:00-12:30\nPAUSE\n14:00-15:30\n15:45-17:15";

let P = [], cur = 0, HIT = [], ek = null, brush = null, peinture = false, dernier = null, histo = [];
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const fmt = (n) => String((n / 60) | 0).padStart(2, "0") + "H" + String(n % 60).padStart(2, "0");
const hhmm = (n) => String((n / 60) | 0).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
const enMin = (v) => { const m = String(v || "").match(/^(\d{1,2})[:h](\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
const uid = () => Math.random().toString(36).slice(2, 9);

function slotsDepuisTexte(t) {
  const o = [];
  String(t || "").split("\n").forEach((l) => {
    l = l.trim();
    if (!l) return;
    if (/^pause/i.test(l)) return o.push({ pause: 1 });
    const m = l.match(/^(\d{1,2})\s*[h:]\s*(\d{2})\s*[-–à]\s*(\d{1,2})\s*[h:]\s*(\d{2})$/i);
    if (m) o.push({ s: +m[1] * 60 + +m[2], e: +m[3] * 60 + +m[4] });
  });
  return o;
}

const nouveau = () => ({
  id: uid(), name: "Emploi du temps " + (P.length + 1), school: "Nom de l'établissement", filiere: "LICENCE 2 INFORMATIQUE",
  annee: "2026 - 2027", version: "", sign: "LA DIRECTION DES ÉTUDES", days: [0, 1, 2, 3, 4, 5],
  slots: slotsDepuisTexte(SLOTS_TYPES), cells: {}, mats: [], indispo: {},
  tpl: "classique", accent: "#1f9d55", font: "sans", orient: "l", fs: 1.3,
});

/** Accepte aussi les fichiers de l'ancien outil (créneaux en texte) */
function completer(o) {
  const p = Object.assign(nouveau(), o);
  if (typeof p.slots === "string") p.slots = slotsDepuisTexte(p.slots);
  if (!Array.isArray(p.mats)) p.mats = [];
  if (!p.indispo || typeof p.indispo !== "object") p.indispo = {};
  if (!FONTS[p.font]) p.font = "sans";
  if (!TP[p.tpl]) p.tpl = "classique";
  p.fs = +p.fs || 1.3;
  return p;
}

/* ---------- Sauvegarde ---------- */
function charger() {
  try { P = (JSON.parse(localStorage.getItem(K)) || []).map(completer); } catch { P = []; }
  if (!P.length) P = [nouveau()];
  try { cur = Math.min(+localStorage.getItem(K + "-c") || 0, P.length - 1); } catch { cur = 0; }
}
let tSave;
function sauver() {
  clearTimeout(tSave);
  tSave = setTimeout(() => {
    try { localStorage.setItem(K, JSON.stringify(P)); localStorage.setItem(K + "-c", cur); }
    catch { toast("Impossible d'enregistrer sur cet appareil (mémoire pleine ou navigation privée).", "err"); }
  }, 250);
}
const p = () => P[cur];

/* ---------- Annuler ---------- */
function memo() {
  histo.push(JSON.stringify(p()));
  if (histo.length > 60) histo.shift();
  $("undo").disabled = false;
}
function annuler() {
  if (!histo.length) return;
  P[cur] = completer(JSON.parse(histo.pop()));
  $("undo").disabled = !histo.length;
  remplir(false); sauver();
}

/* ---------- Validation des créneaux ---------- */
function erreurSlots(S) {
  const vus = [];
  for (const q of S) {
    if (q.pause) continue;
    if (q.s == null || q.e == null) return "Un créneau n'a pas d'heure.";
    if (q.e <= q.s) return `Le créneau ${hhmm(q.s)}-${hhmm(q.e)} finit avant de commencer.`;
    if (vus.some((v) => q.s < v.e && q.e > v.s)) return `Le créneau ${hhmm(q.s)}-${hhmm(q.e)} chevauche un autre créneau.`;
    vus.push(q);
  }
  return "";
}

/* ---------- Dessin A4 ---------- */
function wrap(x, t, mw) {
  const o = [];
  String(t).split("\n").forEach((par) => {
    let l = "";
    par.split(" ").forEach((w) => { const n = l ? l + " " + w : w; if (x.measureText(n).width > mw && l) { o.push(l); l = w; } else l = n; });
    o.push(l);
  });
  return o;
}

function draw(cv, p, s, opts = {}) {
  const z = +p.fs || 1.3, g = Math.min(z, 1.3), L = p.orient === "l", W = L ? 1123 : 794, H = L ? 794 : 1123;
  cv.width = W * s; cv.height = H * s;
  const x = cv.getContext("2d");
  x.scale(s, s);
  const T = TP[p.tpl] || TP.classique, F = FONTS[p.font] || FONTS.sans, hits = [], m = 28, S = p.slots;
  const A = p.accent || "#1f9d55";
  x.fillStyle = T.bg; x.fillRect(0, 0, W, H);
  // bande de couleur en haut
  x.fillStyle = A; x.fillRect(0, 0, W, 6);
  x.fillStyle = T.fg; x.textBaseline = "middle"; x.textAlign = "center";
  let y = m;
  x.font = "bold " + 24 * z + "px " + F; x.fillText(p.school || "", W / 2, y + 14 * g); y += 44 * g;
  x.textAlign = "left"; x.font = "bold " + 14 * z + "px " + F; x.fillText("FILIÈRE : " + (p.filiere || ""), m, y); y += 24 * g;
  x.fillText("ANNÉE ACADÉMIQUE : " + (p.annee || ""), m, y);
  x.textAlign = "right"; x.fillText(p.version ? "VERSION DU : " + p.version : "", W - m, y); y += 24 * g;

  const tw = Math.min(112 * Math.min(z, 1.5), W * 0.18), D = p.days.slice().sort((a, b) => a - b), nd = D.length || 1,
    dw = (W - 2 * m - tw) / nd, wt = S.map((q) => (q.pause ? 0.4 : 1)), sum = wt.reduce((a, b) => a + b, 0) || 1,
    hh = Math.round(32 * g), bot = H - m - 26 * g, u = (bot - y - hh) / sum,
    hb = T.hb === "A" ? A : T.hb === "T" ? A + "30" : T.hb, hf = T.hf === "A" ? A : T.hf;
  x.lineWidth = T.lw; x.strokeStyle = T.grid;
  const box = (a, b, w, h, f) => {
    const gg = T.rad ? 2.5 : 0;
    x.beginPath();
    if (T.rad && x.roundRect) x.roundRect(a + gg, b + gg, w - 2 * gg, h - 2 * gg, T.rad); else x.rect(a + gg, b + gg, w - 2 * gg, h - 2 * gg);
    if (f) { x.fillStyle = f; x.fill(); }
    x.stroke();
  };
  const ct = (t, a, b, w, h, f, st) => { x.fillStyle = f; x.textAlign = "center"; x.font = st + " " + 14 * z + "px " + F; x.fillText(t, a + w / 2, b + h / 2); };
  box(m, y, tw, hh, hb); ct("HORAIRES", m, y, tw, hh, hf, "bold");
  D.forEach((d, i) => { box(m + tw + i * dw, y, dw, hh, hb); ct(DAYS[d].toUpperCase(), m + tw + i * dw, y, dw, hh, hf, "bold"); });

  const cov = new Set();
  Object.keys(p.cells).forEach((k) => { const c = p.cells[k]; if (c.span > 1) { const [d, r] = k.split("|").map(Number); for (let i = 1; i < c.span; i++) cov.add(d + "|" + (r + i)); } });
  let yy = y + hh;
  S.forEach((q, r) => {
    const h = wt[r] * u;
    if (q.pause) { box(m, yy, W - 2 * m, h, null); ct("P   A   U   S   E", m, yy, W - 2 * m, h, T.fg, "bold"); }
    else {
      box(m, yy, tw, h, null);
      x.fillStyle = T.fg; x.textAlign = "center";
      const tl = q.s != null && q.e != null ? fmt(q.s) + "-" + fmt(q.e) : "--";
      let tf = 12 * z; x.font = "bold " + tf + "px " + F;
      while (x.measureText(tl).width > tw - 6 && tf > 7) { tf--; x.font = "bold " + tf + "px " + F; }
      x.fillText(tl, m + tw / 2, yy + h / 2);
      D.forEach((d, i) => {
        const k = d + "|" + r, c = p.cells[k], cx = m + tw + i * dw;
        if (cov.has(k)) return;
        const sp = c && c.span > 1 ? Math.min(c.span, S.length - r) : 1;
        let ch = 0; for (let j = 0; j < sp; j++) ch += wt[r + j] * u;
        let f = null;
        if (c && c.t) f = (c.c || PAL[0]) + T.ca;
        if (c && c.type === "x") f = "#88888822";
        box(cx, yy, dw, ch, f);
        hits.push({ k, x: cx, y: yy, w: dw, h: ch });
        if (opts.survol === k) { x.save(); x.strokeStyle = A; x.lineWidth = 3; x.strokeRect(cx + 2, yy + 2, dw - 4, ch - 4); x.restore(); }
        if (c && c.type === "x") {
          x.save(); x.beginPath(); x.rect(cx + 1, yy + 1, dw - 2, ch - 2); x.clip();
          x.strokeStyle = "#8885"; x.lineWidth = 1;
          for (let zz = -ch; zz < dw; zz += 9) { x.beginPath(); x.moveTo(cx + zz, yy + ch); x.lineTo(cx + zz + ch, yy); x.stroke(); }
          x.restore(); x.lineWidth = T.lw; x.strokeStyle = T.grid;
          x.fillStyle = T.fg; x.globalAlpha = 0.6; x.textAlign = "center"; x.font = "italic " + 11 * z + "px " + F;
          x.fillText("Indisponible", cx + dw / 2, yy + ch / 2); x.globalAlpha = 1;
        } else if (c && c.t) {
          let fs = 14 * z, ls;
          for (;;) {
            x.font = "bold " + fs + "px " + F; ls = wrap(x, c.t, dw - 12).map((t) => [t, "bold"]);
            if (c.pr) { x.font = "italic " + fs + "px " + F; ls = ls.concat(wrap(x, c.pr, dw - 12).map((t) => [t, "italic"])); }
            if (ls.length * fs * 1.25 <= ch - 6 || fs <= 7) break;
            fs--;
          }
          let ty = yy + ch / 2 - (ls.length * fs * 1.25) / 2 + fs * 0.625;
          x.fillStyle = T.fg; x.textAlign = "center";
          ls.forEach((l) => { x.font = l[1] + " " + fs + "px " + F; x.fillText(l[0], cx + dw / 2, ty); ty += fs * 1.25; });
        }
      });
    }
    yy += h;
  });
  x.fillStyle = T.fg; x.textAlign = "right"; x.font = "bold " + 13 * z + "px " + F; x.fillText(p.sign || "", W - m, H - m + 4);
  return hits;
}

let survol = null;
function render() {
  const e = erreurSlots(p().slots);
  $("err").textContent = e;
  HIT = draw($("cv"), p(), 1.6, { survol });
  renderJour();
}

/* ---------- Téléphone : vue jour par jour ---------- */
let jourSel = null;
function renderJour() {
  const pr = p(), D = pr.days.slice().sort((a, b) => a - b);
  if (!D.includes(jourSel)) jourSel = D[0];
  $("jtabs").innerHTML = D.map((d) => {
    const n = pr.slots.filter((q, r) => pr.cells[d + "|" + r]?.t).length;
    return `<button type="button" class="${d === jourSel ? "on" : ""}" data-j="${d}">${DAYS[d].slice(0, 3)}${n ? `<small>${n}</small>` : ""}</button>`;
  }).join("");
  let couvert = 0;
  $("jliste").innerHTML = pr.slots.map((q, r) => {
    if (q.pause) { couvert = 0; return `<div class="edt-jpause">Pause</div>`; }
    if (couvert > 0) { couvert--; return ""; }
    const k = jourSel + "|" + r, c = pr.cells[k] || {};
    const sp = c.span > 1 ? Math.min(c.span, pr.slots.length - r) : 1;
    couvert = sp - 1;
    const fin = pr.slots[r + sp - 1]?.e ?? q.e;
    const contenu = c.type === "x" ? `<span class="edt-jx">Indisponible</span>`
      : c.t ? `<b>${esc(c.t)}</b>${c.pr ? `<span>${esc(c.pr)}</span>` : ""}`
      : `<span class="edt-jvide">+ Ajouter un cours</span>`;
    return `<button type="button" class="edt-jcase ${c.t ? "plein" : ""} ${c.type === "x" ? "x" : ""}" data-k="${k}" style="${c.t ? `--c:${esc(c.c || PAL[0])}` : ""}">
      <span class="edt-jh">${hhmm(q.s)}<br>${hhmm(fin)}</span><span class="edt-jc">${contenu}</span></button>`;
  }).join("");
}

/* ---------- Remplissage des volets ---------- */
function remplir(viderHisto = true) {
  if (viderHisto) { histo = []; $("undo").disabled = true; }
  ek = null;
  document.querySelectorAll("[data-k]").forEach((e) => (e.value = p()[e.dataset.k] ?? ""));
  $("sel").innerHTML = P.map((q, i) => `<option value="${i}">${esc(q.name || "Sans nom")}</option>`).join("");
  $("sel").value = cur;
  remplirJours(); remplirSlots(); remplirMats(); remplirIndispo(); remplirStyle(); remplirPinceaux();
  render();
}

function remplirJours() {
  $("days").innerHTML = DAYS.map((d, i) => `<button type="button" class="edt-chip ${p().days.includes(i) ? "on" : ""}" data-d="${i}">${d.slice(0, 3)}<span>${d.slice(3)}</span></button>`).join("");
}

function remplirSlots() {
  const S = p().slots;
  $("slots").innerHTML = S.map((q, r) => `
    <div class="edt-slot ${q.pause ? "is-pause" : ""}" data-r="${r}">
      ${q.pause ? `<span class="edt-pause">Pause</span>` : `<input type="time" data-f="s" value="${q.s != null ? hhmm(q.s) : ""}" aria-label="Début" /><span class="edt-to">à</span><input type="time" data-f="e" value="${q.e != null ? hhmm(q.e) : ""}" aria-label="Fin" />`}
      <span class="edt-slot-act">
        <button type="button" class="edt-ico" data-a="up" title="Monter" ${r === 0 ? "disabled" : ""}>&uarr;</button>
        <button type="button" class="edt-ico" data-a="down" title="Descendre" ${r === S.length - 1 ? "disabled" : ""}>&darr;</button>
        <button type="button" class="edt-ico edt-ico-x" data-a="del" title="Supprimer">&times;</button>
      </span>
    </div>`).join("") || `<p class="muted">Aucun créneau. Ajoute-en un ou choisis « Horaires types ».</p>`;
}

const JOURS_OPT = (sel) => `<option value="-1">Jour auto</option>` + DAYS.map((d, i) => `<option value="${i}" ${+sel === i ? "selected" : ""}>${d}</option>`).join("");
function remplirMats() {
  $("mats").innerHTML = p().mats.map((m, i) => `
    <div class="edt-mat" data-i="${i}">
      <input type="color" data-f="c" value="${esc(m.c)}" aria-label="Couleur" />
      <input data-f="t" value="${esc(m.t)}" placeholder="Matière" aria-label="Matière" />
      <label class="edt-h"><input type="number" data-f="h" value="${m.h}" min="0" max="40" step="0.5" aria-label="Heures par semaine" /><span>h</span></label>
      <button type="button" class="edt-ico edt-ico-x" data-a="del" title="Supprimer">&times;</button>
      <input data-f="pr" value="${esc(m.pr)}" placeholder="Enseignant (facultatif)" aria-label="Enseignant" class="edt-mat-pr" />
      <select data-f="jour" aria-label="Jour" class="edt-mat-j">${JOURS_OPT(m.jour)}</select>
    </div>`).join("") || `<p class="muted">Aucune matière pour le moment.</p>`;
}

function remplirIndispo() {
  const D = p().days.slice().sort((a, b) => a - b);
  $("indispo").innerHTML = D.map((d) => `
    <div class="edt-ind"><span>${DAYS[d]}</span>
      <button type="button" class="edt-chip sm ${p().indispo[d + "|m"] ? "on-x" : ""}" data-ind="${d}|m">Matin</button>
      <button type="button" class="edt-chip sm ${p().indispo[d + "|a"] ? "on-x" : ""}" data-ind="${d}|a">Après-midi</button>
    </div>`).join("");
}

function remplirStyle() {
  $("tpls").innerHTML = Object.entries(TP).map(([k, t]) => `
    <button type="button" class="edt-tpl ${p().tpl === k ? "on" : ""}" data-tpl="${k}">
      <span class="edt-tpl-ap" style="background:${t.bg};border-color:${t.grid}"><i style="background:${t.hb === "A" ? p().accent : t.hb === "T" ? p().accent + "30" : t.hb}"></i><i></i><i></i></span>${t.nom}</button>`).join("");
  document.querySelectorAll("#orient button").forEach((b) => b.classList.toggle("on", b.dataset.o === p().orient));
}

function remplirPinceaux() {
  const b = (id, label, style = "") => `<button type="button" class="edt-pin ${brush === id || (brush == null && id === "") ? "on" : ""}" data-pin="${id}" ${style}>${label}</button>`;
  $("pinceaux").innerHTML = b("", "Modifier")
    + p().mats.map((m) => b("m:" + m.id, `<i style="background:${esc(m.c)}"></i>${esc(m.t || "Sans nom")}`)).join("")
    + b("x", "Indisponible") + b("gomme", "Gomme");
  $("aide").textContent = brush == null
    ? (p().mats.length ? "Touche une case pour la modifier, ou choisis une matière au-dessus puis touche les cases à remplir." : "Touche une case pour la remplir. Ajoute tes matières (étape 3) pour remplir les cases encore plus vite.")
    : "Touche ou glisse sur les cases à remplir. Choisis « Modifier » pour revenir à l'édition case par case.";
  $("cv").style.touchAction = brush == null ? "auto" : "none";
  $("cv").classList.toggle("peindre", brush != null);
}

/* ---------- Onglets ---------- */
function onglet(t) {
  document.querySelectorAll(".edt-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === t));
  document.querySelectorAll(".edt-volet").forEach((v) => v.classList.toggle("hidden", v.dataset.v !== t));
}
document.querySelectorAll(".edt-tabs button").forEach((b) => (b.onclick = () => onglet(b.dataset.t)));
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { onglet(b.dataset.go); b.closest(".edt-panneau").scrollIntoView({ behavior: "smooth", block: "start" }); }));

/* ---------- Champs simples ---------- */
let memoChamp = null;
document.addEventListener("focusin", (e) => { if (e.target.dataset?.k) memoChamp = e.target.dataset.k; });
document.addEventListener("input", (e) => {
  const k = e.target.dataset?.k;
  if (!k) return;
  if (memoChamp === k) { memo(); memoChamp = null; }
  p()[k] = k === "fs" ? +e.target.value : e.target.value;
  if (k === "name") $("sel").options[cur].text = e.target.value || "Sans nom";
  if (k === "accent") remplirStyle();
  render(); sauver();
});

/* ---------- Projets ---------- */
$("sel").onchange = (e) => { cur = +e.target.value; brush = null; remplir(); sauver(); };
$("bn").onclick = () => { P.push(nouveau()); cur = P.length - 1; brush = null; remplir(); sauver(); onglet("infos"); toast("Nouvel emploi du temps créé."); };
$("bd").onclick = () => { const c = completer(JSON.parse(JSON.stringify(p()))); c.id = uid(); c.name += " (copie)"; P.push(c); cur = P.length - 1; remplir(); sauver(); toast("Copie créée."); };
$("bx").onclick = () => {
  if (!confirm(`Supprimer « ${p().name} » ?`)) return;
  P.splice(cur, 1); if (!P.length) P = [nouveau()]; cur = Math.max(0, cur - 1); brush = null; remplir(); sauver();
};
$("bc").onclick = () => { if (!Object.keys(p().cells).length) return; if (!confirm("Vider toutes les cases ?")) return; memo(); p().cells = {}; p().indispo = {}; remplirIndispo(); render(); sauver(); };
$("undo").onclick = annuler;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); annuler(); }
});

/* ---------- Jours ---------- */
$("days").onclick = (e) => {
  const b = e.target.closest("[data-d]"); if (!b) return;
  const d = +b.dataset.d, D = p().days;
  if (D.includes(d) && D.length === 1) return toast("Garde au moins un jour.", "err");
  memo();
  p().days = D.includes(d) ? D.filter((x) => x !== d) : [...D, d];
  remplirJours(); remplirIndispo(); render(); sauver();
};

/* ---------- Créneaux ---------- */
// Quand on supprime ou déplace un créneau, les cases suivent.
function remapper(fn) {
  const n = {};
  Object.entries(p().cells).forEach(([k, c]) => { const [d, r] = k.split("|").map(Number); const r2 = fn(r); if (r2 != null) n[d + "|" + r2] = c; });
  p().cells = n;
}
$("slots").addEventListener("change", (e) => {
  const row = e.target.closest("[data-r]"); const f = e.target.dataset.f;
  if (!row || !f) return;
  const v = enMin(e.target.value); if (v == null) return;
  memo();
  p().slots[+row.dataset.r][f] = v;
  render(); sauver();
});
$("slots").addEventListener("click", (e) => {
  const a = e.target.closest("[data-a]")?.dataset.a; const row = e.target.closest("[data-r]");
  if (!a || !row) return;
  const r = +row.dataset.r, S = p().slots;
  memo();
  if (a === "del") { S.splice(r, 1); remapper((x) => (x === r ? null : x > r ? x - 1 : x)); }
  if (a === "up" && r > 0) { [S[r - 1], S[r]] = [S[r], S[r - 1]]; remapper((x) => (x === r ? r - 1 : x === r - 1 ? r : x)); }
  if (a === "down" && r < S.length - 1) { [S[r + 1], S[r]] = [S[r], S[r + 1]]; remapper((x) => (x === r ? r + 1 : x === r + 1 ? r : x)); }
  Object.values(p().cells).forEach((c) => { if (c.span > 1) c.span = Math.max(1, c.span); });
  remplirSlots(); render(); sauver();
});
$("add-slot").onclick = () => {
  const S = p().slots, der = [...S].reverse().find((q) => !q.pause && q.e != null);
  const duree = der ? der.e - der.s : 90;
  const s = der ? Math.min(der.e + 15, 23 * 60) : 8 * 60;
  memo();
  S.push({ s, e: Math.min(s + duree, 23 * 60 + 59) });
  remplirSlots(); render(); sauver();
};
$("add-pause").onclick = () => { memo(); p().slots.push({ pause: 1 }); remplirSlots(); render(); sauver(); };
$("preset").onclick = () => {
  if (Object.keys(p().cells).length && !confirm("Remplacer les créneaux par les horaires types (7h30 - 17h15) ? Les cases seront vidées.")) return;
  memo(); p().slots = slotsDepuisTexte(SLOTS_TYPES); p().cells = {}; p().indispo = {};
  remplirSlots(); remplirIndispo(); render(); sauver();
};

/* ---------- Matières ---------- */
const couleurLibre = () => PAL.find((c) => !p().mats.some((m) => m.c === c)) || PAL[p().mats.length % PAL.length];
$("add-mat").onclick = () => {
  memo();
  p().mats.push({ id: uid(), t: "", pr: "", h: 3, c: couleurLibre(), jour: -1 });
  remplirMats(); remplirPinceaux(); sauver();
  $("mats").lastElementChild?.querySelector('[data-f="t"]')?.focus();
};
let memoMat = null;
$("mats").addEventListener("focusin", (e) => { if (e.target.dataset.f) memoMat = e.target; });
function majMat(e) {
  const row = e.target.closest("[data-i]"); const f = e.target.dataset.f;
  if (!row || !f) return;
  if (memoMat === e.target) { memo(); memoMat = null; }
  const m = p().mats[+row.dataset.i];
  m[f] = f === "h" ? Math.max(0, +e.target.value || 0) : f === "jour" ? +e.target.value : e.target.value;
  // Les cases déjà remplies avec cette matière suivent le nouveau nom, enseignant ou couleur
  if (["t", "pr", "c"].includes(f)) Object.values(p().cells).forEach((c) => { if (c.m === m.id) c[f] = m[f]; });
  if (["t", "c"].includes(f)) remplirPinceaux();
  render(); sauver();
}
$("mats").addEventListener("input", majMat);
$("mats").addEventListener("change", (e) => { if (e.target.tagName === "SELECT") majMat(e); });
$("mats").addEventListener("click", (e) => {
  if (e.target.closest("[data-a]")?.dataset.a !== "del") return;
  const i = +e.target.closest("[data-i]").dataset.i;
  memo();
  const [m] = p().mats.splice(i, 1);
  if (brush === "m:" + m.id) brush = null;
  remplirMats(); remplirPinceaux(); sauver();
});

/* ---------- Pas de cours (matin / après-midi) ---------- */
function appliquerIndispo(d, moment, on) {
  p().slots.forEach((q, r) => {
    if (q.pause || q.s == null) return;
    if ((moment === "m") !== (q.s < 12 * 60)) return;
    const k = d + "|" + r, c = p().cells[k];
    if (on && !c) p().cells[k] = { type: "x" };
    if (!on && c?.type === "x") delete p().cells[k];
  });
}
$("indispo").onclick = (e) => {
  const b = e.target.closest("[data-ind]"); if (!b) return;
  const key = b.dataset.ind, [d, moment] = key.split("|");
  memo();
  const on = !p().indispo[key];
  if (on) p().indispo[key] = 1; else delete p().indispo[key];
  appliquerIndispo(+d, moment, on);
  remplirIndispo(); render(); sauver();
};

/* ---------- Génération automatique ---------- */
function generer() {
  const pr = p(), S = pr.slots, D = pr.days.slice().sort((a, b) => a - b);
  const err = erreurSlots(S); if (err) { onglet("horaires"); return toast(err, "err"); }
  const mats = pr.mats.filter((m) => m.t.trim() && m.h > 0);
  if (!mats.length) return toast("Ajoute au moins une matière avec un nombre d'heures.", "err");
  const dejaCours = Object.values(pr.cells).some((c) => c.t);
  if (dejaCours && !confirm("Remplacer les cours déjà placés par une nouvelle génération ?")) return;
  memo();
  const cells = {};
  Object.entries(pr.cells).forEach(([k, c]) => { if (c.type === "x") cells[k] = { type: "x" }; });
  Object.keys(pr.indispo).forEach((key) => { const [d, mo] = key.split("|"); S.forEach((q, r) => { if (!q.pause && q.s != null && (mo === "m") === (q.s < 720)) cells[d + "|" + r] = { type: "x" }; }); });
  const libre = (d, r) => !S[r].pause && S[r].s != null && !cells[d + "|" + r];
  const log = []; let ok = 0;
  [...mats].sort((a, b) => b.h - a.h).forEach((m) => {
    let reste = m.h * 60;
    const ds = m.jour >= 0 && D.includes(m.jour) ? [m.jour] : D;
    while (reste >= 30) {
      let best = null, bs = 1e9;
      ds.forEach((d) => S.forEach((q, r) => {
        if (!libre(d, r)) return;
        const duJour = Object.keys(cells).filter((k) => k.startsWith(d + "|") && cells[k].t);
        const meme = duJour.filter((k) => cells[k].m === m.id).length;
        const sc = meme * 10 + duJour.length + r * 0.01;
        if (sc < bs) { bs = sc; best = [d, r]; }
      }));
      if (!best) { log.push(`${m.t} : plus de place (${Math.round(reste / 6) / 10} h non placées)`); break; }
      const [d, r] = best;
      cells[d + "|" + r] = { t: m.t.trim(), pr: m.pr.trim(), c: m.c, m: m.id };
      reste -= S[r].e - S[r].s; ok++;
    }
  });
  pr.cells = cells;
  render(); sauver();
  toast(`${ok} séance(s) placée(s).` + (log.length ? " " + log.join(" · ") : ""), log.length ? "err" : "ok");
  if (matchMedia("(max-width: 900px)").matches) $("cv").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("bg").onclick = generer;

/* ---------- Saisie rapide en texte ---------- */
$("be").onclick = () => {
  $("nl").value = "Algo 3h avec M. Amoi\nLangage C 3h avec M. Amoi\nBase de données 3h avec M. Ramdé\nFrançais 1.5h avec M. Djé le vendredi\nMaths 1.5h avec M. Pessinou vendredi\nVisual Basic 3h avec M. Ramdé le samedi\nPas de cours le samedi après-midi\nIndisponible mardi après-midi";
};
$("nl-ok").onclick = () => {
  const lignes = $("nl").value.split(/[;\n]+/).map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return toast("Écris au moins une ligne.", "err");
  memo();
  let n = 0; const ignorees = [];
  const jours = (t) => DAYS.map((_, i) => i).filter((i) => t.includes(norm(DAYS[i])));
  lignes.forEach((c) => {
    const t = norm(c);
    if (/\b(pas|sans|aucun|aucune|indisponible|libre|repos|ferme)\b/.test(t)) {
      const ds = jours(t).filter((d) => p().days.includes(d));
      const mo = /apres.?midi|soir/.test(t) ? ["a"] : /matin/.test(t) ? ["m"] : ["m", "a"];
      ds.forEach((d) => mo.forEach((x) => { p().indispo[d + "|" + x] = 1; appliquerIndispo(d, x, true); }));
      if (ds.length) n++; else ignorees.push(c);
      return;
    }
    const m = c.match(/^(.+?)\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)\s*(?:h|heures?)\b(.*)$/i);
    if (!m) return ignorees.push(c);
    const rest = m[3];
    const prof = (rest.match(/(?:avec|par)\s+(.+?)(?=\s+(?:le|les|à|a|chaque|en|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|$)/i) || [])[1] || "";
    const j = jours(norm(rest));
    p().mats.push({ id: uid(), t: m[1].trim(), pr: prof.trim(), h: parseFloat(m[2].replace(",", ".")), c: couleurLibre(), jour: j.length === 1 ? j[0] : -1 });
    n++;
  });
  remplirMats(); remplirIndispo(); remplirPinceaux(); render(); sauver();
  $("nl").value = ignorees.join("\n");
  toast(`${n} ligne(s) ajoutée(s).` + (ignorees.length ? ` ${ignorees.length} non comprise(s), laissée(s) dans la zone de texte.` : ""), ignorees.length ? "err" : "ok");
};

/* ---------- Style ---------- */
$("tpls").onclick = (e) => { const b = e.target.closest("[data-tpl]"); if (!b) return; memo(); p().tpl = b.dataset.tpl; remplirStyle(); render(); sauver(); };
$("orient").onclick = (e) => { const b = e.target.closest("[data-o]"); if (!b) return; memo(); p().orient = b.dataset.o; remplirStyle(); render(); sauver(); };

/* ---------- Clic dans l'aperçu ---------- */
function caseSous(e) {
  const r = $("cv").getBoundingClientRect(), W = $("cv").width / 1.6;
  const lx = ((e.clientX - r.left) * W) / r.width, ly = ((e.clientY - r.top) * W) / r.width;
  return HIT.find((h) => lx >= h.x && lx <= h.x + h.w && ly >= h.y && ly <= h.y + h.h);
}
function peindre(k) {
  const c = p().cells[k], span = c?.span;
  let n = null;
  if (brush === "x") n = { type: "x" };
  else if (brush?.startsWith("m:")) {
    const m = p().mats.find((x) => "m:" + x.id === brush); if (!m) return;
    n = { t: m.t || "Sans nom", pr: m.pr, c: m.c, m: m.id };
  }
  if (span > 1) n = Object.assign(n || {}, { span });
  if (n) p().cells[k] = n; else delete p().cells[k];
}
$("cv").addEventListener("pointerdown", (e) => {
  const h = caseSous(e); if (!h) return;
  if (brush == null) return; // ouverture au clic (voir plus bas)
  e.preventDefault();
  memo(); peinture = true; dernier = h.k; peindre(h.k); render();
  $("cv").setPointerCapture?.(e.pointerId);
});
$("cv").addEventListener("pointermove", (e) => {
  const h = caseSous(e);
  if (peinture) { if (h && h.k !== dernier) { dernier = h.k; peindre(h.k); render(); } return; }
  const k = h?.k || null;
  if (e.pointerType === "mouse" && k !== survol) { survol = k; render(); }
});
$("cv").addEventListener("pointerleave", () => { if (survol) { survol = null; render(); } });
const finPeinture = () => { if (peinture) { peinture = false; dernier = null; sauver(); } };
$("cv").addEventListener("pointerup", finPeinture);
$("cv").addEventListener("pointercancel", finPeinture);
$("cv").addEventListener("click", (e) => { if (brush != null) return; const h = caseSous(e); if (h) ouvrir(h.k); });

$("jtabs").onclick = (e) => { const b = e.target.closest("[data-j]"); if (b) { jourSel = +b.dataset.j; renderJour(); } };
$("jliste").onclick = (e) => {
  const b = e.target.closest(".edt-jcase"); if (!b) return;
  const k = b.dataset.k;
  if (brush == null) return ouvrir(k);
  memo(); peindre(k); render(); sauver();
};

$("pinceaux").onclick = (e) => {
  const b = e.target.closest("[data-pin]"); if (!b) return;
  brush = b.dataset.pin || null;
  remplirPinceaux();
};

/* ---------- Fenêtre d'une case ---------- */
function ouvrir(k) {
  ek = k;
  const c = p().cells[k] || {}, [d, r] = k.split("|").map(Number), q = p().slots[r];
  $("dlg-titre").textContent = `${DAYS[d]} · ${hhmm(q.s)} - ${hhmm(q.e)}`;
  $("dtt").value = c.t || ""; $("dpr").value = c.pr || "";
  $("dc").value = c.c || couleurLibre();
  $("dlg-mats").innerHTML = p().mats.filter((m) => m.t.trim()).map((m) =>
    `<button type="button" class="edt-pin" data-mid="${m.id}"><i style="background:${esc(m.c)}"></i>${esc(m.t)}</button>`).join("");
  $("d-unspan").disabled = !(c.span > 1);
  $("dlg").showModal();
  if (!p().mats.length) setTimeout(() => $("dtt").focus(), 30);
}
$("dlg-mats").onclick = (e) => {
  const b = e.target.closest("[data-mid]"); if (!b) return;
  const m = p().mats.find((x) => x.id === b.dataset.mid);
  memo();
  const span = p().cells[ek]?.span;
  p().cells[ek] = Object.assign({ t: m.t, pr: m.pr, c: m.c, m: m.id }, span > 1 ? { span } : {});
  $("dlg").close(); render(); sauver();
};
$("dlg-form").onsubmit = (e) => {
  e.preventDefault();
  const pr = p(), span = pr.cells[ek]?.span, t = $("dtt").value.trim();
  memo();
  let n = null;
  if (t) {
    const m = pr.mats.find((x) => norm(x.t) === norm(t));
    n = { t, pr: $("dpr").value.trim(), c: $("dc").value, ...(m ? { m: m.id } : {}) };
  }
  if (span > 1) n = Object.assign(n || {}, { span });
  if (n) pr.cells[ek] = n; else delete pr.cells[ek];
  $("dlg").close(); render(); sauver();
};
$("dcl").onclick = () => $("dlg").close();
$("d-x").onclick = () => { memo(); const span = p().cells[ek]?.span; p().cells[ek] = Object.assign({ type: "x" }, span > 1 ? { span } : {}); $("dlg").close(); render(); sauver(); };
$("d-clear").onclick = () => { memo(); delete p().cells[ek]; $("dlg").close(); render(); sauver(); };
$("d-span").onclick = () => {
  const pr = p(), [d, r] = ek.split("|").map(Number), c = pr.cells[ek] || {}, sp = c.span || 1, suiv = r + sp;
  if (suiv >= pr.slots.length || pr.slots[suiv].pause) return toast("Impossible : pas de créneau juste après (ou c'est une pause).", "err");
  memo();
  const k2 = d + "|" + suiv, c2 = pr.cells[k2];
  const base = c.t || c.type ? c : c2 && (c2.t || c2.type) ? { ...c2 } : {};
  delete base.span;
  pr.cells[ek] = Object.assign({}, base, { t: $("dtt").value.trim() || base.t, pr: $("dpr").value.trim() || base.pr, c: $("dc").value || base.c }, { span: sp + 1 + ((c2?.span || 1) - 1) });
  if (!pr.cells[ek].t) delete pr.cells[ek].t;
  delete pr.cells[k2];
  $("d-unspan").disabled = false;
  render(); sauver();
  toast("Case prolongée.");
};
$("d-unspan").onclick = () => {
  const c = p().cells[ek]; if (!c || !(c.span > 1)) return;
  memo(); c.span--; if (c.span <= 1) delete c.span;
  $("d-unspan").disabled = !(c.span > 1);
  render(); sauver();
};

/* ---------- Export A4 ---------- */
function telecharger(b, n) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = n; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast("Fichier téléchargé : " + n);
}
function mkpdf(j, w, h, L) {
  const E = new TextEncoder(), Q = [], o = []; let n = 0;
  const a = (x) => { x = typeof x === "string" ? E.encode(x) : x; Q.push(x); n += x.length; };
  const pw = L ? 841.89 : 595.28, ph = L ? 595.28 : 841.89, cs = `q ${pw} 0 0 ${ph} 0 0 cm /I Do Q`;
  a("%PDF-1.4\n"); o[1] = n; a("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"); o[2] = n; a("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n");
  o[3] = n; a(`3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw} ${ph}]/Contents 4 0 R/Resources<</XObject<</I 5 0 R>>>>>>endobj\n`);
  o[4] = n; a(`4 0 obj<</Length ${cs.length}>>stream\n${cs}\nendstream endobj\n`);
  o[5] = n; a(`5 0 obj<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${j.length}>>stream\n`); a(j); a("\nendstream endobj\n");
  const x0 = n; a("xref\n0 6\n0000000000 65535 f \n"); for (let i = 1; i < 6; i++) a(String(o[i]).padStart(10, "0") + " 00000 n \n");
  a(`trailer<</Size 6/Root 1 0 R>>\nstartxref\n${x0}\n%%EOF`);
  return Q;
}
document.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => {
  try {
    const k = b.dataset.e, pr = p(), cv = document.createElement("canvas");
    draw(cv, pr, 3);
    const nm = (pr.name || "emploi-du-temps").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_");
    if (k === "png") cv.toBlob((x) => telecharger(x, nm + ".png"), "image/png");
    else if (k === "jpg") cv.toBlob((x) => telecharger(x, nm + ".jpg"), "image/jpeg", 0.95);
    else {
      const bin = atob(cv.toDataURL("image/jpeg", 0.95).split(",")[1]), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      telecharger(new Blob(mkpdf(u8, cv.width, cv.height, pr.orient === "l"), { type: "application/pdf" }), nm + ".pdf");
    }
  } catch (e) { toast("Export impossible : " + e.message, "err"); }
}));

/* ---------- Fichier de sauvegarde (.json) ---------- */
const jdl = (o, n) => telecharger(new Blob([JSON.stringify(o, null, 1)], { type: "application/json" }), n + ".json");
$("jx").onclick = () => jdl({ app: "edt-studio", v: 2, projects: [p()] }, (p().name || "edt").replace(/[^\w-]+/g, "_"));
$("ja").onclick = () => jdl({ app: "edt-studio", v: 2, projects: P }, "emplois_du_temps");
$("ji").onclick = () => $("jf").click();
$("jf").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then((t) => {
    const j = JSON.parse(t), a = j.projects || (j.project ? [j.project] : [j]);
    let n = 0;
    a.forEach((o) => { if (o && o.slots && Array.isArray(o.days) && o.cells && typeof o.cells === "object") { P.push(completer({ ...o, id: uid(), name: (o.name || "Importé") + " (importé)" })); n++; } });
    if (!n) throw new Error("fichier non reconnu");
    cur = P.length - 1; remplir(); sauver(); toast(`${n} emploi(s) du temps importé(s).`);
  }).catch((er) => toast("Import impossible : " + er.message, "err"));
  e.target.value = "";
};

/* ---------- Démarrage ---------- */
charger();
remplir();
document.fonts?.ready.then(render);
