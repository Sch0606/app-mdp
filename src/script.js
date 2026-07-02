const LAUNCH_MINIMUM_MS = 2000
const launchStartedAt = performance.now()
const invoke = window.__TAURI__.core.invoke
const clipboardManager = window.__TAURI__.clipboardManager
const updaterApi = window.__TAURI__.updater
const processApi = window.__TAURI__.process
const appApi = window.__TAURI__.app
const SLEEP_HEARTBEAT_MS = 1000
const SLEEP_GAP_THRESHOLD_MS = 5000

const categories = { Perso: [] }

let categorieActive = 'Perso'
let toastTimer
let inactivityTimer
let categorieARenommer = null
let categorieMenu = null
let categorieASupprimer = null
let entryMenuTarget = null
let authMode = 'setup'
let searchQuery = ''
let backupMode = 'export'
let pendingImportText = ''
let showToolbarLock = localStorage.getItem('clave-show-toolbar-lock') !== 'false'
let inactivityMs = Number(localStorage.getItem('clave-auto-lock-delay') || 300000)
let lockHotkey = localStorage.getItem('clave-lock-hotkey') || ''
let isRecordingLockHotkey = false
let biometryState = { isAvailable: false, isEnabled: false, biometryType: 'None' }
let clipboardClearTimer
let clipboardClearMs = Number(localStorage.getItem('clave-clipboard-clear-delay') || 30000)
let pendingUpdate = null
let lastHeartbeatAt = Date.now()
let sleepLockInFlight = false
let editingTarget = null
let currentVaultView = 'access'
let accessFilter = 'all'
let commandSelection = 0
let importPreviewEntries = []

function afficherToast(message) {
    const toast = document.getElementById('toast')

    toast.textContent = message
    toast.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function() {
        toast.classList.remove('visible')
    }, 2400)
}

function afficherErreurVerrou(message) {
    document.getElementById('lock-error').textContent = message
}

function expliquerErreurBiometrie(error) {
    const message = String(error)
    if (message.includes('desactivee sur macOS')) {
        return 'Biométrie désactivée sur macOS.'
    }

    return message
}

function reglerModeVerrou(configured) {
    authMode = configured ? 'unlock' : 'setup'

    document.getElementById('lock-eyebrow').textContent = configured ? 'Coffre verrouillé' : 'Sécurité locale'
    document.getElementById('lock-title').textContent = configured ? 'Déverrouiller Clave' : 'Créer le mot de passe maître'
    document.getElementById('lock-copy').textContent = configured
        ? 'Entrez votre mot de passe maître pour ouvrir le coffre.'
        : 'Il protégera l’ouverture de Clave sur cet appareil.'
    document.getElementById('lock-submit').textContent = configured ? 'Déverrouiller' : 'Créer le coffre'
    document.getElementById('master-password').value = ''
    afficherErreurVerrou('')

    setTimeout(function() {
        document.getElementById('master-password').focus()
    }, 0)
}

function viderCategoriesLocales() {
    Object.keys(categories).forEach(function(cat) {
        delete categories[cat]
    })
    categories.Perso = []
    categorieActive = 'Perso'
    reconstruireOnglets()
    afficherCategorie(categorieActive)
}

async function verrouillerApplication(showToast = true) {
    clearTimeout(inactivityTimer)
    clearTimeout(clipboardClearTimer)
    fermerMenuContextuel()
    fermerMenuAcces()
    fermerModaleRenommage()
    fermerModaleSuppression()
    fermerModaleBackup()
    fermerParametres()

    try {
        await invoke('lock')
    } catch (error) {
        afficherToast(String(error))
    }

    viderCategoriesLocales()
    reglerModeVerrou(true)
    document.body.classList.add('locked')
    document.getElementById('lock-screen').setAttribute('aria-hidden', 'false')
    if (showToast) afficherToast('Coffre verrouillé.')
}

function reprogrammerVerrouillageAuto() {
    if (document.body.classList.contains('locked') || inactivityMs === 0) return

    clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(function() {
        verrouillerApplication(false)
    }, inactivityMs)
}

function ouvrirParametres() {
    const page = document.getElementById('settings-page')
    const button = document.getElementById('settings-button')

    document.querySelector('.sidebar').hidden = true
    document.querySelector('.main').hidden = true
    page.hidden = false
    page.setAttribute('aria-hidden', 'false')
    button.setAttribute('aria-expanded', 'true')
    ouvrirSectionParametres('security')
    synchroniserDelaiVerrouillage(inactivityMs)
    document.getElementById('clipboard-clear-delay').value = String(clipboardClearMs)
}

function fermerParametres() {
    const page = document.getElementById('settings-page')
    const button = document.getElementById('settings-button')

    if (!page || !button) return
    document.querySelector('.sidebar').hidden = false
    document.querySelector('.main').hidden = false
    page.hidden = true
    page.setAttribute('aria-hidden', 'true')
    button.setAttribute('aria-expanded', 'false')
}

function appliquerPreferenceVerrouillage() {
    const toolbarButton = document.getElementById('lock-now')
    const toggle = document.getElementById('toggle-toolbar-lock')

    toggle.checked = showToolbarLock
    toolbarButton.hidden = !showToolbarLock
    localStorage.setItem('clave-show-toolbar-lock', String(showToolbarLock))
}

function ouvrirSectionParametres(section) {
    const buttons = Array.from(document.querySelectorAll('[data-settings-section]'))
    const selectedIndex = Math.max(0, buttons.findIndex(button => button.dataset.settingsSection === section))
    buttons.forEach((button, index) => {
        const active = index === selectedIndex
        button.classList.toggle('active', active)
        button.setAttribute('aria-selected', String(active))
    })
    document.querySelector('.settings-nav').style.setProperty('--selected-index', String(selectedIndex))
    document.querySelectorAll('[data-settings-panel]').forEach(panel => {
        const active = panel.dataset.settingsPanel === section
        panel.hidden = !active
        panel.classList.toggle('active', active)
    })
}

async function chargerVersionApplication() {
    try {
        document.getElementById('app-version').textContent = `v${await appApi.getVersion()}`
    } catch (_) {
        document.getElementById('app-version').textContent = ''
    }
}

async function verifierMiseAJour() {
    const status = document.getElementById('update-status')
    const installButton = document.getElementById('install-update')

    status.textContent = 'Vérification en cours...'
    installButton.hidden = true
    pendingUpdate = null

    try {
        pendingUpdate = await updaterApi.check({ timeout: 15000 })
        if (!pendingUpdate) {
            status.textContent = 'Clave est à jour.'
            return
        }

        status.textContent = `Version ${pendingUpdate.version} disponible.`
        installButton.hidden = false
    } catch (_) {
        status.textContent = 'Vérification impossible. Contrôlez votre connexion.'
    }
}

async function installerMiseAJour() {
    if (!pendingUpdate) return
    const status = document.getElementById('update-status')
    const button = document.getElementById('install-update')
    let downloaded = 0
    let total = 0

    button.disabled = true
    try {
        await pendingUpdate.downloadAndInstall(function(event) {
            if (event.event === 'Started') total = event.data.contentLength || 0
            if (event.event === 'Progress') downloaded += event.data.chunkLength
            if (event.event === 'Progress') {
                status.textContent = total > 0
                    ? `Téléchargement ${Math.round(downloaded / total * 100)} %`
                    : 'Téléchargement...'
            }
        })
        status.textContent = 'Mise à jour installée. Redémarrage...'
        await processApi.relaunch()
    } catch (_) {
        status.textContent = 'Installation impossible. Reessayez plus tard.'
        button.disabled = false
    }
}

function verifierRepriseApresVeille() {
    const now = Date.now()
    const gap = now - lastHeartbeatAt
    lastHeartbeatAt = now

    if (gap <= SLEEP_GAP_THRESHOLD_MS || document.body.classList.contains('locked') || sleepLockInFlight) return

    sleepLockInFlight = true
    verrouillerApplication(false).finally(function() {
        sleepLockInFlight = false
    })
}

function demarrerSurveillanceVeille() {
    lastHeartbeatAt = Date.now()
    window.setInterval(verifierRepriseApresVeille, SLEEP_HEARTBEAT_MS)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) verifierRepriseApresVeille()
    })
}

function synchroniserDelaiVerrouillage(value) {
    const options = Array.from(document.querySelectorAll('input[name="auto-lock-delay"]'))
    const selectedIndex = Math.max(0, options.findIndex(function(option) {
        return option.value === String(value)
    }))

    options.forEach(function(option, index) {
        option.checked = index === selectedIndex
    })
    document.querySelector('.delay-options').style.setProperty('--selected-index', String(selectedIndex))
}

function appliquerDelaiVerrouillage(event) {
    inactivityMs = Number(event.target.value)
    synchroniserDelaiVerrouillage(inactivityMs)
    localStorage.setItem('clave-auto-lock-delay', String(inactivityMs))
    reprogrammerVerrouillageAuto()
    afficherToast(inactivityMs === 0 ? 'Verrouillage automatique désactivé.' : 'Délai mis à jour.')
}

function normaliserTouche(event) {
    if (event.key === ' ') return 'Space'
    if (event.key.length === 1) return event.key.toUpperCase()
    return event.key
}

function mettreAJourAffichageRaccourci() {
    const display = document.getElementById('lock-hotkey-display')
    const button = document.getElementById('record-lock-hotkey')

    display.textContent = isRecordingLockHotkey
        ? 'Appuyez sur une touche'
        : lockHotkey || 'Aucune'
    button.textContent = isRecordingLockHotkey ? 'En attente...' : 'Définir'
}

function capturerRaccourciVerrouillage() {
    isRecordingLockHotkey = true
    mettreAJourAffichageRaccourci()
    afficherToast('Appuyez sur la touche à utiliser.')
}

function retirerRaccourciVerrouillage() {
    lockHotkey = ''
    isRecordingLockHotkey = false
    localStorage.removeItem('clave-lock-hotkey')
    mettreAJourAffichageRaccourci()
    afficherToast('Raccourci retiré.')
}

function cibleEstChampDeSaisie(target) {
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
}

function gererRaccourciVerrouillage(event) {
    if (isRecordingLockHotkey) {
        event.preventDefault()
        lockHotkey = normaliserTouche(event)
        isRecordingLockHotkey = false
        localStorage.setItem('clave-lock-hotkey', lockHotkey)
        mettreAJourAffichageRaccourci()
        afficherToast(`Touche ${lockHotkey} enregistrée.`)
        return
    }

    if (!lockHotkey || document.body.classList.contains('locked')) return
    if (cibleEstChampDeSaisie(event.target)) return

    if (normaliserTouche(event) === lockHotkey) {
        event.preventDefault()
        verrouillerApplication(true)
    }
}

async function mettreAJourBiometrie() {
    const status = await invoke('biometrie_status')
    const statusText = document.getElementById('biometry-status')
    const unlockButton = document.getElementById('biometry-unlock')
    const enableButton = document.getElementById('enable-biometry')
    const disableButton = document.getElementById('disable-biometry')

    biometryState = status
    unlockButton.hidden = !(status.isAvailable && status.isEnabled)
    enableButton.disabled = !status.isAvailable
    disableButton.disabled = !status.isEnabled

    if (!status.isAvailable) {
        statusText.textContent = status.error || 'Biométrie indisponible sur cet appareil.'
        return status
    }

    statusText.textContent = status.isEnabled
        ? `${status.biometryType} activée.`
        : `${status.biometryType} disponible.`
    return status
}

async function activerBiometrie() {
    const passwordInput = document.getElementById('biometry-master-password')
    const password = passwordInput.value

    if (password.length < 8) {
        afficherToast('Entrez le mot de passe maître.')
        return
    }

    try {
        await invoke('activer_biometrie', { password })
        passwordInput.value = ''
        await mettreAJourBiometrie()
        afficherToast('Biométrie activée.')
    } catch (error) {
        afficherToast(expliquerErreurBiometrie(error))
    }
}

async function desactiverBiometrie() {
    try {
        await invoke('desactiver_biometrie')
        await mettreAJourBiometrie()
        afficherToast('Biométrie désactivée.')
    } catch (error) {
        afficherToast(expliquerErreurBiometrie(error))
    }
}

async function deverrouillerAvecBiometrie() {
    if (!biometryState.isAvailable || !biometryState.isEnabled) return

    try {
        await invoke('deverrouiller_biometrie')
        await ouvrirApplication()
    } catch (error) {
        afficherErreurVerrou(expliquerErreurBiometrie(error))
    }
}

function afficherGenerateur() {
    document.querySelector('.tools-grid').classList.remove('generator-collapsed')
    document.getElementById('generator-output').textContent = 'Prêt'
}

async function changerMotDePasseMaitre(event) {
    event.preventDefault()

    const oldPassword = document.getElementById('old-master-password').value
    const newPassword = document.getElementById('new-master-password').value
    const confirmPassword = document.getElementById('confirm-new-master-password').value
    const feedback = document.getElementById('settings-feedback')

    feedback.textContent = ''

    if (newPassword.length < 8) {
        feedback.textContent = 'Le nouveau mot de passe doit faire au moins 8 caracteres.'
        return
    }

    if (newPassword !== confirmPassword) {
        feedback.textContent = 'La confirmation ne correspond pas.'
        return
    }

    try {
        await invoke('changer_mot_de_passe_maitre', {
            ancienPassword: oldPassword,
            nouveauPassword: newPassword,
        })
        document.getElementById('change-master-form').reset()
        feedback.textContent = 'Mot de passe maître modifié.'
        afficherToast('Mot de passe maître enregistré.')
    } catch (error) {
        feedback.textContent = String(error)
    }
}

async function ouvrirApplication() {
    document.body.classList.remove('locked')
    document.getElementById('lock-screen').setAttribute('aria-hidden', 'true')
    await chargerCategories()
    reprogrammerVerrouillageAuto()
}

async function initialiserAuth() {
    const status = await invoke('auth_status')

    if (status.unlocked) {
        await ouvrirApplication()
        return
    }

    reglerModeVerrou(status.configured)
    document.body.classList.add('locked')
    document.getElementById('lock-screen').setAttribute('aria-hidden', 'false')
    mettreAJourBiometrie().catch(function() {})
}

async function soumettreVerrou(event) {
    event.preventDefault()

    const password = document.getElementById('master-password').value

    if (password.length < 8) {
        afficherErreurVerrou('Utilisez au moins 8 caracteres.')
        return
    }

    try {
        if (authMode === 'setup') {
            await invoke('setup_master_password', { password })
            afficherToast('Coffre protégé.')
        } else {
            await invoke('unlock', { password })
        }

        await ouvrirApplication()
    } catch (error) {
        afficherErreurVerrou(String(error))
    }
}

function compterAcces(nom) {
    const total = getVisibleEntries(nom).length
    document.getElementById('entry-count').textContent = `${total} accès`
}

function creerNomCategorie() {
    const base = 'Nouvel espace'
    let nom = base
    let index = 2

    while (categories[nom]) {
        nom = `${base} ${index}`
        index += 1
    }

    return nom
}

function creerOngletCategorie(nom) {
    const liste = document.querySelector('.sidebar ul')
    const nouvelOnglet = document.createElement('li')

    nouvelOnglet.textContent = nom
    nouvelOnglet.tabIndex = 0
    liste.appendChild(nouvelOnglet)
}

function reconstruireOnglets() {
    const liste = document.querySelector('.sidebar ul')
    liste.innerHTML = ''
    Object.keys(categories).forEach(creerOngletCategorie)
}

function echapperHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}

function normaliser(value) {
    return String(value || '').toLowerCase().trim()
}

function obtenirUrlLogo(site) {
    const value = String(site || '').trim()
    if (!value) return ''

    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
        if (!['http:', 'https:'].includes(url.protocol)) return ''
        return `${url.origin}/favicon.ico`
    } catch (_) {
        return ''
    }
}

function getVisibleEntries(nom) {
    const query = normaliser(searchQuery)
    const sourceCategories = query || accessFilter !== 'all' ? Object.keys(categories) : [nom]
    const results = []

    sourceCategories.forEach(function(category) {
        ;(categories[category] || []).forEach(function(entry, index) {
            const searchable = normaliser(`${category} ${entry.plateforme} ${entry.email} ${entry.mdp}`)
            const matchesFilter = accessFilter === 'favorites' ? entry.favorite : accessFilter === 'recent' ? entry.last_accessed > 0 : true
            if ((!query || searchable.includes(query)) && matchesFilter) {
                results.push({ category, entry, index })
            }
        })
    })

    if (accessFilter === 'recent') results.sort((a, b) => (b.entry.last_accessed || 0) - (a.entry.last_accessed || 0))
    return results
}

function afficherCategorie(nom) {
    const titre = document.querySelector('.page-header h2')
    const liste = document.getElementById('liste-mdp')
    const visibleEntries = getVisibleEntries(nom)

    fermerMenuAcces()

    titre.textContent = searchQuery ? 'Recherche' : nom
    liste.innerHTML = ''
    compterAcces(nom)
    document.getElementById('empty-vault').hidden = visibleEntries.length > 0 || Boolean(searchQuery) || accessFilter !== 'all'

    document.querySelectorAll('.sidebar li').forEach(function(item) {
        item.classList.toggle('active', item.textContent === nom && !searchQuery)
    })

    visibleEntries.forEach(function(item) {
        const ligne = document.createElement('div')
        ligne.className = 'ligne entry-row'
        ligne.dataset.category = item.category
        ligne.dataset.index = String(item.index)
        const initial = (item.entry.plateforme || '?').slice(0, 1).toUpperCase()
        const strength = evaluerForceMotDePasse(item.entry.mdp)
        ligne.innerHTML = `<span class="entry-avatar">${echapperHtml(initial)}</span><div class="entry-summary"><strong>${echapperHtml(item.entry.plateforme || 'Sans nom')}</strong><span>${echapperHtml(item.entry.email || 'Aucun identifiant')}</span></div><span class="entry-space">${echapperHtml(item.category)}</span><span class="strength-badge ${strength.level}">${strength.label}</span>${item.entry.totp_secret ? '<button class="mini-action entry-totp-code" type="button">Code TOTP</button>' : ''}<button class="entry-more" type="button" aria-label="Actions">•••</button><input class="entry-platforme" type="hidden" value="${echapperHtml(item.entry.plateforme)}"><input class="entry-email" type="hidden" value="${echapperHtml(item.entry.email)}"><input class="entry-mdp" type="hidden" value="${echapperHtml(item.entry.mdp)}">`
        const logoUrl = obtenirUrlLogo(item.entry.site)
        if (logoUrl) {
            const logo = document.createElement('img')
            logo.className = 'entry-logo'
            logo.src = logoUrl
            logo.alt = ''
            logo.loading = 'lazy'
            logo.setAttribute('referrerpolicy', 'no-referrer')
            logo.addEventListener('error', function() { logo.remove() })
            ligne.querySelector('.entry-avatar').appendChild(logo)
        }
        const date = document.createElement('span')
        date.className = 'entry-date'
        date.textContent = item.entry.updated_at ? new Date(item.entry.updated_at * 1000).toLocaleDateString('fr-FR') : '—'
        const favorite = document.createElement('button')
        favorite.className = `entry-favorite${item.entry.favorite ? ' active' : ''}`
        favorite.type = 'button'
        favorite.setAttribute('aria-label', item.entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris')
        favorite.textContent = '★'
        const more = ligne.querySelector('.entry-more')
        ligne.insertBefore(date, more)
        ligne.insertBefore(favorite, more)
        liste.appendChild(ligne)
    })

    document.getElementById('plateforme').value = ''
    document.getElementById('email').value = ''
    document.getElementById('mdp').value = ''
    document.getElementById('entry-site').value = ''
    document.getElementById('entry-notes').value = ''
    document.getElementById('entry-totp').value = ''
    mettreAJourAudit()
}

function ouvrirModaleRenommage(nom) {
    fermerMenuContextuel()
    const modal = document.getElementById('rename-modal')
    const input = document.getElementById('rename-input')

    categorieARenommer = nom
    input.value = nom
    modal.classList.add('visible')
    modal.setAttribute('aria-hidden', 'false')
    setTimeout(function() {
        input.focus()
        input.select()
    }, 0)
}

function ouvrirMenuContextuel(event, nom) {
    event.preventDefault()
    fermerMenuAcces()
    const menu = document.getElementById('category-menu')
    const margin = 10
    const width = 190
    const height = 90
    const left = Math.min(event.clientX, window.innerWidth - width - margin)
    const top = Math.min(event.clientY, window.innerHeight - height - margin)

    categorieMenu = nom
    menu.style.left = `${Math.max(margin, left)}px`
    menu.style.top = `${Math.max(margin, top)}px`
    menu.classList.add('visible')
    menu.setAttribute('aria-hidden', 'false')
}

function fermerMenuContextuel() {
    const menu = document.getElementById('category-menu')

    menu.classList.remove('visible')
    menu.setAttribute('aria-hidden', 'true')
    categorieMenu = null
}

function ouvrirMenuAcces(event, ligne) {
    event.preventDefault()
    event.stopPropagation()
    fermerMenuContextuel()
    const menu = document.getElementById('entry-menu')
    const margin = 10
    const width = 230
    const height = 132
    const left = Math.min(event.clientX, window.innerWidth - width - margin)
    const top = Math.min(event.clientY, window.innerHeight - height - margin)

    entryMenuTarget = ligne
    menu.style.left = `${Math.max(margin, left)}px`
    menu.style.top = `${Math.max(margin, top)}px`
    menu.classList.add('visible')
    menu.setAttribute('aria-hidden', 'false')
}

function fermerMenuAcces() {
    const menu = document.getElementById('entry-menu')

    if (!menu) return
    menu.classList.remove('visible')
    menu.setAttribute('aria-hidden', 'true')
    entryMenuTarget = null
}

function fermerModaleRenommage() {
    const modal = document.getElementById('rename-modal')

    modal.classList.remove('visible')
    modal.setAttribute('aria-hidden', 'true')
    categorieARenommer = null
}

function ouvrirModaleSuppression(nom) {
    fermerMenuContextuel()
    const modal = document.getElementById('delete-modal')
    const copy = document.getElementById('delete-copy')

    categorieASupprimer = nom
    copy.textContent = `Les accès de « ${nom} » seront supprimés définitivement.`
    modal.classList.add('visible')
    modal.setAttribute('aria-hidden', 'false')
}

function fermerModaleSuppression() {
    const modal = document.getElementById('delete-modal')

    modal.classList.remove('visible')
    modal.setAttribute('aria-hidden', 'true')
    categorieASupprimer = null
}

function ouvrirModaleBackup(mode) {
    backupMode = mode
    const modal = document.getElementById('backup-modal')

    document.getElementById('backup-title').textContent = mode === 'export' ? 'Exporter le coffre' : 'Importer le coffre'
    document.getElementById('backup-copy').textContent = mode === 'export'
        ? 'Choisissez un mot de passe pour chiffrer le fichier de sauvegarde.'
        : 'Entrez le mot de passe utilisé pour chiffrer cette sauvegarde.'
    document.getElementById('backup-password').value = ''
    modal.classList.add('visible')
    modal.setAttribute('aria-hidden', 'false')
    setTimeout(function() {
        document.getElementById('backup-password').focus()
    }, 0)
}

function fermerModaleBackup() {
    const modal = document.getElementById('backup-modal')

    modal.classList.remove('visible')
    modal.setAttribute('aria-hidden', 'true')
    pendingImportText = ''
}

async function renommerCategorie() {
    const input = document.getElementById('rename-input')
    const ancienNom = categorieARenommer
    const nouveauNom = input.value.trim()

    if (!ancienNom || !nouveauNom) {
        afficherToast('Choisissez un nom.')
        return
    }

    if (categories[nouveauNom] && nouveauNom !== ancienNom) {
        afficherToast('Cet espace existe déjà.')
        return
    }

    if (nouveauNom !== ancienNom) {
        await invoke('renommer_categorie', { ancienNom, nouveauNom })
        categories[nouveauNom] = categories[ancienNom] || []
        delete categories[ancienNom]
        if (categorieActive === ancienNom) categorieActive = nouveauNom

        reconstruireOnglets()
        afficherCategorie(categorieActive)
        afficherToast('Espace renommé.')
    }

    fermerModaleRenommage()
}

function remplacerCategories(data) {
    Object.keys(categories).forEach(function(cat) {
        delete categories[cat]
    })

    if (Object.keys(data).length === 0) {
        data.Perso = []
    }

    Object.keys(data).forEach(function(cat) {
        categories[cat] = data[cat]
    })

    categorieActive = categories[categorieActive] ? categorieActive : Object.keys(categories)[0]
    reconstruireOnglets()
}

async function supprimerCategorie() {
    const nom = categorieASupprimer
    if (!nom) return

    const data = await invoke('supprimer_categorie', { categorie: nom })
    remplacerCategories(data)
    afficherCategorie(categorieActive)
    fermerModaleSuppression()
    afficherToast('Espace supprimé.')
}

function basculerSecret(button) {
    const field = button.closest('.secret-field')
    const input = field.querySelector('input')
    const isHidden = input.type === 'password'

    input.type = isHidden ? 'text' : 'password'
    button.setAttribute('aria-label', isHidden ? 'Masquer le secret' : 'Afficher le secret')
    button.setAttribute('title', isHidden ? 'Masquer le secret' : 'Afficher le secret')
    button.textContent = isHidden ? '◉' : '●'
}

function genererMotDePassePersonnalise() {
    const length = Number(document.getElementById('generator-length').value)
    const readable = document.getElementById('generator-readable').checked
    const includeNumbers = document.getElementById('generator-numbers').checked
    const includeSymbols = document.getElementById('generator-symbols').checked
    const letters = readable ? 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const numbers = readable ? '23456789' : '0123456789'
    const symbols = '!@#$%*-_+='
    let alphabet = letters

    if (includeNumbers) alphabet += numbers
    if (includeSymbols) alphabet += symbols

    const cryptoApi = window.crypto || window.msCrypto
    const random = new Uint32Array(length)
    cryptoApi.getRandomValues(random)

    return Array.from(random)
        .map(function(value) {
            return alphabet[value % alphabet.length]
        })
        .join('')
}

async function genererMotDePasseDans(input) {
    afficherGenerateur()
    input.value = genererMotDePassePersonnalise()
    document.getElementById('generator-output').textContent = 'Généré'
    mettreAJourForce(input.value)
    afficherToast('Secret genere.')
}

function evaluerForceMotDePasse(password) {
    let score = 0
    if (password.length >= 12) score += 1
    if (password.length >= 18) score += 1
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
    if (/\d/.test(password)) score += 1
    if (/[^a-zA-Z0-9]/.test(password)) score += 1

    if (!password) return { label: 'Force non mesurée', score: 0, level: 'empty' }
    if (score <= 2) return { label: 'Faible', score: 30, level: 'weak' }
    if (score <= 4) return { label: 'Moyen', score: 68, level: 'medium' }
    return { label: 'Fort', score: 100, level: 'strong' }
}

function mettreAJourForce(password) {
    const result = evaluerForceMotDePasse(password)
    const label = document.getElementById('strength-label')
    const bar = document.getElementById('strength-bar')

    label.textContent = result.label
    bar.style.width = `${result.score}%`
    bar.dataset.level = result.level
}

function mettreAJourAudit() {
    const list = document.getElementById('audit-list')
    const score = document.getElementById('audit-score')
    const alerts = []
    const seen = new Map()

    Object.entries(categories).forEach(function([category, entries]) {
        entries.forEach(function(entry) {
            const name = entry.plateforme || entry.email || category
            const strength = evaluerForceMotDePasse(entry.mdp)

            if (entry.mdp && strength.level === 'weak') {
                alerts.push(`${name}: mot de passe faible`)
            }

            if (entry.mdp) {
                const existing = seen.get(entry.mdp)
                if (existing) {
                    alerts.push(`${name} : secret déjà utilisé avec ${existing}`)
                } else {
                    seen.set(entry.mdp, name)
                }
            }
        })
    })

    list.innerHTML = ''
    alerts.slice(0, 5).forEach(function(alert) {
        const item = document.createElement('li')
        item.textContent = alert
        list.appendChild(item)
    })

    if (alerts.length === 0) {
        const item = document.createElement('li')
        item.textContent = 'Aucune alerte importante.'
        list.appendChild(item)
    }

    score.textContent = `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}`
}

function filtrerAcces() {
    searchQuery = document.getElementById('search-input').value
    afficherCategorie(categorieActive)
}

async function nettoyerPressePapiersSiInchange(value) {
    try {
        const current = clipboardManager?.readText
            ? await clipboardManager.readText()
            : await navigator.clipboard.readText()
        if (current !== value) return

        if (clipboardManager?.clear) await clipboardManager.clear()
        else await navigator.clipboard.writeText('')
    } catch (_) {}
}

async function copierTexteSecurise(value, message) {
    if (!value) {
        afficherToast('Rien a copier.')
        return
    }

    if (clipboardManager?.writeText) {
        await clipboardManager.writeText(value)
    } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
    } else {
        const textarea = document.createElement('textarea')
        textarea.value = value
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
    }

    clearTimeout(clipboardClearTimer)
    if (clipboardClearMs > 0) {
        clipboardClearTimer = window.setTimeout(function() {
            nettoyerPressePapiersSiInchange(value)
        }, clipboardClearMs)
    }
    afficherToast(message)
}

async function copierTexte(value, message) {
    return copierTexteSecurise(value, message)
}

async function modifierAcces(ligne) {
    const category = ligne.dataset.category
    const index = Number(ligne.dataset.index)
    const plateforme = document.getElementById('plateforme').value.trim()
    const email = document.getElementById('email').value.trim()
    const mdp = document.getElementById('mdp').value.trim()
    const site = document.getElementById('entry-site').value.trim()
    const notes = document.getElementById('entry-notes').value.trim()
    const totpSecret = document.getElementById('entry-totp').value.trim()
    await invoke('modifier', { categorie: category, index, plateforme, email, mdp, site, notes, totpSecret })
    categories[category][index] = { ...categories[category][index], plateforme, email, mdp, site, notes, totp_secret: totpSecret, updated_at: Math.floor(Date.now() / 1000) }
    afficherCategorie(categorieActive)
    fermerPanneauAcces()
    afficherToast('Accès enregistré.')
}

async function supprimerAcces(ligne) {
    const category = ligne.dataset.category
    const index = Number(ligne.dataset.index)
    const data = await invoke('supprimer_acces', { categorie: category, index })

    remplacerCategories(data)
    afficherCategorie(categorieActive)
    afficherToast('Accès supprimé.')
}

async function exporterCoffre(password) {
    const backup = await invoke('exporter', { password })
    const blob = new Blob([backup], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `clave-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    afficherToast('Sauvegarde exportée.')
}

async function importerCoffre(password) {
    const data = await invoke('importer', { password, backupJson: pendingImportText })

    remplacerCategories(data)
    afficherCategorie(categorieActive)
    afficherToast('Sauvegarde importée.')
}

async function confirmerBackup() {
    const password = document.getElementById('backup-password').value

    if (password.length < 8) {
        afficherToast('Mot de passe trop court.')
        return
    }

    try {
        if (backupMode === 'export') {
            await exporterCoffre(password)
        } else {
            await importerCoffre(password)
        }
        fermerModaleBackup()
    } catch (error) {
        afficherToast(String(error))
    }
}

async function chargerCategories() {
    const data = await invoke('charger')
    remplacerCategories(data)
    afficherCategorie(categorieActive)
}

function ouvrirPanneauAcces(ligne = null) {
    editingTarget = ligne
    const drawer = document.getElementById('entry-drawer')
    drawer.hidden = false
    document.getElementById('entry-drawer-title').textContent = ligne ? 'Modifier l’accès' : 'Nouvel accès'
    if (ligne) {
        const entry = categories[ligne.dataset.category][Number(ligne.dataset.index)]
        document.getElementById('plateforme').value = entry.plateforme || ''
        document.getElementById('email').value = entry.email || ''
        document.getElementById('mdp').value = entry.mdp || ''
        document.getElementById('entry-site').value = entry.site || ''
        document.getElementById('entry-notes').value = entry.notes || ''
        document.getElementById('entry-totp').value = entry.totp_secret || ''
    }
    document.getElementById('plateforme').focus()
}

function fermerPanneauAcces() { document.getElementById('entry-drawer').hidden = true; editingTarget = null }

async function afficherVueCoffre(view) {
    currentVaultView = view
    const tabs = Array.from(document.querySelectorAll('.vault-tab'))
    const selectedIndex = Math.max(0, tabs.findIndex(button => button.dataset.view === view))
    tabs.forEach(button => button.classList.toggle('active', button.dataset.view === view))
    document.querySelector('.vault-tabs').style.setProperty('--selected-index', String(selectedIndex))
    document.getElementById('empty-trash').hidden = view !== 'trash'
    if (view === 'access') { afficherCategorie(categorieActive); return }
    const records = await invoke(view === 'history' ? 'charger_historique' : 'charger_corbeille')
    const list = document.getElementById('liste-mdp')
    list.innerHTML = ''
    records.slice().reverse().forEach(function(record, reverseIndex) {
        const row = document.createElement('div')
        row.className = 'activity-row'
        const date = new Date(record.timestamp * 1000).toLocaleString('fr-FR')
        const recordIndex = records.length - 1 - reverseIndex
        row.innerHTML = `<div><strong>${echapperHtml(record.entry.plateforme || 'Sans nom')}</strong><span>${echapperHtml(record.categorie)} · ${view === 'history' ? echapperHtml(record.action) : 'supprimé'} · ${date}</span></div><div class="activity-actions">${view === 'history' ? `<button class="btn-secondary restore-history" data-index="${recordIndex}" type="button">Restaurer cette version</button>` : `<button class="btn-secondary restore-entry" data-index="${recordIndex}" type="button">Restaurer</button><button class="mini-action delete-trash" data-index="${recordIndex}" type="button">Supprimer définitivement</button>`}</div>`
        list.appendChild(row)
    })
}

function tousLesAcces() {
    return Object.entries(categories).flatMap(([category, entries]) => entries.map((entry, index) => ({ category, entry, index })))
}

function ouvrirPaletteCommandes() {
    if (document.body.classList.contains('locked')) return
    fermerParametres()
    const palette = document.getElementById('command-palette')
    palette.classList.add('visible')
    palette.setAttribute('aria-hidden', 'false')
    commandSelection = 0
    document.getElementById('command-search').value = ''
    afficherResultatsCommandes()
    document.getElementById('command-search').focus()
}

function fermerPaletteCommandes() {
    const palette = document.getElementById('command-palette')
    palette.classList.remove('visible')
    palette.setAttribute('aria-hidden', 'true')
}

function resultatsCommandes() {
    const query = normaliser(document.getElementById('command-search').value)
    return tousLesAcces().filter(item => normaliser(`${item.entry.plateforme} ${item.entry.email} ${item.category}`).includes(query)).slice(0, 8)
}

function afficherResultatsCommandes() {
    const results = resultatsCommandes()
    commandSelection = Math.min(commandSelection, Math.max(0, results.length - 1))
    document.getElementById('command-results').innerHTML = results.map((item, position) => `<div class="command-result${position === commandSelection ? ' active' : ''}" data-category="${echapperHtml(item.category)}" data-index="${item.index}"><button class="command-open" type="button"><strong>${echapperHtml(item.entry.plateforme || 'Sans nom')}</strong><span>${echapperHtml(item.entry.email || item.category)}</span></button><button class="command-copy-email mini-action" type="button">Identifiant</button><button class="command-copy-password mini-action" type="button">Mot de passe</button></div>`).join('') || '<p class="empty-command">Aucun accès trouvé.</p>'
}

async function ouvrirResultatCommande(item) {
    await invoke('marquer_consulte', { categorie: item.category, index: item.index })
    item.entry.last_accessed = Math.floor(Date.now() / 1000)
    accessFilter = 'all'; searchQuery = ''; categorieActive = item.category
    document.getElementById('search-input').value = ''
    afficherCategorie(categorieActive)
    fermerPaletteCommandes()
    const row = document.querySelector(`.entry-row[data-category="${CSS.escape(item.category)}"][data-index="${item.index}"]`)
    if (row) ouvrirPanneauAcces(row)
}

async function previsualiserImport(csvText) {
    importPreviewEntries = await invoke('previsualiser_import', { csvText })
    const list = document.getElementById('import-preview-list')
    list.innerHTML = importPreviewEntries.map((entry, index) => `<label class="import-preview-row"><input type="checkbox" value="${index}" checked><span><strong>${echapperHtml(entry.plateforme || 'Sans nom')}</strong><small>${echapperHtml(entry.email || entry.site || '')}</small></span></label>`).join('')
    const modal = document.getElementById('import-preview-modal')
    modal.classList.add('visible'); modal.setAttribute('aria-hidden', 'false')
}

async function verifierMotsDePasseCompromis() {
    const unique = [...new Set(tousLesAcces().map(item => item.entry.mdp).filter(Boolean))]
    let compromised = 0
    for (const password of unique) {
        const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
        const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
        const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } })
        const suffix = hash.slice(5)
        if ((await response.text()).split('\n').some(line => line.startsWith(`${suffix}:`))) compromised += 1
    }
    afficherToast(compromised ? `${compromised} mot(s) de passe compromis détecté(s).` : 'Aucun mot de passe compromis détecté.')
}

document.querySelector('.entry-panel .btn-ajouter').addEventListener('click', async function() {
    const plateforme = document.getElementById('plateforme').value.trim()
    const email = document.getElementById('email').value.trim()
    const mdp = document.getElementById('mdp').value.trim()

    if (!plateforme && !email && !mdp) {
        afficherToast('Ajoutez au moins une information.')
        return
    }

    if (editingTarget) { await modifierAcces(editingTarget); return }
    const site = document.getElementById('entry-site').value.trim()
    const notes = document.getElementById('entry-notes').value.trim()
    const totpSecret = document.getElementById('entry-totp').value.trim()
    await invoke('ajouter', { plateforme, email, mdp, site, notes, totpSecret, categorie: categorieActive })
    const now = Math.floor(Date.now() / 1000)
    categories[categorieActive].push({ plateforme, email, mdp, site, notes, totp_secret: totpSecret, favorite: false, created_at: now, updated_at: now, last_accessed: 0 })
    afficherCategorie(categorieActive)
    fermerPanneauAcces()
    afficherToast('Accès enregistré.')
})

document.getElementById('generer').addEventListener('click', function() {
    afficherGenerateur()
    genererMotDePasseDans(document.getElementById('mdp'))
})

document.getElementById('mdp').addEventListener('input', function(event) {
    mettreAJourForce(event.target.value)
})

document.getElementById('generator-length').addEventListener('input', function(event) {
    document.getElementById('generator-length-value').textContent = event.target.value
})

document.getElementById('add-categorie').addEventListener('click', async function() {
    const nomCategorie = creerNomCategorie()

    await invoke('ajouter_categorie', { categorie: nomCategorie })
    categories[nomCategorie] = []
    categorieActive = nomCategorie
    reconstruireOnglets()
    afficherCategorie(categorieActive)
    afficherToast('Espace créé.')
})

document.getElementById('liste-mdp').addEventListener('click', function(e) {
    if (e.target.closest('.restore-history')) {
        invoke('restaurer_historique', { index: Number(e.target.closest('.restore-history').dataset.index) }).then(function(data) { remplacerCategories(data); afficherVueCoffre('history'); afficherToast('Version restaurée.') })
        return
    }
    if (e.target.closest('.delete-trash')) {
        invoke('supprimer_corbeille', { index: Number(e.target.closest('.delete-trash').dataset.index) }).then(function() { afficherVueCoffre('trash'); afficherToast('Accès supprimé définitivement.') })
        return
    }
    if (e.target.closest('.restore-entry')) {
        const button = e.target.closest('.restore-entry')
        invoke('restaurer_corbeille', { index: Number(button.dataset.index) }).then(function(data) {
            remplacerCategories(data)
            afficherVueCoffre('trash')
        })
        return
    }

    const ligne = e.target.closest('.entry-row')
    if (!ligne) return

    if (e.target.closest('.entry-favorite')) {
        const category = ligne.dataset.category; const index = Number(ligne.dataset.index)
        const favorite = !categories[category][index].favorite
        invoke('definir_favori', { categorie: category, index, favorite }).then(function(data) { remplacerCategories(data); afficherCategorie(categorieActive) })
        return
    }

    if (e.target.closest('.entry-more')) {
        ouvrirMenuAcces(e, ligne)
        return
    }

    if (e.target.closest('.entry-totp-code')) {
        const entry = categories[ligne.dataset.category][Number(ligne.dataset.index)]
        invoke('generer_totp', { secret: entry.totp_secret })
            .then(result => copierTexte(result.code, `Code ${result.code} · ${result.remaining}s`))
            .catch(error => afficherToast(String(error)))
        return
    }

    if (e.target.closest('.copy-email')) {
        copierTexte(ligne.querySelector('.entry-email').value, 'Identifiant copié.')
    }
})

document.getElementById('liste-mdp').addEventListener('contextmenu', function(e) {
    const ligne = e.target.closest('.entry-row')
    if (ligne) ouvrirMenuAcces(e, ligne)
})

document.querySelector('.sidebar ul').addEventListener('dblclick', function(e) {
    if (e.target.tagName === 'LI') {
        ouvrirModaleRenommage(e.target.textContent)
    }
})

document.querySelector('.sidebar ul').addEventListener('contextmenu', function(e) {
    if (e.target.tagName === 'LI') {
        ouvrirMenuContextuel(e, e.target.textContent)
    }
})

document.querySelector('.sidebar ul').addEventListener('click', function(e) {
    if (e.target.tagName === 'LI' && e.detail === 1) {
        searchQuery = ''
        document.getElementById('search-input').value = ''
        categorieActive = e.target.textContent
        afficherCategorie(categorieActive)
    }
})

document.querySelector('.sidebar ul').addEventListener('keydown', function(e) {
    if (e.target.tagName === 'LI' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        categorieActive = e.target.textContent
        afficherCategorie(categorieActive)
    }
})

document.addEventListener('click', function(e) {
    const toggle = e.target.closest('.toggle-secret')
    if (toggle) {
        basculerSecret(toggle)
        return
    }

    if (!e.target.closest('#category-menu')) {
        fermerMenuContextuel()
    }

    if (!e.target.closest('#entry-menu')) {
        fermerMenuAcces()
    }
})

document.getElementById('entry-menu-copy').addEventListener('click', function() {
    const ligne = entryMenuTarget
    if (!ligne) return
    const password = ligne.querySelector('.entry-mdp').value
    fermerMenuAcces()
    copierTexte(password, 'Secret copié.')
})

document.getElementById('entry-menu-edit').addEventListener('click', function() {
    const ligne = entryMenuTarget
    if (!ligne) return
    fermerMenuAcces()
    ouvrirPanneauAcces(ligne)
})

document.getElementById('entry-menu-copy-email').addEventListener('click', function() {
    const ligne = entryMenuTarget
    if (!ligne) return
    const email = ligne.querySelector('.entry-email').value
    fermerMenuAcces()
    copierTexte(email, 'Identifiant copié.')
})

document.getElementById('entry-menu-delete').addEventListener('click', function() {
    const ligne = entryMenuTarget
    if (!ligne) return
    fermerMenuAcces()
    supprimerAcces(ligne).catch(function(error) {
        afficherToast(String(error))
    })
})

document.getElementById('menu-rename').addEventListener('click', function() {
    if (categorieMenu) ouvrirModaleRenommage(categorieMenu)
})

document.getElementById('menu-delete').addEventListener('click', function() {
    if (categorieMenu) ouvrirModaleSuppression(categorieMenu)
})

document.getElementById('search-input').addEventListener('input', filtrerAcces)
document.getElementById('lock-now').addEventListener('click', function() {
    verrouillerApplication(true)
})
document.getElementById('settings-button').addEventListener('click', function() {
    const page = document.getElementById('settings-page')
    if (!page.hidden) {
        fermerParametres()
    } else {
        ouvrirParametres()
    }
})
document.getElementById('close-settings').addEventListener('click', fermerParametres)
document.querySelector('.settings-nav').addEventListener('click', function(event) {
    const button = event.target.closest('[data-settings-section]')
    if (button) ouvrirSectionParametres(button.dataset.settingsSection)
})
document.getElementById('settings-lock-now').addEventListener('click', function() {
    verrouillerApplication(true)
})
document.getElementById('toggle-toolbar-lock').addEventListener('change', function(event) {
    showToolbarLock = event.target.checked
    appliquerPreferenceVerrouillage()
})
document.getElementById('auto-lock-delay').addEventListener('change', appliquerDelaiVerrouillage)
document.getElementById('clipboard-clear-delay').addEventListener('change', function(event) {
    clipboardClearMs = Number(event.target.value)
    localStorage.setItem('clave-clipboard-clear-delay', String(clipboardClearMs))
    afficherToast('Délai du presse-papiers mis à jour.')
})
document.getElementById('check-update').addEventListener('click', verifierMiseAJour)
document.getElementById('install-update').addEventListener('click', installerMiseAJour)
document.getElementById('record-lock-hotkey').addEventListener('click', capturerRaccourciVerrouillage)
document.getElementById('clear-lock-hotkey').addEventListener('click', retirerRaccourciVerrouillage)
document.getElementById('enable-biometry').addEventListener('click', activerBiometrie)
document.getElementById('disable-biometry').addEventListener('click', desactiverBiometrie)
document.getElementById('biometry-unlock').addEventListener('click', deverrouillerAvecBiometrie)
document.getElementById('change-master-form').addEventListener('submit', changerMotDePasseMaitre)
document.getElementById('settings-export-vault').addEventListener('click', function() {
    ouvrirModaleBackup('export')
})
document.getElementById('settings-import-vault').addEventListener('click', function() {
    document.getElementById('import-file').click()
})
document.getElementById('settings-import-browser').addEventListener('click', function() { document.getElementById('browser-import-file').click() })
document.getElementById('browser-import-file').addEventListener('change', async function(event) {
    const file = event.target.files[0]
    if (!file) return
    try {
        await previsualiserImport(await file.text())
    } catch (error) { afficherToast(String(error)) }
    event.target.value = ''
})
document.getElementById('new-access').addEventListener('click', function() { ouvrirPanneauAcces() })
document.getElementById('close-entry-drawer').addEventListener('click', fermerPanneauAcces)
document.querySelectorAll('.vault-tab').forEach(button => button.addEventListener('click', () => afficherVueCoffre(button.dataset.view)))
document.getElementById('empty-trash').addEventListener('click', async function() { await invoke('vider_corbeille'); afficherVueCoffre('trash'); afficherToast('Poubelle vidée.') })
document.getElementById('filter-favorites').addEventListener('click', function() { accessFilter = accessFilter === 'favorites' ? 'all' : 'favorites'; document.getElementById('filter-favorites').classList.toggle('active', accessFilter === 'favorites'); document.getElementById('filter-recent').classList.remove('active'); afficherCategorie(categorieActive) })
document.getElementById('filter-recent').addEventListener('click', function() { accessFilter = accessFilter === 'recent' ? 'all' : 'recent'; document.getElementById('filter-recent').classList.toggle('active', accessFilter === 'recent'); document.getElementById('filter-favorites').classList.remove('active'); afficherCategorie(categorieActive) })
document.getElementById('empty-new-access').addEventListener('click', function() { ouvrirPanneauAcces() })
document.getElementById('empty-import').addEventListener('click', function() { document.getElementById('browser-import-file').click() })
document.getElementById('check-breaches').addEventListener('click', function() { verifierMotsDePasseCompromis().catch(error => afficherToast(String(error))) })
document.getElementById('command-search').addEventListener('input', afficherResultatsCommandes)
document.getElementById('command-results').addEventListener('click', function(event) {
    const row = event.target.closest('.command-result'); if (!row) return
    const item = { category: row.dataset.category, index: Number(row.dataset.index), entry: categories[row.dataset.category][Number(row.dataset.index)] }
    if (event.target.closest('.command-copy-email')) copierTexte(item.entry.email, 'Identifiant copié.')
    else if (event.target.closest('.command-copy-password')) copierTexte(item.entry.mdp, 'Mot de passe copié.')
    else ouvrirResultatCommande(item)
})
document.getElementById('command-search').addEventListener('keydown', function(event) {
    const results = resultatsCommandes()
    if (event.key === 'ArrowDown') { event.preventDefault(); commandSelection = Math.min(results.length - 1, commandSelection + 1); afficherResultatsCommandes() }
    if (event.key === 'ArrowUp') { event.preventDefault(); commandSelection = Math.max(0, commandSelection - 1); afficherResultatsCommandes() }
    if (event.key === 'Enter' && results[commandSelection]) { event.preventDefault(); ouvrirResultatCommande(results[commandSelection]) }
})
document.getElementById('cancel-import-preview').addEventListener('click', function() { document.getElementById('import-preview-modal').classList.remove('visible') })
document.getElementById('confirm-import-preview').addEventListener('click', async function() {
    const selected = [...document.querySelectorAll('#import-preview-list input:checked')].map(input => importPreviewEntries[Number(input.value)])
    const data = await invoke('importer_selection', { entries: selected })
    remplacerCategories(data); afficherCategorie(categorieActive); fermerParametres(); document.getElementById('import-preview-modal').classList.remove('visible'); afficherToast(`${selected.length} accès importé(s).`)
})
document.getElementById('import-file').addEventListener('change', async function(event) {
    const file = event.target.files[0]
    if (!file) return

    pendingImportText = await file.text()
    ouvrirModaleBackup('import')
    event.target.value = ''
})

document.getElementById('confirm-rename').addEventListener('click', renommerCategorie)
document.getElementById('cancel-rename').addEventListener('click', fermerModaleRenommage)
document.getElementById('confirm-delete').addEventListener('click', supprimerCategorie)
document.getElementById('cancel-delete').addEventListener('click', fermerModaleSuppression)
document.getElementById('lock-form').addEventListener('submit', soumettreVerrou)
document.getElementById('confirm-backup').addEventListener('click', confirmerBackup)
document.getElementById('cancel-backup').addEventListener('click', fermerModaleBackup)

document.getElementById('rename-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') renommerCategorie()
    if (e.key === 'Escape') fermerModaleRenommage()
})

document.getElementById('backup-password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') confirmerBackup()
    if (e.key === 'Escape') fermerModaleBackup()
})

document.getElementById('rename-modal').addEventListener('click', function(e) {
    if (e.target.id === 'rename-modal') fermerModaleRenommage()
})

document.getElementById('delete-modal').addEventListener('click', function(e) {
    if (e.target.id === 'delete-modal') fermerModaleSuppression()
})

document.getElementById('backup-modal').addEventListener('click', function(e) {
    if (e.target.id === 'backup-modal') fermerModaleBackup()
})

document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ouvrirPaletteCommandes()
        return
    }
    gererRaccourciVerrouillage(e)
    if (e.defaultPrevented) return

    if (e.key === 'Escape') {
        fermerMenuContextuel()
        fermerMenuAcces()
        fermerModaleSuppression()
        fermerModaleBackup()
        fermerParametres()
        fermerPanneauAcces()
        fermerPaletteCommandes()
    }
})

;['click', 'keydown', 'input', 'mousemove'].forEach(function(eventName) {
    document.addEventListener(eventName, reprogrammerVerrouillageAuto, { passive: true })
})

function attendre(ms) {
    return new Promise(function(resolve) {
        window.setTimeout(resolve, Math.max(0, ms))
    })
}

async function terminerEcranLancement() {
    try {
        const elapsed = performance.now() - launchStartedAt
        await attendre(LAUNCH_MINIMUM_MS - elapsed)

        const launchScreen = document.getElementById('launch-screen')
        if (launchScreen) {
            let reducedMotion = false

            try {
                reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            } catch (_) {}

            launchScreen.classList.add('is-leaving')
            await attendre(reducedMotion ? 0 : 220)
            launchScreen.remove()
        }
    } finally {
        const appRoot = document.getElementById('app-root')
        if (appRoot) {
            appRoot.inert = false
            appRoot.removeAttribute('aria-hidden')
        }

        document.body.classList.remove('launching')

        const masterPassword = document.getElementById('master-password')
        window.setTimeout(function() {
            if (document.body.classList.contains('locked') && !masterPassword.disabled) {
                masterPassword.focus()
            }
        }, 0)
    }
}

function afficherErreurDemarrage(error) {
    document.body.classList.add('locked')
    document.getElementById('lock-screen').setAttribute('aria-hidden', 'false')
    document.getElementById('lock-eyebrow').textContent = 'Erreur de démarrage'
    document.getElementById('lock-title').textContent = "Clave n'a pas pu s'ouvrir"
    document.getElementById('lock-copy').textContent = "Fermez puis relancez l'application."

    document.querySelectorAll('#lock-form input, #lock-form button').forEach(function(control) {
        control.disabled = true
    })

    afficherErreurVerrou(String(error))
}

async function demarrerApplication() {
    let startupError = null

    try {
        await initialiserAuth()
    } catch (error) {
        startupError = error
    } finally {
        await terminerEcranLancement()
    }

    if (startupError) {
        afficherErreurDemarrage(startupError)
    }
}

demarrerApplication()
appliquerPreferenceVerrouillage()
synchroniserDelaiVerrouillage(inactivityMs)
chargerVersionApplication()
demarrerSurveillanceVeille()
mettreAJourAffichageRaccourci()
mettreAJourBiometrie().catch(function() {})
