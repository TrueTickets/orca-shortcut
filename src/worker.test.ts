// Runs src/worker.ts's activate(orca) with the orca object Orca passes, over a mock host, and
// answers Shortcut API calls through the injected fetch.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import type { FetchLike } from './shortcut-api'
import * as main from './worker'

const realFetch = main.deps.fetch
afterEach(() => {
  main.deps.fetch = realFetch
})

type Call = { url: string; method: string; headers: Record<string, string> }

/** Answers every request with `status` and `body`, recording what was asked. */
function fakeShortcut(status: number, body: unknown): Call[] {
  const calls: Call[] = []
  const fake: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }
  main.deps.fetch = fake
  return calls
}

const MEMBER_BODY = {
  id: 'member-1',
  name: 'Ada Lovelace',
  mention_name: 'ada',
  workspace2: { name: 'Analytical Engines', url_slug: 'engines' }
}
const keyring = { 'secrets.protection': { status: 'os-keyring' } }

test('starts disconnected', async () => {
  const worker = await mountWorker(main, { host: mockHost({ results: keyring }) })
  assert.deepEqual(await worker.request('auth.status'), {
    connected: false,
    secretsAvailable: true
  })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('checks the token against Shortcut, then stores it', async () => {
  const calls = fakeShortcut(200, MEMBER_BODY)
  const host = mockHost({ results: keyring })
  const worker = await mountWorker(main, { host })

  const connected = {
    connected: true,
    secretsAvailable: true,
    member: { name: 'Ada Lovelace', mentionName: 'ada', workspaceName: 'Analytical Engines' }
  }
  assert.deepEqual(await worker.request('auth.connect', { token: '  tok-123  ' }), connected)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.app.shortcut.com/api/v3/member')
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].headers['Shortcut-Token'], 'tok-123')
  assert.deepEqual(host.data().secrets, { shortcutToken: 'tok-123' })
  assert.deepEqual(worker.posts, [{ event: 'auth.changed', payload: connected }])
  // A fresh status needs no network call.
  assert.deepEqual(await worker.request('auth.status'), connected)
  assert.equal(calls.length, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a rejected token is reported and never stored', async () => {
  fakeShortcut(401, { message: 'Unauthorized' })
  const host = mockHost({ results: keyring })
  const worker = await mountWorker(main, { host })
  await assert.rejects(worker.request('auth.connect', { token: 'bad' }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'invalid_params')
    assert.match((error as Error).message, /rejected the API token/)
    return true
  })
  assert.deepEqual(host.data().secrets, {})
  assert.deepEqual(worker.posts, [])
  await worker.deactivate()
})

test('an unreachable Shortcut is reported as unavailable', async () => {
  main.deps.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.app.shortcut.com')
  }
  const host = mockHost({ results: keyring })
  const worker = await mountWorker(main, { host })
  await assert.rejects(worker.request('auth.connect', { token: 'tok' }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'unavailable')
    return true
  })
  assert.deepEqual(host.data().secrets, {})
  await worker.deactivate()
})

test('refuses to connect without an OS key store, before calling Shortcut', async () => {
  const calls = fakeShortcut(200, MEMBER_BODY)
  const host = mockHost({ results: { 'secrets.protection': { status: 'unavailable' } } })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('auth.status'), {
    connected: false,
    secretsAvailable: false
  })
  await assert.rejects(worker.request('auth.connect', { token: 'tok' }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'unavailable')
    return true
  })
  assert.equal(calls.length, 0)
  await worker.deactivate()
})

test('disconnect forgets the token and the member', async () => {
  fakeShortcut(200, MEMBER_BODY)
  const host = mockHost({ results: keyring })
  const worker = await mountWorker(main, { host })
  await worker.request('auth.connect', { token: 'tok' })
  assert.deepEqual(await worker.request('auth.disconnect'), {
    connected: false,
    secretsAvailable: true
  })
  assert.deepEqual(host.data().secrets, {})
  assert.equal(host.data().storage.member, undefined)
  assert.deepEqual(worker.posts.at(-1), {
    event: 'auth.changed',
    payload: { connected: false, secretsAvailable: true }
  })
  await worker.deactivate()
})
