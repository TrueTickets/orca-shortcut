import { assert, test } from 'orca/testing'
import type { ShortcutStory, ShortcutWorkflowState } from './shortcut-api'
import {
  buildSearchQuery,
  buildStoryGroups,
  describeFilter,
  normalizeFilter,
  workflowStateOptions
} from './story-tree'

const STATES: ShortcutWorkflowState[] = [
  { id: 1, name: 'New', type: 'backlog', position: 0, workflowId: 1 },
  { id: 2, name: 'Ready', type: 'unstarted', position: 3, workflowId: 1 },
  { id: 3, name: 'In Progress (Stories)', type: 'started', position: 4, workflowId: 1 },
  { id: 4, name: 'In Development (Sub-tasks)', type: 'started', position: 5, workflowId: 1 },
  { id: 5, name: 'Complete', type: 'done', position: 9, workflowId: 1 }
]

function story(id: number, fields: Partial<ShortcutStory> = {}): ShortcutStory {
  return {
    id,
    name: `Story ${id}`,
    appUrl: `https://app.shortcut.com/ws/story/${id}`,
    storyType: 'feature',
    archived: false,
    workflowId: 1,
    workflowStateId: 2,
    parentStoryId: null,
    subTaskIds: [],
    ownerIds: [],
    description: '',
    groupId: null,
    ...fields
  }
}

test('builds one search query per state and owner', () => {
  assert.equal(buildSearchQuery('Ready', 'me', 'ada'), 'owner:ada state:"Ready" !is:archived')
  assert.equal(buildSearchQuery('Ready', 'anyone', 'ada'), 'state:"Ready" !is:archived')
  assert.equal(
    buildSearchQuery('In Development (Sub-tasks)', 'unassigned', 'ada'),
    '!has:owner state:"In Development (Sub-tasks)" !is:archived'
  )
  // A quote in a state name cannot break out of the query.
  assert.equal(buildSearchQuery('Odd "name"', 'anyone', 'x'), 'state:"Odd name" !is:archived')
})

test('names each workflow state once, in workflow order', () => {
  const states: ShortcutWorkflowState[] = [
    { id: 9, name: 'Done', type: 'done', position: 2, workflowId: 1 },
    { id: 7, name: 'Ready', type: 'unstarted', position: 1, workflowId: 1 },
    { id: 8, name: 'Ready', type: 'unstarted', position: 1, workflowId: 1 }
  ]
  assert.deepEqual(workflowStateOptions(states), [
    { name: 'Ready', type: 'unstarted' },
    { name: 'Done', type: 'done' }
  ])
})

test('normalizes filters from settings and storage', () => {
  const fallback = { states: ['Ready'], owner: 'me' as const }
  assert.deepEqual(normalizeFilter({ states: ' Ready, In Development (Sub-tasks) ,,Ready', owner: 'anyone' }, fallback), {
    states: ['Ready', 'In Development (Sub-tasks)'],
    owner: 'anyone'
  })
  assert.deepEqual(normalizeFilter({ states: ['New'], owner: 'nobody' }, fallback), {
    states: ['New'],
    owner: 'me'
  })
  assert.deepEqual(normalizeFilter(null, fallback), fallback)
  assert.deepEqual(normalizeFilter({ states: [], owner: 'me' }, fallback), { states: [], owner: 'me' })
})

test('groups sub-tasks under their parent story, fetched or matched', () => {
  const matches = [
    story(11, { parentStoryId: 10, workflowStateId: 2 }),
    story(12, { parentStoryId: 10, workflowStateId: 4 }),
    story(21, { parentStoryId: 20 }),
    story(20, { subTaskIds: [21, 22], workflowStateId: 3 })
  ]
  // Story 10 did not match (someone else owns it); the worker fetched it.
  const parents = new Map([[10, story(10, { subTaskIds: [11, 12], workflowStateId: 3 })]])
  const groups = buildStoryGroups(matches, parents, STATES)

  assert.deepEqual(
    groups.map((group) => [group.story.id, group.matched, group.subtasks.map((s) => s.id)]),
    [
      [20, true, [21]],
      [10, false, [11, 12]]
    ]
  )
  assert.equal(groups[1].story.state, 'In Progress (Stories)')
  assert.equal(groups[1].subtasks[1].state, 'In Development (Sub-tasks)')
  assert.equal(groups[1].story.subTaskCount, 2)
  assert.equal(groups[1].subtasks[0].parentId, 10)
})

test('a story without a parent is its own group', () => {
  const groups = buildStoryGroups([story(30)], new Map(), STATES)
  assert.deepEqual(groups, [
    {
      story: {
        id: 30,
        name: 'Story 30',
        url: 'https://app.shortcut.com/ws/story/30',
        state: 'Ready',
        stateType: 'unstarted',
        archived: false,
        parentId: null,
        subTaskCount: 0,
        worktrees: [],
        flags: [],
        // Forward, and a story's: the sub-task state is left out.
        nextStates: [
          { id: 3, name: 'In Progress (Stories)', type: 'started' },
          { id: 5, name: 'Complete', type: 'done' }
        ]
      },
      matched: true,
      subtasks: []
    }
  ])
})

test('attaches the worktrees whose branch names each story, and flags what is off', () => {
  const ref = (workspaceId: string, branch: string) => ({
    workspaceId,
    name: workspaceId,
    branch,
    path: `/w/${workspaceId}`,
    project: 'infra',
    projectId: 'project-infra',
    agent: null
  })
  const worktrees = new Map([
    [11, [ref('a', 'ada/sc-11/slug')]],
    [10, [ref('b', 'ada/sc-10/story')]]
  ])
  const matches = [
    story(11, { parentStoryId: 10, workflowStateId: 4 }),
    story(12, { parentStoryId: 10, workflowStateId: 4 })
  ]
  const parents = new Map([[10, story(10, { subTaskIds: [11, 12], workflowStateId: 3 })]])
  const [group] = buildStoryGroups(matches, parents, STATES, worktrees)

  assert.deepEqual(group.story.worktrees.map((w) => w.workspaceId), ['b'])
  assert.deepEqual(group.story.flags, ['on-story'])
  assert.deepEqual(group.subtasks.map((s) => [s.id, s.worktrees.length, s.flags]), [
    [11, 1, []],
    [12, 0, ['no-worktree']]
  ])
})

test('keeps a sub-task visible when its parent could not be fetched', () => {
  const groups = buildStoryGroups([story(41, { parentStoryId: 40 })], new Map(), STATES)
  assert.deepEqual(
    groups.map((group) => [group.story.id, group.matched, group.subtasks.length]),
    [[41, true, 0]]
  )
})

test('an unknown workflow state is named, not dropped', () => {
  const [group] = buildStoryGroups([story(50, { workflowStateId: 999 })], new Map(), STATES)
  assert.equal(group.story.state, 'Unknown state')
})

test('describes the filter for the collapsed filter row', () => {
  assert.equal(describeFilter({ states: ['Ready'], owner: 'me' }), 'Ready · Mine')
  assert.equal(describeFilter({ states: [], owner: 'unassigned' }), 'No states · Unassigned')
})
