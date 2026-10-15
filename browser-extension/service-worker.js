import { buildCredentialCandidate, buildPendingCandidateModel, isCandidateFresh } from './autofill-core.js'

const API_BASE = 'http://127.0.0.1:32191/v1'
const PENDING_PREFIX = 'clavePending:'
const USERNAME_PREFIX = 'claveUsername:'

chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })

async function callApi(route, payload = {}) {
  const { pairingToken = '' } = await chrome.storage.local.get('pairingToken')
  if (!pairingToken) throw { code: 'not_paired', message: 'Appairez d’abord l’extension avec Clave.' }

  let response
  try {
    response = await fetch(`${API_BASE}/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clave-Token': pairingToken,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
  } catch (_) {
    throw { code: 'offline', message: 'Lancez l’application Clave pour continuer.' }
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw { code: data.code || 'request_failed', message: data.message || 'Clave ne peut pas répondre.' }
  return data
}

function pendingKey(sender) {
  const tabId = sender?.tab?.id
  if (!Number.isInteger(tabId)) throw { code: 'missing_tab', message: 'Onglet introuvable.' }
  return `${PENDING_PREFIX}${tabId}`
}

function usernameKey(sender) {
  return pendingKey(sender).replace(PENDING_PREFIX, USERNAME_PREFIX)
}

function canonicalOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.origin : null
  } catch (_) {
    return null
  }
}

// L’origine vient toujours de Chrome (expéditeur du message), jamais du contenu
// fourni par la page, et seules les pages HTTPS sont servies.
function senderOrigin(sender) {
  const origin = canonicalOrigin(sender?.origin || sender?.url || '')
  if (!origin) throw { code: 'insecure_origin', message: 'Clave ne remplit que les pages HTTPS.' }
  return origin
}

function withSenderOrigin(payload, sender) {
  return { ...(payload || {}), origin: senderOrigin(sender) }
}

async function clearPending(key) {
  await chrome.storage.session.remove(key)
}

async function readPending(key) {
  const stored = await chrome.storage.session.get(key)
  const candidate = stored[key]
  if (!isCandidateFresh(candidate)) {
    if (candidate) await clearPending(key)
    return null
  }
  return candidate
}

async function handleMessage(message, sender) {
  if (message.type === 'stage-username') {
    const origin = senderOrigin(sender)
    const username = String(message.payload?.username || '').trim()
    const createdAt = Number(message.payload?.createdAt)
    if (!origin || !username || !isCandidateFresh({ createdAt }, Date.now(), 300_000)) {
      throw { code: 'invalid_username', message: 'Identifiant temporaire invalide.' }
    }
    await chrome.storage.session.set({ [usernameKey(sender)]: { origin, username, createdAt } })
    return { staged: true }
  }

  if (message.type === 'stage-candidate') {
    const key = usernameKey(sender)
    const stored = await chrome.storage.session.get(key)
    const remembered = stored[key]
    const origin = senderOrigin(sender)
    const rememberedUsername = remembered
      && isCandidateFresh(remembered, Date.now(), 300_000)
      && remembered.origin === origin
      ? remembered.username
      : ''
    const candidate = buildCredentialCandidate(
      origin,
      message.payload?.username || rememberedUsername,
      message.payload?.password,
      message.payload?.createdAt,
    )
    if (!candidate || !isCandidateFresh(candidate)) {
      throw { code: 'invalid_candidate', message: 'Identifiants temporaires invalides.' }
    }
    await chrome.storage.session.set({ [pendingKey(sender)]: candidate })
    await chrome.storage.session.remove(key)
    return { staged: true }
  }

  if (message.type === 'pending-candidate') {
    const key = pendingKey(sender)
    const candidate = await readPending(key)
    if (!candidate) return { pending: false }
    let action
    try {
      ;({ action } = await callApi('candidate-status', candidate))
    } catch (error) {
      if (error?.code !== 'locked') throw error
      return {
        pending: true,
        candidate: { ...buildPendingCandidateModel({ ...candidate, action: 'save' }), locked: true },
      }
    }
    if (action === 'saved') {
      await clearPending(key)
      return { pending: false }
    }
    return { pending: true, candidate: buildPendingCandidateModel({ ...candidate, action }) }
  }

  if (message.type === 'save-pending-candidate') {
    const key = pendingKey(sender)
    const candidate = await readPending(key)
    if (!candidate) throw { code: 'expired', message: 'La proposition a expiré.' }
    const result = await callApi('save-candidate', candidate)
    await clearPending(key)
    return result
  }

  if (message.type === 'dismiss-pending-candidate') {
    await clearPending(pendingKey(sender))
    return { dismissed: true }
  }

  if (['status', 'focus'].includes(message.type)) {
    return callApi(message.type, {})
  }

  if (['matches', 'credential'].includes(message.type)) {
    return callApi(message.type, withSenderOrigin(message.payload, sender))
  }

  throw { code: 'unknown_message', message: 'Action Clave inconnue.' }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const supported = [
    'status',
    'matches',
    'credential',
    'focus',
    'stage-username',
    'stage-candidate',
    'pending-candidate',
    'save-pending-candidate',
    'dismiss-pending-candidate',
  ]
  if (!supported.includes(message?.type)) return false

  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({
      ok: false,
      error: { code: error?.code || 'request_failed', message: error?.message || 'Clave ne peut pas répondre.' },
    }))
  return true
})
