// Shared by the panel tests and check scenarios. Not loaded by Orca: nothing the plugin runs
// imports it.
import type { AuthStatus, StoryItem, StoryList, WorktreeRef } from './protocol'

export const connected: AuthStatus = {
  connected: true,
  secretsAvailable: true,
  member: { name: 'Ada Lovelace', mentionName: 'ada', workspaceName: 'Analytical Engines' }
}

export function storyItem(id: number, fields: Partial<StoryItem> = {}): StoryItem {
  return {
    id,
    name: `Story ${id}`,
    url: `https://app.shortcut.com/engines/story/${id}`,
    state: 'Ready',
    stateType: 'unstarted',
    archived: false,
    parentId: null,
    subTaskCount: 0,
    worktrees: [],
    flags: [],
    nextStates: [],
    ...fields
  }
}

export function worktreeRef(storyId: number, fields: Partial<WorktreeRef> = {}): WorktreeRef {
  return {
    workspaceId: `ws-${storyId}`,
    name: `sc-${storyId}-work`,
    branch: `ada/sc-${storyId}/work`,
    path: `/work/sc-${storyId}`,
    project: 'engines',
    projectId: 'project-engines',
    agent: null,
    ...fields
  }
}

export const WORKFLOW_STATES: StoryList['states'] = [
  { name: 'New', type: 'backlog' },
  { name: 'Ready', type: 'unstarted' },
  { name: 'In Progress (Stories)', type: 'started' },
  { name: 'In Development (Sub-tasks)', type: 'started' },
  { name: 'PR Review (Sub-tasks)', type: 'started' },
  { name: 'Complete', type: 'done' }
]
