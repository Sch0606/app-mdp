import { test, expect } from '@playwright/test'

async function installVault(page, { locked = false } = {}) {
  await page.addInitScript(({ locked }) => {
    // Ces scénarios décrivent le thème clair ; le thème sombre est le défaut de l’app.
    if (localStorage.getItem('clave-dark-mode') === null) localStorage.setItem('clave-dark-mode', 'false')
    const entries = [
      { plateforme: 'GitHub', email: 'dev@example.fr', mdp: 'Long-secret-42!Unique', site: 'https://github.com', notes: '', totp_secret: '', icon_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath fill="%23111" d="M4 4h16v16H4z"/%3E%3C/svg%3E', favorite: true, updated_at: 2_000_000 },
      { plateforme: 'Banque principale', email: 'lea@example.fr', mdp: 'Secret-123!', site: '', notes: '', totp_secret: '', favorite: false, updated_at: 2_000_000 },
    ]
    const invoke = async (command) => {
      if (command === 'auth_status') return { configured: true, unlocked: !locked }
      if (command === 'biometrie_status') return { isAvailable: true, isEnabled: true, biometryType: 'Face', error: null }
      if (command === 'charger') return { Perso: entries, Travail: [] }
      if (command === 'deverrouiller_biometrie') {
        await new Promise((resolve) => setTimeout(resolve, 400))
        return { configured: true, unlocked: true }
      }
      return undefined
    }
    window.__TAURI__ = {
      core: { invoke },
      clipboardManager: { writeText: async () => {}, readText: async () => '', clear: async () => {} },
      updater: { check: async () => null }, process: { relaunch: async () => {} }, app: { getVersion: async () => '0.3.0' },
    }
  }, { locked })
}

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'compact', width: 820, height: 720 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`reste utilisable sans débordement en vue ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installVault(page)
    await page.goto('/')
    await expect(page.getByTestId('vault-workspace')).toBeVisible()

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      body: document.body.scrollWidth,
      root: document.documentElement.scrollWidth,
    }))
    expect(geometry.body).toBeLessThanOrEqual(geometry.viewport)
    expect(geometry.root).toBeLessThanOrEqual(geometry.viewport)
    await expect(page.locator('#new-access')).toBeVisible()

    if (viewport.name === 'desktop') {
      await page.screenshot({ path: 'test-results/visual-qa/vault-desktop.png', fullPage: true })
    }

    await page.locator('#new-access').click()
    await expect.poll(async () => {
      const drawer = await page.locator('.entry-drawer').boundingBox()
      return drawer.x >= 0 && drawer.x + drawer.width <= viewport.width + 1
    }).toBe(true)
    if (viewport.name === 'desktop') {
      await page.screenshot({ path: 'test-results/visual-qa/drawer-desktop.png', fullPage: true })
    }
  })
}

test('supprime la boucle de scan lorsque les animations sont réduites', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installVault(page, { locked: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Déverrouiller avec la biométrie' }).click()

  await expect(page.getByTestId('biometric-scanner')).toHaveAttribute('data-state', 'scanning')
  await expect(page.locator('.scan-beam')).toHaveCount(0)
})

test('présente chaque accès avec une hiérarchie compacte', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await installVault(page)
  await page.goto('/')

  await expect(page.locator('.entry-row')).toHaveCount(2)
  await expect(page.locator('.entry-space')).toHaveCount(0)
  await expect(page.locator('.entry-summary .strength-badge').first()).toBeVisible()

  const rowHeight = await page.locator('.entry-row').first().evaluate((element) => element.getBoundingClientRect().height)
  expect(rowHeight).toBeLessThanOrEqual(64)
})

test('conserve les icônes de site lisibles en mode sombre', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('clave-dark-mode', 'true'))
  await installVault(page)
  await page.goto('/')

  const avatar = page.locator('.entry-avatar-with-image').first()
  await expect(avatar).toHaveCSS('background-color', 'rgb(238, 243, 240)')
  await expect(avatar.locator('img')).toHaveCSS('filter', /drop-shadow/)
})

test('présente une modale sombre entièrement dans la fenêtre', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 })
  await page.addInitScript(() => localStorage.setItem('clave-dark-mode', 'true'))
  await installVault(page)
  await page.goto('/')

  await page.locator('.categories li button').first().click({ button: 'right' })
  await page.locator('#menu-rename').click()
  const layer = page.getByRole('dialog', { name: 'Renommer l’espace' })
  await expect(layer).toHaveAttribute('data-theme', 'dark')
  const panel = page.locator('.dialog')
  await expect(panel).toBeVisible()
  const cancelContrast = await page.locator('#cancel-rename').evaluate((element) => {
    function parse(color) {
      const values = color.match(/[\d.]+/g).map(Number)
      return [values[0], values[1], values[2], values[3] ?? 1]
    }
    function composite(foreground, background) {
      const alpha = foreground[3] + background[3] * (1 - foreground[3])
      if (!alpha) return [0, 0, 0, 0]
      return [0, 1, 2].map((index) => (
        (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha
      )).concat(alpha)
    }
    function renderedBackground(node) {
      const layers = []
      for (let current = node; current; current = current.parentElement) layers.push(parse(getComputedStyle(current).backgroundColor))
      return layers.reverse().reduce((background, layer) => composite(layer, background), [255, 255, 255, 1])
    }
    function luminance(channels) {
      const linear = channels.slice(0, 3).map((value) => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const style = getComputedStyle(element)
    const foreground = luminance(parse(style.color))
    const background = luminance(renderedBackground(element))
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
  expect(cancelContrast).toBeGreaterThanOrEqual(4.5)
  const bounds = await panel.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(820)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(720)

  await page.screenshot({ path: 'test-results/visual-qa/popup-dialog-dark.png', fullPage: true })
})
