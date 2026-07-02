# Settings and Entry Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moderniser les controles de reglages, deplacer les actions d'acces dans un menu contextuel et reconstruire Clave avec son splash.

**Architecture:** Le HTML porte les controles accessibles et les deux menus contextuels. Le JavaScript conserve les preferences existantes et centralise la ligne cible du menu d'acces. Le CSS applique le langage visuel vert et menthe deja utilise par Clave.

**Tech Stack:** HTML, CSS, JavaScript ES2022, Tauri 2, Python unittest, Rust.

---

### Task 1: Verrouiller le contrat visuel et fonctionnel

**Files:**
- Modify: `tests/test_tauri_static_app.py`

- [ ] Ajouter un test qui exige le controle segmente, l'interrupteur, le menu `entry-menu`, l'absence du sous-texte et l'absence de `row-actions`.
- [ ] Executer le test cible et confirmer qu'il echoue sur le HTML actuel.

### Task 2: Moderniser les reglages

**Files:**
- Modify: `src/index.html`
- Modify: `src/script.js`
- Modify: `src/style.css`

- [ ] Remplacer le select par quatre radios stylisees et un indicateur glissant sans changer les valeurs stockees.
- [ ] Remplacer la case a cocher visible par un interrupteur accessible.
- [ ] Supprimer le sous-texte du titre Parametres.
- [ ] Executer le test cible.

### Task 3: Ajouter le menu contextuel des acces

**Files:**
- Modify: `src/index.html`
- Modify: `src/script.js`
- Modify: `src/style.css`
- Test: `tests/test_tauri_static_app.py`

- [ ] Retirer le bloc `row-actions` des lignes generees.
- [ ] Ajouter le menu avec Copier le mot de passe, Enregistrer et Supprimer.
- [ ] Brancher clic droit, clic exterieur et Echap sur la ligne cible.
- [ ] Verifier que Generer n'est pas present dans ce menu.

### Task 4: Verifier et reconstruire

**Files:**
- Verify: `src/index.html`, `src/script.js`, `src/style.css`
- Build: `src-tauri/target/release/bundle/nsis/Clave_0.1.2_x64-setup.exe`

- [ ] Executer `node --check src/script.js`.
- [ ] Executer `python -m unittest discover -s tests -v`.
- [ ] Executer `npm run check`.
- [ ] Controler le rendu local dans le navigateur.
- [ ] Verifier que le splash reste visible au moins deux secondes.
- [ ] Executer `npm run build` et verifier la date du nouvel installateur.
