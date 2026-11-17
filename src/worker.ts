// The plugin's own worker. Orca starts it on the panel's first plugin.request and transpiles this
// file when it loads: no build step. It is the only part of the plugin that talks to Shortcut —
// panel frames have no network — and the only part that ever sees the API token.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AuthStatus } from './protocol'
import { codedError, createShortcutClient, type FetchLike } from './shortcut-api'

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

export default function activate(orca: OrcaWorkerApi): void {
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
