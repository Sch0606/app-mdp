# Sélecteur du délai d’effacement du presse-papiers

## Objectif

Remplacer la liste déroulante du délai d’effacement du presse-papiers par un sélecteur segmenté cohérent avec celui du verrouillage automatique.

## Interface

Le réglage conserve les quatre valeurs existantes : `15 s`, `30 s`, `1 min` et `Jamais`. Les options sont affichées sur une ligne dans un conteneur clair à quatre colonnes. Un rectangle vert foncé indique la sélection et glisse entre les colonnes en 320 ms avec la même courbe d’animation que le délai de verrouillage.

Le contrôle conserve les états de focus visibles et reste utilisable au clavier grâce à des boutons radio natifs. La préférence enregistrée est sélectionnée à l’ouverture des paramètres.

## Implémentation

Le sélecteur reprend la structure et les styles du composant `delay-options`. Les styles communs sont partagés afin d’éviter deux implémentations visuellement divergentes. Une fonction synchronise la valeur du presse-papiers, l’état des boutons radio et la variable CSS `--selected-index`.

Le changement d’option continue d’enregistrer `clave-clipboard-clear-delay` dans `localStorage` et d’afficher le message existant.

## Vérification

Un test d’interface sélectionne une nouvelle durée, vérifie le déplacement de l’indicateur, la valeur enregistrée et la persistance après fermeture puis réouverture des paramètres.
