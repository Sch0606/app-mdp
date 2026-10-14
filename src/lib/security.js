const RECENT_WINDOW_SECONDS = 7 * 24 * 60 * 60
const PASSWORD_GROUPS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  numbers: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
}

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

const MAX_TAGS = 12
const MAX_TAG_LENGTH = 32

// Même normalisation que `normalize_tags` côté Rust.
export function normalizeTags(tags = []) {
  const normalized = []
  for (const tag of tags) {
    const value = Array.from(String(tag).trim().replace(/^#+/, '').split(/\s+/).filter(Boolean).join('-').toLowerCase())
      .slice(0, MAX_TAG_LENGTH)
      .join('')
    if (value && !normalized.includes(value)) normalized.push(value)
    if (normalized.length >= MAX_TAGS) break
  }
  return normalized
}

export function collectTags(entries) {
  const counts = new Map()
  entries.forEach((entry) => (entry.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)))
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'fr'))
    .map(([tag]) => tag)
}

export function filterEntries(entries, query = '', filter = 'all', now = Math.floor(Date.now() / 1000)) {
  const terms = String(query).trim().split(/\s+/).filter(Boolean)
  // `#banque` cherche une étiquette ; les autres mots cherchent dans le texte et les étiquettes.
  const tagTerms = terms.filter((term) => term.startsWith('#') && term.length > 1).map((term) => normalizeText(term.slice(1)))
  const normalizedQuery = normalizeText(terms.filter((term) => !term.startsWith('#')).join(' '))
  const tagFilter = filter.startsWith('tag:') ? filter.slice(4) : ''

  return entries.filter((entry) => {
    const tags = entry.tags || []
    const searchable = normalizeText(`${entry.plateforme || ''} ${entry.email || ''} ${entry.site || ''} ${tags.join(' ')}`)
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return false
    if (tagTerms.some((term) => !tags.some((tag) => normalizeText(tag).startsWith(term)))) return false
    if (tagFilter) return tags.includes(tagFilter)
    if (filter === 'favorites') return Boolean(entry.favorite)
    if (filter === 'recent') return Number(entry.last_accessed || entry.last_used_at || 0) >= now - RECENT_WINDOW_SECONDS
    return true
  })
}

export function allEntries(categories) {
  return Object.entries(categories).flatMap(([category, entries]) =>
    entries.map((entry, index) => ({ ...entry, category, index })),
  )
}
