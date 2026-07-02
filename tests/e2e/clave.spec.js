import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const vault = { Perso: [] }
    const invoke = async (command, args = {}) => {
      if (command === 'auth_status') return { configured: true, unlocked: true }
      if (command === 'charger') return structuredClone(vault)
      if (command === 'biometrie_status') return { isAvailable: false, isEnabled: false, biometryType: 'None' }
      if (command === 'ajouter') { vault[args.categorie].push({ plateforme: args.plateforme, email: args.email, mdp: args.mdp, site: args.site, notes: args.notes, totp_secret: args.totpSecret, updated_at: Math.floor(Date.now() / 1000) }); return }
      if (command === 'modifier') { vault[args.categorie][args.index] = { ...vault[args.categorie][args.index], plateforme: args.plateforme, email: args.email, mdp: args.mdp }; return }
      if (command === 'supprimer_acces') { vault[args.categorie].splice(args.index, 1); return structuredClone(vault) }
      if (command === 'charger_historique' || command === 'charger_corbeille') return []
      if (command === 'generer') return 'Test-Password-123!'
      return command.startsWith('supprimer_') ? structuredClone(vault) : undefined
    }
    window.__TAURI__ = {
      core: { invoke },
      clipboardManager: { writeText: async () => {}, readText: async () => '', clear: async () => {} },
      updater: { check: async () => null }, process: { relaunch: async () => {} }, app: { getVersion: async () => '0.2.0' },
    }
  })
  await page.goto('/')
  await expect(page.locator('#launch-screen')).toHaveCount(0, { timeout: 5000 })
})

test('ajoute, modifie et supprime un accès avec le menu', async ({ page }) => {
  await page.getByRole('button', { name: '+ Nouvel accès' }).click()
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
  await page.locator('input[name="auto-lock-delay"][value="600000"] + span').click()
  await expect(page.locator('.delay-options')).toHaveAttribute('style', /--selected-index: 2/)
  await page.getByRole('button', { name: 'Interface' }).click()
  await expect(page.locator('.settings-nav')).toHaveAttribute('style', /--selected-index: 1/)
  await page.locator('#close-settings').click()
  await page.getByRole('button', { name: 'Historique' }).click()
  await expect(page.locator('.vault-tabs')).toHaveAttribute('style', /--selected-index: 1/)
})
