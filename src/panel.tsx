// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel never sees the API token after it is submitted: the worker checks and stores it,
// and makes every Shortcut call.
import {
  Box,
  Button,
  Callout,
  Heading,
  IconButton,
  Input,
  plugin,
  read,
  Row,
  Separator,
  set,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  type PanelContext
} from 'orca'
import {
  auth,
  busy,
  draft,
  error,
  focusChanged,
  listLoading,
  messageOf,
  refresh,
  setAuth,
  showTab,
  tab,
  worktreesChanged,
  worktreesLoading,
  type Tab as TabName
} from './state'
import { StoriesView } from './stories-view'
import { WorktreesView } from './worktrees-view'

async function connect(): Promise<void> {
  set(busy, true)
  set(error, null)
  try {
    setAuth(await plugin.request('auth.connect', { token: read(draft) }))
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
    setAuth(await plugin.request('auth.disconnect'))
  } catch (reason) {
    set(error, messageOf(reason))
  }
}

/** Runs once before the first render; what it pushes to `subscriptions` ends with the panel. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('auth.changed', setAuth),
    plugin.on('focus.changed', focusChanged),
    plugin.on('worktrees.changed', worktreesChanged)
  )
  void plugin
    .request('auth.status')
    .then(setAuth)
    .catch((reason: unknown) => set(error, messageOf(reason)))
  // Ask after the worker sees Orca's focus; an older worker without it simply leaves none.
  void plugin
    .request('focus.get')
    .then(focusChanged)
    .catch(() => undefined)
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
        placeholder="Paste your token"
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
  const header = (
    <Row justify="between">
      <Heading>Shortcut</Heading>
      {status?.connected ? (
        <IconButton
          icon="refresh"
          label="Refresh"
          disabled={read(listLoading) || read(worktreesLoading)}
          onPress={refresh}
        />
      ) : null}
    </Row>
  )
  if (status === null || !status.connected) {
    return (
      <Stack gap="md">
        {header}
        {problem ? <Callout tone="danger">{problem}</Callout> : null}
        {status === null ? (
          problem ? null : <Spinner label="Loading" />
        ) : (
          <ConnectForm secretsAvailable={status.secretsAvailable} />
        )}
      </Stack>
    )
  }
  // Like Orca's left sidebar: the list scrolls, and what follows it stays at the bottom.
  return (
    <Box height="100%" gap="md">
      {header}
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      <Box grow scroll="y" minHeight={0}>
        <Tabs label="View" value={read(tab)} onChange={(value) => showTab(value as TabName)}>
          <Tab value="stories" label="Stories" icon="book">
            <StoriesView />
          </Tab>
          <Tab value="worktrees" label="Worktrees" icon="folder">
            <WorktreesView />
          </Tab>
        </Tabs>
      </Box>
      <Box gap="sm" shrink={false}>
        <Separator />
        <Row justify="between">
          <Text muted size="xs" truncate>
            {`@${status.member.mentionName} · ${status.member.workspaceName}`}
          </Text>
          <Button variant="ghost" size="sm" onPress={disconnect}>
            Disconnect
          </Button>
        </Row>
      </Box>
    </Box>
  )
}
