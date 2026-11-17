// stories.list end to end through the worker, with a fake Shortcut that routes by URL.
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
      { id: 100, name: 'New', type: 'backlog', position: 0 },
      { id: 101, name: 'Ready', type: 'unstarted', position: 3 },
      { id: 102, name: 'In Progress (Stories)', type: 'started', position: 4 },
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
  workflow_state_id: 101,
  parent_story_id: null,
  sub_task_story_ids: [],
  owner_ids: ['member-1'],
  ...fields
})

type Routes = {
  /** Search pages by query; each page's `next` points at the following page. */
  search: Record<string, unknown[][]>
  stories?: Record<number, unknown>
}

/** Answers /workflows, /search/stories (paged) and /stories/:id; records every URL asked. */
function fakeShortcut(routes: Routes): string[] {
  const asked: string[] = []
  const answer = (status: number, body: unknown) => ({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
  const fake: FetchLike = async (url) => {
    asked.push(url)
    const parsed = new URL(url)
    const path = parsed.pathname.replace('/api/v3', '')
    if (path === '/workflows') {
      return answer(200, WORKFLOWS)
    }
    if (path === '/member') {
      return answer(200, { id: 'member-1', name: 'Ada', mention_name: 'ada', workspace2: { name: 'Engines' } })
    }
    if (path === '/search/stories') {
      const query = parsed.searchParams.get('query') ?? ''
      const pages = routes.search[query]
      if (!pages) {
        return answer(200, { data: [], total: 0, next: null })
      }
      const page = Number(parsed.searchParams.get('next') ?? 0)
      const next =
        page + 1 < pages.length
          ? `/api/v3/search/stories?${new URLSearchParams({ query, detail: 'slim', page_size: '25', next: String(page + 1) })}`
          : null
      return answer(200, { data: pages[page], total: pages.flat().length, next })
    }
    const story = /^\/stories\/(\d+)$/.exec(path)
    if (story) {
      const body = routes.stories?.[Number(story[1])]
      return body ? answer(200, body) : answer(404, { message: 'not found' })
    }
    return answer(404, { message: `no route for ${path}` })
  }
  main.deps.fetch = fake
  return asked
}

const connected = {
  results: {
    'secrets.protection': { status: 'os-keyring' },
    'workspace.list': { workspaces: [], truncated: false }
  },
  secrets: { shortcutToken: 'tok' },
  storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } },
  // The status bar count searches Shortcut too; these tests count what the list asks.
  settings: { showReadyCount: false }
}

test('lists my Ready stories by default, under parents fetched when not mine', async () => {
  const asked = fakeShortcut({
    search: {
      'owner:ada state:"Ready" !is:archived': [
        [raw(11, { parent_story_id: 10 }), raw(12, { parent_story_id: 10 }), raw(30)]
      ]
    },
    stories: { 10: raw(10, { workflow_state_id: 102, sub_task_story_ids: [11, 12, 13], owner_ids: ['someone'] }) }
  })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  const list = await worker.request('stories.list', {})

  assert.deepEqual(list.filter, { states: ['Ready'], owner: 'me' })
  assert.deepEqual(
    list.states.map((state) => state.name),
    ['New', 'Ready', 'In Progress (Stories)', 'In Development (Sub-tasks)', 'Complete']
  )
  assert.deepEqual(
    list.groups.map((group) => [group.story.id, group.matched, group.subtasks.map((s) => s.id)]),
    [
      [30, true, []],
      [10, false, [11, 12]]
    ]
  )
  assert.equal(list.groups[1].story.state, 'In Progress (Stories)')
  assert.equal(list.truncated, false)
  // Slim search, and one fetch for the parent that did not match.
  assert.ok(asked.some((url) => url.includes('detail=slim')))
  assert.equal(asked.filter((url) => url.endsWith('/stories/10')).length, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the settings choose the default filter', async () => {
  const asked = fakeShortcut({ search: {} })
  const worker = await mountWorker(main, {
    host: mockHost({
      ...connected,
      settings: {
        ...connected.settings,
        defaultStates: 'Ready, In Development (Sub-tasks)',
        defaultOwner: 'unassigned'
      }
    })
  })
  const list = await worker.request('stories.list', {})
  assert.deepEqual(list.filter, {
    states: ['Ready', 'In Development (Sub-tasks)'],
    owner: 'unassigned'
  })
  const queries = asked
    .filter((url) => url.includes('/search/stories'))
    .map((url) => new URL(url).searchParams.get('query'))
  assert.deepEqual(queries.sort(), [
    '!has:owner state:"In Development (Sub-tasks)" !is:archived',
    '!has:owner state:"Ready" !is:archived'
  ])
  await worker.deactivate()
})

test('a filter from the panel wins over the settings, and merges states', async () => {
  fakeShortcut({
    search: {
      'state:"Ready" !is:archived': [[raw(21, { parent_story_id: 20 })]],
      'state:"In Progress (Stories)" !is:archived': [[raw(20, { workflow_state_id: 102, sub_task_story_ids: [21] })]]
    }
  })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  const list = await worker.request('stories.list', {
    filter: { states: ['Ready', 'In Progress (Stories)'], owner: 'anyone' }
  })
  assert.deepEqual(list.filter, { states: ['Ready', 'In Progress (Stories)'], owner: 'anyone' })
  // The parent matched itself, so it is not fetched again and is marked matched.
  assert.deepEqual(
    list.groups.map((group) => [group.story.id, group.matched, group.subtasks.map((s) => s.id)]),
    [[20, true, [21]]]
  )
  await worker.deactivate()
})

test('follows search pages and reports when it stops early', async () => {
  const pages = Array.from({ length: 5 }, (_, page) => [raw(100 + page)])
  fakeShortcut({ search: { 'owner:ada state:"Ready" !is:archived': pages } })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  const list = await worker.request('stories.list', {})
  // Four pages at most: the fifth is left for a narrower filter.
  assert.equal(list.groups.length, 4)
  assert.equal(list.truncated, true)
  await worker.deactivate()
})

test('a parent Shortcut cannot return is logged, and its sub-task still shows', async () => {
  fakeShortcut({
    search: { 'owner:ada state:"Ready" !is:archived': [[raw(41, { parent_story_id: 40 })]] }
  })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  const list = await worker.request('stories.list', {})
  assert.deepEqual(list.groups.map((group) => group.story.id), [41])
  assert.ok(worker.logs.some((line) => line.includes('sc-40')))
  await worker.deactivate()
})

test('needs a connection', async () => {
  fakeShortcut({ search: {} })
  const worker = await mountWorker(main, {
    host: mockHost({ results: { 'secrets.protection': { status: 'os-keyring' } } })
  })
  await assert.rejects(worker.request('stories.list', {}), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'unavailable')
    return true
  })
  await worker.deactivate()
})

// ---- stories.search ----

test('searches all of Shortcut, leaving out archived stories, grouped under parents', async () => {
  fakeShortcut({
    search: {
      'difference engine !is:archived': [[raw(21, { parent_story_id: 20, workflow_state_id: 104 }), raw(40)]]
    },
    stories: { 20: raw(20, { sub_task_story_ids: [21] }) }
  })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  const found = await worker.request('stories.search', { query: '  difference engine ' })
  assert.equal(found.query, 'difference engine')
  assert.equal(found.truncated, false)
  assert.deepEqual(
    found.groups.map((group) => [group.story.id, group.matched, group.subtasks.map((s) => [s.id, s.state])]),
    [
      [40, true, []],
      [20, false, [[21, 'Complete']]]
    ]
  )
  await worker.deactivate()
})

test('a story id fetches that story; an unknown or archived one finds nothing', async () => {
  const asked = fakeShortcut({
    search: {},
    stories: { 21: raw(21, { parent_story_id: 20 }), 20: raw(20), 22: raw(22, { archived: true }) }
  })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  for (const query of ['21', 'sc-21', 'SC-21']) {
    const found = await worker.request('stories.search', { query })
    assert.deepEqual(found.groups.map((group) => [group.story.id, group.subtasks.map((s) => s.id)]), [[20, [21]]])
  }
  assert.ok(!asked.some((url) => url.includes('/search/')))
  assert.deepEqual((await worker.request('stories.search', { query: 'sc-99' })).groups, [])
  assert.deepEqual((await worker.request('stories.search', { query: '22' })).groups, [])
  await assert.rejects(worker.request('stories.search', { query: '  ' }), /Type something to search for/)
  await worker.deactivate()
})

test('with a filter, the search runs per state and owner, and an id must pass it too', async () => {
  const asked = fakeShortcut({
    search: {
      'engine owner:ada state:"Ready" !is:archived': [[raw(31)]],
      'engine owner:ada state:"In Development (Sub-tasks)" !is:archived': [[raw(32, { workflow_state_id: 103 })]]
    },
    stories: { 31: raw(31), 33: raw(33, { workflow_state_id: 104 }) }
  })
  const worker = await mountWorker(main, { host: mockHost(connected) })
  const filter = { states: ['Ready', 'In Development (Sub-tasks)'], owner: 'me' as const }
  const found = await worker.request('stories.search', { query: 'engine', filter })
  assert.deepEqual(found.filter, filter)
  assert.deepEqual(found.groups.map((group) => group.story.id).sort(), [31, 32])
  assert.ok(!asked.some((url) => new URL(url).searchParams.get('query') === 'engine !is:archived'))

  // By id: 31 is mine and Ready; 33 is Complete, which the filter leaves out.
  assert.deepEqual((await worker.request('stories.search', { query: 'sc-31', filter })).groups.length, 1)
  assert.deepEqual((await worker.request('stories.search', { query: 'sc-33', filter })).groups, [])
  await worker.deactivate()
})
