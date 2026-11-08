import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, updateProfile, sendPasswordResetEmail,
  sendEmailVerification, reload,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, limit, orderBy, startAfter, serverTimestamp, increment, writeBatch, deleteField, onSnapshot, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { canonFiliere, ajouterFilieres, filiereConnue } from "./filieres.js";
import { firebaseConfig, paymentConfig, CREDITS_PAR_PUBLICATION, CREDITS_BIENVENUE, NTFY_TOPIC } from "./config.js";

/** Prévient l'admin sur son téléphone et son PC (ntfy). Ne bloque jamais, aucune donnée personnelle envoyée. */
function prevenirAdmin(title, message, page) {
  if (!NTFY_TOPIC) return;
  try {
    fetch("https://ntfy.sh/", {
      method: "POST", keepalive: true,
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message, priority: 4, tags: ["bell"], click: `https://unidev-2026.web.app/${page}` }),
    }).catch(() => {});
  } catch {}
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = "fr"; // e-mails de Firebase (mot de passe oublié, vérification) en français
export const db = getFirestore(app);

/* ---------- Utilisateurs ---------- */

// Une seule création de profil à la fois par compte : plusieurs parties du site peuvent
// la demander en même temps juste après l'inscription (sinon Firebase refuse la 2e).
const profilsEnCours = new Map();
function ensureProfile(user, nom) {
  if (!profilsEnCours.has(user.uid)) {
    const p = creerProfilSiAbsent(user, nom).finally(() => setTimeout(() => profilsEnCours.delete(user.uid), 2000));
    profilsEnCours.set(user.uid, p);
  }
  return profilsEnCours.get(user.uid);
}
/* ---------- Crédits offerts : une seule fois par appareil ----------
   Une marque est déposée sur l'appareil (cookie + stockage local + IndexedDB) à la première inscription.
   Un nouveau compte créé sur le même appareil démarre alors à 0 crédit. */
const MARQUE = "unidev-bonus";
function idbMarque(ecrire) {
  return new Promise((ok) => {
    try {
      const req = indexedDB.open("unidev", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("appareil");
      req.onerror = () => ok(false);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction("appareil", ecrire ? "readwrite" : "readonly");
          const st = tx.objectStore("appareil");
          if (ecrire) { st.put(Date.now(), MARQUE); tx.oncomplete = () => ok(true); }
          else { const g = st.get(MARQUE); g.onsuccess = () => ok(!!g.result); g.onerror = () => ok(false); }
        } catch { ok(false); }
      };
    } catch { ok(false); }
  });
}
async function bonusDejaUtilise() {
  let vu = false;
  try { vu = vu || !!localStorage.getItem(MARQUE); } catch {}
  vu = vu || document.cookie.split("; ").some((c) => c.startsWith(MARQUE + "="));
  return vu || (await idbMarque(false));
}
async function marquerBonus() {
  try { localStorage.setItem(MARQUE, String(Date.now())); } catch {}
  document.cookie = `${MARQUE}=1; max-age=${10 * 365 * 24 * 3600}; path=/; SameSite=Lax; Secure`;
  await idbMarque(true);
}

async function creerProfilSiAbsent(user, nom) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) { marquerBonus(); return { credits: 0, ...snap.data() }; }
  const dejaUtilise = await bonusDejaUtilise();
  // E-mail déjà vérifié (Google) : crédits tout de suite. Sinon : en attente de vérification.
  const verifie = !!user.emailVerified;
  const profile = {
    nom: nom || user.displayName || (user.email || "").split("@")[0] || "Étudiant",
    email: user.email || "",
    role: "etudiant",
    credits: !dejaUtilise && verifie ? CREDITS_BIENVENUE : 0,
    bonusEnAttente: !dejaUtilise && !verifie,
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(ref, profile);
    await marquerBonus();
    const msg = dejaUtilise ? "Compte créé. Les crédits offerts ont déjà été utilisés sur cet appareil."
      : !verifie ? `Compte créé. Confirme ton e-mail (lien envoyé à ${user.email}) pour recevoir tes ${CREDITS_BIENVENUE} crédits offerts.` : "";
    if (msg) { try { sessionStorage.setItem("unidev-message", msg); } catch {} }
    return profile;
  } catch (e) {
    // Créé entre-temps (autre onglet, autre appareil) : on relit simplement le profil
    const again = await getDoc(ref);
    if (again.exists()) return { credits: 0, ...again.data() };
    throw e;
  }
}

/* ---------- Admin unique ----------
   Son UID est rangé dans Firestore : parametres/admin { uid: "..." }.
   Ce document se crée à la main dans la console Firebase ; le site ne peut pas le modifier. */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Vérifie si `user` est l'admin et explique pourquoi sinon.
 * Renvoie { ok, raison, uidEnregistre } ; raison : null | "absent" | "vide" | "espaces" | "autre" | "lecture".
 * Plusieurs essais : juste après la connexion, Firestore peut ne pas encore connaître la session.
 */
export async function checkAdmin(user, essais = 4) {
  if (!user) return { ok: false, raison: "deconnecte" };
  let derniereErreur = null;
  for (let essai = 0; essai < essais; essai++) {
    try {
      await user.getIdToken();
      const snap = await getDoc(doc(db, "parametres", "admin"));
      if (!snap.exists()) return { ok: false, raison: "absent" };
      const brut = snap.data().uid;
      if (!brut) return { ok: false, raison: "vide" };
      const uid = String(brut);
      if (uid !== uid.trim()) return { ok: false, raison: "espaces", uidEnregistre: uid };
      return { ok: uid === user.uid, raison: uid === user.uid ? null : "autre", uidEnregistre: uid };
    } catch (e) {
      derniereErreur = e;
      if (essai < essais - 1) await pause(700 * (essai + 1));
    }
  }
  console.error(derniereErreur);
  return { ok: false, raison: "lecture", erreur: derniereErreur?.code || derniereErreur?.message };
}
export async function isAdminUser(user) {
  return (await checkAdmin(user, 2)).ok; // rapide : sert seulement à afficher l'onglet Modération
}

/** cb({ user, profile }) — user = null si déconnecté ; profile.isAdmin = vrai pour le seul admin */
const PROFILE_KEY = "unidev-profil";

/** Profil mémorisé de la dernière visite (nom, crédits, admin) pour un affichage immédiat */
export function cachedProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; }
}
function saveProfile(user, profile) {
  try {
    if (!user) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, JSON.stringify({ uid: user.uid, nom: profile.nom, credits: profile.credits || 0, isAdmin: !!profile.isAdmin }));
  } catch {}
}

export function watchUser(cb) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) { saveProfile(null); return cb({ user: null, profile: null }); }
    // Vérification admin et lecture du profil en même temps (plus rapide)
    const [isAdmin, base] = await Promise.all([
      isAdminUser(user),
      ensureProfile(user).catch((e) => { console.error(e); return { nom: user.email, role: "etudiant", credits: 0 }; }),
    ]);
    const profile = { ...base, isAdmin };
    if (profile.bonusEnAttente) await reclamerBonus(user, profile);
    saveProfile(user, profile);
    cb({ user, profile });
  });
}

/* ---------- Crédits offerts après vérification de l'e-mail ---------- */
async function reclamerBonus(user, profile) {
  try {
    if (!user.emailVerified) await reload(user); // l'étudiant vient peut-être de cliquer sur le lien
    if (!auth.currentUser?.emailVerified) return;
    await auth.currentUser.getIdToken(true);      // jeton à jour, pour que Firebase voie l'e-mail vérifié
    await updateDoc(doc(db, "users", user.uid), { credits: increment(CREDITS_BIENVENUE), bonusEnAttente: false });
    profile.credits = (profile.credits || 0) + CREDITS_BIENVENUE;
    profile.bonusEnAttente = false;
    try { sessionStorage.setItem("unidev-message", `E-mail confirmé : ${CREDITS_BIENVENUE} crédits offerts ajoutés.`); } catch {}
  } catch (e) { console.error(e); }
}
const lienRetour = () => ({ url: new URL("credits.html", location.href).href });
export async function renvoyerVerification() {
  if (!auth.currentUser) throw new Error("Connecte-toi d'abord.");
  await sendEmailVerification(auth.currentUser, lienRetour());
}

export async function getCredits(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.data()?.credits || 0;
}

export async function register(nom, email, password) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: nom }).catch(() => {});
  await sendEmailVerification(user, lienRetour()).catch((e) => console.error(e));
  const profil = await ensureProfile(user, nom).catch((e) => { console.error(e); return null; });
  // Si le profil a été créé sans le nom (création en parallèle), on corrige le nom
  if (profil && nom && profil.nom !== nom) await updateDoc(doc(db, "users", user.uid), { nom }).catch(() => {});
  return user;
}
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  let user;
  try {
    ({ user } = await signInWithPopup(auth, provider));
  } catch (e) {
    // Fenêtre bloquée (souvent dans l'appli installée) : on passe par une redirection
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
  // Le profil ne doit jamais empêcher la connexion : en cas d'échec, il sera recréé plus tard
  await ensureProfile(user).catch((e) => console.error(e));
  return user;
}
/** À appeler au chargement de la page de connexion (retour d'une redirection Google) */
export async function finishGoogleRedirect() {
  const res = await getRedirectResult(auth);
  if (res?.user) await ensureProfile(res.user).catch((e) => console.error(e));
  return res?.user || null;
}
export const logout = () => signOut(auth);
/** Mot de passe oublié : e-mail en français, avec un bouton qui ramène sur la page de connexion */
export async function resetPassword(email) {
  try { await sendPasswordResetEmail(auth, email, { url: `${location.origin}/connexion.html` }); }
  catch (e) {
    if (e.code === "auth/unauthorized-continue-uri" || e.code === "auth/invalid-continue-uri") await sendPasswordResetEmail(auth, email);
    else throw e;
  }
}

/* ---------- Documents ---------- */
// Le lien du fichier est rangé à part (documents/{id}/prive/fichier) :
// seuls l'auteur, l'admin et ceux qui ont débloqué le document peuvent le lire.

const docsCol = collection(db, "documents");
const fileRef = (id) => doc(db, "documents", id, "prive", "fichier");
const byDate = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
/* ---------- Filières ajoutées automatiquement (document index/filieres) ---------- */
const filieresRef = doc(db, "index", "filieres");
const FIL_KEY = "unidev-filieres";
try { ajouterFilieres(JSON.parse(localStorage.getItem(FIL_KEY) || "[]")); } catch {}
export const filieresPretes = getDoc(filieresRef).then((s) => {
  const liste = s.data()?.liste || [];
  ajouterFilieres(liste);
  try { localStorage.setItem(FIL_KEY, JSON.stringify(liste)); } catch {}
  return liste;
}).catch(() => []);
/** Ajoute une nouvelle filière à la liste partagée (dans un lot d'écriture admin) */
function ajouterFiliereAuLot(batch, f) {
  if (!f || filiereConnue(f)) return;
  batch.set(filieresRef, { liste: arrayUnion(f) }, { merge: true });
  ajouterFilieres([f]);
}

// Chaque document lu reçoit l'orthographe officielle de sa filière (majuscules, accents, fautes)
const lireDoc = (d) => { const o = { id: d.id, ...d.data() }; if (o.filiere) o.filiere = canonFiliere(o.filiere); return o; };
const mapSnap = (snap) => snap.docs.map(lireDoc).sort(byDate);

export async function listPublished(max = 200) {
  return mapSnap(await getDocs(query(docsCol, where("statut", "==", "publie"), limit(max))));
}

/** Une page de documents publiés (chargement progressif). sort : recent | populaire | titre */
export async function listPublishedPage(sort = "recent", cursor = null, size = 8) {
  const order = {
    recent: orderBy("createdAt", "desc"),
    populaire: orderBy("telechargements", "desc"),
    titre: orderBy("titre"),
  }[sort] || orderBy("createdAt", "desc");
  const parts = [where("statut", "==", "publie"), order];
  if (cursor) parts.push(startAfter(cursor));
  parts.push(limit(size));
  const snap = await getDocs(query(docsCol, ...parts));
  return {
    items: snap.docs.map(lireDoc),
    cursor: snap.docs[snap.docs.length - 1] || cursor,
    done: snap.size < size,
  };
}
export async function listByStatus(statut) {
  return mapSnap(await getDocs(query(docsCol, where("statut", "==", statut), limit(statut === "publie" ? 60 : 150))));
}
export async function listMine(uid) {
  return mapSnap(await getDocs(query(docsCol, where("auteurId", "==", uid), limit(200))));
}

export async function createDocument(data, fichier) {
  const ref = doc(docsCol);
  const batch = writeBatch(db);
  data = { ...data, filiere: canonFiliere(data.filiere) || data.filiere };
  batch.set(ref, { ...data, statut: "en_attente", telechargements: 0, creditAccorde: false, createdAt: serverTimestamp() });
  batch.set(fileRef(ref.id), { ...fichier, auteurId: data.auteurId });
  await batch.commit();
  prevenirAdmin("Document à valider", "Un nouveau document attend ta validation.", "admin.html");
  return ref;
}

export async function getFileUrl(id) {
  return (await getFileInfo(id)).fileUrl;
}
/** { fileUrl, parts: [{url, publicId}] | null } — parts existe pour les gros fichiers découpés */
/** Compte Cloudinary où envoyer les nouveaux fichiers (choisi par l'outil « Choisir le compte Cloudinary ») */
export async function compteDeStockage() {
  try { return (await getDoc(doc(db, "parametres", "stockage"))).data()?.compte || null; } catch { return null; }
}
/** Fiche d'un document (publié, à soi, ou admin) */
export async function getDocument(id) {
  const snap = await getDoc(doc(db, "documents", id));
  return snap.exists() ? lireDoc(snap) : null;
}
export async function getFileInfo(id) {
  const snap = await getDoc(fileRef(id));
  if (!snap.exists()) throw new Error("Fichier introuvable.");
  return snap.data();
}

/** Ids des documents déjà débloqués par l'utilisateur */
// Documents débloqués : gardés 30 minutes dans l'onglet (sinon 1 lecture par document débloqué à chaque page)
const cleAchats = (uid) => `unidev-achats-${uid}`;
export async function listUnlocked(uid) {
  try {
    const m = JSON.parse(sessionStorage.getItem(cleAchats(uid)) || "null");
    if (m && Date.now() - m.t < 30 * 60 * 1000) return new Set(m.ids);
  } catch {}
  // Copie durable sur le téléphone : si Firestore ne répond pas (quota du jour épuisé, réseau),
  // les documents déjà débloqués restent débloqués au lieu de réapparaître « 1 crédit »
  let garde = [];
  try { garde = JSON.parse(localStorage.getItem(cleAchats(uid)) || "[]"); } catch {}
  try {
    const snap = await getDocs(collection(db, "users", uid, "achats"));
    const ids = [...new Set([...snap.docs.map((d) => d.id)])];
    try { sessionStorage.setItem(cleAchats(uid), JSON.stringify({ t: Date.now(), ids })); localStorage.setItem(cleAchats(uid), JSON.stringify(ids)); } catch {}
    return new Set(ids);
  } catch (e) {
    if (garde.length) return new Set(garde);
    throw e;
  }
}
export function retenirAchat(uid, docId) {
  try {
    const m = JSON.parse(sessionStorage.getItem(cleAchats(uid)) || "null");
    if (m) { m.ids = [...new Set([...m.ids, docId])]; sessionStorage.setItem(cleAchats(uid), JSON.stringify(m)); }
    const g = JSON.parse(localStorage.getItem(cleAchats(uid)) || "[]");
    localStorage.setItem(cleAchats(uid), JSON.stringify([...new Set([...g, docId])]));
  } catch {}
}

/** Dépense 1 crédit pour débloquer définitivement un document */
export async function unlockDocument(uid, docId) {
  const batch = writeBatch(db);
  batch.set(doc(db, "users", uid, "achats", docId), { createdAt: serverTimestamp() });
  batch.update(doc(db, "users", uid), { credits: increment(-1), dernierAchat: docId });
  batch.update(doc(db, "documents", docId), { telechargements: increment(1) });
  await batch.commit();
  retenirAchat(uid, docId);
}

/** Admin : publie le document et crédite l'auteur (une seule fois) */
/* ---------- Index de recherche ----------
   Un seul document Firestore (index/catalogue) contient un résumé de tous les documents publiés.
   La recherche lit ce document (1 lecture) au lieu de relire toute la base. */
const indexRef = doc(db, "index", "catalogue");
// 9e case (facultative) : id du document dont celui-ci est la suite
export const indexEntry = (d) => [d.titre || "", d.matiere || "", d.filiere || "", d.type || "", d.niveau || "", d.imageUrl || "", d.format || "", d.universite || "", ...(d.suiteDe ? [d.suiteDe] : [])];
export async function getSearchIndex() {
  const snap = await getDoc(indexRef);
  const map = snap.data()?.docs || {};
  return Object.entries(map).map(([id, e]) => ({
    id, titre: e[0], matiere: e[1], filiere: canonFiliere(e[2]), type: e[3], niveau: e[4], imageUrl: e[5], format: e[6], universite: e[7], suiteDe: e[8] || "", partiel: true,
  }));
}
export async function getDocsByIds(ids) {
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "documents", id)).catch(() => null)));
  return snaps.filter((s) => s?.exists() && s.data().statut === "publie").map(lireDoc);
}
/** Admin : reconstruit l'index à partir de tous les documents publiés */
/** Admin : corrige l'orthographe des filières de tous les documents, puis reconstruit l'index. Renvoie le nombre de corrections. */
export async function harmoniserFilieres() {
  const snap = await getDocs(query(docsCol, limit(5000)));
  const aCorriger = snap.docs.filter((s) => { const f = s.data().filiere; return f && canonFiliere(f) !== f; });
  for (let i = 0; i < aCorriger.length; i += 400) {
    const batch = writeBatch(db);
    aCorriger.slice(i, i + 400).forEach((s) => batch.update(s.ref, { filiere: canonFiliere(s.data().filiere) }));
    await batch.commit();
  }
  // Toutes les filières des documents publiés rejoignent la liste partagée
  const publiees = [...new Set(snap.docs.filter((s) => s.data().statut === "publie").map((s) => canonFiliere(s.data().filiere)).filter(Boolean))];
  const nouvelles = publiees.filter((f) => !filiereConnue(f));
  if (nouvelles.length) { await setDoc(filieresRef, { liste: arrayUnion(...nouvelles) }, { merge: true }); ajouterFilieres(nouvelles); }
  await rebuildIndex();
  return aCorriger.length;
}
export async function rebuildIndex() {
  const snap = await getDocs(query(docsCol, where("statut", "==", "publie"), limit(5000)));
  const map = {};
  snap.docs.forEach((s) => { map[s.id] = indexEntry(lireDoc(s)); });
  await setDoc(indexRef, { docs: map, majLe: serverTimestamp() });
  return snap.size;
}

export async function publishDocument(d) {
  const batch = writeBatch(db);
  batch.update(doc(db, "documents", d.id), { statut: "publie", creditAccorde: true });
  batch.set(indexRef, { docs: { [d.id]: indexEntry(d) } }, { merge: true });
  ajouterFiliereAuLot(batch, canonFiliere(d.filiere));
  if (!d.creditAccorde && d.auteurId) {
    batch.update(doc(db, "users", d.auteurId), { credits: increment(CREDITS_PAR_PUBLICATION) });
  }
  await batch.commit();
}
/** Admin : change la filière, la matière, le type ou le niveau d'un document (et sa place dans le catalogue) */
export async function modifierClassement(d, champs) {
  const n = { ...d, ...champs, filiere: canonFiliere(champs.filiere) || champs.filiere };
  const batch = writeBatch(db);
  batch.update(doc(db, "documents", d.id), { filiere: n.filiere, matiere: n.matiere, type: n.type, niveau: n.niveau });
  if (d.statut === "publie") {
    batch.set(indexRef, { docs: { [d.id]: indexEntry(n) } }, { merge: true });
    ajouterFiliereAuLot(batch, n.filiere);
  }
  await batch.commit();
  return n;
}
export async function setStatus(id, statut) {
  const batch = writeBatch(db);
  batch.update(doc(db, "documents", id), { statut });
  if (statut !== "publie") batch.set(indexRef, { docs: { [id]: deleteField() } }, { merge: true });
  await batch.commit();
}
export async function removeDocument(id) {
  const batch = writeBatch(db);
  batch.set(indexRef, { docs: { [id]: deleteField() } }, { merge: true });
  batch.delete(fileRef(id));
  batch.delete(doc(db, "documents", id));
  await batch.commit();
}

/* ---------- Filières demandées par les étudiants ---------- */
const demandesCol = collection(db, "demandes");
export async function demanderFiliere({ filiere, niveau = "", universite = "", contact = "" }) {
  await addDoc(demandesCol, { filiere, niveau, universite, contact, uid: auth.currentUser?.uid || "", createdAt: serverTimestamp() });
  prevenirAdmin("Filière demandée", [filiere, niveau, universite].filter(Boolean).join(" · "), "admin.html");
}
/** Admin : demandes regroupées par filière (la plus demandée en premier) */
export async function listDemandes() {
  const snap = await getDocs(query(demandesCol, orderBy("createdAt", "desc"), limit(150)));
  const groupes = new Map();
  snap.docs.forEach((s) => {
    const d = { id: s.id, ...s.data() };
    const f = canonFiliere(d.filiere) || d.filiere;
    if (!groupes.has(f)) groupes.set(f, { filiere: f, demandes: [] });
    groupes.get(f).demandes.push(d);
  });
  return [...groupes.values()].sort((a, b) => b.demandes.length - a.demandes.length);
}
/** Admin : ajoute la filière à la liste officielle (proposée partout sur le site) */
export async function ajouterFiliereOfficielle(f) {
  await setDoc(filieresRef, { liste: arrayUnion(f) }, { merge: true });
  ajouterFilieres([f]);
}
export async function supprimerDemandes(ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, "demandes", id)));
    await batch.commit();
  }
}

/* ---------- Doublons ---------- */
const cleTitre = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/**
 * Admin : cherche les documents en double.
 * surs : même titre ET même taille (copie exacte) ; douteux : même titre, taille différente (à vérifier à la main).
 * Dans chaque groupe, le 1er est celui qu'on garde (publié, le plus téléchargé, le plus ancien).
 */
export async function trouverDoublons() {
  const snap = await getDocs(query(docsCol, limit(5000)));
  const tous = snap.docs.map(lireDoc).filter((d) => d.statut !== "rejete");
  const ordre = (a, b) => (b.statut === "publie") - (a.statut === "publie") || (b.telechargements || 0) - (a.telechargements || 0)
    || (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0);
  const parTitre = new Map();
  tous.forEach((d) => { const k = cleTitre(d.titre); if (!k) return; if (!parTitre.has(k)) parTitre.set(k, []); parTitre.get(k).push(d); });
  const surs = [], douteux = [];
  for (const groupe of parTitre.values()) {
    if (groupe.length < 2) continue;
    const parTaille = new Map();
    groupe.forEach((d) => { const k = d.taille || 0; if (!parTaille.has(k)) parTaille.set(k, []); parTaille.get(k).push(d); });
    let reste = [];
    for (const g of parTaille.values()) (g.length > 1 ? surs.push(g.sort(ordre)) : reste.push(g[0]));
    if (reste.length > 1) douteux.push(reste.sort(ordre));
  }
  return { surs, douteux };
}
/** Admin : supprime une liste d'identifiants (fiche, lien du fichier, entrée de l'index) */
export async function supprimerDocuments(ids) {
  for (let i = 0; i < ids.length; i += 150) {
    const batch = writeBatch(db);
    const lot = ids.slice(i, i + 150);
    batch.set(indexRef, { docs: Object.fromEntries(lot.map((id) => [id, deleteField()])) }, { merge: true });
    lot.forEach((id) => { batch.delete(fileRef(id)); batch.delete(doc(db, "documents", id)); });
    await batch.commit();
  }
  return ids.length;
}

/* ---------- Paiements ---------- */

const paiementsCol = collection(db, "paiements");

export async function createPaiement(user, profile, { packs, operateur, numero, reference }) {
  const ref = await addDoc(paiementsCol, {
    uid: user.uid,
    nom: profile?.nom || user.email,
    email: user.email,
    packs,
    montant: packs * paymentConfig.prixPack,
    credits: packs * paymentConfig.creditsParPack,
    operateur, numero, reference,
    statut: "en_attente",
    createdAt: serverTimestamp(),
  });
  // Notification : un appui ouvre directement ce paiement dans l'admin, prêt à confirmer
  prevenirAdmin("Paiement à confirmer", `${packs * paymentConfig.prixPack} FCFA (${packs * paymentConfig.creditsParPack} crédits) via ${operateur}, réf. ${reference}. Appuie pour confirmer.`, `admin.html?paiement=${ref.id}`);
  return ref;
}
export async function listMyPaiements(uid) {
  return mapSnap(await getDocs(query(paiementsCol, where("uid", "==", uid), limit(100))));
}
export async function listPaiements(statut) {
  return mapSnap(await getDocs(query(paiementsCol, where("statut", "==", statut), limit(300))));
}
/** Admin : valide le paiement et ajoute les crédits */
export async function confirmPaiement(p) {
  const batch = writeBatch(db);
  batch.update(doc(db, "paiements", p.id), { statut: "confirme", traiteLe: serverTimestamp() });
  batch.update(doc(db, "users", p.uid), { credits: increment(p.credits) });
  await batch.commit();
}
/** Admin : suit en direct ce qui attend une action (paiements et documents en attente) */
export function watchEnAttente(cb) {
  const etat = { pay: null, doc: null };
  const envoyer = () => { if (etat.pay && etat.doc) cb(etat); };
  const u1 = onSnapshot(query(paiementsCol, where("statut", "==", "en_attente"), limit(100)),
    (s) => { etat.pay = mapSnap(s); envoyer(); }, () => {});
  const u2 = onSnapshot(query(docsCol, where("statut", "==", "en_attente"), limit(100)),
    (s) => { etat.doc = mapSnap(s); envoyer(); }, () => {});
  return () => { u1(); u2(); };
}
export const rejectPaiement = (id) =>
  updateDoc(doc(db, "paiements", id), { statut: "rejete", traiteLe: serverTimestamp() });
