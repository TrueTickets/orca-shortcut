// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { AuthStatus } from './protocol'

const disconnected: AuthStatus = { connected: false, secretsAvailable: true }
const noKeyStore: AuthStatus = { connected: false, secretsAvailable: false }
const connected: AuthStatus = {
  connected: true,
  secretsAvailable: true,
  member: { name: 'Ada Lovelace', mentionName: 'ada', workspaceName: 'Analytical Engines' }
}

test('connects with a pasted token and shows who is connected', async () => {
  const sent: string[] = []
  const host = mockHost({
    requests: {
      'auth.status': disconnected,
      'auth.connect': ({ token }: { token: string }) => {
        sent.push(token)
        return connected
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Connect' }))

  await view.type({ label: 'Shortcut API token' }, 'tok-123')
  await view.press({ text: 'Connect' })

  assert.deepEqual(sent, ['tok-123'])
  assert.ok(view.find({ text: 'Connected as @ada · Analytical Engines' }))
  assert.equal(view.find({ label: 'Shortcut API token' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('shows why a token was rejected and keeps the form', async () => {
  const host = mockHost({
    requests: {
      'auth.status': disconnected,
      'auth.connect': () => {
        throw hostError('invalid_params', 'Shortcut rejected the API token.')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.type({ label: 'Shortcut API token' }, 'bad')
  await view.press({ text: 'Connect' })
  assert.ok(view.find({ text: 'Shortcut rejected the API token.' }))
  assert.ok(view.find({ label: 'Shortcut API token' }))
  await view.unmount()
})

test('disconnects', async () => {
  const host = mockHost({
    requests: { 'auth.status': connected, 'auth.disconnect': disconnected }
  })
  const view = await mount(panel, { host })
  await view.press({ text: 'Disconnect' })
  assert.ok(view.find({ text: 'Connect' }))
  await view.unmount()
})

test('warns when secrets cannot be stored', async () => {
  const host = mockHost({
    requests: { 'auth.status': noKeyStore }
  })
  const view = await mount(panel, { host })
  // A Callout's title is a prop, not a text child: summary() lists it.
  assert.ok(view.summary().includes('Callout warning "No key store"'))
  assert.equal(view.find({ label: 'Shortcut API token' })?.props?.disabled, true)
  assert.equal(view.find({ text: 'Connect' })?.props?.disabled, true)
  await view.unmount()
})
