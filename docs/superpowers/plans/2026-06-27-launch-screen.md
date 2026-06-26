# Clave Launch Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un ecran de lancement Clave jusqu'a ce que l'authentification soit initialisee, pendant au moins 500 ms.

**Architecture:** Le HTML initial contient un calque plein ecran immediatement visible. Une fonction JavaScript unique attend la fin de `initialiserAuth()`, applique le delai minimum restant, puis anime et retire le calque dans un bloc `finally` afin de couvrir aussi les erreurs.

**Tech Stack:** HTML statique, CSS, JavaScript ES2022, Tauri 2, tests Python `unittest`.

---

### Task 1: Verrouiller le contrat de l'ecran de lancement

**Files:**
- Modify: `tests/test_tauri_static_app.py`

- [ ] **Step 1: Write the failing test**

Ajouter a `TauriStaticAppTest` :

```python
def test_launch_screen_waits_for_auth_and_exits_cleanly(self):
    html = Path("src/index.html").read_text(encoding="utf-8")
    script = Path("src/script.js").read_text(encoding="utf-8")
    style = Path("src/style.css").read_text(encoding="utf-8")

    self.assertIn('class="locked launching"', html)
    self.assertIn('id="launch-screen"', html)
    self.assertIn('role="status"', html)
    self.assertIn("LAUNCH_MINIMUM_MS = 500", script)
    self.assertIn("terminerEcranLancement", script)
    self.assertIn("demarrerApplication", script)
    self.assertIn("finally", script)
    self.assertIn(".launch-screen.is-leaving", style)
    self.assertIn("prefers-reduced-motion", style)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_tauri_static_app.TauriStaticAppTest.test_launch_screen_waits_for_auth_and_exits_cleanly -v`

Expected: `FAIL` because `id="launch-screen"` is absent.

- [ ] **Step 3: Commit the failing contract**

```bash
git add tests/test_tauri_static_app.py
git commit -m "test: define Clave launch screen behavior"
```

### Task 2: Ajouter l'interface et le cycle de lancement

**Files:**
- Modify: `src/index.html`
- Modify: `src/style.css`
- Modify: `src/script.js`
- Test: `tests/test_tauri_static_app.py`

- [ ] **Step 1: Add the initial HTML layer**

Mettre `launching` sur `body` et inserer avant l'ecran de verrouillage :

```html
<body class="locked launching">
<section class="launch-screen" id="launch-screen" role="status" aria-live="polite" aria-label="Ouverture de Clave">
    <div class="launch-content">
        <span class="launch-mark" aria-hidden="true">C</span>
        <p class="launch-brand">Clave</p>
        <p class="launch-message">Ouverture du coffre</p>
        <span class="launch-progress" aria-hidden="true"><span></span></span>
    </div>
</section>
```

- [ ] **Step 2: Style the splash and its reduced-motion state**

Ajouter les regles suivantes pres des styles de verrouillage :

```css
.launch-screen {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    color: #f8fffc;
    background: var(--clave-forest);
    opacity: 1;
    transition: opacity 220ms var(--ease);
}

.launch-screen.is-leaving {
    opacity: 0;
    pointer-events: none;
}

.launch-content {
    display: grid;
    justify-items: center;
    gap: 10px;
    animation: launchContentIn 500ms var(--ease) both;
}

.launch-mark {
    width: 58px;
    height: 58px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    color: var(--clave-forest);
    background: var(--clave-mint);
    font-family: "Space Grotesk", Manrope, sans-serif;
    font-size: 30px;
    font-weight: 700;
}

.launch-brand {
    font-family: "Space Grotesk", Manrope, sans-serif;
    font-size: 24px;
    font-weight: 700;
}

.launch-message {
    color: rgba(248, 255, 252, 0.68);
    font-size: 12px;
    font-weight: 700;
}

.launch-progress {
    width: 104px;
    height: 2px;
    margin-top: 12px;
    overflow: hidden;
    background: rgba(248, 255, 252, 0.16);
}

.launch-progress span {
    width: 42%;
    height: 100%;
    display: block;
    background: var(--clave-mint);
    animation: launchProgress 900ms ease-in-out infinite;
}

@keyframes launchContentIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes launchProgress {
    from { transform: translateX(-120%); }
    to { transform: translateX(340%); }
}
```

Le bloc global `@media (prefers-reduced-motion: reduce)` deja present neutralise ces animations.

- [ ] **Step 3: Couple the layer to real initialization**

Ajouter au debut de `src/script.js` :

```js
const LAUNCH_MINIMUM_MS = 500
const launchStartedAt = performance.now()
```

Remplacer l'appel final direct a `initialiserAuth()` par :

```js
function attendre(ms) {
    return new Promise(function(resolve) {
        window.setTimeout(resolve, Math.max(0, ms))
    })
}

async function terminerEcranLancement() {
    const elapsed = performance.now() - launchStartedAt
    await attendre(LAUNCH_MINIMUM_MS - elapsed)

    const launchScreen = document.getElementById('launch-screen')
    if (!launchScreen) return

    launchScreen.classList.add('is-leaving')
    await attendre(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220)
    launchScreen.remove()
    document.body.classList.remove('launching')
}

async function demarrerApplication() {
    try {
        await initialiserAuth()
    } catch (error) {
        afficherToast(String(error))
    } finally {
        await terminerEcranLancement()
    }
}

demarrerApplication()
```

- [ ] **Step 4: Run the focused test**

Run: `python -m unittest tests.test_tauri_static_app.TauriStaticAppTest.test_launch_screen_waits_for_auth_and_exits_cleanly -v`

Expected: `OK` with one passing test.

- [ ] **Step 5: Run frontend and project verification**

```bash
node --check src/script.js
python -m unittest discover -s tests -v
npm run check
git diff --check
```

Expected: JavaScript exits with code 0, 13 Python tests pass, 10 Rust tests pass, and `git diff --check` reports no errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/index.html src/style.css src/script.js
git commit -m "feat: add Clave launch screen"
```
