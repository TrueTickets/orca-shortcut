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
  storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } }
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
      settings: { defaultStates: 'Ready, In Development (Sub-tasks)', defaultOwner: 'unassigned' }
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
