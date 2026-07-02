# Clave Hardening and Productivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sécuriser l’interface, tester les parcours réels et terminer l’historique, la poubelle, la recherche, l’import, les favoris, les récents et la détection de fuites.

**Architecture:** Le coffre chiffré reste la source de vérité et reçoit les métadonnées nécessaires. L’interface statique utilise des commandes Tauri ciblées, tandis que les tests de parcours injectent un adaptateur Tauri contrôlé dans un navigateur local.

**Tech Stack:** Tauri 2, Rust, JavaScript, CSS, Python unittest, Playwright.

---

### Task 1: Sécurité et tests de parcours

**Files:** `src-tauri/tauri.conf.json`, `src/index.html`, `src/style.css`, `tests/e2e/clave.spec.js`, `package.json`

- [ ] Activer une CSP sans scripts inline et supprimer Google Fonts.
- [ ] Ajouter Playwright et un faux adaptateur Tauri.
- [ ] Tester déverrouillage, ajout, modification, menu, suppression, paramètres et animation.

### Task 2: Historique, poubelle et métadonnées

**Files:** `src-tauri/src/store.rs`, `src-tauri/src/lib.rs`, `src/script.js`

- [ ] Ajouter dates, favori et dernière consultation aux accès avec migration par défaut.
- [ ] Restaurer une version historique.
- [ ] Supprimer individuellement et purger automatiquement après 30 jours.

### Task 3: Recherche et import

**Files:** `src/index.html`, `src/script.js`, `src/style.css`, `src-tauri/src/lib.rs`

- [ ] Créer la palette Ctrl+K avec navigation clavier et copie directe.
- [ ] Prévisualiser les CSV et sélectionner les lignes.
- [ ] Reconnaître Chrome, Edge, Firefox, Bitwarden et 1Password.

### Task 4: États, favoris, récents et fuites

**Files:** `src/index.html`, `src/script.js`, `src/style.css`

- [ ] Ajouter l’état vide et la date de modification.
- [ ] Ajouter les filtres Favoris et Récents.
- [ ] Vérifier les mots de passe par l’API k-anonymity de Have I Been Pwned.

### Task 5: Vérification

- [ ] Exécuter `py -m unittest discover -s tests -v`.
- [ ] Exécuter `npm run test:e2e`.
- [ ] Exécuter `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Exécuter `npm run build -- --no-bundle`.
