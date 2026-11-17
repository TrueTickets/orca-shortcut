// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { AuthStatus, StoryFilter, StoryList, WorktreeList } from './protocol'
import { storyItem, worktreeRef } from './test-fixtures'

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
  assert.ok(view.find({ text: '@ada · Analytical Engines' }))
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
      story: storyItem(30, { name: 'Lone story', url: 'https://app.shortcut.com/ws/story/30' }),
      matched: true,
      subtasks: []
    },
    {
      story: storyItem(10, {
        name: 'Parent story',
        state: 'In Progress (Stories)',
        stateType: 'started',
        subTaskCount: 2
      }),
      matched: false,
      subtasks: [
        storyItem(11, {
          name: 'First sub-task',
          url: 'https://app.shortcut.com/ws/story/11',
          parentId: 10
        })
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
  assert.equal(items[0].description, 'sc-30 · no sub-tasks · Ready')
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

// ---- Worktrees ----

const here = worktreeRef(11)
const working = worktreeRef(12, { agent: 'working' })
const linkedList: StoryList = {
  ...list,
  filter: { states: ['In Development (Sub-tasks)'], owner: 'me' },
  groups: [
    {
      story: storyItem(10, { name: 'Parent story', subTaskCount: 3 }),
      matched: false,
      subtasks: [
        storyItem(11, { name: 'Focused work', parentId: 10, stateType: 'started', worktrees: [here] }),
        storyItem(12, { name: 'Agent work', parentId: 10, stateType: 'started', worktrees: [working] }),
        storyItem(13, { name: 'Forgotten work', parentId: 10, stateType: 'started', flags: ['no-worktree'] })
      ]
    }
  ]
}
const linkedWorktrees: WorktreeList = {
  worktrees: [
    { ...worktreeRef(9, { name: 'old' }), storyId: 9, story: storyItem(9, { state: 'Complete', stateType: 'done' }), focused: false, flags: ['stale'] },
    { ...here, storyId: 11, story: linkedList.groups[0].subtasks[0], focused: true, flags: [] }
  ]
}

function linkedHost(extra: Record<string, unknown> = {}) {
  return mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': linkedList,
      'worktrees.list': linkedWorktrees,
      'focus.get': { branch: here.branch, storyId: 11 },
      'worktrees.open': null,
      ...extra
    }
  })
}

type Row = { key: string; icon: string; description: string }
const subtaskRows = (view: Awaited<ReturnType<typeof mount>>) =>
  ((view.find({ type: 'Tree' })?.props?.items as { children: Row[] }[])[0].children)

test('marks sub-tasks by their worktree: here, agent working, missing', async () => {
  const view = await mount(panel, { host: linkedHost() })
  const [focused, agent, forgotten] = subtaskRows(view)
  assert.deepEqual([focused.icon, focused.description], ['folder', 'sc-11 · here'])
  assert.deepEqual([agent.icon, agent.description], ['bot', 'sc-12 · agent working'])
  assert.deepEqual([forgotten.icon, forgotten.description], ['warning', 'sc-13 · no worktree'])
  // The focused worktree's sub-task is selected, so the tree highlights it.
  assert.equal(view.find({ type: 'Tree' })?.props?.selected, 'sc-11')
  await view.unmount()
})

test('follows Orca focus into the list', async () => {
  const view = await mount(panel, { host: linkedHost() })
  await view.post('focus.changed', { branch: working.branch, storyId: 12 })
  assert.equal(view.find({ type: 'Tree' })?.props?.selected, 'sc-12')
  assert.equal(subtaskRows(view)[1].description, 'sc-12 · here')
  await view.unmount()
})

test('the detail card opens the sub-task worktree and says what is off', async () => {
  const sent: unknown[] = []
  const view = await mount(panel, {
    host: linkedHost({ 'worktrees.open': (input: unknown) => (sent.push(input), null) })
  })
  await view.press({ text: 'Open worktree' })
  assert.deepEqual(sent, [{ workspaceId: here.workspaceId }])

  await view.selectItem({ type: 'Tree' }, 'sc-13')
  assert.ok(view.find({ text: 'In progress without a worktree.' }))
  assert.equal(view.find({ text: 'Open worktree' }), null)
  await view.unmount()
})

test('the Worktrees tab lists story worktrees, problems first, and opens one', async () => {
  const sent: unknown[] = []
  const view = await mount(panel, {
    host: linkedHost({ 'worktrees.open': (input: unknown) => (sent.push(input), null) })
  })
  await view.select({ label: 'View' }, 'worktrees')
  assert.ok(view.find({ text: '2 worktrees · 1 needs attention' }))
  const rows = view.findAll({ type: 'ListItem' })
  assert.deepEqual(rows.map((row) => [row.props?.title, row.props?.current ?? false]), [
    ['sc-9 · Story 9', false],
    ['sc-11 · Focused work', true]
  ])
  assert.ok(view.find({ text: 'The story is done or archived: the worktree can go.' }))
  await view.press({ type: 'ListItem', text: /sc-9/ })
  assert.deepEqual(sent, [{ workspaceId: 'ws-9' }])
  await view.unmount()
})

test('a created or removed worktree reloads the list', async () => {
  let calls = 0
  const view = await mount(panel, {
    host: linkedHost({ 'stories.list': () => (calls++, linkedList) })
  })
  assert.equal(calls, 1)
  await view.post('worktrees.changed', null)
  assert.equal(calls, 2)
  await view.unmount()
})

test('a sub-task with a worktree but still in the backlog gets the flag icon, not the warning', async () => {
  const early = storyItem(14, { name: 'Early work', parentId: 10, state: 'New', stateType: 'backlog', worktrees: [worktreeRef(14)], flags: ['not-started'] })
  const withEarly: StoryList = {
    ...linkedList,
    groups: [{ ...linkedList.groups[0], subtasks: [...linkedList.groups[0].subtasks, early] }]
  }
  const view = await mount(panel, { host: linkedHost({ 'stories.list': withEarly }) })
  const row = subtaskRows(view)[3]
  assert.deepEqual([row.icon, row.description], ['flag', 'sc-14 · worktree · not started'])
  await view.selectItem({ type: 'Tree' }, 'sc-14')
  assert.ok(view.summary().some((line) => line.startsWith('Callout accent')))
  await view.unmount()
})
