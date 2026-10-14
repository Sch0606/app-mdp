import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterEntries,
  generateSecurePassword,
  normalizeSiteUrl,
  normalizeText,
  normalizeTotpSecret,
  siteIconFallback,
} from '../../src/lib/security.js'
import { auditEntries, passwordStrength } from '../../src/lib/passwordStrength.js'

function deterministicCrypto(values) {
  let offset = 0
  return {
    getRandomValues(buffer) {
      for (let index = 0; index < buffer.length; index += 1) {
        buffer[index] = values[offset % values.length]
        offset += 1
      }
      return buffer
    },
  }
}

test('normalizeText retire les accents et normalise la casse', () => {
  assert.equal(normalizeText('  SÉCURITÉ Clavé  '), 'securite clave')
})

test('normalizeSiteUrl accepte les formats courants sans schema', () => {
  assert.equal(normalizeSiteUrl(' google.com '), 'https://google.com')
  assert.equal(normalizeSiteUrl('www.exemple.fr/login'), 'https://www.exemple.fr/login')
  assert.equal(normalizeSiteUrl('google'), 'https://google.com')
  assert.equal(normalizeSiteUrl('localhost:5173'), 'https://localhost:5173')
  assert.equal(normalizeSiteUrl(''), '')
})

test('filterEntries cherche dans le service et l identifiant', () => {
  const entries = [
    { plateforme: 'Crédit Agricole', email: 'lea@example.fr', mdp: 'A' },
    { plateforme: 'GitHub', email: 'dev@work.fr', mdp: 'B' },
  ]

  assert.deepEqual(filterEntries(entries, 'credit', 'all'), [entries[0]])
  assert.deepEqual(filterEntries(entries, 'WORK', 'all'), [entries[1]])
})

test('filterEntries applique les filtres favoris et recents', () => {
  const now = 2_000_000
  const entries = [
    { plateforme: 'A', favorite: true, last_accessed: now - 100 },
    { plateforme: 'B', favorite: false, last_accessed: now - 900_000 },
  ]

  assert.deepEqual(filterEntries(entries, '', 'favorites', now), [entries[0]])
  assert.deepEqual(filterEntries(entries, '', 'recent', now), [entries[0]])
})

test('passwordStrength detecte les mots de passe previsibles', () => {
  assert.equal(passwordStrength('abc').level, 'weak')
  assert.equal(passwordStrength('Password123!').level, 'weak')
  assert.equal(passwordStrength('azertyuiop2026').level, 'weak')
  assert.match(passwordStrength('Password123!').suggestions.join(' '), /mot courant|prévisible|previsible/i)
})

test('passwordStrength classe les passphrases solides en tres fort', () => {
  const result = passwordStrength('fjord-cartable-lumineux-76-plafond', ['lea@example.fr', 'GitHub'])

  assert.equal(result.level, 'very-strong')
  assert.equal(result.label, 'Très fort')
  assert.ok(result.score >= 90)
})

test('auditEntries detecte les secrets faibles reutilises et anciens', () => {
  const now = 20_000_000
  const entries = [
    { plateforme: 'Alpha', mdp: 'abc', updated_at: now - 8_000_000 },
    { plateforme: 'Beta', mdp: 'abc', updated_at: now },
    { plateforme: 'Gamma', mdp: 'Long-secret-42!Unique', updated_at: now },
  ]

  const audit = auditEntries(entries, now)
  assert.equal(audit.weak, 2)
  assert.equal(audit.reused, 2)
  assert.equal(audit.stale, 1)
  assert.equal(audit.score, 26)
  assert.equal(audit.label, 'À renforcer')
  assert.equal(audit.averageStrength, 49)
})

test('auditEntries affiche un score robuste pour un coffre sain', () => {
  const now = 20_000_000
  const entries = [
    { plateforme: 'Alpha', mdp: 'fjord-cartable-lumineux-76-plafond', updated_at: now },
    { plateforme: 'Beta', mdp: 'verger-satellite-94-opaline-carnet', updated_at: now },
  ]

  const audit = auditEntries(entries, now)

  assert.equal(audit.weak, 0)
  assert.equal(audit.reused, 0)
  assert.ok(audit.score >= 90)
  assert.equal(audit.label, 'Très bon')
})

test('normalizeTotpSecret accepte une cle et une URI otpauth', () => {
  assert.equal(normalizeTotpSecret(' jbsw y3dp ehpk 3pxp== '), 'JBSWY3DPEHPK3PXP')
  assert.equal(
    normalizeTotpSecret('otpauth://totp/Clave:test?secret=jbswy3dpehpk3pxp&issuer=Clave'),
    'JBSWY3DPEHPK3PXP',
  )
})

test('siteIconFallback extrait un libelle court depuis le site ou le service', () => {
  assert.deepEqual(siteIconFallback('https://accounts.google.com/login', 'Google'), {
    iconUrl: '',
    source: 'fallback',
    fallbackLabel: 'GO',
  })
  assert.equal(siteIconFallback('', 'Banque principale').fallbackLabel, 'BP')
})

test('generateSecurePassword respecte la longueur et les familles demandees', () => {
  const password = generateSecurePassword(
    { length: 24, numbers: true, symbols: true, readable: false },
    deterministicCrypto([0, 1, 2, 3, 4, 5, 6, 7]),
  )

  assert.equal(password.length, 24)
  assert.match(password, /[a-z]/)
  assert.match(password, /[A-Z]/)
  assert.match(password, /\d/)
  assert.match(password, /[^a-zA-Z0-9]/)
})

test('generateSecurePassword exclut les caracteres ambigus en mode lisible', () => {
  const password = generateSecurePassword(
    { length: 32, numbers: true, symbols: false, readable: true },
    deterministicCrypto([0, 31, 63, 95, 127, 159, 191, 223]),
  )

  assert.equal(password.length, 32)
  assert.doesNotMatch(password, /[Il1O0o]/)
  assert.doesNotMatch(password, /[^a-zA-Z0-9]/)
})
