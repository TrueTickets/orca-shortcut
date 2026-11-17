// The status bar's ready count through the worker, with a fake Shortcut. Every name and id here
// is made up.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import type { FetchLike } from './shortcut-api'
import * as main from './worker'

const realFetch = main.deps.fetch
afterEach(() => {
  main.deps.fetch = realFetch
})

const STATES = [
  { id: 102, name: 'Ready', type: 'unstarted', position: 3 },
  { id: 104, name: 'In Development (Sub-tasks)', type: 'started', position: 5 }
]

const raw = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  name: `Sub-task ${id}`,
  app_url: `https://app.shortcut.com/engines/story/${id}`,
  workflow_id: 1,
  workflow_state_id: 102,
  parent_story_id: 10,
  owner_ids: ['member-ada'],
  ...fields
})

/** Ready, mine: sub-tasks 11 and 12 and story 10 until `moved` holds 11. Records search queries. */
function fakeShortcut(moved: Set<number> = new Set()): string[] {
  const searched: string[] = []
  const answer = (status: number, body: unknown) => ({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
  const fake: FetchLike = async (url, init) => {
    const parsed = new URL(url)
    const path = parsed.pathname.replace('/api/v3', '')
    if (path === '/workflows') {
      return answer(200, [{ id: 1, name: 'Development', states: STATES }])
    }
    if (path === '/search/stories') {
      const query = parsed.searchParams.get('query') ?? ''
      searched.push(query)
      const ready = [raw(10, { parent_story_id: null }), raw(11), raw(12), raw(13, { archived: true })]
      return answer(200, {
        data: query === 'owner:ada state:"Ready" !is:archived' ? ready.filter((story) => !moved.has(story.id)) : [],
        next: null
      })
    }
    const story = /^\/stories\/(\d+)$/.exec(path)
    if (story) {
      const id = Number(story[1])
      if (init.method === 'PUT') {
        moved.add(id)
        return answer(200, raw(id, { workflow_state_id: 104 }))
      }
      return answer(200, raw(id, moved.has(id) ? { workflow_state_id: 104 } : {}))
    }
    return answer(404, {})
  }
  main.deps.fetch = fake
  return searched
}

function host(settings: Record<string, string | boolean> = {}, connected = true) {
  return mockHost({
    results: { 'secrets.protection': { status: 'os-keyring' }, 'statusBar.update': { ok: true } },
    secrets: connected ? { shortcutToken: 'tok' } : {},
    storage: connected ? { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } } : {},
    settings
  })
}

const countItem = (h: ReturnType<typeof host>) =>
  h.callsOf('statusBar.update').filter((call) => (call as { id?: string }).id === 'ready-count').at(-1)

test('counts my Ready sub-tasks in the status bar, leaving out stories and archived ones', async () => {
  fakeShortcut()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  const message = await worker.command('shortcut.readyCount')
  assert.deepEqual(countItem(h), {
    id: 'ready-count',
    text: '2 ready',
    icon: 'layers',
    tone: 'accent',
    tooltip: 'Shortcut: 2 sub-tasks in Ready, yours\nsc-11 Sub-task 11\nsc-12 Sub-task 12',
    visible: true
  })
  assert.equal(message, '2 sub-tasks in Ready, yours.\nsc-11 Sub-task 11\nsc-12 Sub-task 12')
  await worker.deactivate()
})

test('counts again after a move from the panel', async () => {
  fakeShortcut()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await worker.command('shortcut.readyCount')
  await worker.request('story.move', { storyId: 11, stateId: 104 })
  // The command waits for a count already under way, so the move's recount has landed.
  await worker.command('shortcut.readyCount')
  assert.equal((countItem(h) as { text?: string }).text, '1 ready')
  await worker.deactivate()
})

test('the default states and owner settings choose what is counted', async () => {
  const searched = fakeShortcut()
  const worker = await mountWorker(main, {
    host: host({ defaultStates: 'Ready, In Development (Sub-tasks)', defaultOwner: 'me' })
  })
  await worker.command('shortcut.readyCount')
  assert.ok(searched.includes('owner:ada state:"In Development (Sub-tasks)" !is:archived'))
  await worker.deactivate()
})

test('hidden when the setting is off, or before connecting, without asking Shortcut', async () => {
  for (const h of [host({ showReadyCount: false }), host({}, false)]) {
    const searched = fakeShortcut()
    const worker = await mountWorker(main, { host: h })
    const message = await worker.command('shortcut.readyCount')
    assert.deepEqual(countItem(h), { id: 'ready-count', visible: false })
    assert.match(String(message), /Connect Shortcut/)
    assert.deepEqual(searched, [])
    await worker.deactivate()
  }
})
