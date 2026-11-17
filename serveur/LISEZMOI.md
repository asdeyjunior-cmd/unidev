# Paiement automatique avec Jèko

Avec ce serveur, l'étudiant paie (Wave, Orange Money, MTN, Moov) et reçoit ses crédits tout de suite, sans que tu confirmes.
Tant que l'étape 4 n'est pas faite, le site garde le paiement manuel : rien ne change.

## 1. Compte Jèko
1. Crée ton compte Jèko (appli Jeko Business) puis ouvre https://business.jeko.africa/ sur ton PC.
2. Menu **Compte > Augmenter votre plafond** : complète le niveau « Création du compte » (cela active l'accès API ;
   plafond 200 000 FCFA par mois, 2 000 000 avec ta pièce d'identité).
3. Menu **Paramètres > API & Webhooks > Créer une clé API** : nom `unidev`, puis **Ajouter**.
   Dans la liste, la colonne **ID** est l'identifiant de la clé (`JEKO_API_KEY_ID`) ; le bouton à côté copie la clé (`JEKO_API_KEY`).
4. L'identifiant du magasin est facultatif : sans `JEKO_STORE_ID`, le serveur prend le premier magasin du compte.
   Pour vérifier : ouvre `https://TON-WORKER/etat`, qui doit afficher `"magasin":true`.

## 2. Serveur Cloudflare (gratuit)
1. Crée un compte sur dash.cloudflare.com.
2. Workers & Pages > Create > Worker > nom : `unidev-paiement` > Deploy.
3. Edit code : efface tout, colle le contenu de `serveur/worker.js`, puis Deploy.
4. Settings > Variables and Secrets, ajoute :

| Nom | Type | Valeur |
|---|---|---|
| `SITE` | Texte | `https://unidev-2026.web.app` |
| `FIREBASE_API_KEY` | Texte | la valeur `apiKey` de `js/config.js` |
| `PRIX_PACK` | Texte | `100` |
| `CREDITS_PACK` | Texte | `5` |
| `JEKO_API_KEY` | Secret | ta clé API Jèko |
| `JEKO_API_KEY_ID` | Secret | l'identifiant de la clé |
| `JEKO_STORE_ID` | Secret | l'identifiant du magasin |
| `JEKO_WEBHOOK_SECRET` | Secret | le secret du webhook (étape 3) |
| `FIREBASE_CLE_JSON` | Secret | tout le contenu de ton fichier `cle-firebase.json` |

5. Note l'adresse du Worker, du type `https://unidev-paiement.TONNOM.workers.dev`.
   Ouvre-la dans le navigateur : elle doit afficher `{"ok":true,"service":"unidev-paiement","jeko":true}`.

## 3. Avis de paiement (webhook)
Sur business.jeko.africa : **Paramètres > API & Webhooks**, webhook « business (global) », adresse
`https://unidev-paiement.TONNOM.workers.dev/jeko`, puis **Créer le webhook**.
Le **secret** ne s'affiche qu'une seule fois, juste après la création : copie-le tout de suite dans `JEKO_WEBHOOK_SECRET` (étape 2).

## 4. Brancher le site
Dans `js/config.js`, mets l'adresse du Worker :

    serveur: "https://unidev-paiement.TONNOM.workers.dev",

Puis Commit et Push. La page « Acheter des crédits » affiche alors les boutons Wave, Orange Money, MTN et Moov.
Le paiement manuel reste disponible en dessous, replié, en secours.

## Sécurité
- Les clés ne sont que dans Cloudflare : jamais dans le site, jamais dans GitHub, jamais dans une discussion.
- Les crédits ne sont donnés qu'après confirmation de Jèko, une seule fois par paiement.
- `PRIX_PACK` et `CREDITS_PACK` doivent être les mêmes que dans `js/config.js`.

# Stockage des fichiers sur Cloudflare R2

Les fichiers (documents, images, affiches) sont rangés sur Cloudflare R2 et servis par ce même serveur :
téléchargements gratuits et illimités, 10 Go de stockage offerts (au-delà : environ 0,015 $ par Go et par mois).

1. Cloudflare > **R2 Object Storage** > activer (un moyen de paiement est demandé, rien n'est prélevé dans l'offre gratuite).
2. **Create bucket** : nom `unidev-fichiers`, emplacement automatique.
3. Workers & Pages > `unidev-paiement` > **Settings > Bindings > Add > R2 bucket** :
   nom de la variable `FICHIERS`, bucket `unidev-fichiers`, puis Deploy.
4. **Edit code** : colle le nouveau `serveur/worker.js`, puis Deploy.
5. **Settings > Variables and Secrets** : ajoute `OUTILS_SECRET` (Secret) = un long mot de passe inventé (30 caractères ou plus).
6. Vérifie l'adresse du serveur dans le navigateur : `"stockage":true` et `"outils":true`.
7. GitHub > Settings > Secrets and variables > Actions : ajoute `R2_URL` (adresse du serveur, sans / à la fin)
   et `OUTILS_SECRET` (le même mot de passe qu'à l'étape 5).
8. Actions > **Déménager les fichiers vers R2** : d'abord avec « Essai » coché, puis sans. Relance jusqu'à « Tout est copié ».

Les envois du site et des outils vont sur R2 dès que le serveur est prêt ; sinon ils repartent sur Cloudinary (jamais sur iugeyztf).

## Notifications de secours par Telegram

Si « Tester les notifications » répond que ntfy.sh ne répond pas (code 522), ajoute Telegram en secours :
1. Dans Telegram, ouvre **@BotFather**, envoie `/newbot`, choisis un nom : il te donne un **jeton** (ex. `123456:ABC...`).
2. Ouvre ton nouveau bot et envoie-lui « bonjour ».
3. Ouvre dans le navigateur `https://api.telegram.org/bot<TON_JETON>/getUpdates` : repère `"chat":{"id":123456789` ; ce nombre est ton **chat id**.
4. Cloudflare > Worker unidev-paiement > Settings > Variables and Secrets, ajoute (type Secret) :
   - `TELEGRAM_TOKEN` = le jeton
   - `TELEGRAM_CHAT` = le chat id
5. Deploy, puis reclique sur « Tester les notifications ».

ntfy reste essayé en premier ; Telegram ne sert que si ntfy échoue.
