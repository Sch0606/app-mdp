// Déchiffre l'accès partagé dans le navigateur. La clé vient du fragment de l'URL
// et n'est jamais envoyée au serveur.

const NONCE_LENGTH = 12
const KEY_LENGTH = 32

export function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export async function decryptPayload(ciphertext, keyText) {
  const keyBytes = base64UrlToBytes(keyText)
  if (keyBytes.length !== KEY_LENGTH) throw new Error('Clé invalide.')
  const data = base64UrlToBytes(ciphertext)
  if (data.length <= NONCE_LENGTH) throw new Error('Contenu invalide.')
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.slice(0, NONCE_LENGTH) },
    key,
    data.slice(NONCE_LENGTH),
  )
  const payload = JSON.parse(new TextDecoder().decode(plaintext))
  if (payload?.v !== 1) throw new Error('Version non prise en charge.')
  return payload
}

const FIELDS = [
  ['username', 'Identifiant', 'code'],
  ['password', 'Mot de passe', 'secret'],
  ['url', 'Site', 'code'],
  ['notes', 'Notes', 'pre'],
]

function actionButton(label, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', () => onClick(button))
  return button
}

function renderSecret(payload) {
  document.getElementById('secret-title').textContent = payload.title || 'Accès partagé'
  const list = document.getElementById('secret-fields')
  list.replaceChildren()
  for (const [name, label, kind] of FIELDS) {
    const value = payload[name]
    if (!value) continue
    const term = document.createElement('dt')
    term.textContent = label
    const detail = document.createElement('dd')
    const text = document.createElement(kind === 'pre' ? 'pre' : 'code')
    const actions = document.createElement('div')
    actions.className = 'field-actions'

    if (kind === 'secret') {
      // Masqué par défaut : le destinataire peut être dans un lieu public.
      let visible = false
      const render = () => {
        text.textContent = visible ? value : '•'.repeat(Math.min(value.length, 16))
        text.classList.toggle('masked', !visible)
      }
      render()
      actions.append(actionButton('Afficher', (button) => {
        visible = !visible
        render()
        button.textContent = visible ? 'Masquer' : 'Afficher'
      }))
    } else {
      text.textContent = value
    }

    actions.append(actionButton('Copier', async (button) => {
      try {
        await navigator.clipboard.writeText(value)
        button.textContent = 'Copié'
        button.classList.add('done')
      } catch (_) {
        button.textContent = 'Échec'
      }
      setTimeout(() => {
        button.textContent = 'Copier'
        button.classList.remove('done')
      }, 1600)
    }))
    detail.append(text, actions)
    list.append(term, detail)
  }
  document.getElementById('intro').hidden = true
  document.getElementById('secret').hidden = false
}

function fail(message) {
  document.getElementById('intro').hidden = true
  document.getElementById('secret').hidden = true
  document.getElementById('failure').hidden = false
  document.getElementById('failure-message').textContent = message
}

function start() {
  const key = location.hash.slice(1)
  const id = location.pathname.split('/').pop()
  // Retire la clé de la barre d'adresse et de l'historique dès le chargement.
  history.replaceState(null, '', location.pathname)
  if (!key) {
    fail('Le lien est incomplet : la clé de déchiffrement (après le #) est absente.')
    return
  }
  const button = document.getElementById('reveal')
  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = 'Déchiffrement…'
    try {
      const response = await fetch(`/api/secrets/${encodeURIComponent(id)}/reveal`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        fail(body.error || 'Ce lien a déjà été consulté ou a expiré.')
        return
      }
      renderSecret(await decryptPayload(body.ciphertext, key))
    } catch (_) {
      fail('Le contenu n’a pas pu être déchiffré. Le lien est peut-être incomplet ou altéré.')
    }
  }, { once: true })
}

if (typeof document !== 'undefined') start()
