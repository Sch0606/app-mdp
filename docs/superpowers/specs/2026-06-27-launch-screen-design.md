# Ecran de lancement Clave

## Objectif

Afficher une interface propre des l'ouverture de Clave pendant l'initialisation du coffre et de l'authentification, sans ralentir inutilement l'application.

## Comportement

- L'ecran de lancement est present dans le HTML initial afin d'apparaitre avant toute initialisation JavaScript.
- Il reste visible jusqu'a la fin de `initialiserAuth()` et pendant au moins 500 ms afin d'eviter un flash visuel.
- Il disparait avec une transition courte en opacite et revele ensuite l'ecran de connexion ou l'application deja deverrouillee.
- Si l'initialisation echoue, l'ecran disparait quand meme et le mecanisme d'erreur existant reste visible et utilisable.
- L'animation respecte `prefers-reduced-motion` et devient statique lorsque les animations sont reduites.

## Interface

L'ecran occupe toute la fenetre avec le vert principal de Clave. Il contient uniquement le monogramme `C`, le nom `Clave`, le texte `Ouverture du coffre` et un indicateur discret anime. Les couleurs, rayons et polices reutilisent les variables et la typographie existantes afin de conserver une identite coherente.

## Architecture

- `src/index.html` contient le composant de lancement en premier enfant de `body`.
- `src/style.css` gere le positionnement plein ecran, l'animation, la transition de sortie et l'accessibilite liee aux mouvements.
- `src/script.js` mesure le temps de lancement, attend simultanement l'initialisation et le delai minimum, puis retire proprement le composant du DOM.
- Une fonction de finalisation commune est executee dans les chemins de succes et d'erreur.

## Accessibilite

Le composant utilise `role="status"` et `aria-live="polite"`. Il masque temporairement le contenu sous-jacent visuellement et aux interactions, sans ajouter de controle necessitant le clavier.

## Verification

- Un test statique verifie la presence du composant, des styles de sortie et du branchement JavaScript.
- Le test doit echouer avant l'implementation puis passer apres celle-ci.
- La suite Python, les tests Rust et la validation syntaxique JavaScript doivent rester verts.
