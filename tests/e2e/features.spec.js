import { test, expect } from '@playwright/test'

async function installTauri(page, options = {}) {
  await page.addInitScript((options) => {
    // Ces scénarios décrivent le thème clair ; le thème sombre est le défaut de l’app.
    if (localStorage.getItem('clave-dark-mode') === null) localStorage.setItem('clave-dark-mode', 'false')
    const vault = {
      Perso: [
        { plateforme: 'Banque', email: 'moi@example.fr', mdp: 'password', site: 'https://banque.fr', notes: '', totp_secret: '', tags: ['finances'], favorite: false, updated_at: 2_000_000 },
        { plateforme: 'GitLab', email: 'dev@example.fr', mdp: 'Tres-Long-Unique-2026!', site: 'https://gitlab.com', notes: '', totp_secret: '', tags: ['travail'], favorite: false, updated_at: 2_000_000 },
      ],
    }
    if (options.duplicates) {
      vault.Travail = [{ plateforme: 'GitLab', email: 'Dev@example.fr', mdp: 'ancien', site: 'www.gitlab.com', notes: 'Import Edge', totp_secret: 'JBSWY3DPEHPK3PXP', tags: [], favorite: false, created_at: 1, updated_at: 1_000_000 }]
    }
    let auth = { configured: options.configured ?? true, unlocked: options.unlocked ?? true, recovery_configured: options.recovery ?? true }
    let systemLock = { supported: true, onSessionLock: true, onSleep: true }
    const listeners = new Map()
    window.__calls = []
    window.__emit = (name, payload) => (listeners.get(name) || []).forEach((handler) => handler({ event: name, payload }))

    const invoke = async (command, args = {}) => {
      window.__calls.push({ command, args })
      switch (command) {
        case 'auth_status': return structuredClone(auth)
        case 'biometrie_status': return { isAvailable: false, isEnabled: false, biometryType: 'None', error: null }
        case 'charger': return structuredClone(vault)
        case 'unlock': auth = { ...auth, unlocked: true }; return structuredClone(auth)
        case 'lock': auth = { ...auth, unlocked: false }; return structuredClone(auth)
        case 'setup_master_password':
          auth = { configured: true, unlocked: true, recovery_configured: true }
          return { ...auth, recoveryKey: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567' }
        case 'recuperer_coffre':
          if (args.cleRecuperation.replace(/[^a-z0-9]/gi, '').toUpperCase() !== 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567') throw new Error('Cle de recuperation incorrecte.')
          auth = { ...auth, unlocked: true }
          return structuredClone(auth)
        case 'creer_cle_recuperation': auth = { ...auth, recovery_configured: true }; return 'WXYZ-WXYZ-WXYZ-WXYZ-WXYZ-WXYZ-WXYZ-WXYZ'
        case 'verifier_fuites': return { compromised: [{ categorie: 'Perso', index: 0, count: 9_659_365 }], checked: 2, requests: 2 }
        case 'verrouillage_systeme_status': return structuredClone(systemLock)
        case 'definir_verrouillage_systeme':
          systemLock = { ...systemLock, onSessionLock: args.onSessionLock, onSleep: args.onSleep }
          return structuredClone(systemLock)
        case 'ajouter':
          vault[args.categorie].push({ plateforme: args.plateforme, email: args.email, mdp: args.mdp, site: args.site, notes: args.notes, totp_secret: args.totpSecret, tags: args.tags, updated_at: 2_000_000 })
          return undefined
        case 'previsualiser_import':
          return [
            { categorie: 'Banques', plateforme: 'Crédit', email: 'moi', mdp: 'x', site: '', notes: '', totp_secret: '', tags: [] },
            { categorie: 'Import KeePass', plateforme: 'Wifi', email: 'admin', mdp: 'y', site: '', notes: '', totp_secret: '', tags: [] },
          ]
        case 'importer_selection':
          args.entries.forEach((entry) => { (vault[entry.categorie] ||= []).push(entry) })
          return structuredClone(vault)
        case 'fusionner_doublons':
          vault[args.categorieRetiree].splice(args.indexRetire, 1)
          return structuredClone(vault)
        case 'charger_historique':
        case 'charger_corbeille': return []
        default: return undefined
      }
    }

    window.__TAURI__ = {
      core: { invoke },
      clipboardManager: { writeText: async (value) => { window.__copied = value }, readText: async () => window.__copied || '', clear: async () => { window.__copied = '' } },
      updater: { check: async () => null },
      process: { relaunch: async () => {} },
      app: { getVersion: async () => '0.3.1' },
      event: {
        listen: async (name, handler) => {
          listeners.set(name, [...(listeners.get(name) || []), handler])
          return () => listeners.set(name, (listeners.get(name) || []).filter((item) => item !== handler))
        },
      },
    }
  }, options)
  await page.goto('/')
  await expect(page.locator('#launch-screen')).toHaveCount(0, { timeout: 15000 })
}

test('ajoute des étiquettes, les affiche et filtre par étiquette', async ({ page }) => {
  await installTauri(page)
  await page.getByRole('button', { name: 'Nouvel accès' }).click()
  await page.locator('#plateforme').fill('Impôts')
  await page.locator('#mdp').fill('Secret-123!')
  await page.locator('#entry-tags').fill('#Finances, Admin')
  await page.locator('#entry-tags').press('Enter')
  await expect(page.locator('.tag-chip')).toHaveText(['#finances', '#admin'])
  await page.locator('.entry-panel .btn-ajouter').click()

  const call = await page.evaluate(() => window.__calls.find((item) => item.command === 'ajouter'))
  expect(call.args.tags).toEqual(['finances', 'admin'])
  await expect(page.locator('.entry-row').filter({ hasText: 'Impôts' }).locator('.entry-tag')).toHaveText(['#finances', '#admin'])

  await page.locator('.tag-filter[data-tag="finances"]').click()
  await expect(page.locator('.entry-row')).toHaveCount(2)
  await page.locator('.tag-filter[data-tag="finances"]').click()
  await expect(page.locator('.entry-row')).toHaveCount(3)

  await page.locator('#search-input').fill('#trav')
  await expect(page.locator('.entry-summary strong')).toHaveText(['GitLab'])
})

test('vérifie les fuites depuis la santé du coffre', async ({ page }) => {
  await installTauri(page)
  await page.getByRole('tab', { name: 'Santé' }).click()
  const card = page.locator('.health-card').filter({ hasText: 'Mots de passe compromis' })
  await expect(card).toContainText('5 caractères')
  await card.locator('#check-breaches').click()
  await expect(card.locator('header strong')).toHaveText('1')
  await expect(card).toContainText('Banque')
  await expect(card).toContainText('9 659 365 fois')
})

test('compare, écarte puis fusionne les doublons dans la santé du coffre', async ({ page }) => {
  await installTauri(page, { duplicates: true })
  await page.getByRole('tab', { name: 'Santé' }).click()
  const card = page.locator('#duplicate-card')
  await expect(card.locator('header strong')).toHaveText('1')
  await expect(card).toContainText('Perso / Travail')

  await card.getByRole('button', { name: 'Comparer' }).click()
  await expect(card.locator('.duplicate-compare tr.differs th')).toContainText(['Site', 'Catégorie', 'Mot de passe', '2FA', 'Notes'])
  await expect(card.locator('.duplicate-compare')).not.toContainText('Tres-Long')

  await card.getByRole('button', { name: 'Fusionner' }).click()
  const call = await page.evaluate(() => window.__calls.find((item) => item.command === 'fusionner_doublons'))
  expect(call.args).toEqual({ categorieGardee: 'Perso', indexGarde: 1, categorieRetiree: 'Travail', indexRetire: 0 })
  await expect(card.locator('header strong')).toHaveText('0')
})

test('mémorise les paires marquées comme différentes', async ({ page }) => {
  await installTauri(page, { duplicates: true })
  await page.getByRole('tab', { name: 'Santé' }).click()
  const card = page.locator('#duplicate-card')
  await card.getByRole('button', { name: 'Pas des doublons' }).click()
  await expect(card.locator('header strong')).toHaveText('0')
  const stored = await page.evaluate(() => localStorage.getItem('clave-dismissed-duplicates'))
  expect(stored).toMatch(/^\["[0-9a-f]{64}"\]$/)
  await page.reload()
  await page.getByRole('tab', { name: 'Santé' }).click()
  await expect(page.locator('#duplicate-card header strong')).toHaveText('0')
})

test('affiche le kit de secours à la création du coffre', async ({ page }) => {
  await installTauri(page, { configured: false, unlocked: false, recovery: false })
  await page.locator('#master-password').fill('Nouveau-Secret-1')
  await page.getByRole('button', { name: 'Créer le coffre' }).click()

  await expect(page.locator('#recovery-key-value')).toContainText('ABCD-EFGH-IJKL-MNOP')
  await expect(page.locator('#confirm-recovery-kit')).toBeDisabled()
  const download = page.waitForEvent('download')
  await page.locator('#download-recovery-kit').click()
  expect((await download).suggestedFilename()).toMatch(/^clave-kit-de-secours-.*\.pdf$/)
  await page.locator('#recovery-kit-saved').check()
  await page.locator('#confirm-recovery-kit').click()
  await expect(page.locator('#recovery-key-value')).toHaveCount(0)
  await expect(page.getByTestId('vault-workspace')).toBeVisible()
})

test('récupère le coffre avec la clé de récupération', async ({ page }) => {
  await installTauri(page, { unlocked: false })
  await page.locator('#forgot-password').click()
  await page.locator('#recovery-key').fill('abcd efgh ijkl mnop qrst uvwx yz23 0000')
  await page.locator('#recovery-new-password').fill('Nouveau-Secret-2')
  await page.locator('#recovery-confirm-password').fill('Nouveau-Secret-2')
  await page.getByRole('button', { name: 'Récupérer le coffre' }).click()
  await expect(page.getByRole('alert')).toContainText('incorrecte')

  await page.locator('#recovery-key').fill('abcd-efgh-ijkl-mnop-qrst-uvwx-yz23-4567')
  await page.getByRole('button', { name: 'Récupérer le coffre' }).click()
  await expect(page.getByTestId('vault-workspace')).toBeVisible()
})

test('masque le lien de récupération sans kit de secours', async ({ page }) => {
  await installTauri(page, { unlocked: false, recovery: false })
  await expect(page.getByRole('heading', { name: 'Déverrouiller Clave' })).toBeVisible()
  await expect(page.locator('#forgot-password')).toHaveCount(0)
})

test('verrouille l’interface sur un événement système', async ({ page }) => {
  await installTauri(page)
  await expect(page.getByTestId('vault-workspace')).toBeVisible()
  await page.evaluate(() => window.__emit('system-locked', 'session-lock'))
  await expect(page.getByRole('heading', { name: 'Déverrouiller Clave' })).toBeVisible()
})

test('règle le verrouillage système et régénère le kit de secours', async ({ page }) => {
  await installTauri(page)
  await page.locator('#settings-button').click()
  await page.locator('#toggle-lock-on-sleep').uncheck()
  await expect.poll(() => page.evaluate(() => window.__calls.filter((item) => item.command === 'definir_verrouillage_systeme').at(-1)?.args))
    .toEqual({ onSessionLock: true, onSleep: false })
  await expect(page.locator('#toggle-lock-on-sleep')).not.toBeChecked()

  await expect(page.locator('#recovery-kit-status')).toHaveText('Clé de récupération active')
  await page.locator('#recovery-kit-password').fill('Secret-Maitre-1')
  await page.locator('#create-recovery-kit').click()
  await expect(page.locator('#recovery-key-value')).toContainText('WXYZ-WXYZ')
  await expect(page.locator('.recovery-kit').locator('..').locator('..')).toContainText('L’ancienne ne fonctionne plus')
})

test('importe depuis un gestionnaire en conservant les dossiers', async ({ page }) => {
  await installTauri(page)
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()
  await expect(page.locator('.manager-formats')).toContainText('KeePass')
  await page.locator('#browser-import-file').setInputFiles({ name: 'export.xml', mimeType: 'text/xml', buffer: Buffer.from('<KeePassFile/>') })
  await expect(page.locator('.import-preview-category')).toHaveText(['Banques', 'Import KeePass'])
  await page.locator('#confirm-import-preview').click()
  await expect(page.getByRole('button', { name: /Banques, 1 accès/ })).toBeVisible()
})
