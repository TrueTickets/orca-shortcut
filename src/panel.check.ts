// `orca plugin check` renders the panel once per scenario. Connected scenarios answer the
// panel's requests with fixed data instead of running the worker, which would call Shortcut.
import { defineCheck } from 'orca/testing'
import type { AuthStatus, StoryList } from './protocol'

const connected: AuthStatus = {
  connected: true,
  secretsAvailable: true,
  member: { name: 'Ada Lovelace', mentionName: 'ada', workspaceName: 'Analytical Engines' }
}

const url = (id: number) => `https://app.shortcut.com/engines/story/${id}`

const stories: StoryList = {
  filter: { states: ['Ready'], owner: 'me' },
  states: [
    { name: 'New', type: 'backlog' },
    { name: 'Ready', type: 'unstarted' },
    { name: 'In Progress (Stories)', type: 'started' },
    { name: 'In Development (Sub-tasks)', type: 'started' },
    { name: 'PR Review (Sub-tasks)', type: 'started' },
    { name: 'Complete', type: 'done' }
  ],
  groups: [
    {
      story: { id: 305, name: 'Publish the difference engine tables', url: url(305), state: 'Ready', parentId: null, subTaskCount: 0 },
      matched: true,
      subtasks: []
    },
    {
      story: { id: 210, name: 'Program the Analytical Engine for Bernoulli numbers', url: url(210), state: 'In Progress (Stories)', parentId: null, subTaskCount: 3 },
      matched: false,
      subtasks: [
        { id: 211, name: 'Lay out the operation cards', url: url(211), state: 'Ready', parentId: 210, subTaskCount: 0 },
        { id: 212, name: 'Check variable cards against Note G', url: url(212), state: 'Ready', parentId: 210, subTaskCount: 0 }
      ]
    }
  ],
  truncated: false
}

export default defineCheck({
  disconnected: { results: { 'secrets.protection': { status: 'os-keyring' } } },
  noKeyStore: { results: { 'secrets.protection': { status: 'unavailable' } } },
  stories: { requests: { 'auth.status': connected, 'stories.list': stories } },
  noStories: { requests: { 'auth.status': connected, 'stories.list': { ...stories, groups: [] } } }
})
