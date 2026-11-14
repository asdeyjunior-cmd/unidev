// Verifie que les composants installes (node_modules) sont complets.
// Code de sortie 1 si l'un d'eux est absent ou abime.
const noms = ["cloudinary", "dotenv", "firebase-admin", "pdf-lib", "pdfjs-dist/legacy/build/pdf.mjs", "pdfkit", "sharp"];
let ok = true;
for (const n of noms) {
  try { await import(n); }
  catch (e) { ok = false; console.log("  Composant abime : " + n.split("/")[0]); }
}
process.exit(ok ? 0 : 1);
