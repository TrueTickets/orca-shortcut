// Pure logic between Shortcut and the panel: the filter as Shortcut search queries, and search
// results as a parent story → sub-task tree. No I/O, so it is tested directly.
import type {
  StoryFilter,
  StoryGroup,
  StoryItem,
  StoryOwner,
  WorkflowStateOption,
  WorktreeRef
} from './protocol'
import type { ShortcutStory, ShortcutWorkflowState } from './shortcut-api'
import { forwardStates } from './state-moves'
import { storyFlags } from './worktree-links'

/** Worktrees by the story id their branch names (see worktree-links.ts). */
export type WorktreeIndex = ReadonlyMap<number, readonly WorktreeRef[]>

export const STORY_OWNERS: readonly StoryOwner[] = ['me', 'anyone', 'unassigned']

/** One Shortcut search query per state, since a query takes a single `state:`. */
export function buildSearchQuery(state: string, owner: StoryOwner, mentionName: string): string {
  const parts = [`state:"${state.replaceAll('"', '')}"`, '!is:archived']
  if (owner === 'me') {
    parts.unshift(`owner:${mentionName}`)
  } else if (owner === 'unassigned') {
    parts.unshift('!has:owner')
  }
  return parts.join(' ')
}

/** Workflow states by name, in workflow order: workflows may repeat a name, the filter names it once. */
export function workflowStateOptions(states: readonly ShortcutWorkflowState[]): WorkflowStateOption[] {
  const byName = new Map<string, WorkflowStateOption>()
  for (const state of [...states].sort((a, b) => a.position - b.position)) {
    if (!byName.has(state.name)) {
      byName.set(state.name, { name: state.name, type: state.type })
    }
  }
  return [...byName.values()]
}

/** A filter from settings or a stored value: unknown owners fall back, states are trimmed and deduped. */
export function normalizeFilter(
  raw: { states?: unknown; owner?: unknown } | null | undefined,
  fallback: StoryFilter
): StoryFilter {
  const states = Array.isArray(raw?.states)
    ? raw.states
    : typeof raw?.states === 'string'
      ? raw.states.split(',')
      : fallback.states
  const cleaned = [
    ...new Set(states.map((state) => String(state).trim()).filter((state) => state.length > 0))
  ]
  const owner = STORY_OWNERS.includes(raw?.owner as StoryOwner)
    ? (raw?.owner as StoryOwner)
    : fallback.owner
  return { states: cleaned, owner }
}

/** A story as the panel shows it, with the worktrees its id names and what is off. */
export function toStoryItem(
  story: ShortcutStory,
  states: ReadonlyMap<number, ShortcutWorkflowState>,
  worktrees: WorktreeIndex
): StoryItem {
  const state = states.get(story.workflowStateId)
  const item = {
    id: story.id,
    name: story.name,
    url: story.appUrl,
    state: state?.name ?? 'Unknown state',
    stateType: state?.type ?? '',
    archived: story.archived,
    parentId: story.parentStoryId,
    subTaskCount: story.subTaskIds.length,
    worktrees: [...(worktrees.get(story.id) ?? [])]
  }
  return {
    ...item,
    flags: storyFlags(item),
    nextStates: forwardStates(story.workflowStateId, story.parentStoryId !== null, [...states.values()])
  }
}

export function statesById(
  states: readonly ShortcutWorkflowState[]
): Map<number, ShortcutWorkflowState> {
  return new Map(states.map((state) => [state.id, state]))
}

/**
 * Groups matching stories under their parent story. A matching sub-task sits under its parent
 * (`parents` holds the parents that did not match themselves); a matching story without a parent
 * is a group of its own, marked `matched`. Newest groups first; sub-tasks in creation order.
 */
export function buildStoryGroups(
  matches: readonly ShortcutStory[],
  parents: ReadonlyMap<number, ShortcutStory>,
  states: readonly ShortcutWorkflowState[],
  worktrees: WorktreeIndex = new Map()
): StoryGroup[] {
  const byId = statesById(states)
  const item = (story: ShortcutStory) => toStoryItem(story, byId, worktrees)
  const matchedById = new Map(matches.map((story) => [story.id, story]))
  const groups = new Map<number, StoryGroup>()

  const groupFor = (story: ShortcutStory, matched: boolean): StoryGroup => {
    let group = groups.get(story.id)
    if (!group) {
      group = { story: item(story), matched, subtasks: [] }
      groups.set(story.id, group)
    }
    group.matched ||= matched
    return group
  }

  for (const story of matches) {
    if (story.parentStoryId === null) {
      groupFor(story, true)
      continue
    }
    const parent = matchedById.get(story.parentStoryId) ?? parents.get(story.parentStoryId)
    if (parent) {
      // The parent is a group even when it only shows as context for this sub-task.
      groupFor(parent, matchedById.has(parent.id) && parent.parentStoryId === null).subtasks.push(
        item(story)
      )
    } else {
      // A parent Shortcut could not return (deleted, or no access): keep the sub-task visible.
      groupFor(story, true)
    }
  }

  for (const group of groups.values()) {
    group.subtasks.sort((a, b) => a.id - b.id)
  }
  return [...groups.values()].sort((a, b) => b.story.id - a.story.id)
}

/** "Ready · Mine", for the collapsed filter. */
export function describeFilter(filter: StoryFilter): string {
  const owner = { me: 'Mine', anyone: 'Anyone', unassigned: 'Unassigned' }[filter.owner]
  const states = filter.states.length === 0 ? 'No states' : filter.states.join(', ')
  return `${states} · ${owner}`
}
