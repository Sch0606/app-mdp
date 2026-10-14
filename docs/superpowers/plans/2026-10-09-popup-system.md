# Popup System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unifier toutes les couches temporaires de Clave sur des primitives accessibles fondées sur les API officielles du Web et de React.

**Architecture:** Une primitive modale portée dans `document.body`, une primitive de menu contextuel conforme APG et une région live persistante fournissent les comportements partagés. Les composants métier existants deviennent des compositions sans logique dupliquée de focus ou de fermeture.

**Tech Stack:** React 19, React DOM portals, HTML `<dialog>`, Motion for React, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-popup-system-design.md`

## Global Constraints

- Ne pas ajouter de dépendance.
- Préserver les identifiants DOM et les contrats de propriétés utilisés par les tests et les flux métier.
- Respecter `prefers-reduced-motion`.
- Ne jamais exposer de secret dans une notification ou un attribut DOM.
- Préserver tous les changements non validés déjà présents dans le répertoire.

## Review Focus

- Déclencheur démonté à la fermeture : ne pas lancer d’erreur lors de la restauration du focus.
- Plusieurs surfaces fermées pendant le verrouillage : aucune couche ne doit survivre.
- Menu ouvert près des bords : la surface doit rester entièrement visible.
- Modale ouverte au clavier : aucun mouvement décoratif ne doit retarder l’action.
- Région live réutilisée : deux messages successifs doivent rester annonçables.

---

### Task 1: Contrats d’interaction

**Files:**
- Modify: `tests/e2e/workflows.spec.js`

**Interfaces:**
- Consumes: flux de renommage, sauvegarde, palette, menus et notifications existants.
- Produces: assertions comportementales sur portail, focus, clavier et région live.

- [ ] Écrire les tests Playwright qui échouent avec l’implémentation actuelle.
- [ ] Exécuter uniquement ces tests et confirmer des échecs dus aux comportements absents.

### Task 2: Primitive modale

**Files:**
- Create: `src/components/overlays/ModalLayer.jsx`
- Modify: `src/components/overlays/Dialog.jsx`
- Modify: `src/components/overlays/CommandPalette.jsx`

**Interfaces:**
- Consumes: `open`, `onClose`, nom/description accessibles, classe et référence de focus initial.
- Produces: une couche modale portée, nativement inertée, fermable et restauratrice de focus.

- [ ] Implémenter `ModalLayer` jusqu’au passage des tests de portail et de focus.
- [ ] Migrer `Dialog` et `CommandPalette` sans changer leurs contrats métier.
- [ ] Exécuter les tests ciblés puis la suite E2E des workflows.

### Task 3: Primitive de menu contextuel

**Files:**
- Create: `src/components/overlays/ContextMenu.jsx`
- Modify: `src/components/overlays/CategoryContextMenu.jsx`
- Modify: `src/components/overlays/EntryContextMenu.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: cible, position, libellé et liste d’actions.
- Produces: menu porté, borné, navigable au clavier et auto-fermant.

- [ ] Ajouter les tests rouges pour flèches, Début/Fin, Échap et clic extérieur.
- [ ] Implémenter la primitive et migrer les deux menus.
- [ ] Retirer les écouteurs globaux devenus redondants dans `App`.
- [ ] Rejouer les tests ciblés.

### Task 4: Notifications et finition visuelle

**Files:**
- Modify: `src/components/overlays/Toast.jsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: le message actuel de `App`.
- Produces: région `status` persistante et pile visuelle animée.

- [ ] Ajouter le test rouge de persistance de la région live.
- [ ] Implémenter la région et les styles des trois primitives.
- [ ] Vérifier la réduction de mouvement et les tailles étroites.

### Task 5: Vérification intégrale

**Files:**
- Modify: aucun fichier produit attendu.

**Interfaces:**
- Consumes: système migré complet.
- Produces: preuves de construction et de non-régression.

- [ ] Exécuter `npm run test:unit`.
- [ ] Exécuter `npm run web:build`.
- [ ] Exécuter `npm run test:e2e`.
- [ ] Exécuter `npm run check`.
- [ ] Inspecter visuellement les variantes claire, sombre et mobile, puis corriger les défauts constatés.
