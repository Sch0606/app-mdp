// Serveur de partage Clave : stocke des secrets déjà chiffrés et les détruit après lecture.
//
// Le serveur ne voit jamais la clé : elle reste dans le fragment (#…) du lien, que les
// navigateurs n'envoient pas. Il ne conserve qu'un texte chiffré opaque, en mémoire.
//
// Limite : la page /s/<id> et viewer.js sont servis par ce même serveur. Un serveur
// compromis pourrait les modifier pour lire le fragment et exfiltrer la clé. Cette page
// ne protège donc que contre un serveur passif ; voir offline/dechiffreur-clave.html.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const MIN_TTL_SECONDS = 5 * 60
export const MAX_TTL_SECONDS = 7 * 24 * 60 * 60
export const MAX_CIPHERTEXT_LENGTH = 48 * 1024
const MAX_BODY_BYTES = 64 * 1024
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
const CIPHERTEXT_PATTERN = /^[A-Za-z0-9_-]+$/
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public')

const STATIC_FILES = {
  '/viewer.js': ['viewer.js', 'text/javascript; charset=utf-8'],
  '/viewer.css': ['viewer.css', 'text/css; charset=utf-8'],
}

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

/** Stockage en mémoire : un secret disparaît à la première lecture ou à son expiration. */
export function createSecretStore({ now = Date.now } = {}) {
  const secrets = new Map()

  return {
    put(ciphertext, ttlSeconds) {
      const id = randomBytes(16).toString('base64url')
      const expiresAt = now() + ttlSeconds * 1000
      secrets.set(id, { ciphertext, expiresAt })
      return { id, expiresAt }
    },
    take(id) {
      const secret = secrets.get(id)
      secrets.delete(id)
      if (!secret || secret.expiresAt <= now()) return null
      return secret.ciphertext
    },
    sweep() {
      const current = now()
      for (const [id, secret] of secrets) {
        if (secret.expiresAt <= current) secrets.delete(id)
      }
    },
    get size() {
      return secrets.size
    },
  }
}

/** Limite simple par adresse IP sur une fenêtre glissante. */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map()
  return {
    allow(key) {
      const current = now()
      const recent = (hits.get(key) || []).filter((time) => current - time < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(current)
      hits.set(key, recent)
      return true
    },
    sweep() {
      const current = now()
      for (const [key, times] of hits) {
        if (!times.some((time) => current - time < windowMs)) hits.delete(key)
      }
    },
  }
}

export function validateCreation(body) {
  if (!body || typeof body !== 'object') return 'Requête invalide.'
  const { ciphertext, ttl } = body
  if (typeof ciphertext !== 'string' || !ciphertext || !CIPHERTEXT_PATTERN.test(ciphertext)) return 'Texte chiffré invalide.'
  if (ciphertext.length > MAX_CIPHERTEXT_LENGTH) return 'Secret trop volumineux.'
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) return 'Durée de validité invalide.'
  return ''
}

function send(response, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body)
  const payload = isJson ? JSON.stringify(body) : body
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...headers,
  })
  response.end(payload)
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Requête trop volumineuse.'), { status: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
      } catch (_) {
        reject(Object.assign(new Error('JSON invalide.'), { status: 400 }))
      }
    })
    request.on('error', reject)
  })
}

function clientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
    if (forwarded) return forwarded
  }
  return request.socket.remoteAddress || 'unknown'
}

export function createShareServer({
  now = Date.now,
  trustProxy = false,
  createLimit = 30,
  revealLimit = 60,
  windowMs = 10 * 60 * 1000,
  sweepIntervalMs = 60 * 1000,
} = {}) {
  const store = createSecretStore({ now })
  const createLimiter = createRateLimiter({ limit: createLimit, windowMs, now })
  const revealLimiter = createRateLimiter({ limit: revealLimit, windowMs, now })
  const files = new Map()

  async function staticFile(name) {
    if (!files.has(name)) files.set(name, await readFile(join(PUBLIC_DIR, name)))
    return files.get(name)
  }

  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost')
      const address = clientAddress(request, trustProxy)

      if (request.method === 'POST' && pathname === '/api/secrets') {
        if (!createLimiter.allow(address)) return send(response, 429, { error: 'Trop de partages. Réessayez plus tard.' })
        if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) return send(response, 415, { error: 'JSON attendu.' })
        const body = await readJson(request)
        const problem = validateCreation(body)
        if (problem) return send(response, 400, { error: problem })
        const { id, expiresAt } = store.put(body.ciphertext, body.ttl)
        return send(response, 201, { id, expiresAt })
      }

      const reveal = pathname.match(/^\/api\/secrets\/([^/]+)\/reveal$/)
      if (request.method === 'POST' && reveal) {
        // Ouvert à toute origine : le déchiffreur hors ligne (offline/dechiffreur-clave.html),
        // indépendant de ce serveur, doit pouvoir récupérer le texte chiffré. La réponse ne
        // contient rien d’exploitable sans la clé, qui reste dans le fragment du lien.
        const cors = { 'Access-Control-Allow-Origin': '*' }
        if (!revealLimiter.allow(address)) return send(response, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }, cors)
        const ciphertext = ID_PATTERN.test(reveal[1]) ? store.take(reveal[1]) : null
        if (!ciphertext) return send(response, 404, { error: 'Ce lien a déjà été consulté ou a expiré.' }, cors)
        return send(response, 200, { ciphertext }, cors)
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        // La page ne consomme rien : un aperçu de lien (messagerie, antivirus) ne détruit pas le secret.
        if (/^\/s\/[A-Za-z0-9_-]{22}$/.test(pathname)) {
          return send(response, 200, await staticFile('viewer.html'), { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' })
        }
        if (STATIC_FILES[pathname]) {
          const [name, type] = STATIC_FILES[pathname]
          return send(response, 200, await staticFile(name), { 'Content-Type': type })
        }
        if (pathname === '/healthz') return send(response, 200, { ok: true })
      }

      return send(response, 404, { error: 'Introuvable.' })
    } catch (error) {
      if (!response.headersSent) send(response, error.status || 500, { error: error.status ? error.message : 'Erreur interne.' })
    }
  })

  const sweeper = setInterval(() => {
    store.sweep()
    createLimiter.sweep()
    revealLimiter.sweep()
  }, sweepIntervalMs)
  sweeper.unref()
  server.on('close', () => clearInterval(sweeper))

  return { server, store }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787)
  const host = process.env.HOST || '127.0.0.1'
  const { server } = createShareServer({ trustProxy: process.env.TRUST_PROXY === '1' })
  server.listen(port, host, () => {
    console.log(`Serveur de partage Clave sur http://${host}:${port}`)
  })
}
