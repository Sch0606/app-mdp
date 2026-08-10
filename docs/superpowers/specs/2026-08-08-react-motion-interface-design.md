# Clave React + Motion Interface Design

## Objective

Migrate the complete Clave frontend from imperative HTML/CSS/JavaScript to React while preserving the Rust/Tauri security model and every existing command. The new interface must feel immediate, remain usable in compact desktop windows, use Framer Motion for purposeful transitions, and provide a custom biometric authentication animation inspired by a face scan without copying Apple's Face ID artwork or branding.

## Scope

The migration covers the launch and lock screens, vault navigation, categories, access list, entry editor, generator, audit, history, trash, contextual actions, command palette, settings, import/export flows, notifications, shortcuts, inactivity locking, clipboard clearing, updater controls, and biometric activation/unlock.

The Rust backend, encrypted data format, Tauri command names, updater endpoints, and biometric plugin remain unchanged unless a frontend integration defect proves a backend change necessary.

## Architecture

Vite builds a React 19 frontend into `dist/` for Tauri. `src/main.jsx` mounts a single `App` component. Feature-focused modules keep rendering, state, Tauri access, and motion definitions separate:

- `src/lib/tauri.js` exposes the global Tauri APIs through a testable adapter.
- `src/lib/security.js` contains password strength, filtering, normalization, and audit helpers.
- `src/motion/presets.js` contains shared springs, transitions, and reduced-motion helpers.
- `src/components/auth/` owns launch, password authentication, and biometric scan states.
- `src/components/vault/` owns navigation, tabs, entries, tools, and the editor drawer.
- `src/components/settings/` owns the settings workspace.
- `src/components/overlays/` owns dialogs, command search, menus, and toasts.
- `src/App.jsx` owns application orchestration and the command/data flow.

React state is managed with `useReducer`, local component state, and focused hooks. No external state library is added.

## Visual Direction

Clave is a quiet security workspace, not a marketing page. The interface uses compact information hierarchy, controlled whitespace, and clear state colors.

### Tokens

- Ink: `#13231f`
- Forest: `#164c3e`
- Forest hover: `#0f3b30`
- Mint: `#a9e7d2`
- Mist: `#eef5f2`
- Paper: `#fbfdfc`
- Line: `#d9e5e0`
- Warning: `#a86713`
- Danger: `#a63d35`

Geist Sans remains the primary typeface. Data, shortcuts, timers, and generated codes use Geist Mono. The design avoids gradients, decorative blobs, oversized cards, and excessive rounding. Repeated access entries may use restrained 8px surfaces; page sections remain unframed.

The signature element is a luminous mint scan path that travels around a four-corner biometric frame. The same spring language drives tab and navigation selection, connecting authentication and vault navigation without adding decoration elsewhere.

## Layout

At widths above 1080px, the vault uses a fixed navigation rail, a fluid main workspace, and an optional 380px editor drawer. Between 760px and 1080px, the navigation rail collapses to icons and the editor overlays the right edge. Below 760px, navigation becomes a bottom bar, the toolbar wraps, table metadata is reduced, and the editor fills the viewport.

The Tauri minimum width may remain desktop-oriented, but responsive CSS and Playwright coverage must prove that the web frontend remains coherent at 390px, 820px, and 1280px.

## Motion System

Framer Motion owns all structural transitions. CSS remains responsible for color, focus, and simple hover state changes.

- App launch: 500ms staged mark, status, and progress reveal, then a 260ms exit.
- Password authentication: 240ms card entrance and 180ms error shake.
- Biometric authentication: idle, scanning, success, and failure states inside one custom scan frame. Scanning loops only while the native biometric command is pending. Success draws a check and opens the vault; failure flashes the corners and returns to idle.
- Workspace transitions: `AnimatePresence` with a 220ms fade/translate between vault and settings.
- Navigation selection: shared `layoutId` spring with stiffness 420, damping 34.
- Entry rows: 20ms stagger capped at ten visible items; subsequent items appear without delay.
- Entry drawer: spring with stiffness 360, damping 36 and an opacity backdrop on compact layouts.
- Dialogs and command palette: 180-220ms scale/translate with focus restored after exit.
- Toasts: stacked enter/exit with no layout jump.

Animations never delay data mutation or block controls. `useReducedMotion()` removes transforms, loops, and stagger while preserving immediate opacity state changes.

## Biometric Flow

The lock screen displays the biometric control only when `biometrie_status` reports both availability and enrollment. Activating it moves the custom scanner from `idle` to `scanning`, then calls `deverrouiller_biometrie`.

On success, the scanner enters `success`, announces “Identité confirmée”, waits only for the 350ms confirmation drawing, loads the vault, then transitions to the workspace. On failure or cancellation, it enters `failure`, exposes the backend message in an ARIA live region, and returns to `idle` after the feedback animation. Password authentication always remains available.

The animation is a product-specific geometric scan, not a spoof of an operating-system prompt. The actual identity decision remains entirely inside the native Tauri biometric plugin.

## Data and Error Flow

All Tauri commands pass through `tauri.js`. Commands reject with normalized French messages. Mutations update the React state only after the backend confirms success, except reversible view preferences stored in `localStorage`.

Sensitive values are never written to logs. Clipboard clearing keeps the current compare-before-clear behavior. Locking clears in-memory categories and closes every overlay. Import files remain user-selected and are never retained by the frontend.

## Accessibility

Every icon button has an accessible name and tooltip. Dialogs trap focus, Escape closes dismissible overlays, and focus returns to the trigger. Selection uses both color and semantic state. Keyboard shortcuts remain functional. Text is corrected to valid UTF-8 French. Motion respects `prefers-reduced-motion`.

## Testing

Playwright runs against the Vite production preview. Tests stub the global Tauri adapter and cover:

- password and biometric authentication states;
- adding, editing, copying, favoriting, and deleting an access;
- category navigation and creation under constrained height;
- vault/settings/tab shared indicators;
- command palette keyboard and outside-click behavior;
- responsive layouts at 390px, 820px, and 1280px;
- reduced-motion behavior;
- no horizontal overflow or overlapping controls;
- preserved import, settings, and lock actions.

Rust tests continue to verify the storage and command layer. A production Vite build and `cargo test` are required before completion.

## Future Features

Recommended follow-up work, in priority order:

1. Password health center for weak, reused, and stale credentials.
2. Privacy-preserving breach checks using k-anonymity.
3. Persistent TOTP display with copy countdown.
4. Browser extension and autofill bridge.
5. Secure notes, payment cards, and passkey metadata.
6. End-to-end encrypted device synchronization.
7. Controlled emergency access.
