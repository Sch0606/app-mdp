import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common'
import * as zxcvbnFrPackage from '@zxcvbn-ts/language-fr'

const RECENT_WINDOW_SECONDS = 7 * 24 * 60 * 60
const STALE_WINDOW_SECONDS = 90 * 24 * 60 * 60
const PASSWORD_GROUPS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  numbers: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
}

const zxcvbn = new ZxcvbnFactory({
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnFrPackage.dictionary,
  },
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  translations: zxcvbnFrPackage.translations,
})

function randomIndex(max, cryptoApi) {
  const limit = Math.floor(0x100000000 / max) * max
  const value = new Uint32Array(1)
  do cryptoApi.getRandomValues(value)
  while (value[0] >= limit)
  return value[0] % max
}

export function generateSecurePassword(options = {}, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random generation is unavailable.')

  const length = Math.min(64, Math.max(8, Number(options.length) || 20))
  const groups = [PASSWORD_GROUPS.lower, PASSWORD_GROUPS.upper]
  if (options.numbers !== false) groups.push(PASSWORD_GROUPS.numbers)
  if (options.symbols !== false) groups.push(PASSWORD_GROUPS.symbols)

  const sanitize = (characters) => options.readable
    ? characters.replace(/[Il1O0o]/g, '')
    : characters
  const activeGroups = groups.map(sanitize).filter(Boolean)
  const pool = activeGroups.join('')
  const password = activeGroups.map((group) => group[randomIndex(group.length, cryptoApi)])

  while (password.length < length) password.push(pool[randomIndex(pool.length, cryptoApi)])
  for (let index = password.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, cryptoApi)
    ;[password[index], password[target]] = [password[target], password[index]]
  }
  return password.join('')
}

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export function normalizeSiteUrl(value = '') {
  const raw = String(value).trim()
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '')
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(compact)
  const hostCandidate = hasScheme ? compact : compact.split(/[/?#]/, 1)[0]
  const host = hostCandidate.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const shouldAddCommonTld = !hasScheme
    && /^[a-z0-9-]{2,}$/i.test(host)
    && !host.includes('.')
    && !host.includes(':')
    && host.toLowerCase() !== 'localhost'
  const candidate = hasScheme
    ? compact
    : `https://${shouldAddCommonTld ? compact.replace(host, `${host}.com`) : compact}`

  try {
    const url = new URL(candidate)
    if (!/^https?:$/i.test(url.protocol)) return ''
    return url.href.replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

function localPasswordWarnings(value) {
  const normalized = normalizeText(value)
  const warnings = []
  if (/^(password|motdepasse|azerty|qwerty|admin|welcome|bonjour|iloveyou)/i.test(value)) {
    warnings.push('Évitez les mots courants ou prévisibles.')
  }
  if (/(0123|1234|2345|3456|abcd|bcde|azerty|qwerty|asdf)/i.test(value)) {
    warnings.push('Évitez les suites évidentes et les motifs de clavier.')
  }
  if (/(.)\1{2,}/.test(value)) {
    warnings.push('Évitez les répétitions de caractères.')
  }
  if (/(19|20)\d{2}|[0-3]?\d[/-][01]?\d[/-]\d{2,4}/.test(value)) {
    warnings.push('Évitez les dates faciles à deviner.')
  }
  if (normalized.includes('clave')) {
    warnings.push('Évitez les mots liés à l’application ou au service.')
  }
  return warnings
}

function strengthLabel(score, password) {
  if (!password) return { level: 'weak', label: 'Faible', percent: 0 }
  if (score >= 4) return { level: 'very-strong', label: 'Très fort', percent: 100 }
  if (score === 3) return { level: 'strong', label: 'Fort', percent: 78 }
  if (score === 2) return { level: 'medium', label: 'Moyen', percent: 55 }
  return { level: 'weak', label: 'Faible', percent: 24 }
}

export function passwordStrength(password = '', userInputs = []) {
  const value = String(password)
  const inputs = Array.isArray(userInputs) ? userInputs.filter(Boolean).map(String) : []
  const estimate = value ? zxcvbn.check(value, inputs) : { score: 0, feedback: {} }
  const localWarnings = localPasswordWarnings(value)
  const adjustedScore = localWarnings.length && estimate.score > 1
    ? Math.max(1, estimate.score - 1)
    : estimate.score
  const mapped = strengthLabel(adjustedScore, value)
  const suggestions = [
    estimate.feedback?.warning,
    ...(estimate.feedback?.suggestions || []),
    ...localWarnings,
  ].filter(Boolean)

  if (!suggestions.length && adjustedScore < 4) {
    suggestions.push('Ajoutez quelques mots sans lien entre eux ou augmentez la longueur.')
  }

  return {
    level: mapped.level,
    label: mapped.label,
    score: mapped.percent,
    guesses: estimate.guesses,
    suggestions,
  }
}

export function normalizeTotpSecret(value = '') {
  const raw = String(value).trim()
  if (!raw) return ''
  let secret = raw
  if (/^otpauth:\/\//i.test(raw)) {
    try {
      secret = new URL(raw).searchParams.get('secret') || ''
    } catch (_) {
      secret = ''
    }
  }
  return secret.toUpperCase().replace(/[\s=]/g, '')
}

export function siteIconFallback(site = '', service = '') {
  let source = service
  try {
    const normalizedSite = normalizeSiteUrl(site)
    source = service || new URL(normalizedSite || String(site)).hostname
      .replace(/^www\./, '')
      .split('.')[0] || service
  } catch (_) {
    source = service
  }

  const words = normalizeText(source || service)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const fallbackLabel = words.length > 1
    ? words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
    : (words[0] || '??').slice(0, 2).toUpperCase()

  return { iconUrl: '', source: 'fallback', fallbackLabel }
}

export function filterEntries(entries, query = '', filter = 'all', now = Math.floor(Date.now() / 1000)) {
  const normalizedQuery = normalizeText(query)

  return entries.filter((entry) => {
    const searchable = normalizeText(`${entry.plateforme || ''} ${entry.email || ''} ${entry.site || ''}`)
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return false
    if (filter === 'favorites') return Boolean(entry.favorite)
    if (filter === 'recent') return Number(entry.last_accessed || entry.last_used_at || 0) >= now - RECENT_WINDOW_SECONDS
    return true
  })
}

export function auditEntries(entries, now = Math.floor(Date.now() / 1000)) {
  const passwordCounts = new Map()
  entries.forEach((entry) => {
    const password = String(entry.mdp || '')
    if (password) passwordCounts.set(password, (passwordCounts.get(password) || 0) + 1)
  })

  const strengths = entries.map((entry) => passwordStrength(entry.mdp, [entry.plateforme, entry.email, entry.site]))
  const weak = strengths.filter((strength) => strength.level === 'weak').length
  const reused = entries.filter((entry) => (passwordCounts.get(String(entry.mdp || '')) || 0) > 1).length
  const stale = entries.filter((entry) => {
    const updatedAt = Number(entry.updated_at || 0)
    return updatedAt > 0 && updatedAt < now - STALE_WINDOW_SECONDS
  }).length
  const total = entries.length
  const averageStrength = total
    ? Math.round(strengths.reduce((sum, strength) => sum + strength.score, 0) / total)
    : 100
  const reusePenalty = total ? Math.round((reused / total) * 20) : 0
  const stalePenalty = total ? Math.round((stale / total) * 15) : 0
  const weakPenalty = total ? Math.round((weak / total) * 8) : 0
  const score = Math.max(0, Math.min(100, averageStrength - reusePenalty - stalePenalty - weakPenalty))
  const label = score >= 90 ? 'Très bon' : score >= 75 ? 'Bon' : score >= 50 ? 'Moyen' : 'À renforcer'

  return { weak, reused, stale, score, label, averageStrength, total }
}

export function allEntries(categories) {
  return Object.entries(categories).flatMap(([category, entries]) =>
    entries.map((entry, index) => ({ ...entry, category, index })),
  )
}
