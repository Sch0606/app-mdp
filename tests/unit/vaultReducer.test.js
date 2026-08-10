import test from 'node:test'
import assert from 'node:assert/strict'
import { initialVaultState, vaultReducer } from '../../src/state/vaultReducer.js'

test('charge les categories et conserve une categorie active valide', () => {
  const state = vaultReducer(initialVaultState, {
    type: 'load',
    categories: { Perso: [], Travail: [{ plateforme: 'GitHub' }] },
  })

  assert.equal(state.activeCategory, 'Perso')
  assert.equal(state.categories.Travail.length, 1)
})

test('revient a la premiere categorie si la categorie active disparait', () => {
  const selected = { ...initialVaultState, categories: { Perso: [], Travail: [] }, activeCategory: 'Travail' }
  const state = vaultReducer(selected, { type: 'load', categories: { Perso: [] } })

  assert.equal(state.activeCategory, 'Perso')
})

test('met a jour navigation recherche et filtre sans modifier les entrees', () => {
  const source = { ...initialVaultState, categories: { Perso: [{ plateforme: 'GitHub' }] } }
  const selected = vaultReducer(source, { type: 'select-category', category: 'Perso' })
  const searched = vaultReducer(selected, { type: 'set-query', query: 'git' })
  const filtered = vaultReducer(searched, { type: 'set-filter', filter: 'favorites' })
  const viewed = vaultReducer(filtered, { type: 'set-view', view: 'history' })

  assert.equal(viewed.query, 'git')
  assert.equal(viewed.filter, 'favorites')
  assert.equal(viewed.view, 'history')
  assert.equal(viewed.categories.Perso[0].plateforme, 'GitHub')
})

test('reset efface toutes les donnees sensibles en memoire', () => {
  const state = vaultReducer({
    categories: { Perso: [{ plateforme: 'GitHub', mdp: 'secret' }] },
    activeCategory: 'Perso',
    query: 'git',
    filter: 'favorites',
    view: 'trash',
  }, { type: 'reset' })

  assert.deepEqual(state, initialVaultState)
})
