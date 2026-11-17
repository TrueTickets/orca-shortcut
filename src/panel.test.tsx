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

type Element = NonNullable<ReturnType<Awaited<ReturnType<typeof mount>>['find']>>
type View = Awaited<ReturnType<typeof mount>>

/** Each row as Orca draws it: title, second line, icon, highlight, and its pills. */
function rows(view: View) {
  const badges = view.findAll({ type: 'Badge' })
  const texts = view.findAll({ type: 'Text' })
  // An element belongs to the row whose path its own path extends.
  const inRow = (row: Element) => (element: Element) => element.path.startsWith(`${row.path}/`)
  const all = view.findAll({ type: 'ListItem' }).map((row: Element) => {
    // The row draws its own two lines (see RowText): the title, then the second line.
    const [title, description] = texts.filter(inRow(row)).map((text: Element) => text.text)
    return {
      title,
      description,
      icon: row.props?.icon as string,
      current: row.props?.current === true,
      pills: badges
        .filter(inRow(row))
        .map((badge: Element) => `${(badge.props?.tone as string) ?? 'neutral'}:${badge.text}`)
    }
  })
  // A story header is the one row without an icon (its chevron sits beside it).
  return all.filter((row) => row.icon !== undefined)
}

/** The story headers: rows without an icon, each opening its story's details. */
function headers(view: View): string[] {
  const texts = view.findAll({ type: 'Text' })
  return view
    .findAll({ type: 'ListItem' })
    .filter((row: Element) => row.props?.icon === undefined)
    .map((row: Element) => texts.find((text: Element) => text.path.startsWith(`${row.path}/`))?.text ?? '')
}

test('lists sub-tasks under a header for their story, as Orca lists worktrees', async () => {
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': list } })
  const view = await mount(panel, { host })
  // The story with sub-tasks is a header, not a row; the lone story is a row of its own.
  assert.ok(view.find({ text: 'Parent story' }))
  assert.deepEqual(
    rows(view).map((row) => [row.title, row.description, row.icon]),
    [
      ['Lone story', 'sc-30', 'book'],
      ['First sub-task', 'sc-11', 'play']
    ]
  )
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('colours each row by its workflow state', async () => {
  const states: StoryList = {
    ...list,
    groups: [
      {
        story: storyItem(10, { name: 'Parent', state: 'In Progress (Stories)', stateType: 'started', subTaskCount: 4 }),
        matched: false,
        subtasks: [
          storyItem(11, { parentId: 10, state: 'Ready', stateType: 'unstarted' }),
          storyItem(12, { parentId: 10, state: 'In Development (Sub-tasks)', stateType: 'started' }),
          storyItem(13, { parentId: 10, state: 'PR Review (Sub-tasks)', stateType: 'started' }),
          storyItem(14, { parentId: 10, state: 'New', stateType: 'backlog' })
        ]
      }
    ]
  }
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': states } })
  const view = await mount(panel, { host })
  assert.deepEqual(rows(view).map((row) => row.pills), [
    ['accent:Ready'],
    ['warning:In Development'],
    ['success:PR Review'],
    ['neutral:New']
  ])
  await view.unmount()
})

test('pressing a row opens its details right under it, and a second press closes them', async () => {
  const host = mockHost({
    requests: { 'auth.status': connected, 'stories.list': list, 'work.options': workOptions }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  // The details follow the pressed row in the drawn tree, not the end of the list.
  const tree = JSON.stringify(view.tree())
  const details = tree.indexOf('sc-11 · Sub-task of sc-10')
  assert.ok(details > tree.indexOf('First sub-task'))
  assert.ok(details < tree.indexOf('@ada · Analytical Engines'))
  await view.press({ text: 'Open in Shortcut' })
  assert.deepEqual(host.callsOf('shell.openExternal'), [
    { url: 'https://app.shortcut.com/ws/story/11' }
  ])
  assert.deepEqual(view.refusals, [])

  await view.press({ type: 'ListItem', text: /First sub-task/ })
  assert.equal(view.find({ text: 'Open in Shortcut' }), null)
  await view.unmount()
})

test('the footer names the connection and stays after the list', async () => {
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': list } })
  const view = await mount(panel, { host })
  const tree = JSON.stringify(view.tree())
  const lastRow = tree.lastIndexOf('First sub-task')
  assert.ok(tree.indexOf('@ada · Analytical Engines') > lastRow)
  assert.ok(view.find({ text: 'Disconnect' }))
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
    { ...worktreeRef(9, { name: 'old' }), storyId: 9, story: storyItem(9, { state: 'Complete', stateType: 'done' }), focused: false, flags: ['done'] },
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


test('marks sub-tasks by their worktree: here, agent working, missing', async () => {
  const view = await mount(panel, { host: linkedHost() })
  const subtasks = rows(view)
  assert.deepEqual(
    subtasks.map((row) => [row.icon, row.description, row.pills]),
    [
      ['branch', 'sc-11 · here', ['warning:Ready']],
      ['bot', 'sc-12 · agent working', ['warning:Ready']],
      ['warning', 'sc-13', ['warning:Ready', 'danger:no worktree']]
    ]
  )
  // The focused worktree's sub-task is highlighted, as Orca highlights the current worktree.
  assert.deepEqual(subtasks.map((row) => row.current), [true, false, false])
  await view.unmount()
})

test('follows Orca focus into the list', async () => {
  const view = await mount(panel, { host: linkedHost() })
  await view.post('focus.changed', { branch: working.branch, storyId: 12 })
  const subtasks = rows(view)
  assert.deepEqual(subtasks.map((row) => row.current), [false, true, false])
  assert.equal(subtasks[1].description, 'sc-12 · here')
  await view.unmount()
})

test('the card opens the sub-task worktree and says what is off', async () => {
  const sent: unknown[] = []
  const view = await mount(panel, {
    host: linkedHost({ 'worktrees.open': (input: unknown) => (sent.push(input), null) })
  })
  await view.press({ type: 'ListItem', text: /Focused work/ })
  await view.press({ text: 'Open worktree' })
  assert.deepEqual(sent, [{ workspaceId: here.workspaceId }])

  await view.press({ type: 'ListItem', text: /Forgotten work/ })
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
  assert.deepEqual(
    rows(view).map((row) => [row.title, row.current, row.pills]),
    [
      ['Story 9', false, ['success:Complete', 'neutral:clean up']],
      ['Focused work', true, ['warning:Ready']]
    ]
  )
  assert.ok(view.find({ text: /^Done in Shortcut\. Remove the worktree/ }))
  await view.press({ type: 'ListItem', text: /Story 9/ })
  assert.deepEqual(sent, [{ workspaceId: 'ws-9' }])
  await view.unmount()
})

test('a sub-task with a worktree but still in the backlog gets the flag, not the warning', async () => {
  const early = storyItem(14, { name: 'Early work', parentId: 10, state: 'New', stateType: 'backlog', worktrees: [worktreeRef(14)], flags: ['not-started'] })
  const withEarly: StoryList = {
    ...linkedList,
    groups: [{ ...linkedList.groups[0], subtasks: [...linkedList.groups[0].subtasks, early] }]
  }
  const view = await mount(panel, { host: linkedHost({ 'stories.list': withEarly }) })
  const row = rows(view)[3]
  assert.deepEqual([row.icon, row.description, row.pills], [
    'flag',
    'sc-14 · ada/sc-14/work',
    ['neutral:New', 'neutral:not started']
  ])
  await view.press({ type: 'ListItem', text: /Early work/ })
  assert.ok(view.summary().some((line) => line.startsWith('Callout accent')))
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


// ---- Starting work ----

const workOptions = {
  projects: [
    { id: 'p-engine', name: 'engine', hostId: 'local' },
    { id: 'p-mill', name: 'mill', hostId: 'ssh:box' }
  ],
  suggestedProjectId: 'p-engine',
  branch: 'ada/sc-11/first-sub-task',
  agents: ['claude', 'codex'],
  defaultAgent: 'claude'
}

test('starts work on a sub-task: options first, then the worktree', async () => {
  const sent: { name: string; input: unknown }[] = []
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': list,
      'work.options': (input: unknown) => (sent.push({ name: 'work.options', input }), workOptions),
      'work.start': (input: unknown) => (
        sent.push({ name: 'work.start', input }),
        {
          workspaceId: 'new',
          branch: workOptions.branch,
          existing: false,
          done: ['Created a worktree in engine.', 'Started codex on it.'],
          warnings: ['Could not update sc-10: down']
        }
      )
    }
  })
  const view = await mount(panel, { host })
  // Opening the sub-task asks for its options at once: the form is ready, with one button.
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  assert.deepEqual(sent, [{ name: 'work.options', input: { storyId: 11 } }])
  assert.equal(view.findAll({ type: 'Button', text: /Start work/ }).length, 1)

  assert.equal(view.valueOf({ label: 'Project' }), 'p-engine')
  assert.equal(view.valueOf({ label: 'Agent' }), 'claude')
  assert.ok(view.find({ text: 'Branch: ada/sc-11/first-sub-task' }))
  await view.select({ label: 'Agent' }, 'codex')
  await view.press({ type: 'Button', text: 'Start work' })

  assert.deepEqual(sent[1], {
    name: 'work.start',
    input: { storyId: 11, projectId: 'p-engine', agent: 'codex' }
  })
  assert.ok(view.summary().some((line) => line.includes('Work started')))
  assert.ok(view.summary().some((line) => line.includes('Needs a look')))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('"No agent" starts work without one', async () => {
  let started: unknown = null
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': list,
      'work.options': workOptions,
      'work.start': (input: unknown) => (
        (started = input),
        { workspaceId: 'new', branch: workOptions.branch, existing: false, done: [], warnings: [] }
      )
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  await view.select({ label: 'Agent' }, 'none')
  await view.press({ type: 'Button', text: 'Start work' })
  assert.deepEqual(started, { storyId: 11, projectId: 'p-engine', agent: null })
  await view.unmount()
})

test('says why work could not start, and keeps the form', async () => {
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': list,
      'work.options': workOptions,
      'work.start': () => {
        throw hostError('action_failed', "this project's setup script needs a decision")
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  await view.press({ type: 'Button', text: 'Start work' })
  assert.ok(view.find({ text: "this project's setup script needs a decision" }))
  assert.ok(view.find({ label: 'Project' }))
  await view.unmount()
})

test('a story offers no worktree of its own', async () => {
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': list } })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /Lone story/ })
  assert.equal(view.find({ type: 'Button', text: 'Start work' }), null)
  assert.ok(view.find({ text: "Work starts on a story's sub-tasks." }))
  await view.unmount()
})

// ---- Structure ----

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Every node of the drawn tree, outer ones included (findAll returns only the innermost match). */
function nodes(view: View): Node[] {
  const found: Node[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const el = node as Node
    found.push(el)
    for (const child of el.children ?? []) walk(child)
  }
  walk(view.tree())
  return found
}

/** The words under a node, as a person reads them. */
function words(node: unknown): string {
  if (typeof node === 'string') return node
  const el = node as Node
  return (el?.children ?? []).map(words).join(' ')
}

test('each story is its own card, and the selected row shares an accent tint with its details', async () => {
  const host = mockHost({
    requests: { 'auth.status': connected, 'stories.list': list, 'work.options': workOptions }
  })
  const view = await mount(panel, { host })
  const boxes = () => nodes(view).filter((node) => node.type === 'Box')
  // One card per story, set apart by its background: the lone story, and the story with its sub-tasks.
  assert.equal(boxes().filter((box) => box.props?.background === 'muted').length, 2)
  assert.equal(boxes().filter((box) => box.props?.background === 'accent').length, 0)

  await view.press({ type: 'ListItem', text: /First sub-task/ })
  const frames = boxes().filter((box) => box.props?.background === 'accent')
  assert.equal(frames.length, 1)
  const framed = words(frames[0])
  // The selected row and its details, and nothing else.
  assert.match(framed, /First sub-task/)
  assert.match(framed, /Open in Shortcut/)
  assert.ok(!/Lone story/.test(framed), 'only the selected row is framed')
  await view.unmount()
})

test("the focused worktree's sub-task gets its own tint and Orca's current highlight, without opening", async () => {
  const view = await mount(panel, { host: linkedHost() })
  const tinted = nodes(view).filter((node) => node.type === 'Box' && node.props?.background === 'success')
  assert.equal(tinted.length, 1)
  assert.match(words(tinted[0]), /Focused work/)
  assert.deepEqual(rows(view).map((row) => row.current), [true, false, false])
  // Focus marks where you are; it does not open the row's details.
  assert.equal(view.find({ text: 'Open worktree' }), null)

  // Selecting the focused row: its details open on the selection tint, which takes over.
  await view.press({ type: 'ListItem', text: /Focused work/ })
  const boxes = nodes(view).filter((node) => node.type === 'Box')
  assert.equal(boxes.filter((box) => box.props?.background === 'success').length, 0)
  assert.match(words(boxes.find((box) => box.props?.background === 'accent')), /Open worktree/)
  await view.unmount()
})

test('the Worktrees tab tints the focused worktree too', async () => {
  const view = await mount(panel, { host: linkedHost() })
  await view.select({ label: 'View' }, 'worktrees')
  // Tabs keep the hidden Stories tab in the tree, with its own tint: find the Worktrees row's,
  // whose second line names the branch.
  const tinted = nodes(view).filter((node) => node.type === 'Box' && node.props?.background === 'success')
  assert.equal(tinted.filter((box) => /ada\/sc-11\/work/.test(words(box))).length, 1)
  await view.unmount()
})

// ---- Creating sub-tasks ----

test('creates a sub-task from a story, then opens it with Start work ready', async () => {
  const sent: { name: string; input: unknown }[] = []
  let after = false
  const withNew: StoryList = {
    ...list,
    groups: [
      {
        story: storyItem(30, { name: 'Lone story', subTaskCount: 1 }),
        matched: true,
        subtasks: [storyItem(31, { name: 'Tabulate the results', parentId: 30 })]
      },
      list.groups[1]
    ]
  }
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': () => (after ? withNew : list),
      'subtask.create': (input: unknown) => {
        sent.push({ name: 'subtask.create', input })
        after = true
        return { id: 31, name: 'Tabulate the results', state: 'Ready', warnings: [] }
      },
      'work.options': (input: unknown) => (sent.push({ name: 'work.options', input }), workOptions)
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /Lone story/ })
  assert.equal(view.find({ type: 'Button', text: 'Create sub-task' })?.props?.disabled, true)
  await view.type({ label: 'New sub-task' }, 'Tabulate the results')
  await view.press({ type: 'Button', text: 'Create sub-task' })

  assert.deepEqual(sent, [
    { name: 'subtask.create', input: { parentId: 30, name: 'Tabulate the results' } },
    { name: 'work.options', input: { storyId: 31 } }
  ])
  // The new sub-task is open, under its story, with its Start work form.
  const frame = nodes(view).find((node) => node.type === 'Box' && node.props?.background === 'accent')
  assert.match(words(frame), /Tabulate the results/)
  assert.ok(view.find({ type: 'Button', text: 'Start work' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says when the filter does not show the new sub-task', async () => {
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': list,
      'subtask.create': { id: 31, name: 'Hidden', state: 'New', warnings: [] }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /Lone story/ })
  await view.type({ label: 'New sub-task' }, 'Hidden', { submit: true })
  assert.ok(view.find({ text: 'Created sc-31 in New. The current filter does not show it.' }))
  await view.unmount()
})

test('says why a sub-task could not be created, keeping the title', async () => {
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': list,
      'subtask.create': () => {
        throw hostError('invalid_params', 'Shortcut takes titles of at most 512 characters.')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /Lone story/ })
  await view.type({ label: 'New sub-task' }, 'Too long')
  await view.press({ type: 'Button', text: 'Create sub-task' })
  assert.ok(view.find({ text: 'Shortcut takes titles of at most 512 characters.' }))
  assert.equal(view.valueOf({ label: 'New sub-task' }), 'Too long')
  await view.unmount()
})

test('a story header opens the story, with Create sub-task, above its sub-tasks', async () => {
  const host = mockHost({ requests: { 'auth.status': connected, 'stories.list': list } })
  const view = await mount(panel, { host })
  assert.deepEqual(headers(view), ['Parent story'])
  await view.press({ type: 'ListItem', text: /Parent story/ })
  const frame = nodes(view).find((node) => node.type === 'Box' && node.props?.background === 'accent')
  const framed = words(frame)
  assert.match(framed, /Parent story/)
  assert.match(framed, /Create sub-task/)
  // The sub-tasks stay outside the story's details.
  assert.ok(!/First sub-task/.test(framed))
  await view.press({ type: 'ListItem', text: /Parent story/ })
  assert.equal(view.find({ type: 'Button', text: 'Create sub-task' }), null)
  await view.unmount()
})

// ---- Folding ----

test('a story folds its sub-tasks away, says how many, and remembers it', async () => {
  const view = await mount(panel, { host: linkedHost() })
  assert.equal(rows(view).length, 3)
  await view.press({ type: 'IconButton', label: 'Hide sub-tasks of sc-10' })
  assert.equal(rows(view).length, 0)
  // The focused worktree's sub-task is among them: the header says where you are.
  assert.ok(view.find({ text: '3 sub-tasks · here' }))
  assert.deepEqual(view.persisted.plugin.collapsed, [10])

  await view.press({ type: 'IconButton', label: 'Show sub-tasks of sc-10' })
  assert.equal(rows(view).length, 3)
  assert.deepEqual(view.persisted.plugin.collapsed, [])
  await view.unmount()
})

test('a story folded in an earlier run starts folded', async () => {
  const view = await mount(panel, { host: linkedHost(), persisted: { plugin: { collapsed: [10] } } })
  assert.equal(rows(view).length, 0)
  assert.ok(view.find({ type: 'IconButton', label: 'Show sub-tasks of sc-10' }))
  await view.unmount()
})

// ---- Moving state ----

/** The list, with sub-task 11 able to move on to In Development or Complete. */
const movable: StoryList = {
  ...list,
  groups: [
    list.groups[0],
    {
      ...list.groups[1],
      subtasks: [
        storyItem(11, {
          name: 'First sub-task',
          parentId: 10,
          nextStates: [
            { id: 104, name: 'In Development (Sub-tasks)', type: 'started' },
            { id: 108, name: 'Complete', type: 'done' }
          ]
        })
      ]
    }
  ]
}

function moveHost(sent: unknown[], loads: { count: number }) {
  return mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': () => (loads.count++, movable),
      'work.options': workOptions,
      'story.move': (input: { storyId: number; stateId: number }) => {
        sent.push(input)
        return input.stateId === 108
          ? { id: 11, state: 'Complete', stateType: 'done' }
          : { id: 11, state: 'In Development (Sub-tasks)', stateType: 'started' }
      }
    }
  })
}

test('moves a sub-task forward from its details, then reloads the list', async () => {
  const sent: unknown[] = []
  const loads = { count: 0 }
  const view = await mount(panel, { host: moveHost(sent, loads) })
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  assert.equal(view.find({ type: 'Button', text: 'Move' })?.props?.disabled, true)
  await view.select({ label: 'Move to' }, '104')
  await view.press({ type: 'Button', text: 'Move' })
  assert.deepEqual(sent, [{ storyId: 11, stateId: 104 }])
  assert.equal(loads.count, 2)
  assert.ok(view.find({ text: 'Moved sc-11 to In Development (Sub-tasks).' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a done state asks first, and Cancel moves nothing', async () => {
  const sent: unknown[] = []
  const view = await mount(panel, { host: moveHost(sent, { count: 0 }) })
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  await view.select({ label: 'Move to' }, '108')
  await view.press({ type: 'Button', text: 'Move' })
  assert.deepEqual(sent, [])
  assert.match(words(nodes(view).find((node) => node.type === 'Callout')), /Move sc-11 to Complete\?/)
  await view.press({ type: 'Button', text: 'Cancel' })
  assert.equal(view.find({ type: 'Button', text: 'Move to Complete' }), null)

  await view.press({ type: 'Button', text: 'Move' })
  await view.press({ type: 'Button', text: 'Move to Complete' })
  assert.deepEqual(sent, [{ storyId: 11, stateId: 108 }])
  await view.unmount()
})

test('offers no picker without later states, and says why a move failed', async () => {
  const host = mockHost({
    requests: {
      'auth.status': connected,
      'stories.list': movable,
      'work.options': workOptions,
      'story.move': () => {
        throw hostError('invalid_params', 'sc-11 can only move forward from Complete here; move it to Ready in Shortcut.')
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ type: 'ListItem', text: /Lone story/ })
  assert.equal(view.find({ label: 'Move to' }), null)
  await view.press({ type: 'ListItem', text: /First sub-task/ })
  await view.select({ label: 'Move to' }, '104')
  await view.press({ type: 'Button', text: 'Move' })
  assert.ok(view.find({ text: /can only move forward from Complete/ }))
  await view.unmount()
})
