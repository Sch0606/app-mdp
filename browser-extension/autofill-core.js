function normalized(value) {
  return String(value || '').trim().toLowerCase()
}

function usernameScore(field) {
  if (!field.visible || !['text', 'email', 'tel', ''].includes(normalized(field.type))) return -1
  const autocomplete = normalized(field.autocomplete)
  const descriptor = normalized(`${field.name} ${field.id} ${field.placeholder}`)
  if (autocomplete === 'one-time-code' || autocomplete === 'new-password') return -1
  if (autocomplete === 'username' || autocomplete === 'email') return 100
  if (normalized(field.type) === 'email') return 80
  if (/user|login|email|e-mail|identifiant|compte/.test(descriptor)) return 60
  if (/search|recherche|filter|coupon|promo/.test(descriptor)) return -1
  return -1
}

function passwordScore(field) {
  if (!field.visible || normalized(field.type) !== 'password') return -1
  const autocomplete = normalized(field.autocomplete)
  if (autocomplete === 'new-password') return -1
  return autocomplete === 'current-password' ? 100 : 50
}

export function detectUsernameField(fields) {
  let bestIndex = -1
  let bestScore = -1
  fields.forEach((field, index) => {
    const score = usernameScore(field)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestIndex
}

export function detectLoginFields(fields) {
  let usernameIndex = -1
  let usernameBest = -1
  let passwordIndex = -1
  let passwordBest = -1

  fields.forEach((field, index) => {
    const nextPassword = passwordScore(field)
    if (nextPassword > passwordBest) {
      passwordBest = nextPassword
      passwordIndex = index
    }
    const nextUsername = usernameScore(field)
    if (nextUsername > usernameBest) {
      usernameBest = nextUsername
      usernameIndex = index
    }
  })

  if (passwordIndex < 0) return { usernameIndex: -1, passwordIndex: -1 }
  return { usernameIndex, passwordIndex }
}

function setInputValue(input, value, eventFactory) {
  if (!input) return
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  if (descriptor?.set) descriptor.set.call(input, value)
  else input.value = value
  input.dispatchEvent(eventFactory('input'))
  input.dispatchEvent(eventFactory('change'))
}

export function fillCredential(usernameField, passwordField, credential, eventFactory = (type) => new Event(type, { bubbles: true })) {
  if (usernameField && credential.username) setInputValue(usernameField, credential.username, eventFactory)
  setInputValue(passwordField, credential.password, eventFactory)
}

export function buildSuggestionModel(accounts) {
  const items = Array.isArray(accounts) ? accounts : []
  return {
    title: items.length > 1 ? 'Choisir un compte' : 'Compte disponible',
    countLabel: `${items.length} compte${items.length > 1 ? 's' : ''}`,
    items,
    selectedIndex: -1,
  }
}

export function suggestionAnchor(usernameField, passwordField) {
  return passwordField || usernameField
}

export function shouldOfferSuggestion(interaction, accounts) {
  return interaction === 'click' && Array.isArray(accounts) && accounts.length > 0
}

export function isLoginAction(control) {
  const tagName = normalized(control?.tagName)
  const type = normalized(control?.type)
  const role = normalized(control?.role)
  if ((tagName === 'button' || tagName === 'input') && type === 'submit') return true
  const interactive = tagName === 'button'
    || tagName === 'a'
    || role === 'button'
    || (tagName === 'input' && ['button', 'image'].includes(type))
  if (!interactive) return false
  const descriptor = normalized(`${control?.text} ${control?.ariaLabel} ${control?.id} ${control?.name}`)
  return /connect|connexion|sign[ -]?in|log[ -]?in|continue|continuer|suivant|next|anmelden|einloggen|entrar|iniciar sesi[oó]n|accedi|ログイン/.test(descriptor)
}

export function buildCredentialCandidate(url, username, password, createdAt = Date.now()) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (_) {
    return null
  }

  const cleanUsername = String(username || '').trim()
  const cleanPassword = String(password || '')
  if (parsed.protocol !== 'https:' || !cleanUsername || !cleanPassword) return null

  return {
    origin: parsed.origin,
    username: cleanUsername,
    password: cleanPassword,
    createdAt,
  }
}

export function isCandidateFresh(candidate, now = Date.now(), ttl = 120_000) {
  const createdAt = Number(candidate?.createdAt)
  return Number.isFinite(createdAt) && createdAt <= now && now - createdAt < ttl
}

export function buildPendingCandidateModel(candidate) {
  return {
    origin: candidate.origin,
    username: candidate.username,
    action: candidate.action,
  }
}

export function watchLoginCompletion({ hasVisibleLogin, onComplete, subscribe }) {
  let active = true
  let unsubscribe = () => {}
  const check = () => {
    if (!active || hasVisibleLogin()) return
    active = false
    unsubscribe()
    onComplete()
  }
  unsubscribe = subscribe(check) || (() => {})
  check()
  return () => {
    if (!active) return
    active = false
    unsubscribe()
  }
}
