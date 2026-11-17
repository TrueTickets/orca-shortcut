// work.options and work.start through the worker: a fake Orca host, a fake Shortcut answering by
// URL, and a fake git. Every name, story and branch here is made up.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import type { GitRunner } from './git-branch'
import type { FetchLike } from './shortcut-api'
import * as main from './worker'

const realFetch = main.deps.fetch
const realGit = main.deps.git
afterEach(() => {
  main.deps.fetch = realFetch
  main.deps.git = realGit
})

const STATES = [
  { id: 100, name: 'New', type: 'backlog', position: 0 },
  { id: 102, name: 'Ready', type: 'unstarted', position: 3 },
  { id: 103, name: 'In Progress (Stories)', type: 'started', position: 4 },
  { id: 104, name: 'In Development (Sub-tasks)', type: 'started', position: 5 },
  { id: 105, name: 'PR Review (Sub-tasks)', type: 'started', position: 6 }
]

const raw = (id: number, fields: Record<string, unknown> = {}) => ({
  id,
  name: `Story ${id}`,
  app_url: `https://app.shortcut.com/engines/story/${id}`,
  story_type: 'feature',
  archived: false,
  workflow_id: 1,
  workflow_state_id: 102,
  parent_story_id: null,
  sub_task_story_ids: [],
  owner_ids: [],
  description: '',
  ...fields
})

const STORIES: Record<number, unknown> = {
  10: raw(10, { name: 'Program the engine', workflow_state_id: 100, sub_task_story_ids: [11, 12], description: 'The big picture.' }),
  11: raw(11, { name: 'Lay out the operation cards', parent_story_id: 10, owner_ids: ['someone'], description: 'Use Note G.' }),
  12: raw(12, { name: 'Check the variable cards', parent_story_id: 10 })
}

type Put = { id: number; body: Record<string, unknown> }

/** Answers /member, /workflows, GET and PUT /stories/:id; records each PUT. */
function fakeShortcut(options: { failPuts?: boolean } = {}): Put[] {
  const puts: Put[] = []
  const answer = (status: number, body: unknown) => ({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
  const fake: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v3', '')
    if (path === '/member') {
      return answer(200, { id: 'member-ada', name: 'Ada', mention_name: 'ada', workspace2: { name: 'Engines', url_slug: 'engines' } })
    }
    if (path === '/workflows') {
      return answer(200, [{ id: 1, name: 'Development', states: STATES }])
    }
    const story = /^\/stories\/(\d+)$/.exec(path)
    if (story) {
      const id = Number(story[1])
      if (init.method === 'PUT') {
        if (options.failPuts) {
          return answer(500, { message: 'down' })
        }
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        puts.push({ id, body })
        return answer(200, { ...(STORIES[id] as object), ...body })
      }
      return STORIES[id] ? answer(200, STORIES[id]) : answer(404, {})
    }
    return answer(404, {})
  }
  main.deps.fetch = fake
  return puts
}

/** A git that starts on Orca's branch and records each command. */
function fakeGit(options: { failRename?: boolean } = {}): string[] {
  const ran: string[] = []
  const run: GitRunner = async (args) => {
    const command = args.join(' ')
    ran.push(command)
    if (command.startsWith('rev-parse')) return { code: 0, stdout: 'ada/lay-out-the-operation-cards', stderr: '' }
    if (command.startsWith('show-ref')) return { code: 1, stdout: '', stderr: '' }
    if (command.startsWith('branch -m') && options.failRename) return { code: 128, stdout: '', stderr: 'fatal: no' }
    return { code: 0, stdout: '', stderr: '' }
  }
  main.deps.git = run
  return ran
}

const PROJECTS = {
  truncated: false,
  projects: [
    { id: 'p-mill', name: 'mill', kind: 'git', hostId: 'local', path: '/repos/mill' },
    { id: 'p-engine', name: 'engine', kind: 'git', hostId: 'local', path: '/repos/engine' },
    { id: 'p-notes', name: 'notes', kind: 'folder', hostId: 'local', path: '/notes' },
    { id: 'p-remote', name: 'remote', kind: 'git', hostId: 'ssh:box', path: '/srv/remote' }
  ]
}

const listed = (id: string, branch: string, fields: Record<string, unknown> = {}) => ({
  id, kind: 'worktree', name: id, project: 'engine', projectId: 'p-engine', path: `/w/${id}`, branch, hostId: 'local', ...fields
})

/** An Orca host whose workspace list gains the new worktree once workspace.create runs. */
function host(options: { existing?: unknown[]; createdOn?: string } = {}) {
  let created = false
  return mockHost({
    results: {
      'secrets.protection': { status: 'os-keyring' },
      'project.list': PROJECTS,
      'workspace.list': () => ({
        truncated: false,
        workspaces: [
          ...(options.existing ?? []),
          ...(created
            ? [listed('new', 'ada/lay-out-the-operation-cards', options.createdOn ? { hostId: options.createdOn } : {})]
            : [])
        ]
      }),
      'workspace.create': () => ((created = true), { workspaceId: 'new' }),
      'workspace.open': { opened: true },
      'agent.launch': { terminalId: 't1' }
    },
    secrets: { shortcutToken: 'tok' },
    storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } }
  })
}

test('offers git projects, the sibling worktree project first, the branch and agents', async () => {
  fakeShortcut()
  const worker = await mountWorker(main, {
    host: host({ existing: [listed('sib', 'ada/sc-12/check')] })
  })
  const options = await worker.request('work.options', { storyId: 11 })
  assert.deepEqual(options.projects.map((project) => project.id), ['p-engine', 'p-mill', 'p-remote'])
  assert.equal(options.suggestedProjectId, 'p-engine')
  assert.equal(options.branch, 'ada/sc-11/lay-out-the-operation-cards')
  assert.equal(options.defaultAgent, 'claude')
  assert.equal(options.agents[0], 'claude')
  await worker.deactivate()
})

test('starts work: worktree, Shortcut branch, sub-task and story moved, agent started', async () => {
  const puts = fakeShortcut()
  const ran = fakeGit()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  const result = await worker.request('work.start', { storyId: 11, projectId: 'p-engine', agent: 'claude' })

  assert.deepEqual(h.callsOf('workspace.create'), [
    { projectId: 'p-engine', hostId: 'local', name: 'Lay out the operation cards', open: true }
  ])
  assert.equal(ran.at(-1), 'branch -m ada/sc-11/lay-out-the-operation-cards')
  assert.deepEqual(puts, [
    { id: 11, body: { workflow_state_id: 104, owner_ids: ['someone', 'member-ada'] } },
    { id: 10, body: { workflow_state_id: 103 } }
  ])
  const [launch] = h.callsOf('agent.launch') as { workspaceId: string; agent: string; prompt: string }[]
  assert.equal(launch.workspaceId, 'new')
  assert.equal(launch.agent, 'claude')
  assert.match(launch.prompt, /^Work on Shortcut sub-task sc-11: Lay out the operation cards/)
  assert.match(launch.prompt, /The big picture\./)

  assert.deepEqual(result, {
    workspaceId: 'new',
    branch: 'ada/sc-11/lay-out-the-operation-cards',
    existing: false,
    done: [
      'Created a worktree in engine.',
      'Put the worktree on ada/sc-11/lay-out-the-operation-cards.',
      'Shortcut sc-11: moved to In Development (Sub-tasks), added you as an owner.',
      'Shortcut sc-10: moved to In Progress (Stories).',
      'Started claude on it.'
    ],
    warnings: []
  })
  assert.deepEqual(h.data().storage.lastProject, 'p-engine')
  assert.ok(worker.posts.some((post) => post.event === 'worktrees.changed'))
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('opens the worktree a sub-task already has instead of making another', async () => {
  const puts = fakeShortcut()
  const h = host({ existing: [listed('old', 'ada/sc-11/lay-out-the-operation-cards')] })
  const worker = await mountWorker(main, { host: h })
  const result = await worker.request('work.start', { storyId: 11, projectId: 'p-engine', agent: 'claude' })
  assert.equal(result.existing, true)
  assert.deepEqual(h.callsOf('workspace.open'), [{ workspaceId: 'old' }])
  assert.deepEqual(h.callsOf('workspace.create'), [])
  assert.deepEqual(h.callsOf('agent.launch'), [])
  assert.deepEqual(puts, [])
  await worker.deactivate()
})

test('refuses a story: work starts on its sub-tasks', async () => {
  fakeShortcut()
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await assert.rejects(
    worker.request('work.start', { storyId: 10, projectId: 'p-engine', agent: null }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'invalid_params')
      assert.match((error as Error).message, /sc-10 is a story/)
      return true
    }
  )
  assert.deepEqual(h.callsOf('workspace.create'), [])
  await worker.deactivate()
})

test('the requireSubtask setting can allow work on a story', async () => {
  fakeShortcut()
  fakeGit()
  const worker = await mountWorker(main, {
    host: mockHost({
      results: {
        'secrets.protection': { status: 'os-keyring' },
        'project.list': PROJECTS,
        'workspace.list': { truncated: false, workspaces: [] },
        'workspace.create': { workspaceId: 'new' }
      },
      secrets: { shortcutToken: 'tok' },
      storage: { member: { name: 'Ada', mentionName: 'ada', workspaceName: 'Engines' } },
      settings: { requireSubtask: false }
    })
  })
  const result = await worker.request('work.start', { storyId: 10, projectId: 'p-engine', agent: null })
  assert.equal(result.workspaceId, 'new')
  await worker.deactivate()
})

test('a worktree on another host keeps its branch, with the command to rename it', async () => {
  fakeShortcut()
  const ran = fakeGit()
  const worker = await mountWorker(main, { host: host({ createdOn: 'ssh:box' }) })
  const result = await worker.request('work.start', { storyId: 11, projectId: 'p-remote', agent: null })
  assert.deepEqual(ran, [])
  assert.match(result.warnings[0], /on ssh:box; rename its branch .* \(git branch -m ada\/sc-11\//)
  await worker.deactivate()
})

test('a git or Shortcut failure after the worktree exists is a warning, not a failure', async () => {
  fakeShortcut({ failPuts: true })
  fakeGit({ failRename: true })
  const h = host()
  const worker = await mountWorker(main, { host: h })
  const result = await worker.request('work.start', { storyId: 11, projectId: 'p-engine', agent: null })
  assert.equal(result.workspaceId, 'new')
  assert.deepEqual(result.done, ['Created a worktree in engine.'])
  assert.equal(result.warnings.length, 3)
  assert.match(result.warnings[0], /git branch -m .* failed: fatal: no/)
  assert.match(result.warnings[1], /Could not update sc-11/)
  assert.match(result.warnings[2], /Could not update sc-10/)
  await worker.deactivate()
})

test('refuses a project that is not a Git project', async () => {
  fakeShortcut()
  const worker = await mountWorker(main, { host: host() })
  await assert.rejects(
    worker.request('work.start', { storyId: 11, projectId: 'p-notes', agent: null }),
    /Pick a Git project/
  )
  await worker.deactivate()
})
