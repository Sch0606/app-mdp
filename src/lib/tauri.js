import { check as checkUpdate } from '@tauri-apps/plugin-updater'

function getTauri() {
  const api = window.__TAURI__
  if (!api?.core?.invoke) throw new Error('Clave doit être lancé depuis l’application de bureau.')
  return api
}

async function checkUpdater() {
  const api = getTauri()
  if (api.updater?.check) return api.updater.check()
  return checkUpdate()
}

export const tauri = {
  invoke(command, args) {
    return getTauri().core.invoke(command, args)
  },
  get clipboard() {
    return getTauri().clipboardManager
  },
  get updater() {
    return {
      check: checkUpdater,
    }
  },
  get process() {
    return getTauri().process
  },
  get app() {
    return getTauri().app
  },
}

function extractErrorText(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'object') {
    return extractErrorText(error.message)
      || extractErrorText(error.error)
      || extractErrorText(error.reason)
      || ''
  }
  return String(error)
}

function isNativeCancelError(message) {
  return /decryption failed/i.test(message)
    && /failed to decrypt data/i.test(message)
    && /HRESULT\(0xF+/i.test(message)
}

export function errorMessage(error, fallback = 'Une action n’a pas pu être terminée.') {
  const message = extractErrorText(error).trim()
  if (!message || isNativeCancelError(message)) return fallback
  return message
}
