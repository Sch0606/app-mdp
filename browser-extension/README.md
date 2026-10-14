# Extension Clave pour Chrome et Edge

Cette extension propose les comptes du coffre Clave uniquement sur le domaine enregistré et ses sous-domaines. Elle ne remplit jamais un compte sans clic et n’affiche pas le mot de passe.

## Installation locale

1. Lancez Clave puis ouvrez **Paramètres → Remplissage**.
2. Activez **Autoriser l’extension Clave** et copiez le code d’appairage.
3. Ouvrez `chrome://extensions` ou `edge://extensions`.
4. Activez le mode développeur, choisissez **Charger l’extension non empaquetée** et sélectionnez ce dossier `browser-extension`.
5. Ouvrez les détails de l’extension, puis **Options de l’extension**. Collez le code et testez la connexion.

Sur un formulaire de connexion, cliquez sur le champ e-mail, identifiant ou mot de passe. Une suggestion Clave compacte apparaît sous le champ uniquement si au moins un compte enregistré correspond au site. Un simple focus clavier, la saisie dans le champ, un coffre verrouillé ou l’absence de compte correspondant n’affichent rien. Choisissez le compte à utiliser ; sur une connexion en plusieurs étapes, Clave peut d’abord remplir l’e-mail seul.

Lorsque vous cliquez sur l’action de connexion d’un formulaire HTTPS contenant un mot de passe, Clave conserve les identifiants au maximum deux minutes dans la mémoire temporaire de l’extension et affiche immédiatement une bannière proposant d’enregistrer le nouveau compte ou de mettre à jour son mot de passe. Si la page navigue avant l’affichage, la proposition réapparaît après la connexion. Rien n’est écrit sans clic et le mot de passe n’est jamais affiché. Une connexion déjà identique dans le coffre ne déclenche aucune proposition.

Les connexions en plusieurs écrans sont également prises en charge sur tous les sites compatibles : l’identifiant saisi à la première étape est conservé temporairement, puis associé au mot de passe uniquement si l’étape suivante appartient exactement au même domaine. La détection repose sur la structure des champs et des actions, pas sur le nom du site, le texte du bouton ou la langue. Les changements d’écran sans rechargement et les formulaires placés dans une iframe sont surveillés.

## Limites actuelles

- Chrome et Edge sur le même appareil que Clave.
- Pages HTTP/HTTPS et formulaires placés dans une iframe accessible à l’extension.
- Correspondance par domaine : un compte `example.com` est proposé sur `login.example.com`, jamais sur `example.com.evil.test` ni sur un autre sous-domaine d’hébergement partagé (`*.github.io`, `*.vercel.app`…). Les pages de connexion communes sont reconnues : un compte `gmail.com` ou `youtube.com` est proposé sur `accounts.google.com`, `outlook.com` sur `login.live.com`, `icloud.com` sur `appleid.apple.com`.
- La fenêtre Clave peut être fermée : le service reste disponible discrètement dans la zone de notification. Utilisez **Quitter Clave** depuis cette icône pour l’arrêter réellement.
- L’enregistrement est proposé uniquement pour les formulaires HTTPS comprenant un identifiant et un mot de passe.
