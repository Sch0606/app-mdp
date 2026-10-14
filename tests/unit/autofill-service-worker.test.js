import test from 'node:test'
import assert from 'node:assert/strict'

const session = {}
let listener
let apiAction = 'save'

globalThis.chrome = {
  storage: {
    local: {
      async get() { return { pairingToken: 'paired-token' } },
    },
    session: {
      async setAccessLevel() {},
      async set(values) { Object.assign(session, values) },
      async get(key) { return { [key]: session[key] } },
      async remove(key) { delete session[key] },
    },
  },
  runtime: {
    onMessage: {
      addListener(callback) { listener = callback },
    },
  },
}

globalThis.fetch = async (url) => ({
  ok: true,
  async json() {
    return { action: url.endsWith('/candidate-status') ? apiAction : 'save' }
  },
})

await import('../../browser-extension/service-worker.js')

function send(message) {
  return new Promise((resolve, reject) => {
    const keptOpen = listener(message, { tab: { id: 42 } }, resolve)
    if (!keptOpen) reject(new Error('Le canal de réponse a été fermé.'))
  })
}

test('le service worker garde le secret en session mais ne le renvoie jamais à la page', async () => {
  const candidate = {
    origin: 'https://example.com',
    username: 'lea@example.fr',
    password: 'Secret-123!',
    createdAt: Date.now(),
  }

  assert.equal((await send({ type: 'stage-candidate', payload: candidate })).ok, true)
  const pending = await send({ type: 'pending-candidate' })

  assert.deepEqual(pending, {
    ok: true,
    data: {
      pending: true,
      candidate: {
        origin: 'https://example.com',
        username: 'lea@example.fr',
        action: 'save',
      },
    },
  })
  assert.equal(JSON.stringify(pending).includes('Secret-123!'), false)

  assert.equal((await send({ type: 'save-pending-candidate' })).ok, true)
  assert.deepEqual(await send({ type: 'pending-candidate' }), { ok: true, data: { pending: false } })
})

test('un compte déjà identique est supprimé de la file sans afficher de proposition', async () => {
  apiAction = 'saved'
  await send({
    type: 'stage-candidate',
    payload: {
      origin: 'https://example.com',
      username: 'lea@example.fr',
      password: 'Secret-123!',
      createdAt: Date.now(),
    },
  })

  assert.deepEqual(await send({ type: 'pending-candidate' }), { ok: true, data: { pending: false } })
  assert.equal(Object.keys(session).length, 0)
})

test('une connexion en plusieurs écrans réunit l’identifiant puis le mot de passe', async () => {
  apiAction = 'save'
  const createdAt = Date.now()

  assert.equal((await send({
    type: 'stage-username',
    payload: { origin: 'https://www.epicgames.com', username: 'lea@example.fr', createdAt },
  })).ok, true)
  assert.equal((await send({
    type: 'stage-candidate',
    payload: { origin: 'https://www.epicgames.com', username: '', password: 'Secret-123!', createdAt },
  })).ok, true)

  const pending = await send({ type: 'pending-candidate' })
  assert.deepEqual(pending.data.candidate, {
    origin: 'https://www.epicgames.com',
    username: 'lea@example.fr',
    action: 'save',
  })
})
