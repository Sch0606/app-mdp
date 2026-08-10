import { test, expect } from '@playwright/test'

async function installVault(page, { locked = false } = {}) {
  await page.addInitScript(({ locked }) => {
    const entries = [
      { plateforme: 'GitHub', email: 'dev@example.fr', mdp: 'Long-secret-42!Unique', site: 'https://github.com', notes: '', totp_secret: '', favorite: true, updated_at: 2_000_000 },
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
