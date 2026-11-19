#!/usr/bin/env node
/**
 * Rapport du matin (chaque jour sur GitHub) :
 *  1. donne les crédits de parrainage (2 crédits au parrain quand son filleul a confirmé son e-mail) ;
 *  2. prépare la vitrine du site : documents recherchés par les étudiants ;
 *  3. envoie à l'admin une notification avec l'état du site (documents, attentes, paiements, inscrits).
 *
 *   node rapport.js            -> fait tout
 *   node rapport.js --essai    -> affiche le rapport sans rien modifier ni envoyer
 *
 * Économe : des comptages (1 lecture pour 1 000 éléments) et quelques dizaines de lectures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import { lireCatalogue } from "./catalogue.js";
import { canonFiliere, ajouterFilieres, appliquerRenommages } from "../../js/filieres.js";
// Topic ntfy : lu depuis le secret GitHub NTFY_TOPIC (plus ecrit dans le code public du site)
const NTFY_TOPIC = (process.env.NTFY_TOPIC || "").trim().replace(/^["']+|["']+$/g, "");

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ESSAI = process.argv.includes("--essai");
const CREDITS_PARRAIN = 2;
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
if (!fs.existsSync(cle)) { console.error(`Clé Firebase introuvable : ${cle}`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const db = admin.firestore();
// Filières ajoutées et renommages / fusions / suppressions décidés par l'admin
{ const r = (await db.doc("index/filieres").get().catch(() => null))?.data() || {}; ajouterFilieres(r.liste || []); appliquerRenommages(r.renommages || []); }
const compter = async (q) => { try { return (await q.count().get()).data().count; } catch { return null; } };
const hier = new Date(Date.now() - 24 * 3600 * 1000);

/* ---------- 1. Parrainages ---------- */
let parrainages = 0;
try {
  const snap = await db.collection("parrainages").where("paye", "==", false).limit(200).get();
  for (const s of snap.docs) {
    const { parrain } = s.data();
    let filleul = null;
    try { filleul = await admin.auth().getUser(s.id); } catch {}
    if (!filleul) { if (!ESSAI) await s.ref.update({ paye: true, annule: "compte supprimé" }); continue; }
    if (!filleul.emailVerified) continue; // on attend qu'il confirme son e-mail
    const refParrain = db.collection("users").doc(String(parrain));
    if (!(await refParrain.get()).exists) { if (!ESSAI) await s.ref.update({ paye: true, annule: "parrain inconnu" }); continue; }
    parrainages++;
    if (ESSAI) continue;
    const batch = db.batch();
    batch.update(refParrain, { credits: admin.firestore.FieldValue.increment(CREDITS_PARRAIN), filleuls: admin.firestore.FieldValue.increment(1) });
    batch.update(s.ref, { paye: true, payeLe: admin.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
  }
} catch (e) { console.log(`Parrainages : ${e.message}`); }

/* ---------- 2. Vitrine : documents recherchés ---------- */
let demandes = [];
try {
  const snap = await db.collection("demandes").orderBy("createdAt", "desc").limit(150).get();
  const vus = new Set();
  for (const s of snap.docs) {
    const d = s.data();
    const texte = String(d.document || (String(d.contact || "").startsWith("Cherche : ") ? d.contact.slice(10) : "")).replace(/\s+/g, " ").trim();
    const k = texte.toLowerCase();
    if (texte.length < 6 || vus.has(k)) continue;
    vus.add(k);
    demandes.push({ document: texte.slice(0, 120), filiere: canonFiliere(d.filiere) || "", niveau: d.niveau || "" });
    if (demandes.length >= 30) break;
  }
  if (!ESSAI) await db.doc("parametres/vitrine").set({ demandes, majLe: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
} catch (e) { console.log(`Vitrine : ${e.message}`); }

/* ---------- 3. État du site ---------- */
const catalogue = await lireCatalogue(db).catch(() => ({}));
const publies = Object.keys(catalogue).length;
const [docsAttente, paieAttente, inscrits, nouveaux, signales] = await Promise.all([
  compter(db.collection("documents").where("statut", "==", "en_attente")),
  compter(db.collection("paiements").where("statut", "==", "en_attente")),
  compter(db.collection("users")),
  compter(db.collection("users").where("createdAt", ">", hier)),
  compter(db.collection("signalements").where("createdAt", ">", hier)),
]);
const n = (v) => (v === null ? "?" : v);
const lignes = [
  `Documents en ligne : ${publies}`,
  `A valider : ${n(docsAttente)} document(s), ${n(paieAttente)} paiement(s)`,
  `Inscrits : ${n(inscrits)} (dont ${n(nouveaux)} depuis hier)`,
  `Signalements depuis hier : ${n(signales)}`,
  `Parrainages récompensés : ${parrainages}`,
  `Documents recherchés affichés : ${demandes.length}`,
];
if (publies > 10000) lignes.push("ATTENTION : le catalogue approche de sa limite (12 000). Préviens pour ajouter des morceaux.");
console.log(lignes.join("\n"));

if (!ESSAI && NTFY_TOPIC) {
  try {
    await fetch("https://ntfy.sh/", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: NTFY_TOPIC, title: "unidev : rapport du matin", message: lignes.join("\n"), click: "https://unidev-2026.web.app/admin.html",
        priority: (docsAttente || 0) + (paieAttente || 0) > 0 ? 4 : 2 }) });
    console.log("\nNotification envoyée.");
  } catch (e) { console.log(`\nNotification non envoyée : ${e.message}`); }
}
process.exit(0);
