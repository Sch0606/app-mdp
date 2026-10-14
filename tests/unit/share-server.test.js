import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'

import { createShareServer, createSecretStore, validateCreation, MAX_TTL_SECONDS } from '../../share-server/server.js'
import { decryptPayload } from '../../share-server/public/viewer.js'

async function withServer(options, run) {
  const { server } = createShareServer(options)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

test('un secret ne peut être révélé qu’une seule fois', async () => {
  await withServer({}, async (base) => {
    const created = await post(`${base}/api/secrets`, { ciphertext: 'abc_DEF-123', ttl: 3600 })
    assert.equal(created.status, 201)
    const { id } = await created.json()
    assert.match(id, /^[A-Za-z0-9_-]{22}$/)

    const first = await fetch(`${base}/api/secrets/${id}/reveal`, { method: 'POST' })
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), { ciphertext: 'abc_DEF-123' })

    const second = await fetch(`${base}/api/secrets/${id}/reveal`, { method: 'POST' })
    assert.equal(second.status, 404)
  })
})

test('ouvrir la page ne consomme pas le secret', async () => {
  await withServer({}, async (base) => {
    const { id } = await (await post(`${base}/api/secrets`, { ciphertext: 'abc', ttl: 3600 })).json()
    const page = await fetch(`${base}/s/${id}`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(page.headers.get('cache-control'), 'no-store')
    const reveal = await fetch(`${base}/api/secrets/${id}/reveal`, { method: 'POST' })
    assert.equal(reveal.status, 200)
  })
})

test('les secrets expirés sont refusés', () => {
  let now = 1_000_000
  const store = createSecretStore({ now: () => now })
  const { id } = store.put('abc', 300)
  now += 301_000
  assert.equal(store.take(id), null)
})

test('la validation refuse les durées et contenus invalides', () => {
  assert.equal(validateCreation({ ciphertext: 'abc', ttl: 3600 }), '')
  assert.ok(validateCreation({ ciphertext: 'abc', ttl: 60 }))
  assert.ok(validateCreation({ ciphertext: 'abc', ttl: MAX_TTL_SECONDS + 1 }))
  assert.ok(validateCreation({ ciphertext: 'a b', ttl: 3600 }))
  assert.ok(validateCreation({ ciphertext: 'a'.repeat(50_000), ttl: 3600 }))
})

test('la création est limitée par adresse', async () => {
  await withServer({ createLimit: 2 }, async (base) => {
    for (let i = 0; i < 2; i += 1) assert.equal((await post(`${base}/api/secrets`, { ciphertext: 'abc', ttl: 3600 })).status, 201)
    assert.equal((await post(`${base}/api/secrets`, { ciphertext: 'abc', ttl: 3600 })).status, 429)
  })
})

test('la page de consultation déchiffre le format produit par Clave', async () => {
  const toB64Url = (bytes) => Buffer.from(bytes).toString('base64url')
  const key = webcrypto.getRandomValues(new Uint8Array(32))
  const nonce = webcrypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const payload = { v: 1, title: 'GitHub', password: 's3cret!' }
  const encrypted = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, new TextEncoder().encode(JSON.stringify(payload))))
  const blob = new Uint8Array([...nonce, ...encrypted])

  assert.deepEqual(await decryptPayload(toB64Url(blob), toB64Url(key)), payload)
  const wrongKey = toB64Url(webcrypto.getRandomValues(new Uint8Array(32)))
  await assert.rejects(decryptPayload(toB64Url(blob), wrongKey))
})
