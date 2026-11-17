// The plugin's own worker. Orca starts it on the panel's first plugin.request and transpiles this
// file when it loads: no build step. It is the only part of the plugin that talks to Shortcut —
// panel frames have no network — and the only part that ever sees the API token.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AuthStatus, StoryFilter, StoryList } from './protocol'
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
  workflowStateOptions
} from './story-tree'

/** Secret key for the Shortcut API token. */
const TOKEN = 'shortcutToken'
/** Storage key for who the token belongs to, so status needs no network call. Not secret. */
const MEMBER = 'member'

/** Swapped by tests; the worker otherwise uses Node's global fetch. */
export const deps: { fetch: FetchLike } = {
  fetch: (url, init) => globalThis.fetch(url, init)
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
const PARENT_FETCH_CONCURRENCY = 6

async function listStories(
  orca: OrcaWorkerApi,
  requested: StoryFilter | undefined,
  signal: AbortSignal
): Promise<StoryList> {
  const { client, mentionName } = await connectedClient(orca)
  const fallback = await defaultFilter(orca)
  const filter = requested ? normalizeFilter(requested, fallback) : fallback

  const [workflowStates, searches] = await Promise.all([
    client.listWorkflowStates(signal),
    Promise.all(
      filter.states.map((state) =>
        client.searchStories(buildSearchQuery(state, filter.owner, mentionName), { signal })
      )
    )
  ])

  const matches = new Map<number, ShortcutStory>()
  for (const search of searches) {
    for (const story of search.stories) {
      matches.set(story.id, story)
    }
  }

  // Parents that did not match themselves, such as a story someone else owns.
  const missing = [
    ...new Set(
      [...matches.values()]
        .map((story) => story.parentStoryId)
        .filter((id): id is number => id !== null && !matches.has(id))
    )
  ]
  const parents = new Map<number, ShortcutStory>()
  for (let start = 0; start < missing.length; start += PARENT_FETCH_CONCURRENCY) {
    const batch = missing.slice(start, start + PARENT_FETCH_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((id) => client.getStory(id, signal)))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        parents.set(result.value.id, result.value)
      } else {
        orca.log(`Could not fetch parent story sc-${batch[index]}: ${String(result.reason)}`)
      }
    })
  }

  return {
    filter,
    states: workflowStateOptions(workflowStates),
    groups: buildStoryGroups([...matches.values()], parents, workflowStates),
    truncated: searches.some((search) => search.truncated)
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('stories.list', (input, { signal }) =>
    listStories(orca, input?.filter, signal)
  )

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
