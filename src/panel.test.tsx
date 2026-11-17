// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { AuthStatus, StoryFilter, StoryList } from './protocol'

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
    requests: { 'auth.status': connected, 'auth.disconnect': disconnected, 'stories.list': list }
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

// ---- Stories ----

const list: StoryList = {
  filter: { states: ['Ready'], owner: 'me' },
  states: [
    { name: 'New', type: 'backlog' },
    { name: 'Ready', type: 'unstarted' },
    { name: 'In Development (Sub-tasks)', type: 'started' },
    { name: 'Complete', type: 'done' }
  ],
  groups: [
    {
      story: { id: 30, name: 'Lone story', url: 'https://app.shortcut.com/ws/story/30', state: 'Ready', parentId: null, subTaskCount: 0 },
      matched: true,
      subtasks: []
    },
    {
      story: { id: 10, name: 'Parent story', url: 'https://app.shortcut.com/ws/story/10', state: 'In Progress (Stories)', parentId: null, subTaskCount: 2 },
      matched: false,
      subtasks: [
        { id: 11, name: 'First sub-task', url: 'https://app.shortcut.com/ws/story/11', state: 'Ready', parentId: 10, subTaskCount: 0 }
      ]
    }
  ],
  truncated: false
}

test('lists stories as a tree, with sub-tasks under their parent', async () => {
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': list } })
  const view = await mount(panel, { host })
  const tree = view.find({ type: 'Tree' })
  const items = tree?.props?.items as { key: string; description: string; children?: { key: string }[] }[]
  assert.deepEqual(items.map((item) => item.key), ['sc-30', 'sc-10'])
  // One state in the filter: rows skip it, since every row would repeat it.
  assert.equal(items[0].description, 'sc-30 · no sub-tasks')
  assert.equal(items[1].description, 'sc-10')
  assert.deepEqual(items[1].children?.map((child) => child.key), ['sc-11'])
  assert.deepEqual(view.expandedOf({ type: 'Tree' }).sort(), ['sc-10', 'sc-30'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('rows name their state when the filter spans several states', async () => {
  const several = { ...list, filter: { states: ['Ready', 'In Development (Sub-tasks)'], owner: 'me' as const } }
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': several } })
  const view = await mount(panel, { host })
  const items = view.find({ type: 'Tree' })?.props?.items as { description: string; children?: { description: string }[] }[]
  assert.equal(items[0].description, 'sc-30 · Ready · no sub-tasks')
  // A parent shown only as context keeps to its id: its state is not what was filtered.
  assert.equal(items[1].description, 'sc-10')
  assert.equal(items[1].children?.[0].description, 'sc-11 · Ready')
  await view.unmount()
})

test('selecting a sub-task shows it and opens it in Shortcut', async () => {
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': list } })
  const view = await mount(panel, { host })
  await view.selectItem({ type: 'Tree' }, 'sc-11')
  assert.ok(view.find({ text: 'Sub-task of sc-10' }))
  await view.press({ text: 'Open in Shortcut' })
  assert.deepEqual(host.callsOf('shell.openExternal'), [
    { url: 'https://app.shortcut.com/ws/story/11' }
  ])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('a filter change reloads with it, and is remembered', async () => {
  const sent: unknown[] = []
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': (input: { filter?: StoryFilter }) => {
        sent.push(input)
        return input.filter ? { ...list, filter: input.filter } : list
      }
    }
  })
  const view = await mount(panel, { host })
  // Done states are not offered: the list is for work still to do.
  assert.equal(view.find({ label: 'Complete' }), null)
  await view.toggle({ label: 'Filters' })
  await view.toggle({ label: 'In Development (Sub-tasks)' })
  await view.select({ label: 'Owner' }, 'anyone')

  assert.deepEqual(sent, [
    {},
    { filter: { states: ['Ready', 'In Development (Sub-tasks)'], owner: 'me' } },
    { filter: { states: ['Ready', 'In Development (Sub-tasks)'], owner: 'anyone' } }
  ])
  assert.deepEqual(view.persisted.plugin.filter, {
    states: ['Ready', 'In Development (Sub-tasks)'],
    owner: 'anyone'
  })
  await view.unmount()
})

test('a remembered filter is sent on the next run', async () => {
  const sent: unknown[] = []
  const filter: StoryFilter = { states: ['New'], owner: 'unassigned' }
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': (input: unknown) => {
        sent.push(input)
        return { ...list, filter }
      }
    }
  })
  const view = await mount(panel, { host, persisted: { plugin: { filter } } })
  assert.deepEqual(sent, [{ filter }])
  await view.unmount()
})

test('says when nothing matches, and when the list failed', async () => {
  const empty = mockHost({
    requests: { 'auth.status': connected, 'stories.list': { ...list, groups: [] } }
  })
  const view = await mount(panel, { host: empty })
  assert.ok(view.summary().some((line) => line.includes('No stories')))
  await view.unmount()

  const failing = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': () => {
        throw hostError('rate_limited', 'Shortcut is rate limiting requests; try again shortly.')
      }
    }
  })
  const failed = await mount(panel, { host: failing })
  assert.ok(failed.find({ text: 'Shortcut is rate limiting requests; try again shortly.' }))
  await failed.unmount()
})
