# Importer des documents en masse dans unidev

Cet outil tourne sur **ton ordinateur** (pas sur le site). Il envoie les fichiers sur Cloudinary, crée leur image, et les publie directement sur unidev, sans passer par la modération.

Deux façons de l'utiliser :
1. **Dossier** : tu ranges tes documents dans des dossiers, l'outil les importe tous.
2. **HAL** : l'outil cherche des cours en français sous **licence libre** dans l'archive ouverte HAL (https://hal.science) et les importe avec le nom des auteurs, la licence et le lien source.

> **Droits d'auteur.** N'importe que des documents que tu as le droit de diffuser : tes propres documents, ceux que des professeurs ou des étudiants t'ont donnés avec leur accord, ou ceux sous licence libre. Les cours et sujets d'examen appartiennent à leurs auteurs et à leurs écoles. Le mode HAL ne garde que les licences qui autorisent la rediffusion sur un site payant (CC BY, CC BY-SA, CC BY-ND, Domaine public, Licence Ouverte) et écarte les licences « NC » (pas d'utilisation commerciale).


## Le plus simple : double-clic sur IMPORTER.bat (Windows)

1. Double-clique sur **IMPORTER.bat**. La première fois, il installe ce qu'il faut et ouvre le fichier `.env` à remplir.
2. Mets `cle-firebase.json` dans ce dossier (voir Installation ci-dessous), puis relance IMPORTER.bat.
3. Choisis **1** (un dossier de ton ordinateur) ou **2** (cours libres HAL).
4. Pour le choix 1 : **glisse ton dossier** de documents dans la fenêtre noire, puis appuie sur Entrée.
5. L'outil affiche d'abord ce qu'il a compris, sans rien envoyer. Si c'est correct, tape **O** puis Entrée : l'import commence.

---

## Installation (une seule fois)

1. Installe **Node.js 18 ou plus** : https://nodejs.org (version LTS).
2. Ouvre un terminal dans ce dossier (`outils/import`), puis tape :
   ```
   npm install
   ```
3. Copie `.env.exemple` en `.env` et remplis-le :
   - **Cloudinary** → Settings → **API Keys** : copie l'*API Key* et l'*API Secret*.
   - **Firebase** → Paramètres du projet → **Comptes de service** → **Générer une nouvelle clé privée**. Place le fichier téléchargé dans ce dossier sous le nom `cle-firebase.json`.

> `.env` et `cle-firebase.json` donnent un accès total à ton site. Ne les envoie à personne, ne les mets pas en ligne. Ce dossier `outils` n'est jamais publié par `firebase deploy`.

---

## Mode 1 : importer un dossier

Range tes fichiers ainsi (chaque niveau de dossier est facultatif) :

```
mes-documents/
  Informatique de gestion/      ← filière
    L2/                         ← niveau (L1, L2, L3, M1, M2, BTS1, BTS2, Doctorat)
      Examens/                  ← type (Cours, TD, TP, Examens, Corrigés, Mémoires, Résumés)
        Algorithmique/          ← matière
          examen_algo_session_1.pdf
```

Le titre est pris dans le nom du fichier (`examen_algo_session_1.pdf` → « examen algo session 1 »).

**Toujours tester d'abord** (rien n'est envoyé, l'outil affiche ce qu'il comprend) :
```
node importer.js dossier "C:\chemin\vers\mes-documents" --essai
```
Puis lancer pour de vrai :
```
node importer.js dossier "C:\chemin\vers\mes-documents"
```

**Titres et infos plus précis (facultatif).** Crée un fichier CSV (Excel → Enregistrer sous → CSV) avec ces colonnes, puis ajoute `--csv infos.csv` :

```
fichier;titre;matiere;filiere;type;niveau;annee;universite;description;image
examen_algo_session_1.pdf;Examen d'algorithmique — session 1;Algorithmique;Informatique de gestion;Examen;L2;2025-2026;ESETEC;Sujet de 3 h avec barème;images/algo.jpg
```
Un exemple est fourni : `exemple-infos.csv`.

**Tes propres images (facultatif).** Pour donner une image à un document, mets-la **dans le même dossier, avec le même nom** :

```
Algorithmique/
  examen_algo_session_1.pdf
  examen_algo_session_1.jpg     ← image de ce document
  cours_algo.pdf                ← pas d'image : couverture automatique
```

Formats acceptés : JPG, JPEG, PNG, WEBP. L'image est réduite automatiquement (1200 px max) avant l'envoi.
Tu peux aussi indiquer l'image dans la colonne `image` du CSV (ex. `images/algo.jpg`, chemin à partir du dossier importé).
Sans image, l'outil prend la 1re page du PDF, sinon une couverture verte avec le titre.
En mode `--essai`, chaque ligne affiche l'image trouvée : vérifie avant d'envoyer.

---

## Mode 3 : ranger un dossier en vrac (export Telegram)

Dans IMPORTER.bat, choisis **3** et glisse ton dossier. L'outil :

1. **crée lui-même les dossiers** Filière / Niveau / Type / Matière en devinant d'après le nom du fichier et le message Telegram (ex. « Examen_compta_BTS1.pdf » → `Finance-Comptabilité/BTS 1/Examen/Comptabilité`) ;
2. **te demande l'image de chaque document** : glisse l'image dans la fenêtre puis Entrée. Pour un export Telegram, la photo envoyée juste avant le fichier est déjà proposée : Entrée suffit ;
3. **copie** les fichiers dans un nouveau dossier `<ton dossier>-range` (l'original ne bouge pas) ;
4. propose ensuite de les importer.

Réponses possibles pour chaque document :

| Tu tapes | Effet |
|---|---|
| Entrée | valider (image proposée, ou couverture automatique) |
| une image glissée | utiliser cette image |
| `n` | pas d'image |
| `c` | corriger la filière, le niveau, le type, la matière |
| `p` | même classement que le document précédent |
| `s` | sauter ce document |
| `auto` | plus de questions : tout le reste est rangé avec le classement deviné |
| `q` | quitter ; relance plus tard, il reprend où tu t'étais arrêté |

**Export Telegram conseillé** (Telegram Desktop → le groupe → ⋮ → Exporter l'historique) : coche **Fichiers** et **Photos**, format **JSON lisible par machine**. Avec ce format, le texte du message devient le titre (et la description) du document, et la photo qui le précède est proposée comme image.

Ce qui n'est pas reconnu va dans `Autre` : tu peux déplacer ces fichiers à la main dans le dossier rangé avant l'import.

---

## Mode 2 : cours libres depuis HAL

```
node importer.js hal --recherche "comptabilité" --max 100 --essai
node importer.js hal --recherche "comptabilité" --max 100
```

Options :
- `--recherche "mots"` : thème cherché (par défaut : tout).
- `--max 100` : nombre de documents à importer.
- `--types LECTURE,MEM` : `LECTURE` = cours, `MEM` = mémoires d'étudiants, `THESE` = thèses.

Idées de recherches : `économie`, `gestion`, `comptabilité`, `marketing`, `droit`, `statistiques`, `mathématiques`, `programmation`, `réseaux`, `base de données`.

HAL contient surtout des cours de niveau universitaire publiés en France. Le nombre de cours sous licence libre dépend du thème : fais d'abord un `--essai` pour voir combien de documents sont retenus.

---

## Modes 4, 5 et 6 : Wikiversité, Wikilivres et Zenodo

Dans IMPORTER.bat, choisis **4** (Wikiversité), **5** (Wikilivres) ou **6** (Zenodo), tape un thème (ex. `comptabilité`, `programmation`, `marketing`) et un nombre maximum.

- **Wikiversité / Wikilivres** : chaque cours (page principale + ses chapitres) devient **un seul PDF** mis en page aux couleurs d'unidev, avec une page de garde verte (qui sert d'image), la source et la licence **CC BY-SA 4.0**. Les ébauches trop courtes sont ignorées. Les formules mathématiques complexes sont simplifiées (texte brut).
- **Zenodo** : seuls les supports de cours en PDF sous licence **CC BY, CC BY-SA, CC BY-ND ou CC0** sont gardés ; les licences « NC » et les documents en langue étrangère sont écartés.

En ligne de commande :
```
node importer.js wiki --projet wikiversite --recherche "comptabilité" --max 20 --essai
node importer.js wiki --projet wikilivres --recherche "programmation" --max 20
node importer.js zenodo --recherche "marketing" --max 20
```

**Rechercher partout (choix 7)** : un seul thème, et l'outil cherche à la suite sur HAL, Wikiversité, Wikilivres et Zenodo. Le nombre maximum s'applique **à chaque site** (10 = jusqu'à 40 documents). Commande : `node importer.js tout --recherche "comptabilité" --max 10 --essai`.

Le nom des auteurs, la licence et le lien source sont écrits dans la description de chaque document : c'est **obligatoire** avec ces licences, ne les retire pas.

---

## Mode 8 : romans du domaine public (Wikisource)

Choix **8** dans IMPORTER.bat. Tape un **titre ou un auteur** (ex. `Zola`, `Victor Hugo`, `Les Misérables`), ou appuie juste sur Entrée pour prendre les romans de la catégorie « Romans » de Wikisource.

- Wikisource en français ne publie que des œuvres **du domaine public** (auteur mort depuis plus de 70 ans) : c'est la même règle en Côte d'Ivoire, tu peux donc les proposer sur unidev.
- L'outil essaie d'abord l'**export PDF officiel** de Wikisource ; s'il ne répond pas, il assemble lui-même le roman (chapitres dans l'ordre de la table des matières) en un PDF avec une couverture verte « ROMAN ».
- Les romans sont classés en **type « Roman »**, **filière « Littérature »**, avec l'auteur comme matière. La source Wikisource est indiquée dans la description (obligatoire : la transcription est sous licence CC BY-SA).
- Un roman entier est long à préparer (souvent 1 à 5 minutes chacun) : commence avec un petit nombre, par ex. 5.

Les romans **récents** (auteurs vivants ou morts il y a moins de 70 ans : Kourouma, Dadié, Camara Laye…) sont protégés : ne les importe pas sans l'accord de l'éditeur.

---

## Mode 9 : les documents d'un site qui t'a donné son accord (ex. Fomesoutra)

1. Ouvre le site dans ton navigateur et va sur une page qui **liste des documents** (ex. « Épreuves BTS Finance-Comptabilité »). Copie son adresse.
2. IMPORTER.bat → **9** → colle l'adresse (clic droit dans la fenêtre noire).
3. Choisis jusqu'où chercher : **1** = cette page seulement, **2** = cette page et ses dossiers, **3** = + leurs sous-dossiers (conseillé), **4** = un niveau de plus. L'outil **reste dans le dossier de départ** (il ne part pas dans les autres rubriques du site) et le **nom de chaque dossier** (ex. « ANALYSE NUMERIQUE ») devient la matière des documents qu'il contient.
4. Confirme que tu as l'accord écrit du site, vérifie la liste, puis tape **O**.

L'outil suit les liens « Télécharger », passe les pages de téléchargement intermédiaires, **parcourt automatiquement les pages suivantes** de la liste (« Suivant », « 2 », « 3 »… : pas besoin de les donner une par une), ne garde que les vrais fichiers (PDF, Word, PowerPoint…), devine la filière, le niveau et le type d'après le titre, et écrit « Document partagé avec l'autorisation de … · Source : … » dans la description. Il va doucement (1 page par seconde) pour ne pas gêner le site. Recommence avec d'autres pages du site : les documents déjà importés sont sautés.

Garde l'accord écrit du site (e-mail ou message) : c'est ta preuve en cas de réclamation.

**Remplacer la signature du site par celle d'unidev** (seulement si le site t'a autorisé à le faire) : réponds **O** à la question, puis tape les mots à remplacer (ex. `fomesoutra,fo me soutra`). Dans chaque PDF, les lignes d'en-tête ou de pied de page qui contiennent ces mots sont remplacées par « unidev-2026.web.app », et les liens cliquables vers le site renvoient vers unidev. Le **logo du site en image** n'est jamais deviné : il est reconnu par **REMPLACER-SIGNATURE.bat** (ou GitHub « Remplacer la signature d'un site »), qui compare tous les documents du site — le logo est la même image large, en haut ou en bas de page, présente dans une grande partie d'entre eux. Une image propre à un document (titre, logo d'école, figure) n'est jamais touchée. Une fois reconnu, ce logo est aussi remplacé automatiquement dans les imports suivants. Limite : un filigrane en diagonale reste. Les noms des **auteurs** ne sont jamais touchés.

---

## Bon à savoir

- **Doublons** : avant chaque envoi, l'outil vérifie qu'aucun document de même titre n'est déjà sur unidev ; si oui, il le saute. Pour nettoyer les doublons déjà en ligne : page Modération → « Supprimer les doublons ».
- **Reprise** : le fichier `import-journal.json` note ce qui a déjà été importé. Si l'import s'arrête (coupure internet), relance la même commande : il reprend là où il s'était arrêté, sans doublon.
- **Images** : ta propre image si tu en as mis une (même nom que le fichier). Sinon, pour un PDF de 10 Mo maximum, la première page du document ; sinon, une couverture verte avec le titre.
- **Gros fichiers** : au-delà de 9 Mo, le fichier est découpé en morceaux, comme sur le site. Maximum : 100 Mo.
- **Quota Cloudinary gratuit** : environ 25 Go par mois, stockage et téléchargements confondus. 2 000 documents de 2 Mo occupent environ 4 Go. Surveille ta consommation dans le tableau de bord Cloudinary.
- **Vitesse** : compte environ 2 à 5 secondes par document selon ta connexion, soit 2 à 3 heures pour 2 000 documents. Tu peux importer par lots (un dossier à la fois).
- **Supprimer un document importé** : bouton Supprimer dans la page Modération (onglet Publiés), puis supprime son fichier dans Cloudinary → Media Library → `unidev/documents`.

---

## Pages des documents pour Google (pages.js)

Pour que chaque document apparaisse dans Google (ex. une recherche « examen algorithmique L2 »), le site doit avoir **une page par document**. L'outil `pages.js` les crée dans le dossier `d/` du site, avec la page « Tous les documents » et le `sitemap.xml`.

Le plus simple : double-clique sur **METTRE-EN-LIGNE.bat** (à la racine du dossier unidev) au lieu de taper `firebase deploy`. Il crée les pages puis met le site en ligne. Fais-le **après avoir validé de nouveaux documents** (une fois par jour ou par semaine suffit).

---

## Nettoyer Cloudinary (NETTOYER-CLOUDINARY.bat)

Supprimer un document dans Modération l'efface de Firebase et du site, mais **son fichier reste sur Cloudinary** (le site ne peut pas l'effacer sans exposer ta clé secrète). Double-clique sur **NETTOYER-CLOUDINARY.bat** de temps en temps : il liste les fichiers et images qui ne servent plus à aucun document, te montre la place libérée, puis les supprime si tu tapes **O**. Les fichiers de moins de 48 h ne sont jamais touchés (envois en cours).

---

## Remplacer la signature dans les documents déjà publiés (REMPLACER-SIGNATURE.bat)

Pour les documents d'un site partenaire **déjà sur unidev** (importés avec le choix 9), avec l'accord écrit du site : double-clique sur **REMPLACER-SIGNATURE.bat**, tape le nom du site (ex. `fomesoutra`) et les mots à remplacer (ex. `fomesoutra,fo me soutra`). L'outil repart du **fichier d'origine** de chaque document (retéléchargé sur le site partenaire grâce à `import-journal.json`), reconnaît le logo du site en comparant tous les documents, liste les documents concernés, puis, après **O**, remplace la signature dans chaque PDF **sans changer le document sur le site** (même titre, même place, mêmes téléchargements). Il note les documents traités et ne les refait jamais. Sur GitHub : Actions → « Remplacer la signature d'un site ».

Ensuite, lance NETTOYER-CLOUDINARY.bat pour supprimer les anciens fichiers.

## Logo du site partenaire (dossier `logos`)
L'outil « Remplacer la signature » reconnaît le logo d'un site en le **comparant aux images du dossier `logos`**
(ex. `fomesoutra.png`). Seules les images qui lui ressemblent sont remplacées, une seule fois par endroit :
les logos d'écoles, les titres et les autres images ne sont jamais touchés.
Pour un autre site, ajoute simplement une capture nette de son logo (PNG, fond blanc) dans ce dossier.
