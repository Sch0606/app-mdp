// Raccourcis clavier : format stocké commun (« Ctrl+Alt+Shift+Meta+L ») et affichage
// adapté à la plateforme (⌃⌥⇧⌘ sur macOS).

export const isMac = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta']

// Raccourcis réservés par macOS (quitter, fermer, masquer, réduire, changer d'app…).
const MAC_RESERVED = new Set(['Meta+Q', 'Meta+W', 'Meta+H', 'Meta+M', 'Meta+Tab', 'Meta+ ', 'Alt+Meta+H', 'Alt+Meta+Escape'])

// La touche physique (event.code) plutôt que le caractère produit : sur macOS,
// ⌥L donne « ¬ » et ⇧1 donne « ! », ce qui rendrait le raccourci imprévisible.
function keyName(event) {
  const code = event.code || ''
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

export function isModifierOnly(event) {
  return MODIFIER_KEYS.includes(event.key)
}

export function hotkeyFromEvent(event) {
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
    keyName(event),
  ].filter(Boolean).join('+')
}

export function isReservedHotkey(value, mac = isMac) {
  return mac && MAC_RESERVED.has(value)
}

const MAC_SYMBOLS = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
const PC_NAMES = { Meta: 'Win' }

export function displayHotkey(value, mac = isMac) {
  if (!value) return ''
  const parts = value.split('+')
  // « Ctrl++ » : la touche est elle-même « + ».
  if (value.endsWith('++')) parts.splice(-2, 2, '+')
  const key = parts.pop()
  if (mac) return parts.map((part) => MAC_SYMBOLS[part] || part).join('') + key
  return [...parts.map((part) => PC_NAMES[part] || part), key].join('+')
}

// Préfixe des raccourcis d'action (⌘ sur macOS, Ctrl ailleurs).
export const modifierLabel = isMac ? '⌘' : 'Ctrl+'
