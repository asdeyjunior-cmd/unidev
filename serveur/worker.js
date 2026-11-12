/**
 * Serveur de paiement unidev (Cloudflare Worker, gratuit). Un seul fichier, à coller dans Cloudflare.
 *
 *   POST /payer     { idToken, packs, methode }  -> crée le paiement chez Jèko, renvoie { url } (page de paiement)
 *   POST /verifier  { idToken, paiement }        -> au retour de l'étudiant : vérifie chez Jèko et crédite si payé
 *   POST /jeko      (appelé par Jèko)            -> avis de paiement signé : crédite l'étudiant
 *
 * Les crédits ne sont donnés qu'après confirmation de Jèko (avis signé, puis vérification directe chez Jèko),
 * une seule fois par paiement. Rien n'est jamais crédité sur la seule parole du navigateur.
 *
 * Réglages (Cloudflare > le Worker > Settings > Variables and Secrets) :
 *   Secrets : JEKO_API_KEY, JEKO_API_KEY_ID, JEKO_STORE_ID, JEKO_WEBHOOK_SECRET, FIREBASE_CLE_JSON
 *   Texte   : SITE (https://unidev-2026.web.app), FIREBASE_API_KEY, PRIX_PACK (100), CREDITS_PACK (5)
 */
const JEKO = "https://api.jeko.africa/partner_api";
const METHODES = ["wave", "orange", "mtn", "moov", "djamo"];
const NOMS = { wave: "Wave", orange: "Orange Money", mtn: "MTN MoMo", moov: "Moov Money", djamo: "Djamo" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // SITE peut contenir plusieurs adresses séparées par des virgules ; la première sert aux retours de paiement
    const sites = String(env.SITE || "").split(",").map((x) => x.trim().replace(/^["']+|["']+$/g, "").replace(/\/$/, "")).filter(Boolean);
    const origine = request.headers.get("Origin") || "";
    // Réglages nettoyés : espaces et guillemets collés par erreur autour d'une valeur sont retirés
    const propre = (v) => String(v || "").trim().replace(/^["']+|["']+$/g, "");
    env = { ...env, SITE: sites[0] || "", FIREBASE_API_KEY: propre(env.FIREBASE_API_KEY), JEKO_API_KEY: propre(env.JEKO_API_KEY),
      JEKO_API_KEY_ID: propre(env.JEKO_API_KEY_ID), JEKO_STORE_ID: propre(env.JEKO_STORE_ID), JEKO_WEBHOOK_SECRET: propre(env.JEKO_WEBHOOK_SECRET) };
    const cors = {
      "Access-Control-Allow-Origin": sites.includes(origine) ? origine : sites[0] || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // Page d'état (aucun secret affiché) : dit ce qui manque encore
    if (request.method === "GET") {
      const etat = { ok: true, service: "unidev-paiement", jeko: !!env.JEKO_API_KEY, site: !!env.SITE, firebase: !!env.FIREBASE_CLE_JSON, webhook: !!env.JEKO_WEBHOOK_SECRET };
      if (env.JEKO_API_KEY && url.pathname === "/etat") {
        try { etat.magasin = !!(await magasin(env)); } catch (e) { etat.magasin = false; etat.probleme = e.message; }
      }
      return json(etat);
    }
    try {
      if (url.pathname === "/jeko") return await avisJeko(request, env);
      const corps = await request.json().catch(() => ({}));
      if (url.pathname === "/payer") return json(await payer(corps, env));
      if (url.pathname === "/verifier") return json(await verifier(corps, env));
      return json({ erreur: "Adresse inconnue" }, 404);
    } catch (e) {
      return json({ erreur: e.message || "Erreur du serveur" }, e.status || 500);
    }
  },
};

const erreur = (message, status = 400) => Object.assign(new Error(message), { status });

/* ---------- 1. L'étudiant clique « Payer » ---------- */
async function payer({ idToken, packs, methode }, env) {
  const user = await quiEstCe(idToken, env);
  packs = Math.floor(Number(packs));
  if (!(packs >= 1 && packs <= 50)) throw erreur("Nombre de packs invalide");
  if (!METHODES.includes(methode)) throw erreur("Moyen de paiement inconnu");
  const prix = Number(env.PRIX_PACK || 100), parPack = Number(env.CREDITS_PACK || 5);
  const montant = packs * prix, credits = packs * parPack;
  const site = (env.SITE || "").replace(/\/$/, "");

  const id = idAleatoire();
  await fsCreer(env, `paiements/${id}`, {
    uid: user.uid, nom: user.nom || user.email || "", email: user.email || "",
    packs, montant, credits, operateur: NOMS[methode], numero: "", reference: `Jèko ${id}`,
    statut: "jeko", auto: true, createdAt: new Date(),
  });

  const r = await fetch(`${JEKO}/payment_requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": env.JEKO_API_KEY, "X-API-KEY-ID": env.JEKO_API_KEY_ID },
    body: JSON.stringify({
      storeId: await magasin(env), amountCents: montant * 100, currency: "XOF", reference: id,
      paymentDetails: { type: "redirect", data: { paymentMethod: methode, successUrl: `${site}/credits.html?paiement=${id}`, errorUrl: `${site}/acheter.html?echec=${id}` } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.redirectUrl) {
    await fsModifier(env, `paiements/${id}`, { statut: "rejete", motif: `Jèko : ${String(j.message || j.error || r.status).slice(0, 150)}` });
    throw erreur("Le paiement n'a pas pu être lancé. Réessaie, ou utilise le paiement manuel plus bas.", 502);
  }
  await fsModifier(env, `paiements/${id}`, { jekoId: String(j.id || "") });
  return { url: j.redirectUrl, paiement: id };
}

/** Identifiant du magasin Jèko : le réglage JEKO_STORE_ID, sinon le premier magasin du compte (demandé à Jèko, gardé en mémoire) */
let magasinMemo = "";
async function magasin(env) {
  if (env.JEKO_STORE_ID) return env.JEKO_STORE_ID;
  if (magasinMemo) return magasinMemo;
  const r = await fetch(`${JEKO}/stores`, { headers: { "X-API-KEY": env.JEKO_API_KEY, "X-API-KEY-ID": env.JEKO_API_KEY_ID } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw erreur(`Jèko refuse la clé : ${String(j.message || j.error || j.code || r.status).slice(0, 120)}`, 502);
  const liste = Array.isArray(j) ? j : j.data || j.stores || j.items || [];
  const id = liste[0]?.id || liste[0]?.storeId;
  if (!id) throw erreur("Aucun magasin trouvé sur le compte Jèko", 502);
  return (magasinMemo = String(id));
}

/* ---------- 2. Retour de l'étudiant (au cas où l'avis de Jèko tarde) ---------- */
async function verifier({ idToken, paiement }, env) {
  const user = await quiEstCe(idToken, env);
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(paiement || ""))) throw erreur("Paiement inconnu");
  const p = await fsLire(env, `paiements/${paiement}`);
  if (!p || p.champs.uid !== user.uid) throw erreur("Paiement inconnu", 404);
  return crediterSiPaye(env, paiement, p);
}

/* ---------- 3. Avis de paiement envoyé par Jèko ---------- */
async function avisJeko(request, env) {
  const brut = await request.text();
  const signature = (request.headers.get("Jeko-Signature") || "").trim().toLowerCase();
  const attendue = await hmacHex(env.JEKO_WEBHOOK_SECRET || "", brut);
  if (!env.JEKO_WEBHOOK_SECRET || !memeTexte(signature.replace(/^sha256=/, ""), attendue)) return new Response("signature invalide", { status: 401 });
  let avis = {};
  try { avis = JSON.parse(brut); } catch { return new Response("ok"); }
  const ref = String(avis?.transactionDetails?.reference || avis?.apiTransactionableDetails?.reference || "");
  if (avis.status === "success" && /^[A-Za-z0-9]{10,40}$/.test(ref)) {
    const p = await fsLire(env, `paiements/${ref}`);
    if (p) await crediterSiPaye(env, ref, p).catch(() => {});
  }
  return new Response("ok"); // 200 : Jèko n'a pas besoin de renvoyer l'avis
}

/** Demande à Jèko l'état réel du paiement ; s'il est payé, donne les crédits (une seule fois). */
async function crediterSiPaye(env, id, p) {
  const c = p.champs;
  if (c.statut === "confirme") return { statut: "confirme", credits: c.credits };
  if (c.statut !== "jeko" || !c.jekoId) return { statut: c.statut };
  const r = await fetch(`${JEKO}/payment_requests/${encodeURIComponent(c.jekoId)}`, { headers: { "X-API-KEY": env.JEKO_API_KEY, "X-API-KEY-ID": env.JEKO_API_KEY_ID } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { statut: "jeko" };
  if (j.status === "error") { await fsModifier(env, `paiements/${id}`, { statut: "rejete", motif: "Paiement annulé ou échoué" }).catch(() => {}); return { statut: "rejete" }; }
  if (j.status !== "success") return { statut: "jeko" };
  // Le montant payé doit être celui du paiement (quand Jèko le renvoie)
  if (j.amountCents != null && Number(j.amountCents) !== c.montant * 100) return { statut: "jeko" };
  // Écriture groupée : « confirmé » + crédits. La condition (version du paiement inchangée) empêche de créditer deux fois.
  const jeton = await jetonGoogle(env);
  const base = `projects/${projet(env)}/databases/(default)/documents`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
    method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [
      { update: { name: `${base}/paiements/${id}`, fields: { statut: { stringValue: "confirme" }, traiteLe: { timestampValue: new Date().toISOString() } } },
        updateMask: { fieldPaths: ["statut", "traiteLe"] }, currentDocument: { updateTime: p.version } },
      { transform: { document: `${base}/users/${c.uid}`, fieldTransforms: [{ fieldPath: "credits", increment: { integerValue: String(c.credits) } }] } },
    ] }),
  });
  if (!res.ok) {
    const apres = await fsLire(env, `paiements/${id}`); // déjà crédité par l'autre chemin (avis + retour en même temps)
    return { statut: apres?.champs.statut || "jeko", credits: c.credits };
  }
  return { statut: "confirme", credits: c.credits };
}

/* ---------- Qui appelle ? (jeton de connexion Firebase vérifié chez Google) ---------- */
async function quiEstCe(idToken, env) {
  if (!idToken) throw erreur("Connecte-toi d'abord", 401);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json", Referer: env.SITE || "" }, body: JSON.stringify({ idToken }),
  });
  const u = (await r.json().catch(() => ({}))).users?.[0];
  if (!r.ok || !u?.localId) throw erreur("Connexion expirée : reconnecte-toi", 401);
  return { uid: u.localId, email: u.email || "", nom: u.displayName || "" };
}

/* ---------- Firestore (API REST, avec la clé de service) ---------- */
const projet = (env) => JSON.parse(env.FIREBASE_CLE_JSON).project_id;
const versVal = (v) => v instanceof Date ? { timestampValue: v.toISOString() }
  : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : { stringValue: String(v ?? "") };
const deVal = (v) => v.stringValue ?? (v.integerValue != null ? Number(v.integerValue) : v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? null);
const champs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, versVal(v)]));
async function fs(env, methode, chemin, corps) {
  const jeton = await jetonGoogle(env);
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${projet(env)}/databases/(default)/documents/${chemin}`, {
    method: methode, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined,
  });
  if (r.status === 404) return null;
  if (!r.ok) throw erreur("La base de données ne répond pas. Réessaie dans un instant.", 503);
  return r.json();
}
async function fsLire(env, chemin) {
  const d = await fs(env, "GET", chemin);
  return d ? { version: d.updateTime, champs: Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, deVal(v)])) } : null;
}
const fsCreer = (env, chemin, o) => { const [col, id] = chemin.split("/"); return fs(env, "POST", `${col}?documentId=${id}`, { fields: champs(o) }); };
const fsModifier = (env, chemin, o) => fs(env, "PATCH", `${chemin}?${Object.keys(o).map((k) => `updateMask.fieldPaths=${k}`).join("&")}`, { fields: champs(o) });

/* Jeton d'accès Google (valable 1 h, gardé en mémoire) */
let memo = { jeton: "", fin: 0 };
async function jetonGoogle(env) {
  if (memo.jeton && Date.now() < memo.fin) return memo.jeton;
  const cle = JSON.parse(env.FIREBASE_CLE_JSON);
  const b64 = (x) => btoa(typeof x === "string" ? x : String.fromCharCode(...new Uint8Array(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const aSigner = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify({
    iss: cle.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const der = Uint8Array.from(atob(cle.private_key.replace(/-----[^-]+-----|\s/g, "")), (ch) => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(aSigner));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${aSigner}.${b64(sig)}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw erreur("Clé Firebase du serveur refusée (FIREBASE_CLE_JSON)", 500);
  memo = { jeton: j.access_token, fin: Date.now() + 50 * 60 * 1000 };
  return memo.jeton;
}

/* ---------- Petits outils ---------- */
async function hmacHex(secret, texte) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texte));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function memeTexte(a, b) { // comparaison à temps constant
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function idAleatoire() {
  const lettres = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(20))].map((b) => lettres[b % lettres.length]).join("");
}
