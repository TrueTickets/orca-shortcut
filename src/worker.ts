// The plugin's own worker. Orca starts it on the panel's first plugin.request and transpiles this
// file when it loads: no build step. It is the only part of the plugin that talks to Shortcut —
// panel frames have no network — and the only part that ever sees the API token.
import { execFile } from 'node:child_process'
import type { OrcaWorkerApi } from 'orca/worker'
import type { GitRunner } from './git-branch'
import type {
  AuthStatus,
  FocusedStory,
  StoryFilter,
  StoryList,
  StorySearch,
  WorktreeList,
  WorktreeRef
} from './protocol'
import {
  codedError,
  createShortcutClient,
  type FetchLike,
  type ShortcutClient,
  type ShortcutStory
} from './shortcut-api'
import {
  buildSearchQuery,
  buildStoryGroups,
  normalizeFilter,
  statesById,
  toStoryItem,
  workflowStateOptions
} from './story-tree'
import {
  FLAG_TEXT,
  indexWorktrees,
  isProblem,
  linkWorktrees,
  shortBranch,
  storyIdOfBranch
} from './worktree-links'
import { createSubtask, moveStory, startWork, workOptions, type WorkContext } from './work-actions'

/** Secret key for the Shortcut API token. */
const TOKEN = 'shortcutToken'
/** Storage key for who the token belongs to, so status needs no network call. Not secret. */
const MEMBER = 'member'

/** Runs git without a shell, so a branch name is only ever an argument. */
const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', [...args], { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr || error?.message || '') })
    })
  })

/** Swapped by tests; the worker otherwise uses Node's global fetch and the git on the PATH. */
export const deps: { fetch: FetchLike; git: GitRunner } = {
  fetch: (url, init) => globalThis.fetch(url, init),
  git: runGit
}

type StoredMember = { name: string; mentionName: string; workspaceName: string }

function isStoredMember(value: unknown): value is StoredMember {
  const member = value as Partial<StoredMember> | null
  return (
    typeof member?.name === 'string' &&
    typeof member.mentionName === 'string' &&
    typeof member.workspaceName === 'string'
  )
}

async function secretsAvailable(orca: OrcaWorkerApi): Promise<boolean> {
  const { status } = await orca.host.call('secrets.protection')
  return status === 'os-keyring'
}

async function status(orca: OrcaWorkerApi): Promise<AuthStatus> {
  const [token, member, available] = await Promise.all([
    orca.secrets.get(TOKEN),
    orca.storage.get(MEMBER),
    secretsAvailable(orca)
  ])
  if (token && available && isStoredMember(member)) {
    return { connected: true, secretsAvailable: true, member }
  }
  return { connected: false, secretsAvailable: available }
}

/** What the `defaultStates` and `defaultOwner` settings say, used when the panel sends no filter. */
async function defaultFilter(orca: OrcaWorkerApi): Promise<StoryFilter> {
  const [states, owner] = await Promise.all([
    orca.settings.get('defaultStates'),
    orca.settings.get('defaultOwner')
  ])
  return normalizeFilter({ states, owner }, { states: ['Ready'], owner: 'me' })
}

async function connectedClient(
  orca: OrcaWorkerApi
): Promise<{ client: ShortcutClient; mentionName: string }> {
  const [token, member] = await Promise.all([orca.secrets.get(TOKEN), orca.storage.get(MEMBER)])
  if (!token || !isStoredMember(member)) {
    throw codedError('unavailable', 'Connect Shortcut first.')
  }
  return { client: createShortcutClient(token, deps.fetch), mentionName: member.mentionName }
}

/** How many stories the worker fetches from Shortcut at once. */
const STORY_FETCH_CONCURRENCY = 6

/** Fetches stories by id, a few at a time; one Shortcut cannot return is logged and left out. */
async function fetchStories(
  orca: OrcaWorkerApi,
  client: ShortcutClient,
  ids: readonly number[],
  why: string,
  signal?: AbortSignal
): Promise<Map<number, ShortcutStory>> {
  const stories = new Map<number, ShortcutStory>()
  for (let start = 0; start < ids.length; start += STORY_FETCH_CONCURRENCY) {
    const batch = ids.slice(start, start + STORY_FETCH_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((id) => client.getStory(id, signal)))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        stories.set(result.value.id, result.value)
      } else {
        orca.log(`Could not fetch ${why} sc-${batch[index]}: ${String(result.reason)}`)
      }
    })
  }
  return stories
}

/** Orca's worktrees whose branch names a story, read live, by story id. */
async function worktreeIndex(orca: OrcaWorkerApi): Promise<Map<number, WorktreeRef[]>> {
  const { workspaces } = await orca.host.call('workspace.list', { includeStatus: true })
  return indexWorktrees(workspaces)
}

async function listStories(
  orca: OrcaWorkerApi,
  requested: StoryFilter | undefined,
  signal: AbortSignal
): Promise<StoryList> {
  const { client, mentionName } = await connectedClient(orca)
  const fallback = await defaultFilter(orca)
  const filter = requested ? normalizeFilter(requested, fallback) : fallback

  const [workflowStates, searches, worktrees] = await Promise.all([
    client.listWorkflowStates(signal),
    Promise.all(
      filter.states.map((state) =>
        client.searchStories(buildSearchQuery(state, filter.owner, mentionName), { signal })
      )
    ),
    worktreeIndex(orca)
  ])

  return {
    filter,
    states: workflowStateOptions(workflowStates),
    groups: await groupStories(
      orca,
      client,
      searches.flatMap((search) => search.stories),
      workflowStates,
      worktrees,
      signal
    ),
    truncated: searches.some((search) => search.truncated)
  }
}

/** Matching stories under their parent story, fetching parents that did not match themselves. */
async function groupStories(
  orca: OrcaWorkerApi,
  client: ShortcutClient,
  stories: readonly ShortcutStory[],
  workflowStates: Awaited<ReturnType<ShortcutClient['listWorkflowStates']>>,
  worktrees: Map<number, WorktreeRef[]>,
  signal?: AbortSignal
) {
  const matches = new Map(stories.map((story) => [story.id, story]))
  // Parents that did not match themselves, such as a story someone else owns.
  const missing = [
    ...new Set(
      [...matches.values()]
        .map((story) => story.parentStoryId)
        .filter((id): id is number => id !== null && !matches.has(id))
    )
  ]
  const parents = await fetchStories(orca, client, missing, 'parent story', signal)
  return buildStoryGroups([...matches.values()], parents, workflowStates, worktrees)
}

/** A story id on its own, as `123` or `sc-123`. */
const STORY_ID = /^\s*(?:sc-)?(\d+)\s*$/i

/** A story passes `filter` when it is in one of its states and owned as it says. */
function passes(
  story: ShortcutStory,
  filter: StoryFilter,
  stateNames: ReadonlyMap<number, string>,
  memberId: string
): boolean {
  const owned =
    filter.owner === 'anyone' ||
    (filter.owner === 'unassigned' ? story.ownerIds.length === 0 : story.ownerIds.includes(memberId))
  return owned && filter.states.includes(stateNames.get(story.workflowStateId) ?? '')
}

/**
 * Searches all of Shortcut; a bare story id fetches that story instead. With `filter`, the
 * search runs once per state, as the list does, since a Shortcut query takes a single state.
 */
async function searchStories(
  orca: OrcaWorkerApi,
  query: string,
  requested: StoryFilter | undefined,
  signal: AbortSignal
): Promise<StorySearch> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw codedError('invalid_params', 'Type something to search for.')
  }
  const { client, mentionName } = await connectedClient(orca)
  const filter = requested ? normalizeFilter(requested, await defaultFilter(orca)) : null
  const id = STORY_ID.exec(trimmed)?.[1]
  const found = id
    ? client.getStory(Number(id), signal).then(
        (story) => ({ stories: story.archived ? [] : [story], truncated: false }),
        // An id Shortcut does not know is no match, not a failure.
        (error: unknown) => {
          if (/answered 404 /.test(String((error as Error).message))) {
            return { stories: [], truncated: false }
          }
          throw error
        }
      )
    : filter
      ? Promise.all(
          filter.states.map((state) =>
            client.searchStories(`${trimmed} ${buildSearchQuery(state, filter.owner, mentionName)}`, {
              maxPages: 2,
              signal
            })
          )
        ).then((searches) => ({
          stories: searches.flatMap((search) => search.stories),
          truncated: searches.some((search) => search.truncated)
        }))
      : client.searchStories(`${trimmed} !is:archived`, { maxPages: 2, signal })
  const [searched, workflowStates, worktrees, member] = await Promise.all([
    found,
    client.listWorkflowStates(signal),
    worktreeIndex(orca),
    // Only an id lookup needs it, to hold the story to the filter.
    id && filter?.owner === 'me' ? client.getCurrentMember(signal) : null
  ])
  const { truncated } = searched
  let stories = searched.stories
  if (id && filter) {
    const stateNames = new Map(workflowStates.map((state) => [state.id, state.name]))
    stories = stories.filter((story) => passes(story, filter, stateNames, member?.id ?? ''))
  }
  return {
    query: trimmed,
    filter,
    groups: await groupStories(orca, client, stories, workflowStates, worktrees, signal),
    truncated
  }
}

/** Every worktree whose branch names a story, with that story as Shortcut has it now. */
async function listWorktrees(
  orca: OrcaWorkerApi,
  focusedBranch: string | null,
  signal?: AbortSignal
): Promise<WorktreeList> {
  const { client } = await connectedClient(orca)
  const [index, workflowStates] = await Promise.all([
    worktreeIndex(orca),
    client.listWorkflowStates(signal)
  ])
  const fetched = await fetchStories(orca, client, [...index.keys()], 'linked story', signal)
  const states = statesById(workflowStates)
  const items = new Map(
    [...fetched.values()].map((story) => [story.id, toStoryItem(story, states, index)])
  )
  return { worktrees: linkWorktrees(index, items, focusedBranch) }
}

/** The status bar item that names the focused worktree's story. */
const FOCUSED_ITEM = 'focused-story'

async function showFocusedStory(orca: OrcaWorkerApi, focus: FocusedStory): Promise<void> {
  const hide = () => orca.host.call('statusBar.update', { id: FOCUSED_ITEM, visible: false })
  if (focus.storyId === null) {
    await hide()
    return
  }
  let client: ShortcutClient
  try {
    ;({ client } = await connectedClient(orca))
  } catch {
    // Not connected: nothing to name.
    await hide()
    return
  }
  const [story, workflowStates, index] = await Promise.all([
    client.getStory(focus.storyId),
    client.listWorkflowStates(),
    worktreeIndex(orca)
  ])
  const item = toStoryItem(story, statesById(workflowStates), index)
  // The focused worktree exists, so "no worktree" never applies here.
  const flags = item.flags.filter((flag) => flag !== 'no-worktree')
  const problem = flags.some(isProblem)
  const notice = !problem && flags.length > 0
  await orca.host.call('statusBar.update', {
    id: FOCUSED_ITEM,
    text: `sc-${item.id} · ${item.state}`,
    icon: problem ? 'warning' : notice ? 'flag' : 'branch',
    tone: problem ? 'warning' : notice ? 'accent' : 'neutral',
    tooltip: [item.name, ...flags.map((flag) => FLAG_TEXT[flag])].join('\n'),
    visible: true
  })
}

export default function activate(orca: OrcaWorkerApi): void {
  /** The focused worktree, from `workspace.changed`; Orca sends the current one on subscribing. */
  let focus: FocusedStory = { branch: null, storyId: null }

  orca.events.on('workspace.changed', async ({ context }) => {
    const branch = context?.branch ? shortBranch(context.branch) : null
    const storyId = storyIdOfBranch(branch)
    if (branch === focus.branch && storyId === focus.storyId) {
      return
    }
    focus = { branch, storyId }
    orca.panels.post('focus.changed', focus)
    await showFocusedStory(orca, focus).catch((error: unknown) =>
      orca.log(`Could not show the focused story: ${String(error)}`)
    )
  })
  for (const event of ['workspace.created', 'workspace.removed'] as const) {
    orca.events.on(event, () => orca.panels.post('worktrees.changed', null))
  }

  orca.panels.handle('focus.get', () => focus)
  orca.panels.handle('stories.list', (input, { signal }) =>
    listStories(orca, input?.filter, signal)
  )
  orca.panels.handle('stories.search', ({ query, filter }, { signal }) =>
    searchStories(orca, query, filter, signal)
  )
  orca.panels.handle('worktrees.list', (_input, { signal }) =>
    listWorktrees(orca, focus.branch, signal)
  )
  const workContext = async (): Promise<WorkContext> => {
    const { client, mentionName } = await connectedClient(orca)
    return { client, mentionName, git: deps.git }
  }
  orca.panels.handle('work.options', async ({ storyId }, { signal }) =>
    workOptions(orca, await workContext(), storyId, signal)
  )
  orca.panels.handle('work.start', async (input) => startWork(orca, await workContext(), input))
  orca.panels.handle('subtask.create', async (input) =>
    createSubtask(orca, await workContext(), input)
  )

  orca.panels.handle('story.move', async (input) => moveStory(await workContext(), input))

  orca.panels.handle('worktrees.open', async ({ workspaceId }) => {
    await orca.host.call('workspace.open', { workspaceId })
    return null
  })

  orca.panels.handle('auth.status', () => status(orca))

  orca.panels.handle('auth.connect', async ({ token }, { signal }) => {
    const trimmed = token.trim()
    if (!trimmed) {
      throw codedError('invalid_params', 'Paste a Shortcut API token.')
    }
    // Without an OS key store Orca cannot encrypt the token, and secrets.set refuses it.
    if (!(await secretsAvailable(orca))) {
      throw codedError(
        'unavailable',
        'Orca has no OS key store to encrypt the token on this machine, so it cannot be saved.'
      )
    }
    // Check the token before storing it, so a typo never lands in secrets.
    const member = await createShortcutClient(trimmed, deps.fetch).getCurrentMember(signal)
    await orca.secrets.set(TOKEN, trimmed)
    await orca.storage.set(MEMBER, {
      name: member.name,
      mentionName: member.mentionName,
      workspaceName: member.workspaceName
    })
    orca.log(`Connected to Shortcut workspace "${member.workspaceName}" as @${member.mentionName}`)
    const next = await status(orca)
    orca.panels.post('auth.changed', next)
    return next
  })

  orca.panels.handle('auth.disconnect', async () => {
    await orca.secrets.delete(TOKEN)
    await orca.storage.delete(MEMBER)
    const next = await status(orca)
    orca.panels.post('auth.changed', next)
    return next
  })
}
