#!/usr/bin/env node
// Prévient Bing (et Yandex, Seznam, Naver…) des pages du site, via IndexNow.
// À lancer APRÈS la mise en ligne : METTRE-EN-LIGNE.bat le fait pour toi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(ICI, "../..");
const HOTE = "unidev-2026.web.app";
const CLE = "25c6ee90ceaa09658d078ca91e740ddd"; // le fichier 25c6ee90ceaa09658d078ca91e740ddd.txt est à la racine du site

const sitemap = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, 10000);

const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOTE, key: CLE, keyLocation: `https://${HOTE}/${CLE}.txt`, urlList: urls }),
}).catch((e) => ({ status: 0, statusText: e.message }));

if (r.status === 200 || r.status === 202) console.log(`IndexNow : ${urls.length} page(s) signalée(s) à Bing.`);
else console.log(`IndexNow : réponse ${r.status} ${r.statusText || ""} (sans gravité, réessaie à la prochaine mise en ligne).`);
