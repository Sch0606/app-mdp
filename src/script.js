const invoke = window.__TAURI__.core.invoke

const categories = { Perso: [] }

let categorieActive = 'Perso'
let toastTimer
let inactivityTimer
let categorieARenommer = null
let categorieMenu = null
let categorieASupprimer = null
let authMode = 'setup'
let searchQuery = ''
let backupMode = 'export'
let pendingImportText = ''
let showToolbarLock = localStorage.getItem('clave-show-toolbar-lock') !== 'false'
let inactivityMs = Number(localStorage.getItem('clave-auto-lock-delay') || 300000)
let lockHotkey = localStorage.getItem('clave-lock-hotkey') || ''
let isRecordingLockHotkey = false
let biometryState = { isAvailable: false, isEnabled: false, biometryType: 'None' }

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
        return 'Biometrie desactivee sur macOS.'
    }

    return message
}

function reglerModeVerrou(configured) {
    authMode = configured ? 'unlock' : 'setup'

    document.getElementById('lock-eyebrow').textContent = configured ? 'Coffre verrouille' : 'Securite locale'
    document.getElementById('lock-title').textContent = configured ? 'Deverrouiller Clave' : 'Creer le mot de passe maitre'
    document.getElementById('lock-copy').textContent = configured
        ? 'Entrez votre mot de passe maitre pour ouvrir le coffre.'
        : 'Il protegera l ouverture de Clave sur cet appareil.'
    document.getElementById('lock-submit').textContent = configured ? 'Deverrouiller' : 'Creer le coffre'
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
    fermerMenuContextuel()
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
    if (showToast) afficherToast('Coffre verrouille.')
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
    document.getElementById('auto-lock-delay').value = String(inactivityMs)
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

function appliquerDelaiVerrouillage() {
    const select = document.getElementById('auto-lock-delay')

    inactivityMs = Number(select.value)
    localStorage.setItem('clave-auto-lock-delay', String(inactivityMs))
    reprogrammerVerrouillageAuto()
    afficherToast(inactivityMs === 0 ? 'Verrouillage auto desactive.' : 'Delai mis a jour.')
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
    button.textContent = isRecordingLockHotkey ? 'En attente...' : 'Definir'
}

function capturerRaccourciVerrouillage() {
    isRecordingLockHotkey = true
    mettreAJourAffichageRaccourci()
    afficherToast('Appuyez sur la touche a utiliser.')
}

function retirerRaccourciVerrouillage() {
    lockHotkey = ''
    isRecordingLockHotkey = false
    localStorage.removeItem('clave-lock-hotkey')
    mettreAJourAffichageRaccourci()
    afficherToast('Raccourci retire.')
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
        afficherToast(`Touche ${lockHotkey} enregistree.`)
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
        statusText.textContent = status.error || 'Biometrie indisponible sur cet appareil.'
        return status
    }

    statusText.textContent = status.isEnabled
        ? `${status.biometryType} activee.`
        : `${status.biometryType} disponible.`
    return status
}

async function activerBiometrie() {
    const passwordInput = document.getElementById('biometry-master-password')
    const password = passwordInput.value

    if (password.length < 8) {
        afficherToast('Entrez le mot de passe maitre.')
        return
    }

    try {
        await invoke('activer_biometrie', { password })
        passwordInput.value = ''
        await mettreAJourBiometrie()
        afficherToast('Biometrie activee.')
    } catch (error) {
        afficherToast(expliquerErreurBiometrie(error))
    }
}

async function desactiverBiometrie() {
    try {
        await invoke('desactiver_biometrie')
        await mettreAJourBiometrie()
        afficherToast('Biometrie desactivee.')
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
    document.getElementById('generator-output').textContent = 'Pret'
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
        feedback.textContent = 'Mot de passe maitre change.'
        afficherToast('Mot de passe maitre mis a jour.')
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
            afficherToast('Coffre protege.')
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
    document.getElementById('entry-count').textContent = `${total} acces`
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

function getVisibleEntries(nom) {
    const query = normaliser(searchQuery)
    const sourceCategories = query ? Object.keys(categories) : [nom]
    const results = []

    sourceCategories.forEach(function(category) {
        ;(categories[category] || []).forEach(function(entry, index) {
            const searchable = normaliser(`${category} ${entry.plateforme} ${entry.email} ${entry.mdp}`)
            if (!query || searchable.includes(query)) {
                results.push({ category, entry, index })
            }
        })
    })

    return results
}

function afficherCategorie(nom) {
    const titre = document.querySelector('.page-header h2')
    const liste = document.getElementById('liste-mdp')
    const visibleEntries = getVisibleEntries(nom)

    titre.textContent = searchQuery ? 'Recherche' : nom
    liste.innerHTML = ''
    compterAcces(nom)

    document.querySelectorAll('.sidebar li').forEach(function(item) {
        item.classList.toggle('active', item.textContent === nom && !searchQuery)
    })

    visibleEntries.forEach(function(item) {
        const ligne = document.createElement('div')
        ligne.className = 'ligne entry-row'
        ligne.dataset.category = item.category
        ligne.dataset.index = String(item.index)
        ligne.innerHTML = `
            <label>
                <span>Service</span>
                <input class="entry-platforme" type="text" placeholder="Nom de la plateforme" value="${echapperHtml(item.entry.plateforme)}">
            </label>
            <label>
                <span>Identifiant</span>
                <span class="inline-field">
                    <input class="entry-email" type="text" placeholder="Adresse e-mail" value="${echapperHtml(item.entry.email)}">
                    <button class="mini-action copy-email" type="button" title="Copier l identifiant">Copier</button>
                </span>
            </label>
            <label>
                <span>Secret ${searchQuery ? `<small>${echapperHtml(item.category)}</small>` : ''}</span>
                <span class="secret-field">
                    <input class="entry-mdp" type="password" placeholder="Mot de passe" value="${echapperHtml(item.entry.mdp)}">
                    <button class="toggle-secret" type="button" aria-label="Afficher le secret" title="Afficher le secret">●</button>
                </span>
            </label>
            <div class="row-actions">
                <button class="btn-generer generate-entry" type="button">Generer</button>
                <button class="btn-secondary save-entry" type="button">Sauver</button>
                <button class="mini-action copy-password" type="button">Copier</button>
                <button class="btn-danger delete-entry" type="button">Suppr.</button>
            </div>
        `
        liste.appendChild(ligne)
    })

    document.getElementById('plateforme').value = ''
    document.getElementById('email').value = ''
    document.getElementById('mdp').value = ''
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
    copy.textContent = `Les acces de "${nom}" seront supprimes definitivement.`
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
        : 'Entrez le mot de passe utilise pour chiffrer cette sauvegarde.'
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
        afficherToast('Cet espace existe deja.')
        return
    }

    if (nouveauNom !== ancienNom) {
        await invoke('renommer_categorie', { ancienNom, nouveauNom })
        categories[nouveauNom] = categories[ancienNom] || []
        delete categories[ancienNom]
        if (categorieActive === ancienNom) categorieActive = nouveauNom

        reconstruireOnglets()
        afficherCategorie(categorieActive)
        afficherToast('Espace renomme.')
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
    afficherToast('Espace supprime.')
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
    document.getElementById('generator-output').textContent = 'Genere'
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

    if (!password) return { label: 'Force non mesuree', score: 0, level: 'empty' }
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
                    alerts.push(`${name}: secret deja utilise avec ${existing}`)
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

async function copierTexte(value, message) {
    if (!value) {
        afficherToast('Rien a copier.')
        return
    }

    if (navigator.clipboard?.writeText) {
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

    afficherToast(message)
}

async function modifierAcces(ligne) {
    const category = ligne.dataset.category
    const index = Number(ligne.dataset.index)
    const plateforme = ligne.querySelector('.entry-platforme').value.trim()
    const email = ligne.querySelector('.entry-email').value.trim()
    const mdp = ligne.querySelector('.entry-mdp').value.trim()

    await invoke('modifier', { categorie: category, index, plateforme, email, mdp })
    categories[category][index] = { plateforme, email, mdp }
    afficherCategorie(categorieActive)
    afficherToast('Acces mis a jour.')
}

async function supprimerAcces(ligne) {
    const category = ligne.dataset.category
    const index = Number(ligne.dataset.index)
    const data = await invoke('supprimer_acces', { categorie: category, index })

    remplacerCategories(data)
    afficherCategorie(categorieActive)
    afficherToast('Acces supprime.')
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
    afficherToast('Sauvegarde exportee.')
}

async function importerCoffre(password) {
    const data = await invoke('importer', { password, backupJson: pendingImportText })

    remplacerCategories(data)
    afficherCategorie(categorieActive)
    afficherToast('Sauvegarde importee.')
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

document.querySelector('.entry-panel .btn-ajouter').addEventListener('click', async function() {
    const plateforme = document.getElementById('plateforme').value.trim()
    const email = document.getElementById('email').value.trim()
    const mdp = document.getElementById('mdp').value.trim()

    if (!plateforme && !email && !mdp) {
        afficherToast('Ajoutez au moins une information.')
        return
    }

    await invoke('ajouter', { plateforme, email, mdp, categorie: categorieActive })
    categories[categorieActive].push({ plateforme, email, mdp })
    afficherCategorie(categorieActive)
    afficherToast('Acces enregistre.')
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
    afficherToast('Espace cree.')
})

document.getElementById('liste-mdp').addEventListener('click', function(e) {
    const ligne = e.target.closest('.entry-row')
    if (!ligne) return

    if (e.target.closest('.generate-entry')) {
        afficherGenerateur()
        genererMotDePasseDans(ligne.querySelector('.entry-mdp'))
    }

    if (e.target.closest('.save-entry')) {
        modifierAcces(ligne).catch(function(error) {
            afficherToast(String(error))
        })
    }

    if (e.target.closest('.delete-entry')) {
        supprimerAcces(ligne).catch(function(error) {
            afficherToast(String(error))
        })
    }

    if (e.target.closest('.copy-email')) {
        copierTexte(ligne.querySelector('.entry-email').value, 'Identifiant copie.')
    }

    if (e.target.closest('.copy-password')) {
        copierTexte(ligne.querySelector('.entry-mdp').value, 'Secret copie.')
    }
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
document.getElementById('settings-lock-now').addEventListener('click', function() {
    verrouillerApplication(true)
})
document.getElementById('toggle-toolbar-lock').addEventListener('change', function(event) {
    showToolbarLock = event.target.checked
    appliquerPreferenceVerrouillage()
})
document.getElementById('auto-lock-delay').addEventListener('change', appliquerDelaiVerrouillage)
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
    gererRaccourciVerrouillage(e)
    if (e.defaultPrevented) return

    if (e.key === 'Escape') {
        fermerMenuContextuel()
        fermerModaleSuppression()
        fermerModaleBackup()
        fermerParametres()
    }
})

;['click', 'keydown', 'input', 'mousemove'].forEach(function(eventName) {
    document.addEventListener(eventName, reprogrammerVerrouillageAuto, { passive: true })
})

initialiserAuth().catch(function(error) {
    afficherToast(String(error))
})
appliquerPreferenceVerrouillage()
mettreAJourAffichageRaccourci()
mettreAJourBiometrie().catch(function() {})
