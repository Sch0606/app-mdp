# Clave React + Motion Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Clave's imperative frontend with a responsive React interface using Framer Motion and a custom biometric scan animation while preserving all Tauri behavior.

**Architecture:** Vite builds a React application from `src/` to `dist/`. A small Tauri adapter isolates native APIs, `App.jsx` coordinates state and commands, feature directories own focused components, and shared Motion presets keep animation behavior consistent and accessible.

**Tech Stack:** React 19, React DOM 19, Framer Motion, Lucide React, Vite, Tauri 2, Playwright.

## Global Constraints

- Preserve every existing Rust command name and encrypted data format.
- Use valid UTF-8 French copy throughout the interface.
- Use Framer Motion for structural transitions and respect `prefers-reduced-motion`.
- Keep password authentication available whenever biometric authentication is shown.
- Never log secrets, master passwords, TOTP seeds, backups, or clipboard content.
- Verify responsive behavior at 390px, 820px, and 1280px.

---

### Task 1: Vite and React runtime

**Files:**
- Modify: `package.json`
- Create: `vite.config.js`
- Modify: `src-tauri/tauri.conf.json`
- Replace: `src/index.html`
- Create: `src/main.jsx`
- Modify: `playwright.config.js`
- Test: `tests/e2e/clave.spec.js`

**Interfaces:**
- Produces: Vite dev server on port 1420 and production output in `dist/`.

- [ ] Write a Playwright smoke test expecting a React root with `data-testid="clave-app"`.
- [ ] Run `npm run test:e2e -- --grep "monte l application React"` and verify failure because the root does not exist.
- [ ] Add `react`, `react-dom`, `framer-motion`, and `lucide-react`; add Vite and the React plugin.
- [ ] Configure Vite with `root: 'src'`, port 1420, and `outDir: '../dist'`.
- [ ] Point Tauri dev/build commands and `frontendDist` at Vite.
- [ ] Replace the legacy document with `<div id="root"></div>` and mount a minimal `App` from `main.jsx`.
- [ ] Change Playwright's server command to `npm run web:build && npm run web:preview`.
- [ ] Run the smoke test and verify it passes.

### Task 2: Native adapter and security helpers

**Files:**
- Create: `src/lib/tauri.js`
- Create: `src/lib/security.js`
- Test: `tests/unit/security.test.js`

**Interfaces:**
- Produces: `tauri.invoke(command, args)`, `tauri.clipboard`, `tauri.updater`, `tauri.process`, `tauri.app`; `normalizeText`, `passwordStrength`, `auditEntries`, and `filterEntries`.

- [ ] Add Node tests for accent-insensitive search, strength levels, reused passwords, stale entries, favorites, and recent filters.
- [ ] Run `node --test tests/unit/security.test.js` and verify module-not-found failure.
- [ ] Implement pure helpers with no DOM access or secret logging.
- [ ] Implement the adapter using `window.__TAURI__`, with explicit unavailable errors for missing APIs.
- [ ] Run the unit tests and verify they pass.

### Task 3: Authentication and biometric scanner

**Files:**
- Create: `src/components/auth/LaunchScreen.jsx`
- Create: `src/components/auth/BiometricScanner.jsx`
- Create: `src/components/auth/LockScreen.jsx`
- Create: `src/motion/presets.js`
- Test: `tests/e2e/auth.spec.js`

**Interfaces:**
- `BiometricScanner({ state, onActivate, message })` accepts `idle | scanning | success | failure`.
- `LockScreen({ configured, biometry, busy, error, onPassword, onBiometry })` emits authentication intents without calling Tauri directly.

- [ ] Add tests for password setup/unlock, biometric visibility, scanning state during a deferred native command, success confirmation, failure recovery, and reduced motion.
- [ ] Run `npm run test:e2e -- tests/e2e/auth.spec.js` and verify failure because the lock screen is absent.
- [ ] Build the custom four-corner scanner with Motion paths, a traveling scan line, and ARIA live feedback.
- [ ] Build the password form and preserve password fallback.
- [ ] Implement launch and lock transitions with shared presets.
- [ ] Run authentication tests and verify they pass.

### Task 4: Vault state and responsive shell

**Files:**
- Create: `src/state/vaultReducer.js`
- Create: `src/components/layout/AppShell.jsx`
- Create: `src/components/vault/Sidebar.jsx`
- Create: `src/components/vault/VaultHeader.jsx`
- Create: `src/components/vault/VaultTabs.jsx`
- Modify: `src/App.jsx`
- Test: `tests/unit/vaultReducer.test.js`
- Test: `tests/e2e/layout.spec.js`

**Interfaces:**
- `vaultReducer(state, action)` owns categories, active category, vault view, search, and filters.
- `AppShell({ mode, sidebar, children, drawer })` provides desktop, compact, and mobile regions.

- [ ] Add reducer tests for load, category selection, mutation replacement, search, filter, and lock reset.
- [ ] Add layout tests at 390px, 820px, and 1280px for visible navigation and zero horizontal overflow.
- [ ] Run both suites and verify expected failures.
- [ ] Implement reducer and responsive shell.
- [ ] Implement animated shared selection indicators with `layoutId`.
- [ ] Run both suites and verify they pass.

### Task 5: Access list, editor, generator, and audit

**Files:**
- Create: `src/components/vault/EntryList.jsx`
- Create: `src/components/vault/EntryRow.jsx`
- Create: `src/components/vault/EntryDrawer.jsx`
- Create: `src/components/vault/SecurityTools.jsx`
- Test: `tests/e2e/vault.spec.js`

**Interfaces:**
- `EntryList` receives filtered entries and emits semantic edit/copy/favorite/delete actions.
- `EntryDrawer({ entry, category, onSave, onClose, onGenerate })` emits normalized form data.

- [ ] Add tests for empty state, add, edit, favorite, copy, delete, generator options, and audit updates.
- [ ] Run the vault suite and verify failure because the controls do not exist.
- [ ] Implement rows with a ten-item-capped stagger and stable responsive columns.
- [ ] Implement the animated editor drawer and validation.
- [ ] Implement generator and audit panels using pure security helpers.
- [ ] Connect confirmed Tauri mutations in `App.jsx`.
- [ ] Run the vault suite and verify it passes.

### Task 6: Settings and security preferences

**Files:**
- Create: `src/components/settings/SettingsView.jsx`
- Create: `src/components/settings/DelaySelector.jsx`
- Test: `tests/e2e/settings.spec.js`

**Interfaces:**
- `SettingsView` receives current preferences and callback props for lock, biometry, password, backup, shortcut, and updater actions.

- [ ] Add tests for animated section selection, automatic lock delay, clipboard delay persistence, toolbar lock preference, biometric enrollment controls, password change, updater, and returning to the vault.
- [ ] Run the settings suite and verify failure.
- [ ] Implement settings navigation and shared selection motion.
- [ ] Implement delay selectors and preference callbacks.
- [ ] Connect biometric enrollment and updater commands.
- [ ] Run the settings suite and verify it passes.

### Task 7: Overlays, command search, history, trash, and import

**Files:**
- Create: `src/components/overlays/Dialog.jsx`
- Create: `src/components/overlays/ToastStack.jsx`
- Create: `src/components/overlays/CommandPalette.jsx`
- Create: `src/components/overlays/ContextMenu.jsx`
- Create: `src/components/vault/ActivityList.jsx`
- Test: `tests/e2e/workflows.spec.js`

**Interfaces:**
- Overlay components receive open state and semantic callbacks; no overlay invokes Tauri directly.
- `ActivityList({ mode, items, onRestore, onDelete, onEmpty })` supports history and trash.

- [ ] Add tests for Ctrl+K, keyboard selection, outside click, context menus, history restore, trash restore/delete/empty, category rename/delete, encrypted backup, browser CSV preview, and focus restoration.
- [ ] Run the workflow suite and verify failure.
- [ ] Implement overlays with `AnimatePresence`, focus management, and Escape behavior.
- [ ] Implement history/trash and import flows.
- [ ] Connect all existing commands through the adapter.
- [ ] Run the workflow suite and verify it passes.

### Task 8: Complete visual system and motion QA

**Files:**
- Replace: `src/style.css`
- Modify: all React components as required by visual QA
- Test: `tests/e2e/visual.spec.js`

**Interfaces:**
- Produces: tokenized CSS, stable responsive dimensions, visible focus, and motion-safe fallbacks.

- [ ] Add tests for Geist fonts, key token colors, responsive overflow, drawer geometry, focus visibility, and reduced-motion transform removal.
- [ ] Run the visual suite and verify failure.
- [ ] Implement the complete tokenized CSS system and responsive breakpoints.
- [ ] Capture Playwright screenshots at 390x844, 820x720, and 1280x800.
- [ ] Inspect screenshots for overlap, clipping, blank states, and inconsistent spacing; patch only observed defects.
- [ ] Run all Playwright tests and verify they pass.

### Task 9: Production verification

**Files:**
- Modify: documentation only if commands changed during implementation.

**Interfaces:**
- Produces: verified distributable frontend and unchanged tested Rust backend.

- [ ] Run `npm run web:build` and require exit code 0 with no unresolved assets.
- [ ] Run `npm run test:e2e` and require all tests to pass.
- [ ] Run `npm run check` and require all Rust tests to pass.
- [ ] Run `git diff --check` and require no whitespace errors.
- [ ] Review the final diff for secret logging, removed Tauri commands, placeholder text, mojibake, and unhandled reduced motion.
