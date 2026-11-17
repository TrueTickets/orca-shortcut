// The worker's view of Orca's worktrees: linking them to stories, following focus into the
// status bar, and telling panels when worktrees come and go.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import type { FetchLike } from './shortcut-api'
import * as main from './worker'

const realFetch = main.deps.fetch
afterEach(() => {
  main.deps.fetch = realFetch
})

const WORKFLOWS = [
  {
    id: 1,
    name: 'Development',
    states: [
      { id: 101, name: 'Ready', type: 'unstarted', position: 3 },
      { id: 103, name: 'In Development (Sub-tasks)', type: 'started', position: 5 },
      { id: 104, name: 'Complete', type: 'done', position: 9 }
    ]
  }
]

const raw = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  name: `Story ${id}`,
  app_url: `https://app.shortcut.com/ws/story/${id}`,
  story_type: 'feature',
  archived: false,
  workflow_state_id: 103,
  parent_story_id: 1,
  sub_task_story_ids: [],
  owner_ids: [],
  ...fields
})

/** Answers /workflows, empty searches and /stories/:id from `stories` (404 otherwise). */
function fakeShortcut(stories: Record<number, unknown>): string[] {
  const asked: string[] = []
  const answer = (status: number, body: unknown) => ({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
  const fake: FetchLike = async (url) => {
    asked.push(url)
    const path = new URL(url).pathname.replace('/api/v3', '')
    if (path === '/workflows') {
      return answer(200, WORKFLOWS)
    }
    if (path === '/search/stories') {
      return answer(200, { data: [], total: 0, next: null })
    }
    const story = /^\/stories\/(\d+)$/.exec(path)
    const body = story ? stories[Number(story[1])] : undefined
    return body ? answer(200, body) : answer(404, { message: 'not found' })
  }
  main.deps.fetch = fake
  return asked
}

const WORKSPACES = {
  truncated: false,
  workspaces: [
    { id: 'w1', kind: 'worktree', name: 'drift', project: 'infra', projectId: 'p', path: '/w1', branch: 'refs/heads/ada/sc-11/drift', hostId: 'local', status: { state: 'working', unread: false, terminalCount: 1, lastActivityAt: 1 } },
    { id: 'w2', kind: 'worktree', name: 'old', project: 'infra', projectId: 'p', path: '/w2', branch: 'ada/sc-12/old', hostId: 'local' },
    { id: 'w3', kind: 'worktree', name: 'gone', project: 'infra', projectId: 'p', path: '/w3', branch: 'ada/sc-13/gone', hostId: 'local' },
    { id: 'w4', kind: 'worktree', name: 'main', project: 'infra', projectId: 'p', path: '/w4', branch: 'main', hostId: 'local' }
  ]
}

function host(extra: Record<string, unknown> = {}) {
  return mockHost({
    results: {
      'secrets.protection': { status: 'os-keyring' },
      'workspace.list': WORKSPACES,
      'statusBar.update': { ok: true },
      'workspace.open': { opened: true },
      ...extra
    },
    secrets: { shortcutToken: 'tok' },
    storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } }
  })
}

const workspaceEvents = ['workspace.changed', 'workspace.created', 'workspace.removed']


/** The last update of the focused-story item; the ready count updates its own item too. */
const focusedItem = (h: ReturnType<typeof mockHost>) =>
  h.callsOf('statusBar.update').filter((call) => (call as { id?: string }).id === 'focused-story').at(-1)

test('lists every story worktree with its story now, problems first', async () => {
  fakeShortcut({ 11: raw(11), 12: raw(12, { workflow_state_id: 104 }) })
  const worker = await mountWorker(main, { host: host(), events: workspaceEvents })
  const { worktrees } = await worker.request('worktrees.list')
  assert.deepEqual(
    worktrees.map((worktree) => [worktree.storyId, worktree.name, worktree.flags, worktree.agent]),
    [
      [13, 'gone', ['missing-story'], null],
      [12, 'old', ['done'], null],
      [11, 'drift', [], 'working']
    ]
  )
  assert.equal(worktrees[2].story?.state, 'In Development (Sub-tasks)')
  assert.equal(worktrees[2].branch, 'ada/sc-11/drift')
  // The main branch names no story, so it is not listed.
  assert.ok(worker.logs.some((line) => line.includes('linked story sc-13')))
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('stories.list marks the stories that have worktrees', async () => {
  fakeShortcut({})
  main.deps.fetch = (async (url: string) => {
    const parsed = new URL(url)
    const path = parsed.pathname.replace('/api/v3', '')
    const body =
      path === '/workflows'
        ? WORKFLOWS
        : path === '/search/stories'
          ? { data: [raw(11, { parent_story_id: null }), raw(14, { parent_story_id: null })], total: 2, next: null }
          : {}
    return { ok: true, status: 200, json: async () => body, text: async () => '' }
  }) as FetchLike
  const worker = await mountWorker(main, { host: host(), events: workspaceEvents })
  const list = await worker.request('stories.list', {})
  const byId = new Map(list.groups.map((group) => [group.story.id, group.story]))
  assert.deepEqual(byId.get(11)?.worktrees.map((worktree) => worktree.workspaceId), ['w1'])
  assert.deepEqual(byId.get(14)?.worktrees, [])
  await worker.deactivate()
})

test('the focused worktree names its story in the status bar and tells panels', async () => {
  fakeShortcut({ 11: raw(11, { name: 'Detect drift' }) })
  const h = host()
  const worker = await mountWorker(main, { host: h, events: workspaceEvents })
  await worker.emit('workspace.changed', {
    context: { workspaceId: 'x', branch: 'refs/heads/ada/sc-11/drift', displayName: 'drift', terminals: [] }
  })
  assert.deepEqual(worker.posts.at(-1), {
    event: 'focus.changed',
    payload: { branch: 'ada/sc-11/drift', storyId: 11 }
  })
  assert.deepEqual(focusedItem(h), {
    id: 'focused-story',
    text: 'sc-11 · In Development (Sub-tasks)',
    icon: 'branch',
    tone: 'neutral',
    tooltip: 'Detect drift',
    visible: true
  })
  assert.deepEqual(await worker.request('focus.get'), { branch: 'ada/sc-11/drift', storyId: 11 })

  // A worktree on a branch without a story hides the item.
  await worker.emit('workspace.changed', {
    context: { workspaceId: 'y', branch: 'main', displayName: 'main', terminals: [] }
  })
  assert.deepEqual(focusedItem(h), { id: 'focused-story', visible: false })
  await worker.deactivate()
})

test('the status bar notes, without warning, a focused worktree whose story is done', async () => {
  fakeShortcut({ 12: raw(12, { name: 'Old work', workflow_state_id: 104 }) })
  const h = host()
  const worker = await mountWorker(main, { host: h, events: workspaceEvents })
  await worker.emit('workspace.changed', {
    context: { branch: 'ada/sc-12/old', displayName: 'old', terminals: [] }
  })
  const update = focusedItem(h) as Record<string, unknown>
  assert.equal(update.tone, 'accent')
  assert.equal(update.icon, 'flag')
  assert.match(String(update.tooltip), /Done in Shortcut/)
  await worker.deactivate()
})

test('the same focus twice is not reported twice', async () => {
  fakeShortcut({ 11: raw(11) })
  const worker = await mountWorker(main, { host: host(), events: workspaceEvents })
  const context = { branch: 'ada/sc-11/drift', displayName: 'drift', terminals: [] }
  await worker.emit('workspace.changed', { context })
  await worker.emit('workspace.changed', { context: { ...context, terminals: [{ id: 't1' }] } })
  assert.equal(worker.posts.filter((post) => post.event === 'focus.changed').length, 1)
  await worker.deactivate()
})

test('tells panels when worktrees come and go, and opens one on request', async () => {
  fakeShortcut({})
  const h = host()
  const worker = await mountWorker(main, { host: h, events: workspaceEvents })
  await worker.emit('workspace.created', { workspaceId: 'n', kind: 'worktree', path: '/n', branch: 'ada/sc-20/new' })
  await worker.emit('workspace.removed', { workspaceId: 'n', kind: 'worktree', path: '/n' })
  assert.deepEqual(
    worker.posts.filter((post) => post.event === 'worktrees.changed').length,
    2
  )
  assert.equal(await worker.request('worktrees.open', { workspaceId: 'w1' }), null)
  assert.deepEqual(h.callsOf('workspace.open'), [{ workspaceId: 'w1' }])
  await worker.deactivate()
})

test('the status bar flags, in accent, a focused worktree whose story is still in the backlog', async () => {
  const backlog = [{ ...WORKFLOWS[0], states: [...WORKFLOWS[0].states, { id: 100, name: 'New', type: 'backlog', position: 0 }] }]
  fakeShortcut({ 11: raw(11, { name: 'Early work', workflow_state_id: 100 }) })
  const inner = main.deps.fetch
  main.deps.fetch = (async (url, init) =>
    new URL(url).pathname.endsWith('/workflows')
      ? { ok: true, status: 200, json: async () => backlog, text: async () => '' }
      : inner(url, init)) as FetchLike
  const h = host()
  const worker = await mountWorker(main, { host: h, events: workspaceEvents })
  await worker.emit('workspace.changed', {
    context: { branch: 'ada/sc-11/drift', displayName: 'drift', terminals: [] }
  })
  const update = focusedItem(h) as Record<string, unknown>
  assert.deepEqual([update.text, update.icon, update.tone], ['sc-11 · New', 'flag', 'accent'])
  assert.match(String(update.tooltip), /backlog/)
  await worker.deactivate()
})
