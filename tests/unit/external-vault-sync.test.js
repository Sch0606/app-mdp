import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshVaultFromExternalChange } from '../../src/lib/externalVaultSync.js'

test('recharge le coffre déverrouillé après un enregistrement externe', async () => {
  const calls = []
  const categories = {
    Personnel: [{ nom: 'Epic Games', site: 'https://www.epicgames.com', identifiant: 'joueur' }],
  }

  const refreshed = await refreshVaultFromExternalChange({
    phase: 'unlocked',
    invoke: async (command) => {
      calls.push(['invoke', command])
      return categories
    },
    dispatch: (action) => calls.push(['dispatch', action]),
  })

  assert.equal(refreshed, true)
  assert.deepEqual(calls, [
    ['invoke', 'charger'],
    ['dispatch', { type: 'load', categories }],
  ])
})

test('ne tente pas de recharger un coffre verrouillé', async () => {
  let invoked = false
  let dispatched = false

  const refreshed = await refreshVaultFromExternalChange({
    phase: 'locked',
    invoke: async () => {
      invoked = true
      return {}
    },
    dispatch: () => { dispatched = true },
  })

  assert.equal(refreshed, false)
  assert.equal(invoked, false)
  assert.equal(dispatched, false)
})
