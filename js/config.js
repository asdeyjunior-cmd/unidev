// Réglages du projet unidev-2026 (déjà remplis)

// Firebase Console → Paramètres du projet → Vos applications → Application Web
export const firebaseConfig = {
  apiKey: "AIzaSyBi0wy74boVtSY_zrwUDk39HaxoqCG-v-4",
  authDomain: "unidev-2026.firebaseapp.com",
  projectId: "unidev-2026",
  storageBucket: "unidev-2026.firebasestorage.app",
  messagingSenderId: "228713298824",
  appId: "1:228713298824:web:5b115d03d196a897b8983d",
};

// Cloudinary → Dashboard (cloud name) + Settings → Upload → Upload presets (unsigned)
export const cloudinaryConfig = {
  cloudName: "iugeyztf",
  // Comptes Cloudinary utilisés (le 1er = le compte principal). Chaque compte doit avoir les DEUX presets
  // non signés ci-dessous (mêmes noms). Mets les mêmes noms dans firestore.rules (cloudinaryRaw / cloudinaryImage).
  comptes: ["iugeyztf", "qxh2bmzt", "jbqiyzzu", "gxmx1dsh", "nis5hqzo"],
  uploadPreset: "unidev_unsigned",
  folder: "unidev/documents",
  imagePreset: "unidev_images",   // preset non signé réservé aux images de couverture
  imageFolder: "unidev/couvertures",
};

export const MAX_FILE_MB = 100; // au-delà de 9 Mo, le fichier est envoyé en morceaux (plan gratuit Cloudinary : 10 Mo par fichier)
export const MAX_IMAGE_MB = 10;
export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
export const ALLOWED_EXT = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "txt", "zip"];

// Paiement : lien de paiement (Wave, Orange Money, CinetPay…)
export const paymentConfig = {
  url: "https://pay.wave.com/m/M_ci_K4ONjIgRPxcS/c/ci/",
  prixPack: 100,          // FCFA
  creditsParPack: 5,      // documents téléchargeables par pack
  operateurs: ["Wave", "Orange Money", "MTN MoMo", "Moov Money", "Autre"],
};
// E-mail affiché sur la page À propos (laisser vide pour masquer le bloc Contact)
export const CONTACT_EMAIL = "asdeyjunior@gmail.com";
// Notifications de l'admin sur téléphone et PC (appli gratuite ntfy, voir README).
// Ce nom est secret : ne le partage pas. Laisser vide pour désactiver.
export const NTFY_TOPIC = "unidev-admin-6368bb96b270a92d";
export const CREDITS_BIENVENUE = 2;        // crédits offerts à chaque nouvel inscrit
export const CREDITS_PAR_PUBLICATION = 1; // crédits gagnés quand un document envoyé est validé

export const CATEGORIES = {
  types: ["Cours", "TD", "TP", "Examen", "Corrigé", "Mémoire", "Résumé", "Roman", "Autre"],
  niveaux: ["Licence 1", "Licence 2", "Licence 3", "Master 1", "Master 2", "BTS 1", "BTS 2", "Doctorat", "Autre"],
};
