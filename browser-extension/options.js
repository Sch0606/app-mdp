const tokenInput = document.querySelector('#token')
const status = document.querySelector('#status')

chrome.storage.local.get('pairingToken').then(({ pairingToken = '' }) => {
  tokenInput.value = pairingToken
})

document.querySelector('#save').addEventListener('click', async () => {
  const pairingToken = tokenInput.value.trim()
  if (!pairingToken) {
    status.className = 'error'
    status.textContent = 'Collez le code affiché dans Clave.'
    return
  }
  await chrome.storage.local.set({ pairingToken })
  const response = await chrome.runtime.sendMessage({ type: 'status' })
  status.className = response?.ok ? 'success' : 'error'
  status.textContent = response?.ok ? 'Extension connectée à Clave.' : (response?.error?.message || 'Connexion impossible.')
})
