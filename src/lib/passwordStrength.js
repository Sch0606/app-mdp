import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common'
import * as zxcvbnFrPackage from '@zxcvbn-ts/language-fr'

const STALE_WINDOW_SECONDS = 90 * 24 * 60 * 60

const zxcvbn = new ZxcvbnFactory({
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnFrPackage.dictionary,
  },
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  translations: zxcvbnFrPackage.translations,
})

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
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

/**
 * Hôte normalisé d’un site, aligné sur `normalized_host` (autofill.rs) :
 * schéma https:// implicite, minuscules, sans point final ni `www.`.
 */
export function normalizeDomain(value = '') {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    const host = url.hostname.replace(/\.$/, '').toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

function duplicateIdentity(entry) {
  const domain = normalizeDomain(entry.site)
  const username = String(entry.email || '').trim().toLowerCase()
  return domain && username ? `${domain}\n${username}` : ''
}

/** Clé stable d’une paire : indépendante de l’ordre et des index (qui bougent). */
export function duplicatePairKey(first, second) {
  const identity = duplicateIdentity(first)
  const marks = [first, second]
    .map((entry) => `${entry.category}\u0000${Number(entry.created_at || 0)}\u0000${entry.plateforme || ''}`)
    .sort()
  return [identity, ...marks].join('\u0001')
}

/**
 * Paires d’entrées au même domaine normalisé et au même identifiant,
 * toutes catégories confondues. `dismissed` contient les clés de paires
 * marquées « pas des doublons ».
 */
export function findDuplicateEntries(entries, dismissed = new Set()) {
  const groups = new Map()
  entries.forEach((entry) => {
    const identity = duplicateIdentity(entry)
    if (!identity) return
    if (!groups.has(identity)) groups.set(identity, [])
    groups.get(identity).push(entry)
  })

  const pairs = []
  groups.forEach((group, identity) => {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const key = duplicatePairKey(group[i], group[j])
        if (dismissed.has(key)) continue
        // La plus récemment modifiée en premier : c’est elle que la fusion conserve.
        const [keep, drop] = Number(group[j].updated_at || 0) > Number(group[i].updated_at || 0)
          ? [group[j], group[i]]
          : [group[i], group[j]]
        pairs.push({ key, domain: identity.split('\n')[0], keep, drop })
      }
    }
  })
  return pairs
}
