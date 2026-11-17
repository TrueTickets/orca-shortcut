// A minimal Shortcut REST v3 client. `fetch` is injected so tests can answer requests without the
// network; the worker passes Node's global fetch.

export const SHORTCUT_ORIGIN = 'https://api.app.shortcut.com'
export const SHORTCUT_API_BASE = `${SHORTCUT_ORIGIN}/api/v3`

/** Shortcut's search answers at most this many stories per page. */
const SEARCH_PAGE_SIZE = 25

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

/** An error whose `code` is an Orca host error code, so it reaches the panel with that code. */
export type CodedError = Error & { code: string }

export function codedError(code: string, message: string): CodedError {
  return Object.assign(new Error(message), { code })
}

/** The fields of `GET /member` the plugin reads. */
export type ShortcutMember = {
  id: string
  name: string
  mentionName: string
  workspaceName: string
  workspaceSlug: string
}

/** The fields of a story the plugin reads, from a slim search result or a full story. */
export type ShortcutStory = {
  id: number
  name: string
  appUrl: string
  storyType: string
  archived: boolean
  workflowStateId: number
  parentStoryId: number | null
  subTaskIds: number[]
  ownerIds: string[]
}

export type ShortcutWorkflowState = {
  id: number
  name: string
  type: string
  position: number
}

export type StorySearchResult = {
  stories: ShortcutStory[]
  /** How many stories Shortcut says match, including any not fetched. */
  total: number
  /** True when `maxPages` stopped the search before the last page. */
  truncated: boolean
}

export type ShortcutClient = {
  getCurrentMember(signal?: AbortSignal): Promise<ShortcutMember>
  /** Runs a Shortcut search query (the same syntax as Shortcut's search box). */
  searchStories(
    query: string,
    options?: { maxPages?: number; signal?: AbortSignal }
  ): Promise<StorySearchResult>
  getStory(id: number, signal?: AbortSignal): Promise<ShortcutStory>
  /** Every state of every workflow in the workspace. */
  listWorkflowStates(signal?: AbortSignal): Promise<ShortcutWorkflowState[]>
}

type RawStory = {
  id?: unknown
  name?: unknown
  app_url?: unknown
  story_type?: unknown
  archived?: unknown
  workflow_state_id?: unknown
  parent_story_id?: unknown
  sub_task_story_ids?: unknown
  owner_ids?: unknown
}

function toStory(raw: RawStory): ShortcutStory {
  if (typeof raw?.id !== 'number' || typeof raw.workflow_state_id !== 'number') {
    throw codedError('action_failed', 'Shortcut answered a story without an id or state.')
  }
  return {
    id: raw.id,
    name: String(raw.name ?? ''),
    appUrl: String(raw.app_url ?? ''),
    storyType: String(raw.story_type ?? ''),
    archived: raw.archived === true,
    workflowStateId: raw.workflow_state_id,
    parentStoryId: typeof raw.parent_story_id === 'number' ? raw.parent_story_id : null,
    subTaskIds: Array.isArray(raw.sub_task_story_ids)
      ? raw.sub_task_story_ids.filter((id): id is number => typeof id === 'number')
      : [],
    ownerIds: Array.isArray(raw.owner_ids)
      ? raw.owner_ids.filter((id): id is string => typeof id === 'string')
      : []
  }
}

export function createShortcutClient(token: string, fetchImpl: FetchLike): ShortcutClient {
  /** `path` is relative to the API base, or a server-given path that starts with `/api/v3`. */
  async function request(method: string, path: string, signal?: AbortSignal): Promise<unknown> {
    const url = path.startsWith('/api/') ? `${SHORTCUT_ORIGIN}${path}` : `${SHORTCUT_API_BASE}${path}`
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Shortcut-Token': token },
        signal
      })
    } catch (error) {
      throw codedError(
        'unavailable',
        `Could not reach Shortcut: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw codedError('invalid_params', 'Shortcut rejected the API token.')
    }
    if (response.status === 429) {
      throw codedError('rate_limited', 'Shortcut is rate limiting requests; try again shortly.')
    }
    if (!response.ok) {
      const what = path.split('?')[0]
      throw codedError('action_failed', `Shortcut answered ${response.status} for ${method} ${what}.`)
    }
    return response.json()
  }

  return {
    async getCurrentMember(signal) {
      const body = (await request('GET', '/member', signal)) as {
        id?: unknown
        name?: unknown
        mention_name?: unknown
        workspace2?: { name?: unknown; url_slug?: unknown }
      }
      if (typeof body?.id !== 'string' || typeof body.mention_name !== 'string') {
        throw codedError('action_failed', 'Shortcut answered GET /member without a member.')
      }
      return {
        id: body.id,
        name: typeof body.name === 'string' ? body.name : body.mention_name,
        mentionName: body.mention_name,
        workspaceName: String(body.workspace2?.name ?? ''),
        workspaceSlug: String(body.workspace2?.url_slug ?? '')
      }
    },

    async searchStories(query, options = {}) {
      const maxPages = options.maxPages ?? 4
      const params = new URLSearchParams({
        query,
        detail: 'slim',
        page_size: String(SEARCH_PAGE_SIZE)
      })
      let path: string | null = `/search/stories?${params.toString()}`
      const stories: ShortcutStory[] = []
      let total = 0
      let pages = 0
      while (path && pages < maxPages) {
        const body = (await request('GET', path, options.signal)) as {
          data?: unknown
          total?: unknown
          next?: unknown
        }
        const data = Array.isArray(body?.data) ? (body.data as RawStory[]) : []
        stories.push(...data.map(toStory))
        total = typeof body?.total === 'number' ? body.total : stories.length
        path = typeof body?.next === 'string' && body.next ? body.next : null
        pages += 1
      }
      return { stories, total, truncated: path !== null }
    },

    async getStory(id, signal) {
      return toStory((await request('GET', `/stories/${id}`, signal)) as RawStory)
    },

    async listWorkflowStates(signal) {
      const body = await request('GET', '/workflows', signal)
      const workflows = Array.isArray(body) ? (body as { states?: unknown }[]) : []
      const states: ShortcutWorkflowState[] = []
      for (const workflow of workflows) {
        for (const raw of Array.isArray(workflow?.states) ? workflow.states : []) {
          const state = raw as { id?: unknown; name?: unknown; type?: unknown; position?: unknown }
          if (typeof state.id === 'number' && typeof state.name === 'string') {
            states.push({
              id: state.id,
              name: state.name,
              type: String(state.type ?? ''),
              position: typeof state.position === 'number' ? state.position : 0
            })
          }
        }
      }
      return states
    }
  }
}
