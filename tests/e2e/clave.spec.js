import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const vault = { Perso: [] }
    const invoke = async (command, args = {}) => {
      if (command === 'auth_status') return { configured: true, unlocked: true }
      if (command === 'charger') return structuredClone(vault)
      if (command === 'biometrie_status') return { isAvailable: false, isEnabled: false, biometryType: 'None' }
      if (command === 'ajouter') { vault[args.categorie].push({ plateforme: args.plateforme, email: args.email, mdp: args.mdp, site: args.site, notes: args.notes, totp_secret: args.totpSecret, icon_url: args.iconUrl, updated_at: Math.floor(Date.now() / 1000) }); return }
      if (command === 'modifier') { vault[args.categorie][args.index] = { ...vault[args.categorie][args.index], plateforme: args.plateforme, email: args.email, mdp: args.mdp }; return }
      if (command === 'supprimer_acces') { vault[args.categorie].splice(args.index, 1); return structuredClone(vault) }
      if (command === 'charger_historique' || command === 'charger_corbeille') return []
      if (command === 'generer') return 'Test-Password-123!'
      return command.startsWith('supprimer_') ? structuredClone(vault) : undefined
    }
    window.__TAURI__ = {
      core: { invoke },
      clipboardManager: { writeText: async () => {}, readText: async () => '', clear: async () => {} },
      updater: { check: async () => null }, process: { relaunch: async () => {} }, app: { getVersion: async () => '0.3.0' },
    }
  })
  await page.goto('/')
  await expect(page.locator('#launch-screen')).toHaveCount(0, { timeout: 5000 })
})

test('monte l application React', async ({ page }) => {
  await expect(page.getByTestId('clave-app')).toBeVisible()
})

test('ajoute, modifie et supprime un accès avec le menu', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Nouvel accès' })).toBeVisible()
  await page.getByRole('button', { name: 'Nouvel accès' }).click()
  await page.locator('#plateforme').fill('Google')
  await page.locator('#email').fill('nom@gmail.com')
  await page.locator('#mdp').fill('Secret-123!')
  await page.locator('.entry-panel .btn-ajouter').click()
  await expect(page.locator('.entry-summary strong')).toHaveText('Google')

  await page.locator('.entry-more').click()
  await expect(page.locator('#entry-menu')).toHaveClass(/visible/)
  await page.locator('.entry-row').click({ button: 'right' })
  await expect(page.locator('#entry-menu')).toHaveClass(/visible/)
  await page.locator('#entry-menu-edit').click()
  await page.locator('#plateforme').fill('Google Pro')
  await page.locator('.entry-panel .btn-ajouter').click()
  await expect(page.locator('.entry-summary strong')).toHaveText('Google Pro')

  await page.locator('.entry-more').click()
  await page.locator('#entry-menu-delete').click()
  await expect(page.locator('.entry-row')).toHaveCount(0)
})

test('change de réglage et déplace les indicateurs animés', async ({ page }) => {
  await page.locator('#settings-button').click()
  await expect(page.locator('input[name="auto-lock-delay"]')).toHaveCount(4)
  await page.locator('input[name="auto-lock-delay"][value="600000"] + span').click()
  await expect(page.locator('.auto-lock-options')).toHaveAttribute('style', /--selected-index: 2/)
  await expect(page.locator('.auto-lock-options .delay-selection')).toBeVisible()
  await expect(page.locator('.auto-lock-options .delay-selection')).not.toHaveCSS('transition-duration', '0s')
  await page.locator('input[name="clipboard-clear-delay"][value="60000"] + span').click()
  await expect(page.locator('.clipboard-delay-options')).toHaveAttribute('style', /--selected-index: 2/)
  await expect(page.locator('.clipboard-delay-options .delay-selection')).toBeVisible()
  await expect(page.locator('.clipboard-delay-options .delay-selection')).not.toHaveCSS('transition-duration', '0s')
  expect(await page.evaluate(() => localStorage.getItem('clave-clipboard-clear-delay'))).toBe('60000')
  await page.locator('#close-settings').click()
  await page.locator('#settings-button').click()
  await expect(page.locator('input[name="clipboard-clear-delay"][value="60000"]')).toBeChecked()
  await page.getByRole('button', { name: 'Interface' }).click()
  await expect(page.locator('.settings-nav')).toHaveAttribute('style', /--selected-index: 1/)
  await page.locator('#close-settings').click()
  await page.getByRole('tab', { name: 'Historique' }).click()
  await expect(page.locator('.vault-tabs')).toHaveAttribute('style', /--selected-index: 2/)
})

test('ferme la recherche Ctrl+K lors d un clic en dehors', async ({ page }) => {
  await page.keyboard.press('Control+K')
  const palette = page.locator('#command-palette')
  await expect(palette).toHaveClass(/visible/)
  await palette.click({ position: { x: 5, y: 5 } })
  await expect(palette).not.toHaveClass(/visible/)
})

test('garde le bouton Créer dans la fenêtre après la création de catégories', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  const createButton = page.locator('#add-categorie')

  for (let index = 0; index < 12; index += 1) {
    await createButton.click()
  }

  await expect(createButton).toBeVisible()
  const buttonBox = await createButton.boundingBox()
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(520)
  expect(buttonBox.height).toBeLessThanOrEqual(48)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.locator('.categories')).toHaveCSS('overflow-y', 'auto')
})

test('ne crée pas de barre horizontale au survol d une catégorie', async ({ page }) => {
  const categories = page.locator('.categories')
  await page.locator('.categories li').first().hover()
  const dimensions = await categories.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
})

test('hiérarchise les actions sans empiler les grands blocs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })

  await expect(page.locator('body')).toHaveCSS('font-family', /Geist/)
  await expect(page.locator('.security-summary')).toBeVisible()
  await expect(page.locator('.security-strip')).toHaveCount(0)
  await expect(page.locator('#new-access')).toHaveCSS('border-radius', '7px')

  const mainPaddingTop = await page.locator('.main').evaluate(element => Number.parseFloat(getComputedStyle(element).paddingTop))
  const lockWidth = await page.locator('#lock-now').evaluate(element => element.getBoundingClientRect().width)
  const listGap = await page.locator('#liste-mdp').evaluate(element => Number.parseFloat(getComputedStyle(element).gap))

  expect(mainPaddingTop).toBeLessThanOrEqual(36)
  expect(lockWidth).toBeLessThanOrEqual(44)
  expect(listGap).toBeLessThanOrEqual(10)
})

test('active le mode sombre depuis les parametres interface', async ({ page }) => {
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Interface' }).click()
  await page.locator('#toggle-dark-mode').check()

  await expect(page.locator('[data-testid="clave-app"]')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.settings-page')).toHaveCSS('background-color', 'rgb(10, 13, 12)')
  expect(await page.evaluate(() => localStorage.getItem('clave-dark-mode'))).toBe('true')
})

test('garde le texte du tutoriel import lisible en mode sombre', async ({ page }) => {
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Interface' }).click()
  await page.locator('#toggle-dark-mode').check()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()

  await expect(page.locator('.import-warning')).toBeVisible()
  await expect(page.locator('.import-warning')).toHaveCSS('color', 'rgb(191, 234, 221)')
})
