# Clipboard Delay Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la liste déroulante d’effacement du presse-papiers par le même sélecteur segmenté animé que le verrouillage automatique.

**Architecture:** Le composant utilise quatre boutons radio natifs dans le conteneur CSS `delay-options`, avec une classe additionnelle permettant de cibler son indicateur. Une fonction JavaScript synchronise la valeur persistée, l’état coché et `--selected-index` à l’ouverture et après chaque changement.

**Tech Stack:** HTML, CSS, JavaScript, Playwright.

---

### Task 1: Comportement du sélecteur

**Files:**
- Modify: `tests/e2e/clave.spec.js`
- Modify: `src/index.html:206`
- Modify: `src/script.js:134-135,251-269,1314-1318`

- [ ] **Step 1: Write the failing test**

Ajouter au test des réglages :

```js
await page.locator('input[name="clipboard-clear-delay"][value="60000"] + span').click()
await expect(page.locator('.clipboard-delay-options')).toHaveAttribute('style', /--selected-index: 2/)
expect(await page.evaluate(() => localStorage.getItem('clave-clipboard-clear-delay'))).toBe('60000')
await page.locator('#close-settings').click()
await page.locator('#settings-button').click()
await expect(page.locator('input[name="clipboard-clear-delay"][value="60000"]')).toBeChecked()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- --grep "change de réglage"`

Expected: FAIL parce que les boutons radio `clipboard-clear-delay` n’existent pas.

- [ ] **Step 3: Replace the select with the segmented control**

Dans `src/index.html`, remplacer le `select` par :

```html
<fieldset class="settings-field delay-setting">
    <legend>Effacement du presse-papiers</legend>
    <div class="delay-options clipboard-delay-options" id="clipboard-clear-delay">
        <span class="delay-selection" aria-hidden="true"></span>
        <label><input type="radio" name="clipboard-clear-delay" value="15000"><span>15 s</span></label>
        <label><input type="radio" name="clipboard-clear-delay" value="30000"><span>30 s</span></label>
        <label><input type="radio" name="clipboard-clear-delay" value="60000"><span>1 min</span></label>
        <label><input type="radio" name="clipboard-clear-delay" value="0"><span>Jamais</span></label>
    </div>
</fieldset>
```

- [ ] **Step 4: Synchronize selection and persistence**

Ajouter `synchroniserDelaiPressePapiers(value)`, sur le même modèle que `synchroniserDelaiVerrouillage`, puis l’appeler à l’ouverture des paramètres et dans l’écouteur `change` avant l’écriture dans `localStorage`.

```js
function synchroniserDelaiPressePapiers(value) {
    const options = Array.from(document.querySelectorAll('input[name="clipboard-clear-delay"]'))
    const selectedIndex = Math.max(0, options.findIndex(option => option.value === String(value)))
    options.forEach((option, index) => { option.checked = index === selectedIndex })
    document.querySelector('.clipboard-delay-options').style.setProperty('--selected-index', String(selectedIndex))
}
```

- [ ] **Step 5: Run the focused test**

Run: `npm run test:e2e -- --grep "change de réglage"`

Expected: PASS.

### Task 2: Régression et compilation

**Files:**
- Test: `tests/e2e/clave.spec.js`

- [ ] **Step 1: Run all interface tests**

Run: `npm run test:e2e`

Expected: tous les tests passent.

- [ ] **Step 2: Run static tests and JavaScript validation**

Run: `python -m unittest discover -s tests -p "test_*.py" && node --check src/script.js`

Expected: 19 tests passent et JavaScript sort avec le code 0.

- [ ] **Step 3: Build the application**

Run: `npx tauri build --no-bundle`

Expected: code 0 et nouvel exécutable dans `src-tauri/target/release/clave.exe`.
