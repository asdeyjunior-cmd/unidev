#!/usr/bin/env node
/**
 * Indique au site sur quel compte Cloudinary les étudiants doivent envoyer leurs fichiers :
 * le plus libre. Écrit parametres/stockage dans Firestore (1 écriture, aucune lecture).
 *   node choisir-compte.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import admin from "firebase-admin";
import cloudinaryPkg from "cloudinary";
const cloudinary = cloudinaryPkg.v2; // module CommonJS : objet entier puis sa partie v2 (toutes versions de Node)
import { comptes, choisirCompte } from "./stockage.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
if (!comptes().length) { console.error("Aucun compte Cloudinary réglé."); process.exit(1); }
const cle = path.resolve(ICI, process.env.FIREBASE_CLE || "./cle-firebase.json");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(cle, "utf8"))) });
const nom = await choisirCompte(cloudinary);
await admin.firestore().doc("parametres/stockage").set({ compte: nom, majLe: admin.firestore.FieldValue.serverTimestamp() });
console.log(`Les nouveaux envois du site iront sur : ${nom}`);
process.exit(0);
