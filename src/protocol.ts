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
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after connecting or disconnecting. */
    'auth.changed': AuthStatus
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

export type StoryItem = {
  id: number
  name: string
  url: string
  /** The workflow state's name. */
  state: string
  parentId: number | null
  subTaskCount: number
}

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
