// Which Orca worktree belongs to which Shortcut story. The link is the story id in the worktree's
// live git branch (`ada/sc-1841/slug`), the same one Shortcut's VCS integration reads, so
// it holds for worktrees made by hand and survives the plugin's storage. No I/O here.
import type {
  AgentState,
  LinkedWorktree,
  StoryItem,
  WorktreeFlag,
  WorktreeRef
} from './protocol'

/** A worktree as `workspace.list` answers it, with the fields this module reads. */
export type ListedWorkspace = {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  project?: string | null
  projectId?: string | null
  path: string
  branch: string | null
  status?: { state: string }
}

/** The branch without `refs/heads/`, which some Orca answers include. */
export function shortBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

/**
 * The story id a branch names, as a whole `sc-<id>` path segment or segment prefix:
 * `ada/sc-1841/slug`, `sc-1841`, `ada/sc-1841-slug` (Orca's own naming). Not `disc-12`.
 */
export function storyIdOfBranch(branch: string | null | undefined): number | null {
  if (!branch) {
    return null
  }
  const match = /(?:^|\/)sc-(\d+)(?=$|[/-])/i.exec(shortBranch(branch))
  return match ? Number(match[1]) : null
}

const AGENT_STATES: readonly AgentState[] = ['working', 'permission', 'done', 'active', 'inactive']

function agentOf(workspace: ListedWorkspace): AgentState | null {
  const state = workspace.status?.state as AgentState | undefined
  return state && AGENT_STATES.includes(state) ? state : null
}

/** Every worktree whose branch names a story, by story id. Folders have no branch to read. */
export function indexWorktrees(workspaces: readonly ListedWorkspace[]): Map<number, WorktreeRef[]> {
  const index = new Map<number, WorktreeRef[]>()
  for (const workspace of workspaces) {
    const storyId = workspace.kind === 'worktree' ? storyIdOfBranch(workspace.branch) : null
    if (storyId === null || workspace.branch === null) {
      continue
    }
    const ref: WorktreeRef = {
      workspaceId: workspace.id,
      name: workspace.name,
      branch: shortBranch(workspace.branch),
      path: workspace.path,
      project: workspace.project ?? null,
      projectId: workspace.projectId ?? null,
      agent: agentOf(workspace)
    }
    index.set(storyId, [...(index.get(storyId) ?? []), ref])
  }
  return index
}

/** States a sub-task is being worked on in; its worktree should exist. */
const IN_PROGRESS = 'started'
const DONE = 'done'
const BACKLOG = 'backlog'

/** What is off about a story and its worktrees, as the list shows it. */
export function storyFlags(item: Omit<StoryItem, 'flags'>): WorktreeFlag[] {
  const flags: WorktreeFlag[] = []
  const isSubtask = item.parentId !== null
  if (isSubtask && item.stateType === IN_PROGRESS && item.worktrees.length === 0) {
    flags.push('no-worktree')
  }
  if (item.worktrees.length > 1) {
    flags.push('duplicate')
  }
  if (!isSubtask && item.worktrees.length > 0) {
    flags.push('on-story')
  }
  if ((item.stateType === DONE || item.archived) && item.worktrees.length > 0) {
    flags.push('stale')
  } else if (item.stateType === BACKLOG && item.worktrees.length > 0) {
    flags.push('not-started')
  }
  return flags
}

/**
 * Flags that are a heads-up rather than a problem: Shortcut is behind the work, not wrong.
 * They show with their own icon and tone.
 */
export const NOTICE_FLAGS: readonly WorktreeFlag[] = ['not-started']

/** Whether a flag is a problem (amber warning) rather than a heads-up (accent flag). */
export const isProblem = (flag: WorktreeFlag): boolean => !NOTICE_FLAGS.includes(flag)

/**
 * The Worktrees tab: each linked worktree with its story (null when Shortcut no longer has it)
 * and what is off. Worktrees whose story Shortcut could not return are flagged `missing-story`.
 */
export function linkWorktrees(
  index: ReadonlyMap<number, WorktreeRef[]>,
  stories: ReadonlyMap<number, StoryItem>,
  /** The focused worktree's branch. Matched by branch, since Orca's workspace ids differ between
   *  its APIs, and Git checks a branch out in one worktree of a repository at a time. */
  focusedBranch: string | null
): LinkedWorktree[] {
  const focused = focusedBranch ? shortBranch(focusedBranch) : null
  const linked: LinkedWorktree[] = []
  for (const [storyId, refs] of index) {
    const story = stories.get(storyId) ?? null
    for (const ref of refs) {
      linked.push({
        ...ref,
        storyId,
        story,
        focused: ref.branch === focused,
        flags: story ? story.flags.filter((flag) => flag !== 'no-worktree') : ['missing-story']
      })
    }
  }
  // Problems first, then newest story first.
  return linked.sort(
    (a, b) => Number(b.flags.length > 0) - Number(a.flags.length > 0) || b.storyId - a.storyId
  )
}

/** One line per flag, for the detail card and the Worktrees tab. */
export const FLAG_TEXT: Record<WorktreeFlag, string> = {
  'no-worktree': 'In progress without a worktree.',
  duplicate: 'More than one worktree has this story’s branch.',
  'on-story': 'The worktree is on a story; work belongs on its sub-tasks.',
  stale: 'The story is done or archived: the worktree can go.',
  'missing-story': 'Shortcut has no such story, or this token cannot see it.',
  'not-started': 'Has a worktree but is still in a backlog state: move it along in Shortcut.'
}

/** Short pill text for each flag; the card spells it out. */
export const FLAG_PILL: Record<WorktreeFlag, string> = {
  'no-worktree': 'no worktree',
  duplicate: 'duplicate',
  'on-story': 'on story',
  stale: 'stale',
  'missing-story': 'missing',
  'not-started': 'not started'
}
