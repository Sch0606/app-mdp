import assert from 'node:assert/strict'
import test from 'node:test'
import { displayHotkey, hotkeyFromEvent, isModifierOnly, isReservedHotkey } from '../../src/lib/hotkeys.js'

const key = (overrides) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '', code: '', ...overrides })

test('la touche physique est utilisée, même quand ⌥ ou ⇧ change le caractère', () => {
  assert.equal(hotkeyFromEvent(key({ altKey: true, metaKey: true, key: '¬', code: 'KeyL' })), 'Alt+Meta+L')
  assert.equal(hotkeyFromEvent(key({ ctrlKey: true, shiftKey: true, key: '!', code: 'Digit1' })), 'Ctrl+Shift+1')
  assert.equal(hotkeyFromEvent(key({ ctrlKey: true, key: 'l', code: 'KeyL' })), 'Ctrl+L')
  assert.equal(hotkeyFromEvent(key({ ctrlKey: true, key: 'F5', code: 'F5' })), 'Ctrl+F5')
})

test('les touches de modification seules ne forment pas un raccourci', () => {
  assert.ok(isModifierOnly(key({ key: 'Meta' })))
  assert.ok(!isModifierOnly(key({ key: 'l' })))
})

test('les raccourcis système de macOS sont refusés uniquement sur Mac', () => {
  assert.ok(isReservedHotkey('Meta+Q', true))
  assert.ok(!isReservedHotkey('Meta+Q', false))
  assert.ok(!isReservedHotkey('Shift+Meta+L', true))
})

test('affichage avec les symboles macOS ou les noms PC', () => {
  assert.equal(displayHotkey('Ctrl+Alt+Shift+Meta+L', true), '⌃⌥⇧⌘L')
  assert.equal(displayHotkey('Ctrl+Alt+Shift+Meta+L', false), 'Ctrl+Alt+Shift+Win+L')
  assert.equal(displayHotkey('Ctrl++', false), 'Ctrl++')
  assert.equal(displayHotkey('', true), '')
})
