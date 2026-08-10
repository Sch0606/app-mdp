import { test, expect } from '@playwright/test'

async function installTauri(page, { biometricFailure = false, rawCancelFailure = false } = {}) {
  await page.addInitScript(({ biometricFailure, rawCancelFailure }) => {
    const invoke = async (command) => {
      if (command === 'auth_status') return { configured: true, unlocked: false }
      if (command === 'biometrie_status') {
        return { isAvailable: true, isEnabled: true, biometryType: 'WindowsHello', error: null }
      }
      if (command === 'deverrouiller_biometrie') {
        await new Promise((resolve) => setTimeout(resolve, 350))
        if (rawCancelFailure) throw '[Decryption failed - failed to decrypt data: Error { code: HRESULT(0xFFFFFFFF), message: "" }]'
        if (biometricFailure) throw new Error('Authentification annulée.')
        return { configured: true, unlocked: true }
      }
      if (command === 'unlock') return { configured: true, unlocked: true }
      if (command === 'charger') return { Perso: [] }
      return undefined
    }

    window.__TAURI__ = {
      core: { invoke },
      clipboardManager: { writeText: async () => {}, readText: async () => '', clear: async () => {} },
      updater: { check: async () => null },
      process: { relaunch: async () => {} },
      app: { getVersion: async () => '0.3.0' },
    }
  }, { biometricFailure, rawCancelFailure })
}

test('deverrouille le coffre avec le mot de passe', async ({ page }) => {
  await installTauri(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Déverrouiller Clave' })).toBeVisible()
  await page.getByLabel('Mot de passe maître').fill('Secret-123!')
  await expect(page.locator('#master-password')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click()
  await expect(page.locator('#master-password')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Masquer le mot de passe' }).click()
  await expect(page.locator('#master-password')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()

  await expect(page.getByTestId('vault-workspace')).toBeVisible()
})

test('anime le scan biométrique pendant l appel natif', async ({ page }) => {
  await installTauri(page)
  await page.goto('/')

  const scanner = page.getByTestId('biometric-scanner')
  await expect(scanner).toHaveAttribute('data-state', 'idle')
  await expect(page.getByText('Windows Hello')).toBeVisible()
  await page.getByRole('button', { name: 'Déverrouiller avec Windows Hello' }).click()
  await expect(scanner).toHaveAttribute('data-state', 'scanning')
  await expect(page.getByText('Analyse en cours')).toBeVisible()
  await expect(page.getByTestId('vault-workspace')).toBeVisible({ timeout: 2500 })
})

test('revient au repos après un échec biométrique', async ({ page }) => {
  await installTauri(page, { biometricFailure: true })
  await page.goto('/')

  await page.getByRole('button', { name: 'Déverrouiller avec Windows Hello' }).click()
  await expect(page.getByRole('alert')).toContainText('Authentification annulée.')
  await expect(page.getByTestId('biometric-scanner')).toHaveAttribute('data-state', 'failure')
  await expect(page.getByTestId('biometric-scanner')).toHaveAttribute('data-state', 'idle', { timeout: 2000 })
  await expect(page.getByLabel('Mot de passe maître')).toBeVisible()
})

test('masque le message natif Windows Hello quand l utilisateur annule', async ({ page }) => {
  await installTauri(page, { rawCancelFailure: true })
  await page.goto('/')

  await page.getByRole('button', { name: 'Déverrouiller avec Windows Hello' }).click()
  await expect(page.getByRole('alert')).toContainText('Authentification non confirmée.')
  await expect(page.getByRole('alert')).not.toContainText('Decryption failed')
  await expect(page.getByRole('alert')).not.toContainText('HRESULT')
})
