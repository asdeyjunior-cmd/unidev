# unidev — ce qu'il te reste à faire

Le code du site est terminé. Pour le mettre en ligne, il te reste à créer les comptes, à remplir **un seul fichier** (`js/config.js`) et à publier.
Suis les étapes dans l'ordre et coche au fur et à mesure. Compte environ 1 h.

---

## Étape 1 — Créer le projet Firebase (≈ 15 min)

- [ ] Va sur https://console.firebase.google.com → **Ajouter un projet** → nom : `unidev` → Google Analytics : facultatif.
- [ ] **Authentication** → **Commencer** → onglet **Sign-in method** → active :
  - [ ] **E-mail/Mot de passe**
  - [ ] **Google** (choisis ton e-mail d'assistance)
- [ ] **Firestore Database** → **Créer une base de données** → **mode production** → région `europe-west` (la plus proche de l'Afrique de l'Ouest).
- [ ] Firestore → onglet **Règles** → efface tout → colle le contenu du fichier `firestore.rules` → **Publier**.
- [ ] **Paramètres du projet** → **Vos applications** → icône **`</>`** (Web) → nom : `unidev` → **Enregistrer**.
  Firebase affiche un bloc `firebaseConfig = { apiKey: ..., authDomain: ..., ... }` : **garde-le ouvert**, tu en as besoin à l'étape 4.

## Étape 2 — Créer les index Firestore (≈ 5 min)

Sans eux, la liste des documents ne se charge pas.

- [ ] Firestore → onglet **Index** → **Composite** → **Créer un index**, 3 fois, collection `documents` :

  | Champ 1 | Champ 2 |
  |---|---|
  | `statut` — Croissant | `createdAt` — Décroissant |
  | `statut` — Croissant | `telechargements` — Décroissant |
  | `statut` — Croissant | `titre` — Croissant |

- [ ] Attends que les 3 index passent à l'état **Activé** (quelques minutes).

Astuce : si tu oublies un index, la console du navigateur (F12) affiche un lien qui le crée en un clic.

## Étape 3 — Configurer Cloudinary (≈ 10 min)

- [ ] Crée un compte gratuit sur https://cloudinary.com.
- [ ] Sur le **Dashboard**, note ton **Cloud name**.
- [ ] **Settings → Upload → Upload presets → Add upload preset** (pour les documents) :
  - Upload preset name : `unidev_unsigned`
  - Signing mode : **Unsigned**
  - Folder : `unidev/documents`
  - Use filename : **désactivé** (noms de fichiers impossibles à deviner)
  - Allowed formats : `pdf,doc,docx,ppt,pptx,xls,xlsx,odt,txt,zip`
  - **Save**
- [ ] **Add upload preset** une seconde fois (pour les images de couverture) :
  - Upload preset name : `unidev_images`
  - Signing mode : **Unsigned**
  - Folder : `unidev/couvertures`
  - Allowed formats : `jpg,jpeg,png,webp`
  - Max file size : `10` Mo
  - Incoming transformation (recommandé) : `c_limit,w_1200`
  - **Save**
- [ ] **Settings → Security** → coche **Allow delivery of PDF and ZIP files** → **Save**.
  (Sans ça, les PDF ne s'ouvrent pas : erreur 401.)

## Étape 4 — Remplir `js/config.js` (≈ 5 min)

C'est le **seul fichier de code** à modifier. Ouvre-le et remplace :

- [ ] Le bloc `firebaseConfig` par celui copié à l'étape 1 (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
- [ ] `cloudName: "VOTRE_CLOUD_NAME"` par ton Cloud name (étape 3).
- [ ] `url: "COLLEZ_ICI_VOTRE_LIEN_DE_PAIEMENT"` par ton lien de paiement (Wave, Orange Money, CinetPay…).

Réglages déjà en place (à changer seulement si tu le souhaites) :

| Réglage dans `js/config.js` | Valeur | Si tu le changes… |
|---|---|---|
| `prixPack` | 100 FCFA | change aussi `prixPack()` en haut de `firestore.rules` |
| `creditsParPack` | 5 crédits | change aussi `creditsParPack()` dans `firestore.rules` |
| `CREDITS_BIENVENUE` | 2 crédits offerts à l'inscription | change aussi `creditsBienvenue()` dans `firestore.rules` |
| `CREDITS_PAR_PUBLICATION` | 1 crédit par document validé | rien d'autre |
| `MAX_FILE_MB` | 100 Mo | les fichiers de plus de 9 Mo sont envoyés en morceaux |

Si tu modifies `firestore.rules`, recolle-le dans Firebase (Firestore → Règles → Publier).

## Étape 5 — Mettre le site en ligne (≈ 10 min)

Avec **Firebase Hosting** (gratuit, adresse en `unidev.web.app`). Il faut Node.js installé sur ton ordinateur.

- [ ] Ouvre un terminal dans le dossier `unidev`, puis :
  ```
  npm install -g firebase-tools
  firebase login
  firebase use --add          (choisis ton projet unidev)
  firebase deploy
  ```
  Le fichier `firebase.json` est déjà prêt : `firebase deploy` publie le site, les règles et les index.
- [ ] Note l'adresse affichée à la fin, par exemple `https://unidev-xxxx.web.app`.
- [ ] Firebase → **Authentication → Paramètres → Domaines autorisés** : vérifie que cette adresse y figure (Firebase l'ajoute normalement tout seul). Ajoute aussi ton propre nom de domaine si tu en utilises un.

Sans ordinateur ? Netlify (https://app.netlify.com/drop) : glisse-dépose le dossier `unidev`, puis ajoute l'adresse obtenue dans les domaines autorisés de Firebase.

Pour tester sur ton ordinateur avant la mise en ligne : `npx serve .` dans le dossier, puis ouvre l'adresse affichée. Le site ne marche pas en double-cliquant sur `index.html`.

### Application installable

Le site s'installe comme une application : icône sur l'écran d'accueil, ouverture en plein écran, page « Pas de connexion » hors ligne.
- **Android (Chrome)** : une fenêtre « Installer unidev » apparaît en bas du site → **Installer**.
- **iPhone (Safari)** : la fenêtre explique la marche à suivre : bouton **Partager** → **Sur l'écran d'accueil**.
- **Ordinateur (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

L'installation exige un site en **https** : c'est automatique avec Firebase Hosting ou Netlify.

- [ ] **À chaque nouvelle mise en ligne**, change `VERSION` en haut de `sw.js` (`unidev-v1` → `unidev-v2`…) avant `firebase deploy`, pour que les applications installées récupèrent la nouvelle version.

## Étape 6 — Créer ton compte admin (≈ 5 min)

Il n'y a qu'un seul admin : toi.

- [ ] Firebase → **Authentication → Users → Ajouter un utilisateur** : ton e-mail admin + ton identifiant (mot de passe).
- [ ] Copie l'**UID** de ce compte (colonne « UID utilisateur »).
- [ ] Firestore → **Démarrer une collection** :
  - ID de la collection : `parametres`
  - ID du document : `admin`
  - Champ : `uid` — type **string** — valeur : l'UID copié
  - **Enregistrer**
- [ ] Ouvre `https://ton-site/admin.html` et connecte-toi avec l'e-mail et l'identifiant. La page Modération s'affiche.
- [ ] Mets cette adresse en favori : aucun lien du site n'y mène.

## Étape 7 — Tester avant de lancer (≈ 10 min)

- [ ] Inscris-toi avec un **autre** e-mail (compte étudiant) → le solde affiche **2 crédits**.
- [ ] **Publier** : envoie un document avec son image → il apparaît « En attente » dans Mes publications.
- [ ] Sur `admin.html` → **Documents à valider** → **Publier** → le document apparaît dans le catalogue et l'étudiant gagne **1 crédit**.
- [ ] Avec le compte étudiant, télécharge un document → le solde baisse de 1, le document s'ouvre.
- [ ] **Crédits → Acheter des crédits** → déclare un faux paiement → sur `admin.html`, **Paiements à confirmer** → **Confirmer** → l'étudiant reçoit 5 crédits.
- [ ] Essaie d'ouvrir `admin.html` avec le compte étudiant → il est refusé.
- [ ] Vérifie sur ton téléphone : barre de recherche, filtres sur une ligne, 2 documents par ligne, barre du bas.
- [ ] Installe l'application sur ton téléphone et ouvre-la depuis l'écran d'accueil.

## Étape 8 — Lancer

- [ ] Publie et valide **au moins 8 documents** toi-même, pour que la page d'accueil soit remplie dès le premier jour.
- [ ] Partage le lien du site dans les groupes WhatsApp de ta promo et de ton école.

## Au quotidien (admin)

1. Ouvre `admin.html` (en favori).
2. **Documents à valider** : clique sur **Voir** pour vérifier le fichier, puis **Publier** (l'auteur gagne 1 crédit) ou **Refuser**.
3. **Paiements à confirmer** : compare la **référence** et le **numéro** avec les SMS ou l'historique de ton compte Mobile Money. Si le paiement est bien reçu, clique sur **Confirmer** ; sinon, sur **Refuser**.
4. Quand tu **supprimes** un document, supprime aussi son fichier dans Cloudinary → Media Library → dossier `unidev/documents` (le site ne peut pas le faire seul).

---

## Pour référence

### Fichiers du projet
```
index.html          Catalogue : recherche, filtres, tri, téléchargement par crédit
publier.html        Envoi d'un document + image, suivi de mes publications
connexion.html      Connexion / inscription / mot de passe oublié
credits.html        Solde, boutons Publier / Acheter, historique des paiements
acheter.html        Achat de crédits : paiement et déclaration
admin.html          Connexion admin + modération des documents et des paiements
css/style.css       Styles (vert et blanc, responsive)
js/config.js        ← TES RÉGLAGES (Firebase, Cloudinary, paiement, crédits)
js/firebase.js      Comptes et base de données
js/cloudinary.js    Envoi des fichiers et images
js/ui.js            En-tête, barre du bas, cartes
js/catalogue.js, js/publier.js, js/credits.js, js/acheter.js
firestore.rules     Règles de sécurité (à coller dans Firebase)
firestore.indexes.json  Index de la liste des documents
firebase.json       Configuration pour « firebase deploy »
manifest.webmanifest  Nom, icônes et couleurs de l'application installée
sw.js               Service worker : ouverture rapide et mode hors connexion
offline.html        Page affichée sans connexion
icons/              Icônes de l'application
```

### Fonctionnement des crédits
- 1 crédit = 1 document téléchargé. Un document débloqué se retélécharge gratuitement.
- 2 crédits offerts à l'inscription.
- +1 crédit quand un document publié est validé par l'admin (une seule fois par document).
- 100 FCFA = 5 crédits, ajoutés quand l'admin confirme le paiement.

### Données Firestore
- `documents/{id}` : titre, matiere, filiere, type, niveau, annee, universite, description, imageUrl, format, taille, nomFichier, auteurId, auteurNom, statut (`en_attente` | `publie` | `rejete`), telechargements, creditAccorde, createdAt
- `documents/{id}/prive/fichier` : fileUrl, publicId, auteurId — lisible seulement par l'auteur, l'admin et ceux qui ont débloqué le document
- `users/{uid}` : nom, email, role, credits, dernierAchat, createdAt
- `users/{uid}/achats/{docId}` : documents débloqués
- `paiements/{id}` : uid, nom, email, packs, montant, credits, operateur, numero, reference, statut (`en_attente` | `confirme` | `rejete`), createdAt
- `parametres/admin` : uid du seul administrateur (créé à la main)

### Limites à connaître
- **Taille** : 100 Mo maximum. Au-delà de 9 Mo, le document est découpé en morceaux (le plan gratuit Cloudinary limite chaque fichier à 10 Mo) et recollé sur l'appareil au téléchargement.
- **Suppression** : supprimer un document efface sa fiche, pas le fichier Cloudinary (à supprimer à la main).
- **Liens partagés** : un étudiant qui a débloqué un document peut en partager le lien. L'empêcher demanderait un serveur payant (Cloud Functions).
- **Comptes multiples** : les 2 crédits offerts ne sont donnés qu'après vérification de l'adresse e-mail (lien envoyé à l'inscription ; automatique avec Google), et une seule fois par appareil (marque déposée dans le navigateur). On peut encore contourner en changeant de navigateur, en effaçant les données du site ou en navigation privée. Si ça devient un problème, on peut réserver ces crédits aux e-mails vérifiés.
- **Envoi non signé** : quelqu'un qui connaît le nom du preset peut envoyer des fichiers sur ton Cloudinary ; les formats et la taille autorisés limitent l'abus.

## Importer des milliers de documents

L'outil `outils/import` (à lancer sur ton ordinateur) importe un dossier entier de documents, ou des cours sous licence libre depuis l'archive ouverte HAL. Mode d'emploi : `outils/import/LISEZMOI.md`. Ce dossier n'est jamais mis en ligne.

La recherche utilise un **index** (Firestore : `index/catalogue`) mis à jour automatiquement quand tu publies, refuses ou supprimes un document, et par l'outil d'import. En cas de doute, clique sur **Mettre à jour l'index de recherche** dans la page Modération. L'index tient jusqu'à environ 3 000 documents.

## Notifications sur ton téléphone et ton PC (ntfy, gratuit)

À chaque paiement déclaré ou document envoyé, le site t'envoie une notification dans la barre de notifications de ton téléphone et en message flash sur ton PC, même quand le site est fermé.

- **Téléphone :** installe l'appli **ntfy** (Play Store ou App Store). Touche **+**, tape le nom du canal qui se trouve dans `js/config.js` à la ligne `NTFY_TOPIC` (par exemple `unidev-admin-...`), puis **S'abonner**.
- **PC :** ouvre **https://ntfy.sh/app** dans Chrome ou Edge, clique sur **S'abonner à un sujet**, colle le même nom, puis autorise les notifications. Installe la page comme application (icône d'installation dans la barre d'adresse) pour les recevoir même quand l'onglet est fermé, tant que le navigateur tourne en arrière-plan.

Le nom du canal est secret : quiconque le connaît peut lire ces notifications. Elles ne contiennent ni nom, ni e-mail, ni numéro : seulement le montant et l'opérateur. Pour changer de canal, modifie `NTFY_TOPIC` puis redéploie.
