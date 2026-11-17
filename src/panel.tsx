// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel never sees the API token after it is submitted: the worker checks and stores it.
import {
  atom,
  Button,
  Callout,
  Heading,
  Input,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { AuthStatus } from './protocol'

/** What the worker last reported; null until it answers. */
const auth = atom<AuthStatus | null>(null)
/** The token being typed. In memory only: never persisted by the panel. */
const draft = atom('')
const busy = atom(false)
const error = atom<string | null>(null)

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function connect(): Promise<void> {
  set(busy, true)
  set(error, null)
  try {
    set(auth, await plugin.request('auth.connect', { token: read(draft) }))
    set(draft, '')
  } catch (reason) {
    set(error, messageOf(reason))
  } finally {
    set(busy, false)
  }
}

async function disconnect(): Promise<void> {
  set(error, null)
  try {
    set(auth, await plugin.request('auth.disconnect'))
  } catch (reason) {
    set(error, messageOf(reason))
  }
}

/** Runs once before the first render; what it pushes to `subscriptions` ends with the panel. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('auth.changed', (status) => set(auth, status)))
  void plugin
    .request('auth.status')
    .then((status) => set(auth, status))
    .catch((reason: unknown) => set(error, messageOf(reason)))
}

function ConnectForm({ secretsAvailable }: { secretsAvailable: boolean }) {
  return (
    <Stack gap="sm">
      <Text>
        Connect a Shortcut API token. Create one in Shortcut under Settings → Your Account → API
        Tokens.
      </Text>
      {secretsAvailable ? null : (
        <Callout tone="warning" title="No key store">
          Orca cannot encrypt secrets on this machine, so the token cannot be saved.
        </Callout>
      )}
      <Input
        label="Shortcut API token"
        type="password"
        placeholder="Shortcut API token"
        value={read(draft)}
        disabled={read(busy) || !secretsAvailable}
        onChange={(value) => set(draft, value)}
        onSubmit={connect}
      />
      <Button onPress={connect} disabled={read(busy) || !secretsAvailable || !read(draft).trim()}>
        {read(busy) ? 'Checking…' : 'Connect'}
      </Button>
    </Stack>
  )
}

export default function Panel() {
  const status = read(auth)
  const problem = read(error)
  return (
    <Stack gap="md">
      <Heading>Shortcut</Heading>
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      {status === null ? (
        problem ? null : <Spinner label="Loading" />
      ) : status.connected ? (
        <Row justify="between">
          <Text muted size="xs">
            {`Connected as @${status.member.mentionName} · ${status.member.workspaceName}`}
          </Text>
          <Button variant="ghost" onPress={disconnect}>
            Disconnect
          </Button>
        </Row>
      ) : (
        <ConnectForm secretsAvailable={status.secretsAvailable} />
      )}
    </Stack>
  )
}
