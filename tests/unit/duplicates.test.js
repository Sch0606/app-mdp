import test from 'node:test'
import assert from 'node:assert/strict'
import { duplicatePairKey, findDuplicateEntries, normalizeDomain, supportsTwoFactor } from '../../src/lib/passwordStrength.js'

test('la 2FA n’est recommandée que pour les services de l’annuaire', () => {
  const domains = new Set(['github.com', 'google.co.uk'])
  assert.equal(supportsTwoFactor('https://www.github.com/login', domains), true)
  assert.equal(supportsTwoFactor('gist.github.com', domains), true)
  assert.equal(supportsTwoFactor('accounts.google.co.uk', domains), true)
  assert.equal(supportsTwoFactor('forum.example.org', domains), false)
  assert.equal(supportsTwoFactor('notgithub.com', domains), false)
  assert.equal(supportsTwoFactor('', domains), false)
  assert.equal(supportsTwoFactor('github.com', new Set()), false)
})

const entry = (overrides) => ({ category: 'Perso', index: 0, plateforme: 'GitHub', email: 'moi@x.fr', site: '', created_at: 1, updated_at: 1, ...overrides })

test('normalizeDomain retire le schéma, www. et la casse', () => {
  assert.equal(normalizeDomain('https://www.GitHub.com/login'), 'github.com')
  assert.equal(normalizeDomain('www.github.com'), 'github.com')
  assert.equal(normalizeDomain('github.com.'), 'github.com')
  assert.equal(normalizeDomain('ftp://github.com'), '')
  assert.equal(normalizeDomain(''), '')
})

test('détecte un même compte importé avec des URL différentes, toutes catégories', () => {
  const chrome = entry({ category: 'Chrome', index: 0, site: 'https://github.com', updated_at: 10 })
  const edge = entry({ category: 'Edge', index: 3, site: 'www.github.com', email: ' Moi@X.fr ', updated_at: 20 })
  const pairs = findDuplicateEntries([chrome, edge])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].domain, 'github.com')
  assert.equal(pairs[0].keep, edge, 'la plus récente est conservée')
  assert.equal(pairs[0].drop, chrome)
})

test('ignore les identifiants différents, sous-domaines distincts et entrées incomplètes', () => {
  const pairs = findDuplicateEntries([
    entry({ site: 'github.com' }),
    entry({ site: 'github.com', email: 'autre@x.fr' }),
    entry({ site: 'gist.github.com' }),
    entry({ site: '', index: 4 }),
    entry({ site: 'github.com', email: '', index: 5 }),
  ])
  assert.equal(pairs.length, 0)
})

test('trois entrées identiques donnent trois paires', () => {
  const pairs = findDuplicateEntries([0, 1, 2].map((index) => entry({ index, site: 'github.com', created_at: index })))
  assert.equal(pairs.length, 3)
})

test('les paires écartées ne reviennent pas, même si les index changent', () => {
  const a = entry({ index: 0, site: 'github.com', created_at: 1 })
  const b = entry({ index: 1, site: 'github.com', created_at: 2 })
  const key = duplicatePairKey(a, b)
  assert.equal(key, duplicatePairKey(b, a))
  assert.equal(findDuplicateEntries([{ ...a, index: 7 }, { ...b, index: 2 }], new Set([key])).length, 0)
})
