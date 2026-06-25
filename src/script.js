const invoke = window.__TAURI__.core.invoke

const categories = { Perso: [] }
let categorieActive = 'Perso'
let toastTimer
let categorieARenommer = null
let categorieMenu = null
let categorieASupprimer = null

function afficherToast(message) {
    const toast = document.getElementById('toast')

    toast.textContent = message
    toast.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function() {
        toast.classList.remove('visible')
    }, 2400)
}

function compterAcces(nom) {
    const total = categories[nom]?.length || 0
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

function afficherCategorie(nom) {
    const titre = document.querySelector('.page-header h2')
    const liste = document.getElementById('liste-mdp')

    titre.textContent = nom
    liste.innerHTML = ''
    compterAcces(nom)

    document.querySelectorAll('.sidebar li').forEach(function(item) {
        item.classList.toggle('active', item.textContent === nom)
    })

    categories[nom].forEach(function(entry) {
        const ligne = document.createElement('div')
        ligne.className = 'ligne'
        ligne.innerHTML = `
            <input type="text" placeholder="Nom de la plateforme" value="${echapperHtml(entry.plateforme)}">
            <input type="text" placeholder="Adresse e-mail" value="${echapperHtml(entry.email)}">
            <span class="secret-field">
                <input type="password" placeholder="Mot de passe" value="${echapperHtml(entry.mdp)}">
                <button class="toggle-secret" type="button" aria-label="Afficher le secret" title="Afficher le secret">◐</button>
            </span>
            <button class="btn-generer" type="button">Générer</button>
        `
        liste.appendChild(ligne)
    })

    document.getElementById('plateforme').value = ''
    document.getElementById('email').value = ''
    document.getElementById('mdp').value = ''
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
    copy.textContent = `Les accès de "${nom}" seront supprimés définitivement.`
    modal.classList.add('visible')
    modal.setAttribute('aria-hidden', 'false')
}

function fermerModaleSuppression() {
    const modal = document.getElementById('delete-modal')

    modal.classList.remove('visible')
    modal.setAttribute('aria-hidden', 'true')
    categorieASupprimer = null
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
        categories[nouveauNom] = categories[ancienNom] || []
        delete categories[ancienNom]
        if (categorieActive === ancienNom) categorieActive = nouveauNom

        document.querySelectorAll('.sidebar li').forEach(function(item) {
            if (item.textContent === ancienNom) item.textContent = nouveauNom
        })

        await invoke('renommer_categorie', { ancienNom, nouveauNom })
        afficherCategorie(categorieActive)
        afficherToast('Espace renommé.')
    }

    fermerModaleRenommage()
}

async function supprimerCategorie() {
    const nom = categorieASupprimer
    if (!nom) return

    const data = await invoke('supprimer_categorie', { categorie: nom })
    Object.keys(categories).forEach(function(cat) {
        delete categories[cat]
    })
    Object.keys(data).forEach(function(cat) {
        categories[cat] = data[cat]
    })

    if (!categories[categorieActive]) {
        categorieActive = Object.keys(categories)[0] || 'Perso'
    }

    reconstruireOnglets()
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
    button.textContent = isHidden ? '◉' : '◐'
}

async function genererMotDePasseDans(input) {
    input.value = await invoke('generer')
    afficherToast('Secret généré.')
}

async function chargerCategories() {
    const data = await invoke('charger')
    Object.keys(data).forEach(function(cat) {
        categories[cat] = data[cat]
        if (cat !== 'Perso') {
            creerOngletCategorie(cat)
        }
    })
    afficherCategorie(categorieActive)
}

document.querySelector('.btn-ajouter').addEventListener('click', async function() {
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
    afficherToast('Accès enregistré.')
})

document.getElementById('generer').addEventListener('click', function() {
    genererMotDePasseDans(document.getElementById('mdp'))
})

document.getElementById('add-categorie').addEventListener('click', async function() {
    const nomCategorie = creerNomCategorie()

    creerOngletCategorie(nomCategorie)
    categories[nomCategorie] = []
    categorieActive = nomCategorie
    afficherCategorie(categorieActive)
    afficherToast('Espace créé.')

    await invoke('ajouter_categorie', { categorie: nomCategorie })
})

document.getElementById('liste-mdp').addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-generer')) {
        const ligne = e.target.closest('.ligne')
        const inputMdp = ligne.querySelector('.secret-field input')
        genererMotDePasseDans(inputMdp)
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

document.getElementById('confirm-rename').addEventListener('click', renommerCategorie)
document.getElementById('cancel-rename').addEventListener('click', fermerModaleRenommage)
document.getElementById('confirm-delete').addEventListener('click', supprimerCategorie)
document.getElementById('cancel-delete').addEventListener('click', fermerModaleSuppression)

document.getElementById('rename-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') renommerCategorie()
    if (e.key === 'Escape') fermerModaleRenommage()
})

document.getElementById('rename-modal').addEventListener('click', function(e) {
    if (e.target.id === 'rename-modal') fermerModaleRenommage()
})

document.getElementById('delete-modal').addEventListener('click', function(e) {
    if (e.target.id === 'delete-modal') fermerModaleSuppression()
})

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        fermerMenuContextuel()
        fermerModaleSuppression()
    }
})

chargerCategories().catch(function(error) {
    afficherToast(String(error))
})
