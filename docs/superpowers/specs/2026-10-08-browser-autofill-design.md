# Remplissage automatique Clave — conception

## Objectif

Permettre à Chrome et Edge de proposer les comptes du coffre Clave correspondant exactement au site courant, puis de remplir l’identifiant et le mot de passe après un choix explicite. Un coffre verrouillé ne livre aucun secret et l’application Clave est remise au premier plan pour l’authentification.

## Périmètre de cette livraison

- Extension Chromium Manifest V3 chargeable localement.
- Détection des champs d’identifiant, d’e-mail et de mot de passe dans la page principale.
- Proposition non intrusive sur les formulaires de connexion.
- Liste de comptes lorsque plusieurs entrées correspondent.
- Liaison locale à Clave par un service HTTP limité à `127.0.0.1:32191` et protégé par un jeton aléatoire.
- Activation, désactivation, copie du jeton et état du service dans les paramètres.
- Correspondance stricte de l’hôte, en considérant seulement `www.example.com` et `example.com` équivalents.

Les iframes, Firefox/Safari et le remplissage générique des applications Windows ne font pas partie de cette première livraison. Windows ne fournit pas de contrat universel permettant d’identifier de façon sûre les champs de connexion de toute application. Une future fonction d’auto-saisie devra utiliser des associations d’applications explicites et un raccourci, jamais une détection silencieuse.

## Sécurité

- Le service écoute uniquement l’interface de boucle locale.
- Toutes les routes métier exigent le jeton d’appairage dans `X-Clave-Token`.
- Seules les origines `chrome-extension://` et `extension://` sont acceptées.
- Le coffre verrouillé renvoie un état verrouillé et aucune métadonnée d’entrée.
- La route de recherche ne renvoie jamais les mots de passe.
- La route de secret revalide le domaine et la sélection avant de renvoyer un identifiant et un mot de passe.
- Aucun remplissage n’est déclenché sans clic de l’utilisateur.
- Le mot de passe est affecté au champ mais n’est jamais rendu dans le sélecteur.

## Architecture

Le module Rust `autofill` possède la configuration persistante, la logique de correspondance et le petit serveur local. Il partage le `PasswordStore` déjà déverrouillé avec les commandes Tauri. L’interface React expose les commandes d’état, d’activation et de rotation du jeton dans une nouvelle section de paramètres.

L’extension contient un service worker qui est le seul composant autorisé à contacter le service local. Le script de contenu détecte les formulaires et échange uniquement des messages structurés avec le worker. Le sélecteur visuel est isolé dans un Shadow DOM.

## Flux

1. L’utilisateur active le remplissage dans Clave et copie le jeton d’appairage.
2. Il charge l’extension puis colle le jeton dans ses options.
3. Sur une page de connexion, l’extension affiche un bouton Clave près du mot de passe.
4. Un clic demande les correspondances pour l’origine courante.
5. Si le coffre est verrouillé, Clave passe au premier plan et l’utilisateur s’authentifie.
6. L’utilisateur choisit un compte ; l’extension demande alors seulement ce secret et remplit les champs.

## Tests

- Tests Rust de correspondance exacte, refus des domaines proches, secret absent des résultats et refus quand le coffre est verrouillé.
- Tests Node des heuristiques de détection et du remplissage.
- Test Playwright des réglages d’activation, de copie et de rotation du jeton.
- Suites existantes Rust, Node, Playwright et build Vite.
