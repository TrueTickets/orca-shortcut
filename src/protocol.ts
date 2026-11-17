// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

declare module 'orca' {
  interface PluginRequests {
    /** Whether a token is stored and whom it belongs to. Never returns the token. */
    'auth.status': { output: AuthStatus }
    /** Checks `token` against Shortcut, then stores it in the plugin's encrypted secrets. */
    'auth.connect': { input: { token: string }; output: AuthStatus }
    /** Forgets the stored token. */
    'auth.disconnect': { output: AuthStatus }
    /**
     * Stories matching `filter`, grouped under their parent story. Without a filter, the
     * `defaultStates` and `defaultOwner` settings apply; the answer says which filter ran.
     */
    'stories.list': { input: { filter?: StoryFilter }; output: StoryList }
    /** Every worktree whose branch names a story, with that story and what is off. */
    'worktrees.list': { output: WorktreeList }
    /** The focused worktree's branch and story, as last reported by Orca. */
    'focus.get': { output: FocusedStory }
    /** What starting work on a story offers: projects, the branch it would use, agents. */
    'work.options': { input: { storyId: number }; output: WorkOptions }
    /**
     * Starts work on a sub-task: opens its worktree if it has one; otherwise creates one in
     * `projectId`, puts it on the Shortcut branch, moves the sub-task and its story along in
     * Shortcut and, with `agent`, starts that agent on it.
     */
    'work.start': { input: { storyId: number; projectId: string; agent: string | null }; output: StartResult }
    /** Shows a worktree in Orca, as clicking it in the sidebar does. */
    'worktrees.open': { input: { workspaceId: string }; output: null }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after connecting or disconnecting. */
    'auth.changed': AuthStatus
    /** A worktree was created or removed: lists that show worktrees are stale. */
    'worktrees.changed': null
    /** The focused worktree changed; `storyId` is the story its branch names, if any. */
    'focus.changed': FocusedStory
  }
}

export type AuthStatus =
  | { connected: false; secretsAvailable: boolean }
  | {
      connected: true
      secretsAvailable: true
      member: { name: string; mentionName: string; workspaceName: string }
    }

export type StoryOwner = 'me' | 'anyone' | 'unassigned'

/** Which stories to list: any of these workflow states (by name), owned as `owner` says. */
export type StoryFilter = { states: string[]; owner: StoryOwner }

export type WorkflowStateOption = { name: string; type: string }

export type AgentState = 'working' | 'permission' | 'done' | 'active' | 'inactive'

/** An Orca worktree whose branch names a story. */
export type WorktreeRef = {
  workspaceId: string
  name: string
  /** Without `refs/heads/`. */
  branch: string
  path: string
  project: string | null
  /** The id `project.list` gives the worktree's project. */
  projectId: string | null
  /** The agent status Orca shows for the worktree, when it reports one. */
  agent: AgentState | null
}

/** What is off between a story and its worktrees. */
export type WorktreeFlag =
  | 'no-worktree'
  | 'duplicate'
  | 'on-story'
  | 'stale'
  | 'missing-story'
  /** Has a worktree while still in a backlog state: work began before Shortcut says so. */
  | 'not-started'

export type StoryItem = {
  id: number
  name: string
  url: string
  /** The workflow state's name, and its type (`backlog`, `unstarted`, `started`, `done`). */
  state: string
  stateType: string
  archived: boolean
  parentId: number | null
  subTaskCount: number
  /** Worktrees whose branch names this story. */
  worktrees: WorktreeRef[]
  flags: WorktreeFlag[]
}

export type LinkedWorktree = WorktreeRef & {
  storyId: number
  /** Null when Shortcut could not return the story. */
  story: StoryItem | null
  /** The worktree Orca shows now. */
  focused: boolean
  flags: WorktreeFlag[]
}

export type WorktreeList = { worktrees: LinkedWorktree[] }

/** The focused worktree's branch, and the story it names. */
export type FocusedStory = { branch: string | null; storyId: number | null }

/**
 * A parent story and its sub-tasks that matched. `matched` is false when the story is only
 * shown as context for its sub-tasks.
 */
export type StoryGroup = { story: StoryItem; matched: boolean; subtasks: StoryItem[] }

export type StoryList = {
  filter: StoryFilter
  /** Every workflow state, in workflow order, for the filter. */
  states: WorkflowStateOption[]
  groups: StoryGroup[]
  /** True when a state had more matches than the plugin fetched. */
  truncated: boolean
}

export type ProjectOption = { id: string; name: string; hostId: string | null }

export type WorkOptions = {
  /** Git projects a worktree can be made in. */
  projects: ProjectOption[]
  suggestedProjectId: string | null
  /** The branch the worktree would be put on. */
  branch: string
  /** Agents Orca can start, by id; the setting's default first. */
  agents: string[]
  defaultAgent: string | null
}

export type StartResult = {
  workspaceId: string
  branch: string
  /** True when the sub-task already had a worktree, which was opened instead. */
  existing: boolean
  /** What was done, one line each. */
  done: string[]
  /** What could not be done; the worktree exists either way. */
  warnings: string[]
}
