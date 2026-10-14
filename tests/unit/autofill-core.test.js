import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCredentialCandidate,
  buildPendingCandidateModel,
  buildSuggestionModel,
  detectUsernameField,
  detectLoginFields,
  fillCredential,
  isCandidateFresh,
  isLoginAction,
  shouldOfferSuggestion,
  suggestionAnchor,
  watchLoginCompletion,
} from '../../browser-extension/autofill-core.js'

test('detectLoginFields préfère le champ username explicite et le mot de passe visible', () => {
  const fields = [
    { type: 'text', name: 'search', autocomplete: '', placeholder: 'Rechercher', visible: true },
    { type: 'email', name: 'email', autocomplete: 'username', placeholder: '', visible: true },
    { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: '', visible: true },
  ]

  assert.deepEqual(detectLoginFields(fields), { usernameIndex: 1, passwordIndex: 2 })
})

test('detectLoginFields ignore les champs cachés et les nouveaux mots de passe', () => {
  const fields = [
    { type: 'email', name: 'email', autocomplete: '', placeholder: '', visible: false },
    { type: 'password', name: 'new_password', autocomplete: 'new-password', placeholder: '', visible: true },
  ]

  assert.deepEqual(detectLoginFields(fields), { usernameIndex: -1, passwordIndex: -1 })
})

test('detectLoginFields ne prend jamais un champ texte ambigu pour un identifiant', () => {
  const fields = [
    { type: 'text', name: 'code', autocomplete: 'one-time-code', placeholder: 'Code', visible: true },
    { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: '', visible: true },
  ]

  assert.deepEqual(detectLoginFields(fields), { usernameIndex: -1, passwordIndex: 1 })
})

test('detectUsernameField reconnaît l’identifiant d’une connexion en plusieurs étapes', () => {
  const fields = [
    { type: 'email', name: 'email', autocomplete: 'username', placeholder: 'Adresse e-mail', visible: true },
    { type: 'text', name: 'code', autocomplete: 'one-time-code', placeholder: 'Code', visible: true },
  ]

  assert.equal(detectUsernameField(fields), 0)
})

test('isLoginAction reconnaît les boutons de connexion pilotés par JavaScript', () => {
  assert.equal(isLoginAction({ tagName: 'button', type: 'submit', text: '' }), true)
  assert.equal(isLoginAction({ tagName: 'button', type: 'button', text: 'Continuer' }), true)
  assert.equal(isLoginAction({ tagName: 'button', type: 'button', text: 'Afficher le mot de passe' }), false)
})

test('isLoginAction reconnaît les actions de connexion sans confondre les boutons annexes', () => {
  assert.equal(isLoginAction({ tagName: 'button', type: 'button', text: 'Anmelden' }), true)
  assert.equal(isLoginAction({ tagName: 'a', type: '', text: 'ログイン' }), true)
  assert.equal(isLoginAction({ tagName: 'div', role: 'button', type: '', text: 'Entrar' }), true)
  assert.equal(isLoginAction({ tagName: 'button', type: 'button', text: 'Afficher le mot de passe' }), false)
  assert.equal(isLoginAction({ tagName: 'button', type: 'button', text: 'Annuler' }), false)
  assert.equal(isLoginAction({ tagName: 'div', type: '', text: 'Continuer' }), false)
})

test('fillCredential remplit sans afficher le secret et émet input puis change', () => {
  const events = []
  const username = { value: '', dispatchEvent: (event) => events.push(`username:${event.type}`) }
  const password = { value: '', dispatchEvent: (event) => events.push(`password:${event.type}`) }

  fillCredential(username, password, { username: 'lea@example.fr', password: 'Secret-123!' }, (type) => ({ type }))

  assert.equal(username.value, 'lea@example.fr')
  assert.equal(password.value, 'Secret-123!')
  assert.deepEqual(events, ['username:input', 'username:change', 'password:input', 'password:change'])
})

test('buildSuggestionModel conserve tous les comptes sans en choisir un implicitement', () => {
  const accounts = [
    { category: 'Perso', index: 0, label: 'GitHub personnel', username: 'lea@example.fr' },
    { category: 'Travail', index: 2, label: 'GitHub travail', username: 'lea@work.fr' },
  ]

  assert.deepEqual(buildSuggestionModel(accounts), {
    title: 'Choisir un compte',
    countLabel: '2 comptes',
    items: accounts,
    selectedIndex: -1,
  })
})

test('suggestionAnchor place toujours la suggestion sous le mot de passe', () => {
  const username = { id: 'username' }
  const password = { id: 'password' }

  assert.equal(suggestionAnchor(username, password), password)
})

test('la suggestion est réservée au clic et exige au moins un compte enregistré', () => {
  assert.equal(shouldOfferSuggestion('click', [{ username: 'lea@example.fr' }]), true)
  assert.equal(shouldOfferSuggestion('focus', [{ username: 'lea@example.fr' }]), false)
  assert.equal(shouldOfferSuggestion('input', [{ username: 'lea@example.fr' }]), false)
  assert.equal(shouldOfferSuggestion('click', []), false)
  assert.equal(shouldOfferSuggestion('click', null), false)
})

test('buildCredentialCandidate ne capture que des identifiants complets sur HTTPS', () => {
  assert.deepEqual(
    buildCredentialCandidate('https://example.com/login', ' lea@example.fr ', 'Secret-123!', 1_000),
    { origin: 'https://example.com', username: 'lea@example.fr', password: 'Secret-123!', createdAt: 1_000 },
  )
  assert.equal(buildCredentialCandidate('http://example.com', 'lea@example.fr', 'Secret-123!', 1_000), null)
  assert.equal(buildCredentialCandidate('https://example.com', '', 'Secret-123!', 1_000), null)
})

test('isCandidateFresh expire le secret temporaire après deux minutes', () => {
  const candidate = { createdAt: 1_000 }

  assert.equal(isCandidateFresh(candidate, 120_999), true)
  assert.equal(isCandidateFresh(candidate, 121_001), false)
})

test('buildPendingCandidateModel ne transmet jamais le mot de passe à la page', () => {
  const model = buildPendingCandidateModel({
    origin: 'https://example.com',
    username: 'lea@example.fr',
    password: 'Secret-123!',
    action: 'update',
  })

  assert.deepEqual(model, {
    origin: 'https://example.com',
    username: 'lea@example.fr',
    action: 'update',
  })
  assert.equal('password' in model, false)
})

test('watchLoginCompletion attend la disparition du formulaire sur une SPA', () => {
  let hasLogin = true
  let observedChange
  let completed = 0
  let disconnected = 0

  watchLoginCompletion({
    hasVisibleLogin: () => hasLogin,
    onComplete: () => { completed += 1 },
    subscribe: (callback) => {
      observedChange = callback
      return () => { disconnected += 1 }
    },
  })

  assert.equal(completed, 0)
  hasLogin = false
  observedChange()
  assert.equal(completed, 1)
  assert.equal(disconnected, 1)
  observedChange()
  assert.equal(completed, 1)
})
