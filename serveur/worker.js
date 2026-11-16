/**
 * Serveur de paiement unidev (Cloudflare Worker, gratuit). Un seul fichier, à coller dans Cloudflare.
 *
 *   POST /payer     { idToken, packs, methode }  -> crée le paiement chez Jèko, renvoie { url } (page de paiement)
 *   POST /verifier  { idToken, paiement }        -> au retour de l'étudiant : vérifie chez Jèko et crédite si payé
 *   POST /jeko      (appelé par Jèko)            -> avis de paiement signé : crédite l'étudiant
 *
 * Stockage des fichiers (Cloudflare R2, liaison « FICHIERS ») :
 *   GET  /f/<clé>                                -> le fichier (public, comme avant sur Cloudinary ; clé introuvable à deviner)
 *   POST /envoyer?genre=doc|image&nom=…          -> envoi par un étudiant connecté (en-tête Authorization: Bearer <jeton>)
 *   POST /copier   { source, cle }               -> outils : copie un fichier Cloudinary dans R2 (en-tête X-Secret)
 *   POST /deposer?cle=…                          -> outils : dépose un fichier dans R2 (en-tête X-Secret)
 *
 * Les crédits ne sont donnés qu'après confirmation de Jèko (avis signé, puis vérification directe chez Jèko),
 * une seule fois par paiement. Rien n'est jamais crédité sur la seule parole du navigateur.
 *
 * Réglages (Cloudflare > le Worker > Settings > Variables and Secrets) :
 *   Secrets : JEKO_API_KEY, JEKO_API_KEY_ID, JEKO_STORE_ID, JEKO_WEBHOOK_SECRET, FIREBASE_CLE_JSON
 *   Texte   : SITE (https://unidev-2026.web.app), FIREBASE_API_KEY, PRIX_PACK (100), CREDITS_PACK (5)
 *   Secret  : OUTILS_SECRET (mot de passe des outils GitHub pour /copier et /deposer)
 *   Secret  : NTFY_TOPIC (nom du salon ntfy de l'admin ; garde-le ici, pas dans le code du site)
 *   Liaison R2 : FICHIERS -> le bucket « unidev-fichiers »
 *
 *   POST /prevenir { idToken, type, info }       -> prévient l'admin (ntfy). type : document|demande|signalement|paiement
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
      JEKO_API_KEY_ID: propre(env.JEKO_API_KEY_ID), JEKO_STORE_ID: propre(env.JEKO_STORE_ID), JEKO_WEBHOOK_SECRET: propre(env.JEKO_WEBHOOK_SECRET),
      OUTILS_SECRET: propre(env.OUTILS_SECRET) };
    const cors = {
      "Access-Control-Allow-Origin": sites.includes(origine) ? origine : sites[0] || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });
    // Fichiers : lus par tout le monde (le lien n'est donné qu'aux étudiants qui ont débloqué le document)
    if (url.pathname.startsWith("/f/") && (request.method === "GET" || request.method === "HEAD")) return lireFichier(request, env, url);
    if (url.pathname.startsWith("/f/") && request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_FICHIERS });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // Page d'état (aucun secret affiché) : dit ce qui manque encore
    if (request.method === "GET") {
      const etat = { ok: true, service: "unidev-paiement", jeko: !!env.JEKO_API_KEY, site: !!env.SITE, firebase: !!env.FIREBASE_CLE_JSON, webhook: !!env.JEKO_WEBHOOK_SECRET,
        stockage: !!env.FICHIERS, outils: !!env.OUTILS_SECRET,
        // Empreinte du mot de passe des outils (4 caractères, ne révèle rien) : doit être la même que celle affichée par GitHub
        empreinte: env.OUTILS_SECRET ? (await empreinte(env.OUTILS_SECRET)) : "" };
      if (url.pathname === "/etat" && env.FIREBASE_CLE_JSON) {
        const t = await fsLire(env, "parametres/jeko").catch(() => null);
        if (t) etat.dernierAvisJeko = { quand: t.champs.dernierAvis, etat: t.champs.dernierEtat, resultat: t.champs.dernierResultat };
      }
      if (env.JEKO_API_KEY && url.pathname === "/etat") {
        try { etat.magasin = !!(await magasin(env)); } catch (e) { etat.magasin = false; etat.probleme = e.message; }
      }
      return json(etat);
    }
    try {
      if (url.pathname === "/jeko") return await avisJeko(request, env);
      if (url.pathname === "/prevenir") return json(await prevenir(await request.json().catch(() => ({})), env));
      if (url.pathname === "/envoyer") return json(await envoyerFichier(request, env, url));
      if (url.pathname === "/deposer") return json(await deposerFichier(request, env, url));
      if (url.pathname === "/copier") return json(await copierFichier(request, env));
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
  // En parallèle : qui est l'étudiant, jeton Google et magasin Jèko (au lieu de les attendre l'un après l'autre)
  const [user] = await Promise.all([quiEstCe(idToken, env), jetonGoogle(env).catch(() => {}), magasin(env).catch(() => {})]);
  packs = Math.floor(Number(packs));
  if (!(packs >= 1 && packs <= 10)) throw erreur("Nombre de packs invalide");
  if (!METHODES.includes(methode)) throw erreur("Moyen de paiement inconnu");
  const prix = Number(env.PRIX_PACK || 100), parPack = Number(env.CREDITS_PACK || 5);
  const montant = packs * prix, credits = packs * parPack;
  const site = (env.SITE || "").replace(/\/$/, "");

  const id = idAleatoire();
  const r = await fetch(`${JEKO}/payment_requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": env.JEKO_API_KEY, "X-API-KEY-ID": env.JEKO_API_KEY_ID },
    body: JSON.stringify({
      storeId: await magasin(env), amountCents: montant * 100, currency: "XOF", reference: id,
      paymentDetails: { type: "redirect", data: { paymentMethod: methode, successUrl: `${site}/credits.html?paiement=${id}`, errorUrl: `${site}/acheter.html?echec=${id}` } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.redirectUrl) throw erreur("Le paiement n'a pas pu être lancé. Réessaie, ou utilise le paiement manuel plus bas.", 502);
  // Une seule écriture (avec l'identifiant Jèko). Elle doit réussir AVANT d'envoyer l'étudiant payer.
  const paiement = {
    uid: user.uid, nom: user.nom || user.email || "", email: user.email || "",
    packs, montant, credits, operateur: NOMS[methode], numero: "", reference: `Jèko ${id}`,
    statut: "jeko", auto: true, jekoId: String(j.id || ""), createdAt: new Date(),
  };
  for (let essai = 1; ; essai++) {
    try { await fsCreer(env, `paiements/${id}`, paiement); break; }
    catch (e) { if (essai >= 3) throw erreur("Le paiement n'a pas pu être préparé. Réessaie dans un instant.", 503); }
  }
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
  if (!env.JEKO_WEBHOOK_SECRET || !memeTexte(signature.replace(/^sha256=/, ""), attendue)) {
    await fsModifier(env, "parametres/jeko", { dernierAvis: new Date().toISOString(), dernierResultat: "signature invalide (secret du webhook différent)" }).catch(() => {});
    return new Response("signature invalide", { status: 401 });
  }
  let avis = {};
  try { avis = JSON.parse(brut); } catch { return new Response("ok"); }
  const ref = String(avis?.transactionDetails?.reference || avis?.apiTransactionableDetails?.reference || avis?.reference || avis?.data?.reference || "");
  const etat = etatJeko(avis);
  let resultat = "ignoré";
  if (PAYE.includes(etat) && /^[A-Za-z0-9]{10,40}$/.test(ref)) {
    const p = await fsLire(env, `paiements/${ref}`).catch(() => null);
    if (p && p.champs.statut === "jeko") {
      // L'avis est signé par Jèko : il suffit (pas besoin de redemander à Jèko, c'est ce qui faisait attendre)
      resultat = (await crediter(env, ref, p).catch((e) => ({ statut: `erreur ${e.message}` }))).statut;
    } else resultat = p ? `déjà ${p.champs.statut}` : "paiement inconnu";
  }
  // Trace du dernier avis (visible sur /etat), pour vérifier que Jèko prévient bien le serveur
  await fsModifier(env, "parametres/jeko", { dernierAvis: new Date().toISOString(), dernierEtat: etat.slice(0, 30), dernierResultat: String(resultat).slice(0, 60) }).catch(() => {});
  return new Response("ok"); // 200 : Jèko n'a pas besoin de renvoyer l'avis
}

/* ---------- Notifier l'admin (ntfy) : le topic reste côté serveur, jamais dans le code du site ---------- */
const MODELES_AVIS = {
  document: ["Document à valider", "Un nouveau document attend ta validation."],
  demande: ["Filière demandée", "Une filière ou un document a été demandé."],
  signalement: ["Document signalé", "Un document a été signalé."],
  paiement: ["Paiement à confirmer", "Un paiement manuel attend ta confirmation."],
};
async function prevenir({ idToken, type, info }, env) {
  if (!env.NTFY_TOPIC) return { ok: false };
  const m = MODELES_AVIS[type];
  if (!m) return { ok: false };
  // Il faut être connecté : empêche n'importe qui d'inonder l'admin de fausses alertes
  await quiEstCe(idToken, env);
  const extra = String(info || "").replace(/[\r\n]+/g, " ").replace(/[^\P{Cc}]/gu, "").slice(0, 120).trim();
  const site = (env.SITE || "https://unidev-2026.web.app").replace(/\/$/, "");
  await fetch("https://ntfy.sh/", {
    method: "POST",
    body: JSON.stringify({ topic: String(env.NTFY_TOPIC || "").trim().replace(/^["']+|["']+$/g, ""), title: m[0], message: extra ? `${m[1]} ${extra}` : m[1], priority: 4, tags: ["bell"], click: `${site}/admin.html` }),
  }).catch(() => {});
  return { ok: true };
}

const PAYE = ["success", "successful", "succeeded", "completed", "paid", "done"];
const RATE = ["error", "failed", "failure", "canceled", "cancelled", "expired", "rejected"];
const etatJeko = (j) => String(j?.status ?? j?.data?.status ?? j?.state ?? "").toLowerCase();

/** Demande à Jèko l'état réel du paiement ; s'il est payé, donne les crédits (une seule fois). */
async function crediterSiPaye(env, id, p) {
  const c = p.champs;
  if (c.statut === "confirme") return { statut: "confirme", credits: c.credits };
  if (c.statut !== "jeko" || !c.jekoId) return { statut: c.statut };
  const r = await fetch(`${JEKO}/payment_requests/${encodeURIComponent(c.jekoId)}`, { headers: { "X-API-KEY": env.JEKO_API_KEY, "X-API-KEY-ID": env.JEKO_API_KEY_ID } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { statut: "jeko" };
  const etat = etatJeko(j);
  if (RATE.includes(etat)) { await fsModifier(env, `paiements/${id}`, { statut: "rejete", motif: "Paiement annulé ou échoué" }).catch(() => {}); return { statut: "rejete" }; }
  if (!PAYE.includes(etat)) return { statut: "jeko" };
  // Le montant payé doit être celui du paiement (quand Jèko le renvoie)
  if (j.amountCents != null && Number(j.amountCents) !== c.montant * 100) return { statut: "jeko" };
  return crediter(env, id, p);
}

/** Donne les crédits et marque le paiement confirmé, en une seule écriture qui ne peut réussir qu'une fois */
async function crediter(env, id, p) {
  const c = p.champs;
  if (c.statut === "confirme") return { statut: "confirme", credits: c.credits };
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

/* ---------- Stockage des fichiers (R2) ---------- */
const CORS_FICHIERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, ETag",
};
const MAX_DOC = 100 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024;
// Types qui peuvent exécuter du code dans le navigateur (vol de session, hameçonnage) : jamais servis tels quels
const TYPE_DANGEREUX = /^\s*(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/ecmascript)/i;
// Images réellement sûres à afficher en ligne (le SVG est volontairement exclu : il peut contenir du script)
const IMAGE_SURE = /^\s*image\/(jpeg|png|webp|gif|bmp|avif|heic|heif)\b/i;
const typeSur = (t) => TYPE_DANGEREUX.test(t) ? "application/octet-stream" : String(t || "application/octet-stream").split(";")[0].slice(0, 120);
const nomPropre = (n) => String(n || "fichier").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(-90) || "fichier";
const cleValide = (c) => /^(documents|images|opportunites)\/[\w./-]{3,200}$/.test(c) && !c.includes("..");
const lienFichier = (url, cle) => `${url.origin}/f/${cle.split("/").map(encodeURIComponent).join("/")}`;
function stockage(env) {
  if (!env.FICHIERS) throw erreur("Stockage R2 non relié au serveur (liaison FICHIERS).", 503);
  return env.FICHIERS;
}
function secretOutils(request, env) {
  const s = request.headers.get("X-Secret") || "";
  if (!env.OUTILS_SECRET || !memeTexte(s.trim().replace(/^["']+|["']+$/g, ""), env.OUTILS_SECRET)) throw erreur("Accès refusé", 401);
}
/** Range « bytes=a-b » -> option R2 */
function plage(h) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || "");
  if (!m || (!m[1] && !m[2])) return undefined;
  if (!m[1]) return { suffix: Number(m[2]) };
  return m[2] ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : { offset: Number(m[1]) };
}
async function lireFichier(request, env, url) {
  const cle = decodeURIComponent(url.pathname.slice(3));
  if (!cleValide(cle) || !env.FICHIERS) return new Response("Introuvable", { status: 404, headers: CORS_FICHIERS });
  const range = plage(request.headers.get("Range"));
  const obj = request.method === "HEAD" ? await env.FICHIERS.head(cle) : await env.FICHIERS.get(cle, range ? { range } : {});
  if (!obj) return new Response("Introuvable", { status: 404, headers: CORS_FICHIERS });
  const h = new Headers(CORS_FICHIERS);
  obj.writeHttpMetadata(h);
  // Sécurité : ne jamais laisser un fichier envoyé par un étudiant s'exécuter dans le navigateur.
  // Le type stocké est forcé à une valeur sûre, le navigateur ne devine plus le type, et tout ce qui
  // n'est pas une vraie image (documents, SVG, HTML…) est téléchargé au lieu d'être ouvert dans la page.
  const typeStocke = String(obj.httpMetadata?.contentType || "");
  h.set("Content-Type", typeSur(typeStocke));
  h.set("X-Content-Type-Options", "nosniff");
  if (!IMAGE_SURE.test(typeStocke)) {
    const nom = cle.split("/").pop() || "fichier";
    h.set("Content-Disposition", `attachment; filename="${nom.replace(/[^\w.-]+/g, "_")}"`);
  }
  h.set("ETag", obj.httpEtag);
  h.set("Cache-Control", "public, max-age=31536000, immutable");
  h.set("Accept-Ranges", "bytes");
  if (request.method === "HEAD") { h.set("Content-Length", String(obj.size)); return new Response(null, { headers: h }); }
  if (range && obj.range) {
    const debut = obj.range.offset ?? (obj.size - obj.range.suffix);
    const longueur = obj.range.length ?? (obj.size - debut);
    h.set("Content-Range", `bytes ${debut}-${debut + longueur - 1}/${obj.size}`);
    h.set("Content-Length", String(longueur));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers: h });
}
/** Met un corps de requête/réponse dans R2 (taille connue : envoi en continu ; sinon en mémoire) */
async function ranger(env, cle, corps, taille, type) {
  const opts = { httpMetadata: { contentType: type || "application/octet-stream" } };
  if (taille > 0 && corps) {
    const { readable, writable } = new FixedLengthStream(taille);
    const copie = corps.pipeTo(writable);
    const obj = await stockage(env).put(cle, readable, opts);
    await copie;
    return obj;
  }
  return stockage(env).put(cle, await new Response(corps).arrayBuffer(), opts);
}
/** Envoi par un étudiant connecté (document ou image de couverture) */
async function envoyerFichier(request, env, url) {
  if (request.method !== "POST") throw erreur("Méthode non autorisée", 405);
  const user = await quiEstCe((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env);
  const genre = url.searchParams.get("genre") === "image" ? "image" : "doc";
  const taille = Number(request.headers.get("Content-Length") || 0);
  if (!taille) throw erreur("Fichier vide");
  if (taille > (genre === "image" ? MAX_IMAGE : MAX_DOC)) throw erreur(genre === "image" ? "Image trop lourde (15 Mo maximum)." : "Fichier trop lourd (100 Mo maximum).", 413);
  const typeRecu = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].slice(0, 120);
  if (genre === "image" && !IMAGE_SURE.test(typeRecu)) throw erreur("Image non acceptée (formats : JPG, PNG, WebP, GIF).");
  // On ne stocke jamais un type qui pourrait s'exécuter (HTML, SVG, JS…)
  const type = genre === "image" ? typeRecu : typeSur(typeRecu);
  const cle = `${genre === "image" ? "images" : "documents"}/${user.uid}/${idAleatoire()}/${nomPropre(url.searchParams.get("nom"))}`;
  const obj = await ranger(env, cle, request.body, taille, type);
  return { url: lienFichier(url, cle), cle, bytes: obj?.size || taille };
}
/** Outils : dépose un fichier (corps brut) */
async function deposerFichier(request, env, url) {
  secretOutils(request, env);
  const cle = String(url.searchParams.get("cle") || "");
  if (!cleValide(cle)) throw erreur("Clé invalide");
  const type = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0];
  const obj = await ranger(env, cle, request.body, Number(request.headers.get("Content-Length") || 0), type);
  return { url: lienFichier(url, cle), cle, bytes: obj?.size || 0 };
}
/** Outils : copie un fichier Cloudinary dans R2 (rien n'est recopié s'il y est déjà) */
async function copierFichier(request, env) {
  secretOutils(request, env);
  const { source, cle } = await request.json().catch(() => ({}));
  if (!cleValide(String(cle || ""))) throw erreur("Clé invalide");
  if (!/^https:\/\/(res|api)\.cloudinary\.com\//.test(String(source || ""))) throw erreur("Source non autorisée");
  const url = new URL(request.url);
  const deja = await stockage(env).head(cle);
  if (deja) return { url: lienFichier(url, cle), cle, bytes: deja.size, deja: true };
  const r = await fetch(source, { headers: { "Accept-Encoding": "identity" } });
  if (!r.ok) throw erreur(`Cloudinary répond ${r.status}${r.headers.get("x-cld-error") ? ` (${r.headers.get("x-cld-error")})` : ""}`, r.status === 404 ? 404 : 502);
  const type = (r.headers.get("Content-Type") || "application/octet-stream").split(";")[0];
  // Fichier compressé pendant le transfert : sa taille annoncée n'est pas la vraie, on le lit en entier
  const taille = r.headers.get("Content-Encoding") ? 0 : Number(r.headers.get("Content-Length") || 0);
  let obj;
  try { obj = await ranger(env, cle, r.body, taille, type); }
  catch (e) { throw erreur(`Rangement dans R2 impossible : ${String(e.message || e).slice(0, 120)}`, 500); }
  return { url: lienFichier(url, cle), cle, bytes: obj?.size || 0 };
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
async function empreinte(t) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].slice(0, 2).map((b) => b.toString(16).padStart(2, "0")).join("");
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
