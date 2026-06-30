# Clave Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer dans Clave la fondation securite, la nouvelle experience du coffre, l'historique, la corbeille, les imports navigateurs et les codes TOTP.

**Architecture:** Le backend Rust reste l'autorite pour le stockage chiffre, les migrations, l'historique, la corbeille, l'import CSV et TOTP. Le frontend est decoupe en services JavaScript pour le presse-papiers, la veille, la palette et les vues. GitHub Releases devient le canal de mise a jour signe.

**Tech Stack:** Tauri 2, Rust 2021, JavaScript ES2022, HTML/CSS, GitHub Actions, AES-GCM, CSV, TOTP RFC 6238.

---

### Task 1: Contrats de securite et de livraison

**Files:**
- Modify: `tests/test_tauri_static_app.py`
- Modify: `src-tauri/src/store.rs`

- [ ] Ajouter des tests exigeant la version, l'updater GitHub, le delai du presse-papiers et le battement de veille.
- [ ] Ajouter des tests Rust pour `should_clear_clipboard(copied, current)` et `detect_sleep_gap(previous, current, interval)`.
- [ ] Executer les tests cibles et confirmer leur echec avant implementation.

### Task 2: Version, mise a jour GitHub et publication signee

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.github/workflows/release.yml`
- Modify: `src/index.html`
- Modify: `src/script.js`

- [ ] Integrer les modules officiels Tauri App, Updater et Process.
- [ ] Configurer l'endpoint GitHub Releases de `Sch0606/app-mdp` et la cle publique de signature.
- [ ] Afficher la version courante et les etats `verification`, `a jour`, `disponible`, `telechargement`, `erreur`.
- [ ] Generer dans GitHub Actions les bundles signes et le manifeste updater.
- [ ] Executer les tests statiques et `cargo check`.

### Task 3: Presse-papiers et reprise apres veille

**Files:**
- Modify: `src/index.html`
- Modify: `src/script.js`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/test_tauri_static_app.py`

- [ ] Centraliser les copies de secrets et planifier 15 s, 30 s, 60 s ou jamais.
- [ ] Relire le presse-papiers avant effacement afin de ne jamais supprimer une nouvelle copie de l'utilisateur.
- [ ] Ajouter un battement monotone qui verrouille apres un ecart de veille et a la restauration de visibilite.
- [ ] Verifier que le verrouillage annule les minuteurs et ne journalise aucun secret.

### Task 4: Modele chiffre version 3, historique et corbeille

**Files:**
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] Faire evoluer `PasswordEntry` avec `id`, `website`, `notes`, `totp_secret`, `created_at`, `updated_at` et valeurs par defaut pour les anciens coffres.
- [ ] Faire evoluer le coffre chiffre avec `history` et `trash`, tous deux chiffres avec la cle du coffre.
- [ ] Enregistrer l'ancienne valeur lors d'une modification et deplacer une suppression dans la corbeille.
- [ ] Ajouter les commandes de lecture, restauration et vidage.
- [ ] Tester la migration v2, la restauration d'historique et la restauration de corbeille.

### Task 5: Nouvelle liste et panneau Nouvel acces

**Files:**
- Modify: `src/index.html`
- Modify: `src/style.css`
- Modify: `src/script.js`

- [ ] Remplacer le formulaire permanent par un bouton `Nouvel acces` et un panneau lateral reutilise pour creer ou modifier.
- [ ] Afficher des lignes compactes avec initiale, service, identifiant, force, date et bouton `•••`.
- [ ] Conserver le clic droit et faire partager le meme menu au bouton `•••`.
- [ ] Brancher copie, modification et suppression sur les identifiants stables.
- [ ] Verifier le rendu 920 px et 1180 px ainsi que les parcours clavier.

### Task 6: Recherche rapide Ctrl+K

**Files:**
- Modify: `src/index.html`
- Modify: `src/style.css`
- Modify: `src/script.js`

- [ ] Ajouter une palette modale ouverte par `Ctrl+K` ou `Cmd+K`.
- [ ] Filtrer localement par service, identifiant, site et espace.
- [ ] Permettre fleches, Entree, Echap, copie du secret et ouverture de l'acces.
- [ ] Tester la fermeture, le focus et l'absence de secret dans le texte de resultat.

### Task 7: Vues Historique et Corbeille

**Files:**
- Modify: `src/index.html`
- Modify: `src/style.css`
- Modify: `src/script.js`

- [ ] Ajouter les vues `Acces`, `Historique`, `Corbeille` dans le coffre.
- [ ] Afficher l'action, le service et la date sans afficher le secret.
- [ ] Restaurer une version ou un element supprime apres confirmation.
- [ ] Vider la corbeille apres confirmation.

### Task 8: Import Chrome, Edge et Firefox

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/index.html`
- Modify: `src/script.js`

- [ ] Parser les CSV Chrome/Edge `name,url,username,password,note` et Firefox `url,username,password,...`.
- [ ] Afficher un apercu avec nombre de lignes valides, doublons et erreurs.
- [ ] Importer apres confirmation dans l'espace choisi et chiffrer immediatement.
- [ ] Effacer le contenu CSV de la memoire frontend apres l'operation.
- [ ] Tester les variantes d'entetes et les lignes mal formees.

### Task 9: Codes TOTP

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/index.html`
- Modify: `src/script.js`

- [ ] Accepter une cle Base32 ou une URI `otpauth://` dans le panneau d'acces.
- [ ] Chiffrer le secret TOTP dans le coffre.
- [ ] Generer un code RFC 6238 a six chiffres et son temps restant via Rust.
- [ ] Afficher et copier le code sans l'ajouter a l'historique.
- [ ] Tester les vecteurs RFC et les secrets invalides.

### Task 10: Verification et livraison

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

- [ ] Executer `node --check src/script.js`.
- [ ] Executer `python -m unittest discover -s tests -v`.
- [ ] Executer `npm run check`.
- [ ] Executer `npm run build` et verifier les bundles Windows.
- [ ] Verifier qu'un coffre v2 est migre sans perte et qu'une mise a jour de test est refusee si la signature est invalide.
