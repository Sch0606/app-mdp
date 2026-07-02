# Reglages et menu contextuel des acces

## Objectif

Moderniser les controles visibles dans les captures, alleger chaque ligne d'acces et livrer un executable qui contient reellement l'ecran de chargement deja present dans les sources.

## Interface

- Le delai de verrouillage devient un controle segmente a quatre choix : `2 min`, `5 min`, `10 min`, `Jamais`. Son rectangle actif glisse entre les positions en 320 ms.
- Le texte d'introduction sous le titre Parametres est supprime.
- La preference d'affichage du bouton Verrouiller devient un interrupteur avec un etat visuel clair.
- Les lignes d'acces ne montrent plus les boutons Generer, Sauver, Copier et Suppr. situes a droite.
- Un clic droit sur une ligne ouvre un menu contenant `Copier le mot de passe`, `Enregistrer` et `Supprimer`. Generer n'y apparait pas.
- Le bouton Copier integre au champ Identifiant reste disponible.

## Comportement

Le controle segmente et l'interrupteur conservent les memes valeurs `localStorage`. Le menu contextuel memorise la ligne cible, se positionne dans la fenetre, se ferme par clic exterieur ou Echap et reutilise les fonctions existantes de copie, modification et suppression.

## Ecran de chargement et livraison

L'installation actuellement lancee date du 26 juin, alors que le splash a ete ajoute aux sources le 27 juin. Le correctif consiste a maintenir le splash pendant au moins deux secondes, verifier son animation, puis produire un nouvel executable et un nouvel installateur.

## Verification

Des tests statiques verrouillent la structure des nouveaux controles, l'absence des anciens boutons et le branchement du menu. La suite Python, les tests Rust, la syntaxe JavaScript, le rendu local et la construction Tauri doivent passer.
