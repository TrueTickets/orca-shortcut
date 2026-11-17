// A minimal Shortcut REST v3 client. `fetch` is injected so tests can answer requests without the
// network; the worker passes Node's global fetch.

export const SHORTCUT_API_BASE = 'https://api.app.shortcut.com/api/v3'

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

export type ShortcutClient = {
  getCurrentMember(signal?: AbortSignal): Promise<ShortcutMember>
}

export function createShortcutClient(token: string, fetchImpl: FetchLike): ShortcutClient {
  async function request(method: string, path: string, signal?: AbortSignal): Promise<unknown> {
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(`${SHORTCUT_API_BASE}${path}`, {
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
      throw codedError('action_failed', `Shortcut answered ${response.status} for ${method} ${path}.`)
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
    }
  }
}
