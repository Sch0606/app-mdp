import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useReducer, useRef, useState } from 'react'
import { LaunchScreen } from './components/auth/LaunchScreen.jsx'
import { LockScreen } from './components/auth/LockScreen.jsx'
import { EntryContextMenu } from './components/overlays/EntryContextMenu.jsx'
import { CommandPalette } from './components/overlays/CommandPalette.jsx'
import { CategoryContextMenu } from './components/overlays/CategoryContextMenu.jsx'
import { Dialog } from './components/overlays/Dialog.jsx'
import { BackupDialog } from './components/overlays/BackupDialog.jsx'
import { ImportPreviewDialog } from './components/overlays/ImportPreviewDialog.jsx'
import { Toast } from './components/overlays/Toast.jsx'
import { SettingsView } from './components/settings/SettingsView.jsx'
import { EntryDrawer } from './components/vault/EntryDrawer.jsx'
import { VaultWorkspace } from './components/vault/VaultWorkspace.jsx'
import { tauri, errorMessage } from './lib/tauri.js'
import { motionProps } from './motion/presets.js'
import { initialVaultState, vaultReducer } from './state/vaultReducer.js'
import { allEntries, generateSecurePassword, normalizeSiteUrl } from './lib/security.js'

const emptyBiometry = { isAvailable: false, isEnabled: false, biometryType: 'None', error: null }
const SLEEP_GAP_THRESHOLD_MS = 5000

export function App() {
  const reduced = useReducedMotion()
  const toastTimer = useRef()
  const clipboardTimer = useRef()
  const inactivityTimer = useRef()
  const biometricResetTimer = useRef()
  const sessionGeneration = useRef(0)
  const lastHeartbeat = useRef(Date.now())
  const importInputRef = useRef(null)
  const browserImportInputRef = useRef(null)
  const [phase, setPhase] = useState('loading')
  const [screen, setScreen] = useState('vault')
  const [configured, setConfigured] = useState(true)
  const [biometry, setBiometry] = useState(emptyBiometry)
  const [biometricState, setBiometricState] = useState('idle')
  const [vault, dispatch] = useReducer(vaultReducer, initialVaultState)
  const [drawer, setDrawer] = useState(null)
  const [entryMenu, setEntryMenu] = useState(null)
  const [categoryMenu, setCategoryMenu] = useState(null)
  const [categoryDialog, setCategoryDialog] = useState(null)
  const [backupDialog, setBackupDialog] = useState(null)
  const [importPreview, setImportPreview] = useState([])
  const [commandOpen, setCommandOpen] = useState(false)
  const [activityItems, setActivityItems] = useState([])
  const [toast, setToast] = useState('')
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState('Version installée.')
  const [pendingUpdate, setPendingUpdate] = useState(null)
  const [preferences, setPreferences] = useState(() => ({
    autoLockDelay: Number(localStorage.getItem('clave-auto-lock-delay') || 300000),
    clipboardDelay: Number(localStorage.getItem('clave-clipboard-clear-delay') || 30000),
    showToolbarLock: localStorage.getItem('clave-show-toolbar-lock') !== 'false',
    darkMode: localStorage.getItem('clave-dark-mode') === 'true',
    lockHotkey: localStorage.getItem('clave-lock-hotkey') || '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function initialize() {
      try {
        const [auth, biometricStatus] = await Promise.all([
          tauri.invoke('auth_status'),
          tauri.invoke('biometrie_status').catch(() => emptyBiometry),
        ])
        if (!active) return
        setConfigured(auth.configured)
        setBiometry(biometricStatus || emptyBiometry)
        if (auth.unlocked) {
          const data = await tauri.invoke('charger')
          if (active) {
            dispatch({ type: 'load', categories: data })
            setPhase('unlocked')
          }
        } else {
          setPhase('locked')
        }
      } catch (cause) {
        if (!active) return
        setError(errorMessage(cause, 'Le coffre ne peut pas démarrer.'))
        setPhase('locked')
      }
    }

    initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    function onCommandShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && phase === 'unlocked') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    document.addEventListener('keydown', onCommandShortcut)
    return () => document.removeEventListener('keydown', onCommandShortcut)
  }, [phase])

  useEffect(() => {
    function closeMenu(event) {
      if (!event.target.closest?.('#entry-menu, .entry-more')) setEntryMenu(null)
      if (!event.target.closest?.('#category-menu, .categories li')) setCategoryMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [])

  useEffect(() => () => {
    clearTimeout(toastTimer.current)
    clearTimeout(clipboardTimer.current)
    clearTimeout(biometricResetTimer.current)
  }, [])

  useEffect(() => {
    if (phase !== 'unlocked') return undefined
    lastHeartbeat.current = Date.now()

    function verifyHeartbeat() {
      const now = Date.now()
      if (now - lastHeartbeat.current > SLEEP_GAP_THRESHOLD_MS) {
        lockVault()
        return
      }
      lastHeartbeat.current = now
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') verifyHeartbeat()
    }

    const interval = setInterval(verifyHeartbeat, 1000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'unlocked' || preferences.autoLockDelay === 0) return undefined

    function scheduleLock() {
      clearTimeout(inactivityTimer.current)
      inactivityTimer.current = setTimeout(() => lockVault(), preferences.autoLockDelay)
    }

    const events = ['pointerdown', 'keydown', 'wheel']
    events.forEach((eventName) => document.addEventListener(eventName, scheduleLock, { passive: true }))
    scheduleLock()
    return () => {
      clearTimeout(inactivityTimer.current)
      events.forEach((eventName) => document.removeEventListener(eventName, scheduleLock))
    }
  }, [phase, preferences.autoLockDelay])

  useEffect(() => {
    if (phase !== 'unlocked' || !preferences.lockHotkey) return undefined
    function onHotkey(event) {
      const pressed = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join('+')
      if (pressed === preferences.lockHotkey) {
        event.preventDefault()
        lockVault()
      }
    }
    document.addEventListener('keydown', onHotkey)
    return () => document.removeEventListener('keydown', onHotkey)
  }, [phase, preferences.lockHotkey])

  function showToast(message) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  function isCurrentSession(token) {
    return token === sessionGeneration.current
  }

  async function openVault() {
    const data = await tauri.invoke('charger')
    sessionGeneration.current += 1
    dispatch({ type: 'load', categories: data })
    setScreen('vault')
    setPhase('unlocked')
  }

  async function authenticateWithPassword(password) {
    setBusy(true)
    setError('')
    try {
      const command = configured ? 'unlock' : 'setup_master_password'
      await tauri.invoke(command, { password })
      await openVault()
    } catch (cause) {
      setError(errorMessage(cause, 'Mot de passe incorrect.'))
    } finally {
      setBusy(false)
    }
  }

  async function authenticateWithBiometry() {
    if (busy) return
    clearTimeout(biometricResetTimer.current)
    setBusy(true)
    setError('')
    setBiometricState('scanning')
    try {
      await tauri.invoke('deverrouiller_biometrie')
      setBiometricState('success')
      if (!reduced) await new Promise((resolve) => setTimeout(resolve, 350))
      await openVault()
    } catch (cause) {
      setError(errorMessage(cause, 'Authentification non confirmée.'))
      setBiometricState('failure')
      biometricResetTimer.current = setTimeout(() => setBiometricState('idle'), 900)
    } finally {
      setBusy(false)
    }
  }

  async function saveEntry(form) {
    const session = sessionGeneration.current
    const category = drawer.category
    const index = drawer.index
    const payload = {
      categorie: category,
      plateforme: form.plateforme.trim(),
      email: form.email.trim(),
      mdp: form.mdp,
      site: normalizeSiteUrl(form.site) || form.site.trim(),
      notes: form.notes,
      totpSecret: form.totp_secret.trim(),
      iconUrl: form.icon_url || '',
    }

    try {
      if (index == null) {
        await tauri.invoke('ajouter', payload)
        if (!isCurrentSession(session)) return
        const next = {
          ...vault.categories,
          [category]: [...vault.categories[category], {
            plateforme: payload.plateforme,
            email: payload.email,
            mdp: payload.mdp,
            site: payload.site,
            notes: payload.notes,
            totp_secret: payload.totpSecret,
            icon_url: payload.iconUrl,
            updated_at: Math.floor(Date.now() / 1000),
          }],
        }
        dispatch({ type: 'load', categories: next })
        showToast('Accès ajouté.')
      } else {
        await tauri.invoke('modifier', { ...payload, index })
        if (!isCurrentSession(session)) return
        const entries = vault.categories[category].map((entry, currentIndex) => currentIndex === index
          ? { ...entry, ...payload, categorie: undefined, totp_secret: payload.totpSecret, icon_url: payload.iconUrl, updated_at: Math.floor(Date.now() / 1000) }
          : entry)
        dispatch({ type: 'load', categories: { ...vault.categories, [category]: entries } })
        showToast('Accès modifié.')
      }
      setDrawer(null)
    } catch (cause) {
      if (isCurrentSession(session)) showToast(errorMessage(cause))
    }
  }

  async function generatePassword(options) {
    try {
      return generateSecurePassword(options)
    } catch (cause) {
      showToast(errorMessage(cause, 'Le mot de passe n’a pas pu être généré.'))
      return ''
    }
  }

  async function deleteEntry(target) {
    const session = sessionGeneration.current
    setEntryMenu(null)
    setCommandOpen(false)
    try {
      const result = await tauri.invoke('supprimer_acces', { categorie: target.category, index: target.index })
      if (!isCurrentSession(session)) return
      if (result && typeof result === 'object') {
        dispatch({ type: 'load', categories: result })
      } else {
        const entries = vault.categories[target.category].filter((_, index) => index !== target.index)
        dispatch({ type: 'load', categories: { ...vault.categories, [target.category]: entries } })
      }
      showToast('Accès placé dans la poubelle.')
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function toggleFavorite(target) {
    const session = sessionGeneration.current
    const favorite = !target.favorite
    try {
      const result = await tauri.invoke('definir_favori', { categorie: target.category, index: target.index, favorite })
      if (!isCurrentSession(session)) return
      if (result && typeof result === 'object') {
        dispatch({ type: 'load', categories: result })
      } else {
        const entries = vault.categories[target.category].map((entry, index) => index === target.index ? { ...entry, favorite } : entry)
        dispatch({ type: 'load', categories: { ...vault.categories, [target.category]: entries } })
      }
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function copySecure(value, message) {
    if (!value) return
    const session = sessionGeneration.current
    try {
      await tauri.clipboard.writeText(value)
      if (!isCurrentSession(session)) {
        await tauri.clipboard.clear().catch(() => {})
        return
      }
      showToast(message)
      clearTimeout(clipboardTimer.current)
      const clearDelay = preferences.clipboardDelay
      if (clearDelay === 0) return
      clipboardTimer.current = setTimeout(async () => {
        try {
          if (await tauri.clipboard.readText() === value) await tauri.clipboard.clear()
        } catch (_) {
          // Clipboard cleanup is best effort.
        }
      }, clearDelay)
    } catch (cause) {
      showToast(errorMessage(cause, 'Le presse-papiers est indisponible.'))
    }
  }

  async function addCategory() {
    const session = sessionGeneration.current
    let number = 1
    while (Object.hasOwn(vault.categories, `Espace ${number}`)) number += 1
    const category = `Espace ${number}`
    try {
      await tauri.invoke('ajouter_categorie', { categorie: category })
      if (!isCurrentSession(session)) return
      dispatch({ type: 'load', categories: { ...vault.categories, [category]: [] } })
      dispatch({ type: 'select-category', category })
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function renameCategory() {
    const session = sessionGeneration.current
    const oldName = categoryDialog?.category
    const newName = categoryDialog?.value?.trim()
    if (!oldName || !newName) return
    if (newName !== oldName && Object.hasOwn(vault.categories, newName)) {
      showToast('Cet espace existe déjà.')
      return
    }
    try {
      if (newName !== oldName) {
        await tauri.invoke('renommer_categorie', { ancienNom: oldName, nouveauNom: newName })
        if (!isCurrentSession(session)) return
        const next = { ...vault.categories, [newName]: vault.categories[oldName] || [] }
        delete next[oldName]
        dispatch({ type: 'load', categories: next })
        if (vault.activeCategory === oldName) queueMicrotask(() => dispatch({ type: 'select-category', category: newName }))
        showToast('Espace renommé.')
      }
      setCategoryDialog(null)
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function deleteCategory() {
    const session = sessionGeneration.current
    const category = categoryDialog?.category
    if (!category) return
    try {
      const result = await tauri.invoke('supprimer_categorie', { categorie: category })
      if (!isCurrentSession(session)) return
      const fallback = { ...vault.categories }
      delete fallback[category]
      if (!Object.keys(fallback).length) fallback.Perso = []
      dispatch({ type: 'load', categories: result && typeof result === 'object' ? result : fallback })
      setCategoryDialog(null)
      showToast('Espace supprimé.')
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function lockVault() {
    sessionGeneration.current += 1
    const lockSession = sessionGeneration.current
    clearTimeout(toastTimer.current)
    clearTimeout(clipboardTimer.current)
    clearTimeout(inactivityTimer.current)
    clearTimeout(biometricResetTimer.current)
    setDrawer(null)
    setEntryMenu(null)
    setCategoryMenu(null)
    setCategoryDialog(null)
    setBackupDialog(null)
    setImportPreview([])
    setCommandOpen(false)
    setActivityItems([])
    setToast('')
    setError('')
    setPendingUpdate(null)
    setBusy(false)
    setScreen('vault')
    dispatch({ type: 'reset' })
    setConfigured(true)
    setBiometricState('idle')
    setPhase('locked')

    tauri.clipboard.clear().catch(() => {})
    try {
      await tauri.invoke('lock')
    } catch (cause) {
      if (isCurrentSession(lockSession)) setError(errorMessage(cause, 'Le verrouillage natif a echoue.'))
    }
  }

  function updatePreference(name, value) {
    setPreferences((current) => ({ ...current, [name]: value }))
    const storageKeys = {
      autoLockDelay: 'clave-auto-lock-delay',
      clipboardDelay: 'clave-clipboard-clear-delay',
      showToolbarLock: 'clave-show-toolbar-lock',
      darkMode: 'clave-dark-mode',
      lockHotkey: 'clave-lock-hotkey',
    }
    localStorage.setItem(storageKeys[name], String(value))
  }

  async function openSettings() {
    setScreen('settings')
    try {
      setVersion(await tauri.app.getVersion())
    } catch (_) {
      setVersion('')
    }
  }

  async function handleSettingsAction(type, payload) {
    try {
      switch (type) {
        case 'lock': await lockVault(); break
        case 'feedback': showToast(payload); break
        case 'enable-biometry': {
          const status = await tauri.invoke('activer_biometrie', { password: payload })
          setBiometry(status)
          showToast('Biométrie activée.')
          break
        }
        case 'disable-biometry': {
          const status = await tauri.invoke('desactiver_biometrie')
          setBiometry(status)
          showToast('Biométrie désactivée.')
          break
        }
        case 'change-password':
          await tauri.invoke('changer_mot_de_passe_maitre', { ancienPassword: payload.old, nouveauPassword: payload.next })
          showToast('Mot de passe maître modifié.')
          break
        case 'check-update': {
          setUpdateStatus('Recherche en cours…')
          const update = await tauri.updater.check()
          setPendingUpdate(update)
          setUpdateStatus(update ? `Version ${update.version} disponible.` : 'Clave est à jour.')
          break
        }
        case 'install-update':
          if (pendingUpdate) {
            setUpdateStatus('Installation de la mise à jour…')
            await pendingUpdate.downloadAndInstall()
            await tauri.process.relaunch()
          }
          break
        case 'record-hotkey': {
          showToast('Appuyez sur la combinaison de verrouillage.')
          const capture = (event) => {
            event.preventDefault()
            const value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join('+')
            if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) updatePreference('lockHotkey', value)
          }
          document.addEventListener('keydown', capture, { once: true })
          break
        }
        case 'export': setBackupDialog({ mode: 'export' }); break
        case 'import': importInputRef.current?.click(); break
        case 'browser-import': browserImportInputRef.current?.click(); break
        default: break
      }
    } catch (cause) {
      showToast(errorMessage(cause))
      setUpdateStatus(errorMessage(cause))
    }
  }

  async function confirmBackup(password) {
    const session = sessionGeneration.current
    try {
      if (backupDialog.mode === 'export') {
        const content = await tauri.invoke('exporter', { password })
        if (!isCurrentSession(session)) return
        const blob = new Blob([content], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `clave-backup-${new Date().toISOString().slice(0, 10)}.json`
        link.click()
        URL.revokeObjectURL(url)
        showToast('Sauvegarde exportée.')
      } else {
        const data = await tauri.invoke('importer', { password, backupJson: backupDialog.content })
        if (!isCurrentSession(session)) return
        dispatch({ type: 'load', categories: data })
        setScreen('vault')
        showToast('Sauvegarde importée.')
      }
      setBackupDialog(null)
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function onBackupFile(event) {
    const session = sessionGeneration.current
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const content = await file.text()
    if (isCurrentSession(session)) setBackupDialog({ mode: 'import', content })
  }

  async function onBrowserImportFile(event) {
    const session = sessionGeneration.current
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const entries = await tauri.invoke('previsualiser_import', { csvText: await file.text() })
      if (!isCurrentSession(session)) return
      const detectedEntries = entries || []
      if (!detectedEntries.length) {
        showToast('Aucun mot de passe détecté dans ce fichier.')
        return
      }
      setImportPreview(detectedEntries)
    } catch (cause) {
      showToast(errorMessage(cause, 'Import impossible. Vérifiez le fichier exporté depuis votre navigateur.'))
    }
  }

  async function confirmBrowserImport(entries) {
    const session = sessionGeneration.current
    try {
      const data = await tauri.invoke('importer_selection', { entries })
      if (!isCurrentSession(session)) return
      dispatch({ type: 'load', categories: data })
      setImportPreview([])
      setScreen('vault')
      showToast(`${entries.length} accès importé${entries.length > 1 ? 's' : ''}.`)
    } catch (cause) {
      showToast(errorMessage(cause))
    }
  }

  async function handleVaultAction(type, payload) {
    switch (type) {
      case 'select-category': dispatch({ type, category: payload }); break
      case 'query': dispatch({ type: 'set-query', query: payload }); break
      case 'filter': dispatch({ type: 'set-filter', filter: payload }); break
      case 'view': {
        const session = sessionGeneration.current
        dispatch({ type: 'set-view', view: payload })
        if (payload === 'history' || payload === 'trash') {
          try {
            const command = payload === 'history' ? 'charger_historique' : 'charger_corbeille'
            const items = await tauri.invoke(command)
            if (isCurrentSession(session)) setActivityItems(items)
          } catch (cause) {
            setActivityItems([])
            showToast(errorMessage(cause))
          }
        }
        break
      }
      case 'new-entry': {
        const entry = payload?.generate ? { mdp: await generatePassword() } : null
        setDrawer({ category: vault.activeCategory, index: null, entry })
        break
      }
      case 'edit-entry': setDrawer({ category: payload.category, index: payload.index, entry: payload }); break
      case 'entry-menu': setEntryMenu({ target: payload.entry, position: { x: Math.min(payload.event.clientX, window.innerWidth - 230), y: Math.min(payload.event.clientY, window.innerHeight - 180) } }); break
      case 'category-menu': setCategoryMenu({ target: payload.category, position: { x: Math.min(payload.event.clientX, window.innerWidth - 230), y: Math.min(payload.event.clientY, window.innerHeight - 120) } }); break
      case 'rename-category': setCategoryDialog({ type: 'rename', category: payload.category, value: payload.category }); break
      case 'favorite': await toggleFavorite(payload); break
      case 'totp': {
        const session = sessionGeneration.current
        try {
          const result = await tauri.invoke('generer_totp', { secret: payload.totp_secret })
          if (!isCurrentSession(session)) break
          await copySecure(result.code, `Code temporaire copié · ${result.remaining}s`)
        } catch (cause) {
          showToast(errorMessage(cause, 'Le code temporaire ne peut pas être généré.'))
        }
        break
      }
      case 'copy': await copySecure(payload.value, payload.message); break
      case 'restore-history': {
        const session = sessionGeneration.current
        const result = await tauri.invoke('restaurer_historique', { index: payload })
        if (!isCurrentSession(session)) break
        dispatch({ type: 'load', categories: result })
        const items = await tauri.invoke('charger_historique')
        if (!isCurrentSession(session)) break
        setActivityItems(items)
        showToast('Version restaurée.')
        break
      }
      case 'restore-trash': {
        const session = sessionGeneration.current
        const result = await tauri.invoke('restaurer_corbeille', { index: payload })
        if (!isCurrentSession(session)) break
        dispatch({ type: 'load', categories: result })
        const items = await tauri.invoke('charger_corbeille')
        if (!isCurrentSession(session)) break
        setActivityItems(items)
        showToast('Accès restauré.')
        break
      }
      case 'delete-trash': {
        const session = sessionGeneration.current
        await tauri.invoke('supprimer_corbeille', { index: payload })
        if (!isCurrentSession(session)) break
        const items = await tauri.invoke('charger_corbeille')
        if (!isCurrentSession(session)) break
        setActivityItems(items)
        showToast('Accès supprimé définitivement.')
        break
      }
      case 'empty-trash': {
        const session = sessionGeneration.current
        await tauri.invoke('vider_corbeille')
        if (!isCurrentSession(session)) break
        setActivityItems([])
        showToast('Poubelle vidée.')
        break
      }
      case 'add-category': await addCategory(); break
      case 'open-settings': await openSettings(); break
      case 'lock': await lockVault(); break
      default: break
    }
  }

  const menuTarget = entryMenu?.target

  return (
    <div className="clave-app" data-testid="clave-app" data-theme={preferences.darkMode ? 'dark' : 'light'}>
      <AnimatePresence mode="wait">
        {phase === 'loading' && <LaunchScreen key="launch" />}
        {phase === 'locked' && (
          <LockScreen
            key="lock"
            configured={configured}
            biometry={biometry}
            biometricState={biometricState}
            busy={busy}
            error={error}
            onPassword={authenticateWithPassword}
            onBiometry={authenticateWithBiometry}
          />
        )}
        {phase === 'unlocked' && (
          <motion.div key="workspace" {...motionProps(reduced)}>
            <AnimatePresence mode="wait" initial={false}>
              {screen === 'vault' ? (
                <motion.div key="vault-screen" {...motionProps(reduced)}>
                  <VaultWorkspace state={vault} activityItems={activityItems} showToolbarLock={preferences.showToolbarLock} onAction={handleVaultAction} />
                </motion.div>
              ) : (
                <SettingsView
                  key="settings-screen"
                  preferences={preferences}
                  biometry={biometry}
                  version={version}
                  updateStatus={updateStatus}
                  updateAvailable={Boolean(pendingUpdate)}
                  onClose={() => setScreen('vault')}
                  onPreference={updatePreference}
                  onAction={handleSettingsAction}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <EntryDrawer
        open={Boolean(drawer)}
        entry={drawer?.entry}
        onClose={() => setDrawer(null)}
        onSave={saveEntry}
        onGenerate={generatePassword}
      />
      <EntryContextMenu
        target={menuTarget}
        position={entryMenu?.position || { x: 0, y: 0 }}
        onEdit={() => { setDrawer({ category: menuTarget.category, index: menuTarget.index, entry: menuTarget }); setEntryMenu(null) }}
        onCopyPassword={() => { copySecure(menuTarget.mdp, 'Mot de passe copié.'); setEntryMenu(null) }}
        onCopyEmail={() => { copySecure(menuTarget.email, 'Identifiant copié.'); setEntryMenu(null) }}
        onDelete={() => deleteEntry(menuTarget)}
      />
      <CategoryContextMenu
        target={categoryMenu?.target}
        position={categoryMenu?.position || { x: 0, y: 0 }}
        onRename={() => { setCategoryDialog({ type: 'rename', category: categoryMenu.target, value: categoryMenu.target }); setCategoryMenu(null) }}
        onDelete={() => { setCategoryDialog({ type: 'delete', category: categoryMenu.target }); setCategoryMenu(null) }}
      />
      <Dialog
        open={categoryDialog?.type === 'rename'}
        title="Renommer l’espace"
        labelledBy="rename-title"
        onClose={() => setCategoryDialog(null)}
        actions={<><button className="secondary-button" id="cancel-rename" type="button" onClick={() => setCategoryDialog(null)}>Annuler</button><button className="primary-button" id="confirm-rename" type="button" onClick={renameCategory}>Renommer</button></>}
      >
        <label className="dialog-field"><span>Nouveau nom</span><input id="rename-input" value={categoryDialog?.value || ''} onChange={(event) => setCategoryDialog((current) => ({ ...current, value: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') renameCategory() }} autoFocus /></label>
      </Dialog>
      <Dialog
        open={categoryDialog?.type === 'delete'}
        title="Supprimer cet espace ?"
        labelledBy="delete-title"
        description={`Les accès de « ${categoryDialog?.category || ''} » seront placés dans la poubelle.`}
        onClose={() => setCategoryDialog(null)}
        actions={<><button className="secondary-button" id="cancel-delete" type="button" onClick={() => setCategoryDialog(null)}>Annuler</button><button className="danger-button" id="confirm-delete" type="button" onClick={deleteCategory}>Supprimer</button></>}
      />
      <BackupDialog state={backupDialog} onClose={() => setBackupDialog(null)} onConfirm={confirmBackup} />
      <ImportPreviewDialog entries={importPreview} onClose={() => setImportPreview([])} onConfirm={confirmBrowserImport} />
      <input ref={importInputRef} id="import-file" className="sr-only" type="file" accept="application/json,.json" onChange={onBackupFile} tabIndex="-1" />
      <input ref={browserImportInputRef} id="browser-import-file" className="sr-only" type="file" accept="text/csv,text/plain,.csv,.tsv,.txt" onChange={onBrowserImportFile} tabIndex="-1" />
      <CommandPalette
        open={commandOpen}
        entries={allEntries(vault.categories)}
        onClose={() => setCommandOpen(false)}
        onSelect={(entry) => {
          dispatch({ type: 'select-category', category: entry.category })
          setDrawer({ category: entry.category, index: entry.index, entry })
          setCommandOpen(false)
          tauri.invoke('marquer_consulte', { categorie: entry.category, index: entry.index }).catch(() => {})
        }}
      />
      <Toast message={toast} />
    </div>
  )
}
