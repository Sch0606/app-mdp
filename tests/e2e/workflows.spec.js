import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let vault = {
      Perso: [{ plateforme: 'Google', email: 'lea@example.fr', mdp: 'Secret-123!', site: 'https://google.com', notes: '', totp_secret: 'JBSWY3DPEHPK3PXP', favorite: false, updated_at: 2_000_000 }],
      Travail: [],
    }
    const history = [
      { categorie: 'Perso', action: 'modified', entry: { ...vault.Perso[0], plateforme: 'Google ancien' }, timestamp: 1_900_000, entry_index: 0 },
      { categorie: 'Perso', action: 'modified', entry: { ...vault.Perso[0], plateforme: 'Google recent' }, timestamp: 1_990_000, entry_index: 0 },
    ]
    const trash = [{ categorie: 'Perso', entry: { ...vault.Perso[0], plateforme: 'Compte supprimé' }, timestamp: 1_950_000 }]
    window.__calls = []

    const invoke = async (command, args = {}) => {
      window.__calls.push({ command, args })
      if (command === 'auth_status') return { configured: true, unlocked: true }
      if (command === 'plugin:updater|check') {
        if (window.__updaterError) throw new Error(window.__updaterError)
        return window.__updaterMetadata || null
      }
      if (command === 'plugin:updater|download_and_install') return undefined
      if (command === 'biometrie_status') return { isAvailable: false, isEnabled: false, biometryType: 'None', error: null }
      if (command === 'charger') return structuredClone(vault)
      if (command === 'charger_historique') return structuredClone(history)
      if (command === 'charger_corbeille') return structuredClone(trash)
      if (command === 'ajouter' && args.plateforme === 'Operation lente') {
        await new Promise((resolve) => setTimeout(resolve, 350))
        return undefined
      }
      if (command === 'ajouter') {
        vault[args.categorie].push({ plateforme: args.plateforme, email: args.email, mdp: args.mdp, site: args.site, notes: args.notes, totp_secret: args.totpSecret, icon_url: args.iconUrl, updated_at: 2_000_000 })
        return undefined
      }
      if (command === 'restaurer_historique' || command === 'restaurer_corbeille') return structuredClone(vault)
      if (command === 'generer_totp') return { code: '123456', remaining: 22 }
      if (command === 'resoudre_icone_site') return { iconUrl: 'https://google.com/favicon.ico', source: 'favicon', fallbackLabel: 'GO' }
      if (command === 'renommer_categorie') {
        vault[args.nouveauNom] = vault[args.ancienNom]
        delete vault[args.ancienNom]
        return undefined
      }
      if (command === 'supprimer_categorie') {
        delete vault[args.categorie]
        return structuredClone(vault)
      }
      if (command === 'exporter') return '{"version":3}'
      if (command === 'previsualiser_import') {
        if (args.csvText?.includes('empty-import')) return []
        return [{ plateforme: 'Compte importé', email: 'import@example.fr', mdp: 'Import-Secret-123!', site: 'https://example.com', notes: '', totp_secret: '', icon_url: '' }]
      }
      if (command === 'importer_selection') {
        vault['Import navigateur'] = structuredClone(args.entries)
        return structuredClone(vault)
      }
      return undefined
    }

    window.__TAURI__ = {
      core: { invoke },
      clipboardManager: {
        writeText: async (value) => { window.__copied = value },
        readText: async () => window.__copied || '',
        clear: async () => { window.__copied = '' },
      },
      updater: { check: async () => null },
      process: { relaunch: async () => {} },
      app: { getVersion: async () => '0.3.0' },
    }
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        window.__calls.push({ command, args })
        if (command === 'plugin:updater|check') {
          if (window.__updaterError) throw new Error(window.__updaterError)
          return window.__updaterMetadata || null
        }
        if (command === 'plugin:updater|download_and_install') return undefined
        return invoke(command, args)
      },
      transformCallback: () => 1,
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('vault-workspace')).toBeVisible()
})

test('charge et restaure l historique et la poubelle', async ({ page }) => {
  await page.getByRole('tab', { name: 'Historique' }).click()
  await expect(page.locator('.activity-row').first()).toContainText('Google recent')
  await page.getByRole('button', { name: 'Restaurer la version' }).first().click()

  await page.getByRole('tab', { name: 'Poubelle' }).click()
  await expect(page.locator('.activity-row')).toContainText('Compte supprimé')
  await page.getByRole('button', { name: 'Restaurer l’accès' }).click()

  const commands = await page.evaluate(() => window.__calls.map((call) => call.command))
  expect(commands).toContain('restaurer_historique')
  expect(commands).toContain('restaurer_corbeille')
  const restoreCall = await page.evaluate(() => window.__calls.find((call) => call.command === 'restaurer_historique'))
  expect(restoreCall.args.index).toBe(1)
})

test('la palette restaure le focus au champ de recherche', async ({ page }) => {
  const search = page.locator('#search-input')
  await search.focus()
  await page.keyboard.press('Control+K')
  await expect(page.locator('#command-search')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search).toBeFocused()
})

test('le verrouillage ferme les surfaces sensibles et ignore une sauvegarde tardive', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('clave-lock-hotkey', 'Ctrl+L'))
  await page.reload()
  await expect(page.getByTestId('vault-workspace')).toBeVisible()

  await page.locator('#new-access').click()
  await page.locator('#plateforme').fill('Operation lente')
  await page.locator('#mdp').fill('Secret-tardif-42!')
  await page.locator('.btn-ajouter').click()
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true })))

  await expect(page.getByRole('heading', { name: /Clave/ })).toBeVisible()
  await expect(page.locator('.entry-drawer')).toHaveCount(0)
  await page.waitForTimeout(450)
  await expect(page.getByTestId('vault-workspace')).toHaveCount(0)
  await expect(page.getByText('Operation lente')).toHaveCount(0)
})

test('le verrouillage ferme une sauvegarde ouverte', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('clave-lock-hotkey', 'Ctrl+L'))
  await page.reload()
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()
  await page.locator('#settings-export-vault').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true })))
  await expect(page.getByTestId('vault-workspace')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('verrouille le coffre apres une reprise de veille', async ({ page }) => {
  await page.evaluate(() => {
    const now = Date.now
    Date.now = () => now() + 7000
  })
  await expect(page.getByTestId('vault-workspace')).toHaveCount(0, { timeout: 2500 })
})

test('copie un code TOTP depuis la ligne d accès', async ({ page }) => {
  await expect(page.getByText('123 456')).toBeVisible()
  await expect(page.getByText('22 s')).toBeVisible()
  await page.getByRole('button', { name: 'Copier le code temporaire de Google' }).click()
  await expect.poll(() => page.evaluate(() => window.__copied)).toBe('123456')
})

test('configure la longueur et les caracteres du generateur', async ({ page }) => {
  await page.locator('#new-access').click()
  await page.locator('#generator-length').fill('28')
  await page.locator('#generator-symbols').uncheck()
  await page.locator('#generator-readable').check()
  await page.locator('#generer').click()

  const password = await page.locator('#mdp').inputValue()
  expect(password).toHaveLength(28)
  expect(password).toMatch(/^[A-Za-z2-9]+$/)
  expect(password).not.toMatch(/[Il1O0o]/)
})

test('resout le favicon du site sans bloquer le formulaire', async ({ page }) => {
  await page.locator('#new-access').click()
  await page.locator('#plateforme').fill('Google')
  await page.locator('#mdp').fill('Secret-123!')
  await page.locator('#entry-site').fill('google')
  await expect(page.locator('.site-icon-preview img')).toHaveAttribute('src', 'https://google.com/favicon.ico')
  await page.locator('.btn-ajouter').click()
  await expect.poll(() => page.evaluate(() => window.__calls.findLast((call) => call.command === 'ajouter')?.args.site)).toBe('https://google.com')
  await expect(page.locator('.entry-row img.entry-avatar-image')).toHaveAttribute('src', 'https://google.com/favicon.ico')
})

test('affiche des libelles utilisateur et l aide import', async ({ page }) => {
  await expect(page.locator('body')).not.toContainText('AES-GCM')
  await expect(page.locator('body')).not.toContainText('Générer un secret')
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()
  await expect(page.getByRole('heading', { name: 'Importer depuis un navigateur' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Tutoriel/ })).toBeVisible()
  await expect(page.getByText('Exporter le coffre')).toBeVisible()
  await expect(page.getByText('Importer une sauvegarde Clave')).toBeVisible()
  await expect(page.getByText(/Vérifiez la prévisualisation/)).toBeVisible()
  await expect(page.getByText(/Supprimez le fichier CSV après import/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Chrome/ })).toHaveAttribute('href', /support\.google\.com/)
  await expect(page.getByRole('link', { name: /Bitwarden/ })).toHaveAttribute('href', /bitwarden\.com/)
})

test('renomme un espace depuis son menu contextuel', async ({ page }) => {
  await page.locator('.categories li').first().click({ button: 'right' })
  await expect(page.locator('#category-menu')).toHaveClass(/visible/)
  await page.locator('#menu-rename').click()
  await page.locator('#rename-input').fill('Personnel')
  await page.locator('#confirm-rename').click()
  await expect(page.getByRole('button', { name: /Personnel/ })).toBeVisible()
})

test('ferme une boîte de dialogue avec Echap', async ({ page }) => {
  await page.locator('.categories li').first().click({ button: 'right' })
  await page.locator('#menu-rename').click()
  await expect(page.getByRole('dialog', { name: 'Renommer l’espace' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Renommer l’espace' })).toHaveCount(0)
})

test('exporte une sauvegarde depuis les paramètres', async ({ page }) => {
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()
  await page.locator('#settings-export-vault').click()
  await expect(page.getByRole('dialog', { name: 'Exporter le coffre' })).toBeVisible()
  await page.locator('#backup-password').fill('Backup-Secret-123!')
  await page.locator('#confirm-backup').click()

  await expect.poll(() => page.evaluate(() => window.__calls.some((call) => call.command === 'exporter' && call.args.password === 'Backup-Secret-123!'))).toBe(true)
})

test('prévisualise puis importe un fichier navigateur', async ({ page }) => {
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()
  await page.locator('#browser-import-file').setInputFiles({
    name: 'passwords.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,url,username,password\nCompte importé,https://example.com,import@example.fr,Import-Secret-123!'),
  })

  await expect(page.getByRole('dialog', { name: 'Accès détectés' })).toBeVisible()
  await page.locator('#confirm-import-preview').click()
  await expect(page.getByRole('button', { name: /Import navigateur/ })).toBeVisible()
})

test('affiche un retour clair quand le fichier navigateur ne contient aucun mot de passe', async ({ page }) => {
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'Sauvegarde' }).click()
  await page.locator('#browser-import-file').setInputFiles({
    name: 'empty-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,url,username,password\nempty-import,,,'),
  })

  await expect(page.getByRole('dialog', { name: 'Accès détectés' })).toHaveCount(0)
  await expect(page.locator('#toast')).toContainText('Aucun mot de passe')
})

test('recherche une mise a jour via le plugin updater Tauri v2 sans global updater', async ({ page }) => {
  await page.evaluate(() => {
    delete window.__TAURI__.updater
    window.__updaterMetadata = {
      rid: 42,
      version: '0.4.0',
      currentVersion: '0.3.0',
      date: '2026-08-09',
      body: 'Nouvelle version disponible',
    }
  })
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'À propos' }).click()
  await page.locator('#check-update').click()

  await expect(page.locator('#update-status')).toContainText('Version 0.4.0 disponible')
  await expect(page.locator('#install-update')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__calls.some((call) => call.command === 'plugin:updater|check'))).toBe(true)
})

test('affiche un message clair si le manifeste de mise a jour est absent', async ({ page }) => {
  await page.evaluate(() => {
    delete window.__TAURI__.updater
    window.__updaterError = 'Could not fetch a valid release JSON from the remote'
  })
  await page.locator('#settings-button').click()
  await page.getByRole('button', { name: 'À propos' }).click()
  await page.locator('#check-update').click()

  await expect(page.locator('#update-status')).toContainText('Aucune mise à jour publiée')
})
