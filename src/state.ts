// The panel's state and the requests that fill it. Every view reads these atoms; only the
// worker talks to Shortcut and Orca's workspaces.
import { atom, plugin, read, set } from 'orca'
import type {
  AuthStatus,
  FocusedStory,
  StoryFilter,
  StoryGroup,
  StoryList,
  StorySearch,
  WorktreeList
} from './protocol'

/** What the worker last reported; null until it answers. */
export const auth = atom<AuthStatus | null>(null)
/** The token being typed. In memory only: never persisted by the panel. */
export const draft = atom('')
export const busy = atom(false)
export const error = atom<string | null>(null)

export type Tab = 'stories' | 'worktrees'
export const tab = atom<Tab>('tab', 'stories', { persist: 'plugin' })

/** The filter the person picked; null until they change one, so the settings' defaults apply. */
export const chosenFilter = atom<StoryFilter | null>('filter', null, { persist: 'plugin' })
export const list = atom<StoryList | null>(null)
export const listLoading = atom(false)
export const listError = atom<string | null>(null)
export const selected = atom<string | null>(null)
/** Stories whose sub-tasks are folded away, by id; remembered across panel runs. */
export const collapsed = atom<readonly number[]>('collapsed', [], { persist: 'plugin' })

/** What is typed in the search box: it narrows the list as it is typed. */
export const query = atom('')
/** All of Shortcut searched for a query (on Enter); shown in place of the list until cleared. */
export const searchResults = atom<StorySearch | null>(null)
export const searching = atom(false)
export const searchError = atom<string | null>(null)

export const worktrees = atom<WorktreeList | null>(null)
export const worktreesLoading = atom(false)
export const worktreesError = atom<string | null>(null)

/** The focused worktree's story, from the worker. */
export const focus = atom<FocusedStory>({ branch: null, storyId: null })

export const keyOf = (id: number): string => `sc-${id}`

export function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

const connected = (): boolean => read(auth)?.connected === true

/** Only the newest request of a kind may draw: an older answer arriving late is dropped. */
let storiesRequest = 0
let worktreesRequest = 0
let searchRequest = 0

export async function loadStories(): Promise<void> {
  if (!connected()) {
    return
  }
  const request = ++storiesRequest
  set(listLoading, true)
  set(listError, null)
  try {
    const filter = read(chosenFilter)
    const answer = await plugin.request('stories.list', filter ? { filter } : {})
    if (request !== storiesRequest) {
      return
    }
    set(list, answer)
  } catch (reason) {
    if (request === storiesRequest) {
      set(listError, messageOf(reason))
    }
  } finally {
    if (request === storiesRequest) {
      set(listLoading, false)
    }
  }
  // Shortcut results on show are stale for the same reason the list was.
  const shown = read(searchResults)
  if (shown) {
    await searchShortcut(shown.query)
  }
}

/** Searches all of Shortcut for `text`; its results replace the list until the query changes. */
export async function searchShortcut(text: string): Promise<void> {
  if (!connected() || !text.trim()) {
    return
  }
  const request = ++searchRequest
  set(searching, true)
  set(searchError, null)
  try {
    const answer = await plugin.request('stories.search', { query: text })
    if (request === searchRequest) {
      set(searchResults, answer)
    }
  } catch (reason) {
    if (request === searchRequest) {
      set(searchError, messageOf(reason))
    }
  } finally {
    if (request === searchRequest) {
      set(searching, false)
    }
  }
}

/** Typing narrows the list; Shortcut results for an earlier query no longer apply. */
export function changeQuery(text: string): void {
  set(query, text)
  set(searchError, null)
  if (read(searchResults)?.query !== text.trim()) {
    ++searchRequest
    set(searchResults, null)
    set(searching, false)
  }
}

export function clearSearch(): void {
  changeQuery('')
}

/**
 * The groups that match `text`, by title or id (`sc-12`, `12`): a matching story keeps all its
 * sub-tasks; otherwise a story stays, as their context, with only its matching sub-tasks.
 */
export function narrowGroups(groups: readonly StoryGroup[], text: string): StoryGroup[] {
  const needle = text.trim().toLowerCase()
  if (!needle) {
    return [...groups]
  }
  const matches = (item: { id: number; name: string }) =>
    item.name.toLowerCase().includes(needle) || keyOf(item.id).includes(needle.replace(/^(?=\d)/, 'sc-'))
  return groups.flatMap((group) => {
    if (matches(group.story)) {
      return [group]
    }
    const subtasks = group.subtasks.filter(matches)
    return subtasks.length > 0 ? [{ ...group, subtasks }] : []
  })
}

export async function loadWorktrees(): Promise<void> {
  if (!connected()) {
    return
  }
  const request = ++worktreesRequest
  set(worktreesLoading, true)
  set(worktreesError, null)
  try {
    const answer = await plugin.request('worktrees.list')
    if (request === worktreesRequest) {
      set(worktrees, answer)
    }
  } catch (reason) {
    if (request === worktreesRequest) {
      set(worktreesError, messageOf(reason))
    }
  } finally {
    if (request === worktreesRequest) {
      set(worktreesLoading, false)
    }
  }
}

/** Reloads what the visible tab shows; the other tab loads when it is shown. */
export function refresh(): void {
  void (read(tab) === 'worktrees' ? loadWorktrees() : loadStories())
}

export function showTab(next: Tab): void {
  set(tab, next)
  if (next === 'worktrees' ? read(worktrees) === null : read(list) === null) {
    refresh()
  }
}

/** A worktree was created or removed: what was loaded is stale. */
export function worktreesChanged(): void {
  void loadStories()
  if (read(worktrees) !== null || read(tab) === 'worktrees') {
    void loadWorktrees()
  }
}

/** The focused worktree changed: its sub-task gets Orca's current-row highlight (see StoryRow). */
export function focusChanged(next: FocusedStory): void {
  set(focus, next)
  const current = read(worktrees)
  if (current) {
    set(worktrees, {
      worktrees: current.worktrees.map((worktree) => ({
        ...worktree,
        focused: worktree.branch === next.branch
      }))
    })
  }
}

export function setAuth(status: AuthStatus): void {
  const wasConnected = connected()
  set(auth, status)
  if (status.connected && !wasConnected) {
    refresh()
  }
  if (!status.connected) {
    set(list, null)
    set(searchResults, null)
    set(worktrees, null)
    set(selected, null)
  }
}

export async function openWorktree(workspaceId: string): Promise<void> {
  try {
    await plugin.request('worktrees.open', { workspaceId })
  } catch (reason) {
    set(error, messageOf(reason))
  }
}
