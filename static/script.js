const categories = { 'Perso': [] }
let categorieActive = 'Perso'
let toastTimer
let categorieARenommer = null

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
    const libelle = total > 1 ? 'accès' : 'accès'
    document.getElementById('entry-count').textContent = `${total} ${libelle}`
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
            <input type="text" placeholder="Nom de la plateforme" value="${entry.plateforme}">
            <input type="text" placeholder="Adresse e-mail" value="${entry.email}">
            <span class="secret-field">
                <input type="password" placeholder="Mot de passe" value="${entry.mdp}">
                <button class="toggle-secret" type="button" aria-label="Afficher le secret" title="Afficher le secret">
                    <span class="eye-open">◐</span>
                </button>
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

function fermerModaleRenommage() {
    const modal = document.getElementById('rename-modal')

    modal.classList.remove('visible')
    modal.setAttribute('aria-hidden', 'true')
    categorieARenommer = null
}

function renommerCategorie() {
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

        fetch('/renommer-categorie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ancienNom, nouveauNom })
        })

        afficherCategorie(categorieActive)
        afficherToast('Espace renommé.')
    }

    fermerModaleRenommage()
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

function genererMotDePasseDans(input) {
    fetch('/generer')
        .then(response => response.json())
        .then(data => {
            input.value = data.mdp
        afficherToast('Secret généré.')
        })
}

fetch('/charger')
    .then(response => response.json())
    .then(data => {
        Object.keys(data).forEach(function(cat) {
            categories[cat] = data[cat]
            if (cat !== 'Perso') {
                creerOngletCategorie(cat)
            }
        })
        afficherCategorie(categorieActive)
    })

document.querySelector('.btn-ajouter').addEventListener('click', function() {
    const plateforme = document.getElementById('plateforme').value.trim()
    const email = document.getElementById('email').value.trim()
    const mdp = document.getElementById('mdp').value.trim()

    if (!plateforme && !email && !mdp) {
        afficherToast('Ajoutez au moins une information.')
        return
    }

    fetch('/ajouter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateforme, email, mdp, categorie: categorieActive })
    })

    categories[categorieActive].push({ plateforme, email, mdp })
    afficherCategorie(categorieActive)
    afficherToast('Accès enregistré.')
})

document.getElementById('generer').addEventListener('click', function() {
    genererMotDePasseDans(document.getElementById('mdp'))
})

document.getElementById('add-categorie').addEventListener('click', function() {
    const nomCategorie = creerNomCategorie()

    creerOngletCategorie(nomCategorie)
    categories[nomCategorie] = []
    categorieActive = nomCategorie
    afficherCategorie(categorieActive)
    afficherToast('Espace créé.')

    fetch('/ajouter-categorie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categorie: nomCategorie })
    })
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
    }
})

document.getElementById('confirm-rename').addEventListener('click', renommerCategorie)
document.getElementById('cancel-rename').addEventListener('click', fermerModaleRenommage)

document.getElementById('rename-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') renommerCategorie()
    if (e.key === 'Escape') fermerModaleRenommage()
})

document.getElementById('rename-modal').addEventListener('click', function(e) {
    if (e.target.id === 'rename-modal') fermerModaleRenommage()
})
