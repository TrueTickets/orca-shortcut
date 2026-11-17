// subtask.create through the worker, with a fake Shortcut. Every name and id here is made up.
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
  { id: 104, name: 'In Development (Sub-tasks)', type: 'started', position: 5 }
]

const raw = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  name: `Story ${id}`,
  app_url: `https://app.shortcut.com/engines/story/${id}`,
  story_type: 'chore',
  archived: false,
  workflow_id: 1,
  workflow_state_id: 100,
  parent_story_id: null,
  sub_task_story_ids: [],
  owner_ids: [],
  description: '',
  group_id: 'team-engines',
  ...fields
})

/** Answers /member, /workflows, GET /stories/:id and POST /stories; records each POST body. */
function fakeShortcut(options: { linkParent?: boolean } = {}): Record<string, unknown>[] {
  const posts: Record<string, unknown>[] = []
  const answer = (status: number, body: unknown) => ({
    ok: status === 200 || status === 201,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
  const fake: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v3', '')
    if (path === '/member') {
      return answer(200, { id: 'member-ada', name: 'Ada', mention_name: 'ada', workspace2: { name: 'Engines' } })
    }
    if (path === '/workflows') {
      return answer(200, [{ id: 1, name: 'Development', states: STATES }])
    }
    if (path === '/stories' && init.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
      posts.push(body)
      return answer(201, raw(30, {
        ...body,
        parent_story_id: options.linkParent === false ? null : body.parent_story_id
      }))
    }
    const story = /^\/stories\/(\d+)$/.exec(path)
    if (story) {
      const id = Number(story[1])
      return answer(200, id === 11 ? raw(11, { parent_story_id: 10 }) : raw(id))
    }
    return answer(404, {})
  }
  main.deps.fetch = fake
  return posts
}

function host(settings: Record<string, string> = {}) {
  return mockHost({
    results: { 'secrets.protection': { status: 'os-keyring' } },
    secrets: { shortcutToken: 'tok' },
    storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } },
    settings
  })
}

test('creates a sub-task in Ready, owned by you, with its story team and type', async () => {
  const posts = fakeShortcut()
  const worker = await mountWorker(main, { host: host() })
  const created = await worker.request('subtask.create', { parentId: 10, name: '  Tabulate the results  ' })
  assert.deepEqual(posts, [
    {
      name: 'Tabulate the results',
      workflow_state_id: 102,
      parent_story_id: 10,
      owner_ids: ['member-ada'],
      group_id: 'team-engines',
      story_type: 'chore'
    }
  ])
  assert.deepEqual(created, { id: 30, name: 'Tabulate the results', state: 'Ready', warnings: [] })
  await worker.deactivate()
})

test('the newSubtaskState setting picks the state, falling back to the first not-started one', async () => {
  let posts = fakeShortcut()
  let worker = await mountWorker(main, { host: host({ newSubtaskState: 'New' }) })
  await worker.request('subtask.create', { parentId: 10, name: 'A' })
  assert.equal(posts[0].workflow_state_id, 100)
  await worker.deactivate()

  posts = fakeShortcut()
  worker = await mountWorker(main, { host: host({ newSubtaskState: 'Doing' }) })
  const created = await worker.request('subtask.create', { parentId: 10, name: 'B' })
  assert.equal(posts[0].workflow_state_id, 102)
  assert.deepEqual(created.warnings, ['No workflow state is named "Doing"; created it in Ready.'])
  await worker.deactivate()
})

test('refuses a sub-task as parent, and an empty title, before creating anything', async () => {
  const posts = fakeShortcut()
  const worker = await mountWorker(main, { host: host() })
  await assert.rejects(worker.request('subtask.create', { parentId: 11, name: 'Deeper' }), /sc-11 is itself a sub-task: add sub-tasks to its story, sc-10/)
  await assert.rejects(worker.request('subtask.create', { parentId: 10, name: '   ' }), /Give the sub-task a title/)
  assert.deepEqual(posts, [])
  await worker.deactivate()
})

test('says so when Shortcut did not link the new story to its parent', async () => {
  fakeShortcut({ linkParent: false })
  const worker = await mountWorker(main, { host: host() })
  const created = await worker.request('subtask.create', { parentId: 10, name: 'Loose' })
  assert.deepEqual(created.warnings, ['Shortcut created sc-30 but did not make it a sub-task of sc-10.'])
  await worker.deactivate()
})
