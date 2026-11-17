// `orca plugin check` renders the panel once per scenario. Connected scenarios answer the
// panel's requests with fixed data instead of running the worker, which would call Shortcut.
import { defineCheck } from 'orca/testing'
import type { StoryList, WorktreeList } from './protocol'
import { connected, storyItem, WORKFLOW_STATES, worktreeRef } from './test-fixtures'

const focusedRef = worktreeRef(211)
const agentRef = worktreeRef(212, { agent: 'working' })

const stories: StoryList = {
  filter: { states: ['Ready', 'In Development (Sub-tasks)'], owner: 'me' },
  states: WORKFLOW_STATES,
  groups: [
    {
      story: storyItem(305, { name: 'Publish the difference engine tables' }),
      matched: true,
      subtasks: []
    },
    {
      story: storyItem(210, {
        name: 'Program the Analytical Engine for Bernoulli numbers',
        state: 'In Progress (Stories)',
        stateType: 'started',
        subTaskCount: 3
      }),
      matched: false,
      subtasks: [
        storyItem(211, {
          name: 'Lay out the operation cards',
          parentId: 210,
          state: 'In Development (Sub-tasks)',
          stateType: 'started',
          worktrees: [focusedRef]
        }),
        storyItem(212, {
          name: 'Check variable cards against Note G',
          parentId: 210,
          state: 'In Development (Sub-tasks)',
          stateType: 'started',
          worktrees: [agentRef]
        }),
        storyItem(213, {
          name: 'Tabulate the results',
          parentId: 210,
          state: 'In Development (Sub-tasks)',
          stateType: 'started',
          flags: ['no-worktree']
        })
      ]
    }
  ],
  truncated: false
}

const worktrees: WorktreeList = {
  worktrees: [
    {
      ...worktreeRef(150, { name: 'old-tables' }),
      storyId: 150,
      story: storyItem(150, { name: 'Print the old tables', state: 'Complete', stateType: 'done' }),
      focused: false,
      flags: ['done']
    },
    {
      ...focusedRef,
      storyId: 211,
      story: stories.groups[1].subtasks[0],
      focused: true,
      flags: []
    },
    {
      ...agentRef,
      storyId: 212,
      story: stories.groups[1].subtasks[1],
      focused: false,
      flags: []
    }
  ]
}

const connectedRequests = {
  'auth.status': connected,
  'stories.list': stories,
  'worktrees.list': worktrees,
  'focus.get': { branch: focusedRef.branch, storyId: 211 }
}

export default defineCheck({
  disconnected: { results: { 'secrets.protection': { status: 'os-keyring' } } },
  noKeyStore: { results: { 'secrets.protection': { status: 'unavailable' } } },
  stories: { requests: connectedRequests },
  noStories: {
    requests: { ...connectedRequests, 'stories.list': { ...stories, groups: [] } }
  },
  worktrees: { requests: connectedRequests, persisted: { plugin: { tab: 'worktrees' } } }
})
