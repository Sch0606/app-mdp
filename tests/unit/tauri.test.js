import test from 'node:test'
import assert from 'node:assert/strict'
import { errorMessage } from '../../src/lib/tauri.js'

test('errorMessage masque les erreurs natives Windows Hello annulees', () => {
  const raw = '[Decryption failed - failed to decrypt data: Error { code: HRESULT(0xFFFFFFFF), message: "" }]'

  assert.equal(errorMessage(raw, 'Authentification non confirmée.'), 'Authentification non confirmée.')
  assert.equal(errorMessage(new Error(raw), 'Authentification non confirmée.'), 'Authentification non confirmée.')
})

test('errorMessage extrait un message lisible depuis un objet erreur', () => {
  assert.equal(errorMessage({ message: 'Action annulée.' }), 'Action annulée.')
  assert.equal(errorMessage({ error: { message: 'Accès refusé.' } }), 'Accès refusé.')
})
