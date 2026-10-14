# Système de pop-ups — conception

## Objectif

Remplacer les implémentations dispersées des dialogues, de la palette, des menus contextuels et des notifications par un système cohérent, accessible et testable, sans modifier les flux métier de Clave.

## Références officielles

- React `createPortal` pour sortir les couches des conteneurs susceptibles de les rogner.
- Élément HTML `<dialog>` ouvert avec `showModal()` pour la couche supérieure native, l’inertie du document et le confinement du focus.
- WAI-ARIA APG Dialog Modal pour le focus initial, Échap, le bouton de fermeture, le nom accessible et le retour du focus.
- WAI-ARIA APG Menu pour les rôles, les flèches, Début/Fin, Échap et le retour au contexte.
- Motion `AnimatePresence` pour conserver les éléments pendant leur animation de sortie.

## Architecture

`ModalLayer` est la primitive modale. Elle rend un `<dialog>` dans `document.body` avec `createPortal`, l’ouvre par `showModal()`, intercepte `cancel`, gère le clic sur l’arrière-plan, place le focus initial et le rend au déclencheur. Le navigateur fournit l’inertie et la boucle de tabulation natives. Les dialogues métier et la palette ne réimplémentent plus ce comportement.

`ContextMenu` est la primitive non modale. Elle rend le menu dans le même portail, borne sa position à la fenêtre après mesure, place le focus sur le premier item et implémente la navigation verticale WAI-ARIA. Elle se ferme sur sélection, clic extérieur, Tab ou Échap, puis rend le focus au contexte précédent.

`ToastRegion` reste montée en permanence avec une région `status`. Les messages sont rendus dans une pile visuelle séparée afin que les annonces ne dépendent pas du montage de la région live. La compatibilité avec l’état actuel de `App` est conservée.

## Composants migrés

- `Dialog`, `BackupDialog` et `ImportPreviewDialog` utilisent `ModalLayer`.
- `CommandPalette` utilise `ModalLayer` en variante large et instantanée pour les ouvertures clavier.
- `CategoryContextMenu` et `EntryContextMenu` utilisent `ContextMenu`.
- `Toast` devient la façade de `ToastRegion`.

## Présentation et mouvement

Le vocabulaire visuel reste celui de Clave : papier légèrement teinté, vert profond, traits fins et ombres contrôlées. Les modales apparaissent par une translation verticale de 8 px, une opacité et un flou légers sur 180 ms, sans rebond. La sortie est plus courte et moins mobile. Les menus partent de leur point d’invocation. La palette clavier est instantanée. `prefers-reduced-motion` désactive les déplacements et les flous.

## Gestion des erreurs et cas limites

- Un environnement sans `HTMLDialogElement.showModal` conserve les rôles ARIA et le confinement manuel comme repli.
- Une cible de retour supprimée n’est jamais refocalisée ; le focus revient au document.
- Une modale non fermable ignore Échap et le clic d’arrière-plan.
- Un menu vide ne tente aucun déplacement de focus.
- Les positions négatives ou hors écran sont bornées avec une marge de 8 px.

## Validation

Les tests Playwright vérifient le portail, la modalité native, le focus initial et restauré, Échap, le clic d’arrière-plan, la navigation complète des menus, la fermeture extérieure, la région live persistante et le comportement en réduction de mouvement. La suite unitaire, la construction Vite et les tests Rust restent des barrières de régression.
