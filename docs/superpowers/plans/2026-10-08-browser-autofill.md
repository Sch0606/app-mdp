# Browser Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un remplissage sûr des identifiants Clave dans Chrome et Edge.

**Architecture:** Un serveur local Rust partage le coffre déverrouillé et expose une API minimale protégée par jeton. Une extension Manifest V3 détecte les formulaires, demande les comptes correspondant exactement au domaine et remplit uniquement après sélection.

**Tech Stack:** Rust, Tauri 2, React 19, Chrome Extensions Manifest V3, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-browser-autofill-design.md`

## Global Constraints

- Écouter uniquement `127.0.0.1:32191`.
- Ne jamais renvoyer de secret dans la liste des correspondances.
- Refuser toute origine non-extension, tout jeton invalide et tout coffre verrouillé.
- Exiger un choix utilisateur avant remplissage.
- Ne faire correspondre que l’hôte exact, avec équivalence `www`.

## Review Focus

- Domaine homographe ou suffixe proche : aucune correspondance.
- Coffre verrouillé : aucune métadonnée ni secret.
- Jeton absent ou invalide : requête refusée.
- Plusieurs comptes : aucun compte choisi implicitement.
- Champ React contrôlé : événements `input` et `change` émis après remplissage.

---

### Task 1: Moteur de correspondance et API locale

**Files:**
- Create: `src-tauri/src/autofill.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: `AutofillRuntime`, `start_server`, `status`, `set_enabled`, `rotate_token`.

- [ ] Écrire les tests Rust de domaine, verrouillage et absence de secret.
- [ ] Exécuter les tests et constater leur échec faute de module.
- [ ] Implémenter la configuration et l’API locale minimale.
- [ ] Exécuter les tests Rust et obtenir un résultat vert.

### Task 2: Réglages dans Clave

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/settings/SettingsView.jsx`
- Modify: `src/style.css`
- Modify: `tests/e2e/workflows.spec.js`

**Interfaces:**
- Consumes: commandes Tauri `autofill_status`, `set_autofill_enabled`, `rotate_autofill_token`.

- [ ] Écrire le test Playwright du panneau de remplissage.
- [ ] Exécuter le test et vérifier son échec.
- [ ] Ajouter l’état, les actions et le panneau compact de réglages.
- [ ] Exécuter le test et obtenir un résultat vert.

### Task 3: Extension Chromium

**Files:**
- Create: `browser-extension/manifest.json`
- Create: `browser-extension/autofill-core.js`
- Create: `browser-extension/service-worker.js`
- Create: `browser-extension/content-script.js`
- Create: `browser-extension/options.html`
- Create: `browser-extension/options.js`
- Create: `browser-extension/styles.css`
- Create: `browser-extension/README.md`
- Create: `tests/unit/autofill-core.test.js`

**Interfaces:**
- Consumes: API locale `/v1/status`, `/v1/matches`, `/v1/credential`, `/v1/focus`.

- [ ] Écrire les tests Node de détection et de remplissage.
- [ ] Exécuter les tests et vérifier leur échec.
- [ ] Implémenter le cœur testable, le worker, l’interface et les options.
- [ ] Exécuter les tests unitaires et obtenir un résultat vert.

### Task 4: Vérification intégrée

**Files:**
- Modify: `browser-extension/README.md` si les vérifications révèlent une divergence.

- [ ] Exécuter `npm run test:unit`.
- [ ] Exécuter `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Exécuter `npm run test:e2e`.
- [ ] Exécuter `npm run web:build`.
- [ ] Examiner le diff de sécurité et corriger toute régression importante avec un test rouge puis vert.
