# Faire tourner l'import sur GitHub (PC éteint possible)

Une fois installé, tu lances un import depuis **n'importe quel téléphone ou ordinateur** : il tourne sur les serveurs de GitHub jusqu'au bout (jusqu'à 6 h), même si ton PC est éteint ou que tu n'as plus de connexion. Gratuit (2 000 minutes par mois).

En plus, chaque nuit vers 2 h, GitHub **met le site en ligne** tout seul (pages Google des nouveaux documents + Bing), et le 1er de chaque mois il **nettoie Cloudinary**.

Les modes « dossier de mon PC » et « export Telegram » restent sur ton PC (IMPORTER.bat), car les fichiers sont chez toi.

---

## 1. Créer le compte et mettre le site sur GitHub (une seule fois)

1. Crée un compte gratuit sur **github.com**.
2. Installe **GitHub Desktop** : desktop.github.com, puis connecte-toi.
3. GitHub Desktop → **File → Add local repository** → choisis ton dossier `unidev` → il propose « create a repository » : clique dessus, nom `unidev`, puis **Create repository**.
4. **Vérifie** dans la liste des fichiers à gauche que **`.env` et `cle-firebase.json` n'apparaissent PAS** (le fichier `.gitignore` les bloque). S'ils apparaissent, arrête-toi et demande-moi.
5. Clique **Publish repository**, laisse **« Keep this code private » coché**, puis **Publish**.

## 2. Ranger tes clés dans les « secrets » GitHub (une seule fois)

Sur github.com, ouvre ton dépôt `unidev` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crée ces 3 secrets (nom exact à gauche) :

| Nom | Valeur |
|---|---|
| `FIREBASE_CLE_JSON` | ouvre `outils/import/cle-firebase.json` avec le Bloc-notes, Ctrl+A, Ctrl+C, colle tout |
| `CLOUDINARY_API_KEY` | la valeur de `CLOUDINARY_API_KEY` dans ton `.env` |
| `CLOUDINARY_API_SECRET` | la valeur de `CLOUDINARY_API_SECRET` dans ton `.env` |

Les secrets sont chiffrés : personne ne peut les relire, pas même toi.

## 3. Autoriser GitHub à mettre le site en ligne (une seule fois)

Dans PowerShell, dans le dossier `unidev` :
```
firebase init hosting:github
```
- « For which GitHub repository » : tape `ton-pseudo-github/unidev`
- « Set up the workflow to run a build script before every deploy? » : **N**
- « Set up automatic deployment to your site's live channel when a PR is merged? » : **N**

Firebase crée tout seul le secret `FIREBASE_SERVICE_ACCOUNT_UNIDEV_2026`. S'il a créé un fichier `.github/workflows/firebase-hosting-pull-request.yml`, supprime-le (on a déjà nos propres fichiers). Puis, dans GitHub Desktop : **Commit** puis **Push origin**.

---

## Lancer un import (téléphone ou PC)

1. github.com → ton dépôt `unidev` → onglet **Actions** (sur téléphone : navigateur, ou appli GitHub).
2. À gauche : **Importer des documents** → bouton **Run workflow**.
3. Remplis :
   - **Où chercher** : `tout`, `hal`, `wikiversite`, `wikilivres`, `zenodo`, `romans` ou `site`
   - **Thème** : ex. `comptabilité` (pour les romans : un auteur, ou vide)
   - **Nombre maximum**
   - pour `site` uniquement : l'**adresse** de la page (ex. une page Fomesoutra) et la **profondeur**
4. **Run workflow**. C'est parti : tu peux fermer ton téléphone ou éteindre ton PC.

Pour suivre : clique sur l'import en cours, puis sur « importer » : tu vois le même journal que dans la fenêtre noire. Une coche verte = terminé. À la fin, les nouveaux documents sont sur le site, avec leur page Google.

## Les autres automatismes

- **Mettre le site en ligne** : chaque nuit, et à chaque fois que tu envoies une modification (Push) depuis GitHub Desktop. Tu peux aussi le lancer à la main : Actions → « Mettre le site en ligne » → Run workflow. Tu n'as plus besoin de `firebase deploy`.
- **Nettoyer Cloudinary** : le 1er de chaque mois, ou Actions → « Nettoyer Cloudinary » → Run workflow.

## Mettre à jour le site

Quand je t'envoie une nouvelle version : remplace les fichiers dans ton dossier `unidev` (garde `.env`, `cle-firebase.json`), puis GitHub Desktop → **Commit** → **Push origin**. GitHub met le site en ligne tout seul.
