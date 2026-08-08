import unittest
from pathlib import Path


class TauriStaticAppTest(unittest.TestCase):
    def test_tauri_static_frontend_uses_global_invoke_without_bare_import(self):
        script = Path("src/script.js").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")

        self.assertNotIn("@tauri-apps/api", script)
        self.assertIn("__TAURI__.core.invoke", script)
        self.assertIn('"withGlobalTauri": true', config)

    def test_windows_release_does_not_open_a_console_window(self):
        main_rs = Path("src-tauri/src/main.rs").read_text(encoding="utf-8")

        self.assertIn('windows_subsystem = "windows"', main_rs)

    def test_context_menu_and_delete_category_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")

        self.assertIn('id="category-menu"', html)
        self.assertIn('id="delete-modal"', html)
        self.assertIn("contextmenu", script)
        self.assertIn("supprimer_categorie", script)
        self.assertIn("fn supprimer_categorie", lib)

    def test_master_password_lock_screen_is_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
        store = Path("src-tauri/src/store.rs").read_text(encoding="utf-8")

        self.assertIn('id="lock-screen"', html)
        self.assertIn('id="master-password"', html)
        self.assertNotIn('id="master-confirm"', html)
        self.assertIn("auth_status", script)
        self.assertIn("setup_master_password", script)
        self.assertIn("unlock", script)
        self.assertIn("fn auth_status", lib)
        self.assertIn("fn setup_master_password", lib)
        self.assertIn("fn unlock", lib)
        self.assertIn("PBKDF2-HMAC-SHA256", store)
        self.assertIn("wrapped_key", store)

    def test_launch_screen_waits_for_auth_and_exits_cleanly(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")

        self.assertIn('class="locked launching"', html)
        self.assertIn('id="launch-screen"', html)
        self.assertIn('role="status"', html)
        self.assertIn('id="app-root" inert aria-hidden="true"', html)
        self.assertIn("LAUNCH_MINIMUM_MS = 2000", script)
        self.assertIn("terminerEcranLancement", script)
        self.assertIn("demarrerApplication", script)
        self.assertIn("finally", script)
        self.assertIn("appRoot.inert = false", script)
        self.assertIn("appRoot.removeAttribute('aria-hidden')", script)
        self.assertIn("document.body.classList.remove('launching')", script)
        self.assertIn("afficherErreurDemarrage", script)
        self.assertIn(".launch-screen.is-leaving", style)
        self.assertIn(".app-root", style)
        self.assertIn("prefers-reduced-motion", style)
        self.assertIn("animation: launchContentIn 180ms", style)
        self.assertIn("animation: launchMarkPulse 600ms", style)
        self.assertIn("animation: launchProgress 480ms", style)
        self.assertIn("@keyframes launchMarkPulse", style)

        startup = script[script.index("async function demarrerApplication()") :]
        self.assertIn("let startupError = null", startup)
        self.assertLess(
            startup.index("await terminerEcranLancement()"),
            startup.index("afficherErreurDemarrage(startupError)"),
        )

    def test_productivity_security_options_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")

        for marker in [
            'id="search-input"',
            'id="lock-now"',
            'id="audit-panel"',
            'id="generator-length"',
            'id="backup-modal"',
        ]:
            self.assertIn(marker, html)

        self.assertNotIn('id="export-vault"', html)
        self.assertNotIn('id="import-vault"', html)

        for marker in [
            "filtrerAcces",
            "copierTexte",
            "modifierAcces",
            "supprimerAcces",
            "verrouillerApplication",
            "evaluerForceMotDePasse",
            "mettreAJourAudit",
            "exporterCoffre",
            "importerCoffre",
        ]:
            self.assertIn(marker, script)

        for command in ["modifier", "supprimer_acces", "exporter", "importer"]:
            self.assertIn(f"fn {command}", lib)
            self.assertIn(command, script)

    def test_settings_page_and_collapsed_generator_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")
        package = Path("package.json").read_text(encoding="utf-8")

        for marker in [
            'id="settings-button"',
            'id="settings-page"',
            'id="settings-lock-now"',
            'id="lock-hotkey-display"',
            'id="record-lock-hotkey"',
            'id="clear-lock-hotkey"',
            'id="biometry-settings"',
            'id="biometry-status"',
            'id="enable-biometry"',
            'id="disable-biometry"',
            'id="toggle-toolbar-lock"',
            'id="auto-lock-delay"',
            'id="change-master-form"',
            'id="settings-export-vault"',
            'id="settings-import-vault"',
            'class="tools-grid generator-collapsed"',
        ]:
            self.assertIn(marker, html)

        for marker in [
            "ouvrirParametres",
            "fermerParametres",
            "changerMotDePasseMaitre",
            "appliquerPreferenceVerrouillage",
            "appliquerDelaiVerrouillage",
            "capturerRaccourciVerrouillage",
            "gererRaccourciVerrouillage",
            "mettreAJourBiometrie",
            "activerBiometrie",
            "deverrouillerAvecBiometrie",
            "expliquerErreurBiometrie",
            "afficherGenerateur",
            "changer_mot_de_passe_maitre",
            "biometrie_status",
        ]:
            self.assertIn(marker, script)

        self.assertIn("fn changer_mot_de_passe_maitre", lib)
        self.assertIn("fn biometrie_status", lib)
        self.assertIn("tauri_plugin_biometry::init()", lib)
        self.assertNotIn('"entitlements": "entitlements.plist"', config)
        self.assertIn('"build:mac-local"', package)
        self.assertIn(".generator-collapsed .tool-panel:first-child", style)
        self.assertIn(".settings-page", style)

    def test_settings_controls_and_entry_context_menu_are_streamlined(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")

        self.assertNotIn(
            "Controle la securite, l'interface et les sauvegardes du coffre.",
            html,
        )
        self.assertIn('class="delay-options auto-lock-options"', html)
        self.assertIn('class="delay-options clipboard-delay-options"', html)
        self.assertIn('class="delay-selection"', html)
        self.assertEqual(html.count('name="auto-lock-delay"'), 4)
        self.assertEqual(html.count('name="clipboard-clear-delay"'), 4)
        self.assertIn('class="settings-switch"', html)
        self.assertIn('id="entry-menu"', html)
        self.assertIn('id="entry-menu-copy"', html)
        self.assertIn('id="entry-menu-edit"', html)
        self.assertIn('id="entry-menu-copy-email"', html)
        self.assertIn('id="entry-menu-delete"', html)

        entry_menu = html[html.index('id="entry-menu"') : html.index('id="category-menu"')]
        self.assertNotIn("Generer", entry_menu)
        self.assertNotIn('class="row-actions"', script)
        self.assertNotIn('class="generate-entry"', script)
        self.assertIn("ouvrirMenuAcces", script)
        self.assertIn("fermerMenuAcces", script)
        self.assertIn("entryMenuTarget", script)
        self.assertIn("synchroniserDelaiVerrouillage", script)
        self.assertIn("--selected-index", script)
        self.assertIn(".delay-options", style)
        self.assertIn(".delay-selection", style)
        self.assertIn(".delay-options label > span", style)
        self.assertNotIn(".delay-options span {", style)

    def test_vault_productivity_features_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        rust = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
        for marker in ('id="new-access"', 'data-view="history"', 'data-view="trash"', 'id="settings-import-browser"', 'id="entry-totp"'):
            self.assertIn(marker, html)
        for marker in ("ctrlKey", "importer_navigateur", "generer_totp", "restaurer_corbeille"):
            self.assertIn(marker, script + rust)

    def test_entry_menu_left_click_and_site_favicon_are_wired(self):
        script = Path("src/script.js").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")
        self.assertIn("event.stopPropagation()", script)
        self.assertIn("obtenirUrlLogo", script)
        self.assertIn("logo.className = 'entry-logo'", script)
        self.assertIn("logo.setAttribute('referrerpolicy', 'no-referrer')", script)
        self.assertIn(".entry-logo", style)
        list_click = script[script.index("document.getElementById('liste-mdp').addEventListener('click'") : script.index("document.getElementById('liste-mdp').addEventListener('contextmenu'")]
        self.assertIn("e.target.closest('.entry-more')", list_click)

    def test_settings_navigation_copy_and_vault_animation_are_consistent(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")

        for section in ("security", "interface", "backup", "shortcuts", "about"):
            self.assertIn(f'data-settings-section="{section}"', html)
            self.assertIn(f'data-settings-panel="{section}"', html)
        self.assertIn('class="settings-nav-indicator"', html)
        self.assertIn('class="vault-tab-selection"', html)
        self.assertIn("--selected-index", script)
        self.assertIn(".settings-nav-indicator", style)
        self.assertIn(".vault-tab-selection", style)
        self.assertIn(".vault-tabs.vault-tabs", style)
        self.assertIn(".vault-tabs .vault-tab.active", style)
        self.assertNotIn("Parametres", html)
        self.assertNotIn("Securite", html)
        self.assertNotIn("Sauvegarder", html + script)
        self.assertNotIn("Sauver", html + script)

    def test_interface_uses_geist_spacing_and_rounded_controls(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")

        self.assertIn("@font-face", style)
        self.assertIn("font-family: 'Geist'", style)
        self.assertIn("--radius-action: 40px", style)
        self.assertIn("--content-max: 1120px", style)
        self.assertIn("--section-gap: 24px", style)
        self.assertIn("font-family: var(--font-ui)", style)
        self.assertIn("border-radius: var(--radius-action)", style)
        self.assertIn("settings-panel[data-settings-panel=\"security\"]", style)
        self.assertNotIn("fonts.googleapis.com", html)

    def test_hardening_and_productivity_completion_is_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        rust = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
        store = Path("src-tauri/src/store.rs").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")
        package = Path("package.json").read_text(encoding="utf-8")

        self.assertNotIn("fonts.googleapis.com", html)
        self.assertNotIn('"csp": null', config)
        for marker in ('id="command-palette"', 'id="import-preview-modal"', 'id="empty-vault"', 'id="filter-favorites"', 'id="filter-recent"'):
            self.assertIn(marker, html)
        for marker in ("restaurer_historique", "supprimer_corbeille", "PURGE_AFTER_SECONDS", "favorite", "updated_at", "last_accessed"):
            self.assertIn(marker, rust + store)
        for marker in ("ouvrirPaletteCommandes", "previsualiserImport"):
            self.assertIn(marker, script)
        self.assertNotIn('id="check-breaches"', html)
        self.assertNotIn("verifierMotsDePasseCompromis", script)
        self.assertNotIn("api.pwnedpasswords.com", script + config)
        self.assertIn('"test:e2e"', package)
        self.assertTrue(Path("tests/e2e/clave.spec.js").exists())

    def test_security_foundation_is_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")
        cargo = Path("src-tauri/Cargo.toml").read_text(encoding="utf-8")
        workflow = Path(".github/workflows/release.yml").read_text(encoding="utf-8")

        for marker in [
            'id="app-version"',
            'id="check-update"',
            'id="install-update"',
            'id="clipboard-clear-delay"',
        ]:
            self.assertIn(marker, html)

        for marker in [
            "copierTexteSecurise",
            "nettoyerPressePapiersSiInchange",
            "demarrerSurveillanceVeille",
            "SLEEP_GAP_THRESHOLD_MS",
            "verifierMiseAJour",
        ]:
            self.assertIn(marker, script)

        self.assertIn("tauri-plugin-updater", cargo)
        self.assertIn("tauri-plugin-clipboard-manager", cargo)
        self.assertIn('"createUpdaterArtifacts": true', config)
        self.assertIn("releases/latest/download/latest.json", config)
        self.assertIn("TAURI_SIGNING_PRIVATE_KEY", workflow)
        self.assertIn("tauri-apps/tauri-action@v0.6.2", workflow)

    def test_release_workflow_uses_universal_macos_bundle_path(self):
        workflow = Path(".github/workflows/release.yml").read_text(encoding="utf-8")

        self.assertIn("--target universal-apple-darwin", workflow)
        self.assertIn("tauri-apps/tauri-action@v0.6.2", workflow)
        self.assertIn("uploadUpdaterSignatures: true", workflow)
        self.assertIn("actions/checkout@v5", workflow)
        self.assertIn("actions/setup-node@v5", workflow)

    def test_macos_biometry_is_disabled_without_keychain_workflow(self):
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")

        self.assertFalse(Path(".github/workflows/macos-biometry-test.yml").exists())
        self.assertFalse(Path("MACOS_BIOMETRY.md").exists())
        self.assertFalse(Path("scripts/macos-repair-clave.sh").exists())
        self.assertFalse(Path("src-tauri/entitlements.plist").exists())
        self.assertIn('#[cfg(target_os = "macos")]', lib)
        self.assertIn("Biometrie desactivee sur macOS.", lib)
        self.assertIn('#[cfg(not(target_os = "macos"))]', lib)
