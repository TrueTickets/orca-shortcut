// story.move through the worker, with a fake Shortcut. Every name and id here is made up.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import type { FetchLike } from './shortcut-api'
import * as main from './worker'

const realFetch = main.deps.fetch
afterEach(() => {
  main.deps.fetch = realFetch
})

const STATES = [
  { id: 100, name: 'New', type: 'backlog', position: 0 },
  { id: 102, name: 'Ready', type: 'unstarted', position: 3 },
  { id: 103, name: 'In Progress (Stories)', type: 'started', position: 4 },
  { id: 104, name: 'In Development (Sub-tasks)', type: 'started', position: 5 },
  { id: 108, name: 'Complete', type: 'done', position: 9 }
]

const raw = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  name: `Story ${id}`,
  app_url: `https://app.shortcut.com/engines/story/${id}`,
  story_type: 'chore',
  archived: false,
  workflow_id: 1,
  workflow_state_id: 104,
  parent_story_id: 10,
  sub_task_story_ids: [],
  owner_ids: [],
  description: '',
  group_id: null,
  ...fields
})

/** Sub-task 11 sits in In Development; story 10 in Ready. Records each PUT body by story id. */
function fakeShortcut(): [number, Record<string, unknown>][] {
  const puts: [number, Record<string, unknown>][] = []
  const answer = (status: number, body: unknown) => ({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
  const fake: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v3', '')
    if (path === '/workflows') {
      return answer(200, [{ id: 1, name: 'Development', states: STATES }])
    }
    const story = /^\/stories\/(\d+)$/.exec(path)
    if (story) {
      const id = Number(story[1])
      const current = id === 10 ? raw(10, { workflow_state_id: 102, parent_story_id: null }) : raw(id)
      if (init.method === 'PUT') {
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        puts.push([id, body])
        return answer(200, { ...current, ...body })
      }
      return answer(200, current)
    }
    return answer(404, {})
  }
  main.deps.fetch = fake
  return puts
}

function host() {
  return mockHost({
    results: { 'secrets.protection': { status: 'os-keyring' } },
    secrets: { shortcutToken: 'tok' },
    storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } }
  })
}

test('moves a sub-task forward and says where it is now', async () => {
  const puts = fakeShortcut()
  const worker = await mountWorker(main, { host: host() })
  const moved = await worker.request('story.move', { storyId: 11, stateId: 108 })
  assert.deepEqual(puts, [[11, { workflow_state_id: 108 }]])
  assert.deepEqual(moved, { id: 11, state: 'Complete', stateType: 'done' })
  await worker.deactivate()
})

test('refuses to move anything back, or a sub-task into a story state', async () => {
  const puts = fakeShortcut()
  const worker = await mountWorker(main, { host: host() })
  await assert.rejects(
    worker.request('story.move', { storyId: 11, stateId: 102 }),
    /sc-11 can only move forward from In Development \(Sub-tasks\) here; move it to Ready in Shortcut/
  )
  await assert.rejects(worker.request('story.move', { storyId: 10, stateId: 104 }), /sc-10 can only move forward/)
  await assert.rejects(worker.request('story.move', { storyId: 11, stateId: 999 }), /No workflow state has id 999/)
  assert.deepEqual(puts, [])
  await worker.deactivate()
})

test('a move to the state it is already in changes nothing', async () => {
  const puts = fakeShortcut()
  const worker = await mountWorker(main, { host: host() })
  const moved = await worker.request('story.move', { storyId: 10, stateId: 102 })
  assert.deepEqual(moved, { id: 10, state: 'Ready', stateType: 'unstarted' })
  assert.deepEqual(puts, [])
  await worker.deactivate()
})
