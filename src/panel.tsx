// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel never sees the API token after it is submitted: the worker checks and stores it,
// and makes every Shortcut call.
import {
  atom,
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  plugin,
  read,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  Tree,
  type PanelContext,
  type TreeItem
} from 'orca'
import type {
  AuthStatus,
  StoryFilter,
  StoryGroup,
  StoryItem,
  StoryList,
  StoryOwner
} from './protocol'
import { describeFilter } from './story-tree'

/** What the worker last reported; null until it answers. */
const auth = atom<AuthStatus | null>(null)
/** The token being typed. In memory only: never persisted by the panel. */
const draft = atom('')
const busy = atom(false)
const error = atom<string | null>(null)

/** The filter the person picked; null until they change one, so the settings' defaults apply. */
const chosenFilter = atom<StoryFilter | null>('filter', null, { persist: 'plugin' })
const list = atom<StoryList | null>(null)
const loading = atom(false)
const listError = atom<string | null>(null)
const selected = atom<string | null>(null)
const expanded = atom<readonly string[]>([])
/** Only the newest list request may draw: an older answer arriving late is dropped. */
let listRequest = 0

const OWNER_OPTIONS: readonly { value: StoryOwner; label: string }[] = [
  { value: 'me', label: 'Me' },
  { value: 'anyone', label: 'Anyone' },
  { value: 'unassigned', label: 'Unassigned' }
]

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

const keyOf = (id: number): string => `sc-${id}`

async function loadStories(): Promise<void> {
  if (read(auth)?.connected !== true) {
    return
  }
  const request = ++listRequest
  set(loading, true)
  set(listError, null)
  try {
    const filter = read(chosenFilter)
    const answer = await plugin.request('stories.list', filter ? { filter } : {})
    if (request !== listRequest) {
      return
    }
    set(list, answer)
    set(
      expanded,
      answer.groups.map((group) => keyOf(group.story.id))
    )
  } catch (reason) {
    if (request === listRequest) {
      set(listError, messageOf(reason))
    }
  } finally {
    if (request === listRequest) {
      set(loading, false)
    }
  }
}

function changeFilter(change: (filter: StoryFilter) => StoryFilter): void {
  const current = read(chosenFilter) ?? read(list)?.filter
  if (!current) {
    return
  }
  set(chosenFilter, change(current))
  void loadStories()
}

function toggleState(state: string, checked: boolean): void {
  changeFilter((filter) => ({
    ...filter,
    states: checked
      ? [...filter.states, state]
      : filter.states.filter((name) => name !== state)
  }))
}

function setAuth(status: AuthStatus): void {
  const wasConnected = read(auth)?.connected === true
  set(auth, status)
  if (status.connected && !wasConnected) {
    void loadStories()
  }
  if (!status.connected) {
    set(list, null)
    set(selected, null)
  }
}

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
  ctx.subscriptions.push(plugin.on('auth.changed', setAuth))
  void plugin
    .request('auth.status')
    .then(setAuth)
    .catch((reason: unknown) => set(error, messageOf(reason)))
}

/**
 * Rows are narrow, so a row names its state only when the filter spans several states and the
 * state tells rows apart; the detail card always shows it.
 */
function storyItem(group: StoryGroup, showState: boolean): TreeItem {
  const { story } = group
  const noSubtasks = group.matched && story.parentId === null && story.subTaskCount === 0
  const describe = (item: StoryItem, extra = '') =>
    // A parent shown only as context keeps to its id: its state is not what was filtered.
    [keyOf(item.id), showState && group.matched ? item.state : '', extra]
      .filter(Boolean)
      .join(' · ')
  return {
    key: keyOf(story.id),
    label: story.name,
    description: describe(story, noSubtasks ? 'no sub-tasks' : ''),
    icon: story.parentId === null ? 'book' : 'branch',
    children:
      group.subtasks.length > 0
        ? group.subtasks.map((subtask) => ({
            key: keyOf(subtask.id),
            label: subtask.name,
            description: [keyOf(subtask.id), showState ? subtask.state : ''].filter(Boolean).join(' · '),
            icon: 'branch' as const
          }))
        : undefined
  }
}

function findItem(groups: readonly StoryGroup[], key: string | null): StoryItem | null {
  for (const group of groups) {
    if (keyOf(group.story.id) === key) {
      return group.story
    }
    const subtask = group.subtasks.find((candidate) => keyOf(candidate.id) === key)
    if (subtask) {
      return subtask
    }
  }
  return null
}

function Filters({ current }: { current: StoryList }) {
  const filter = read(chosenFilter) ?? current.filter
  return (
    <Collapsible title="Filters" description={describeFilter(filter)}>
      <Stack gap="sm">
        <Select
          label="Owner"
          value={filter.owner}
          options={OWNER_OPTIONS}
          onChange={(owner) => changeFilter((before) => ({ ...before, owner: owner as StoryOwner }))}
        />
        {current.states
          .filter((state) => state.type !== 'done')
          .map((state) => (
            <Checkbox
              key={state.name}
              label={state.name}
              checked={filter.states.includes(state.name)}
              onChange={(checked) => toggleState(state.name, checked)}
            />
          ))}
      </Stack>
    </Collapsible>
  )
}

function Detail({ story }: { story: StoryItem }) {
  const where =
    story.parentId === null
      ? `Story · ${story.subTaskCount} sub-task${story.subTaskCount === 1 ? '' : 's'}`
      : `Sub-task of ${keyOf(story.parentId)}`
  return (
    <Card title={story.name} description={`${keyOf(story.id)} · ${story.state}`}>
      <Stack gap="sm">
        <Text muted size="xs">
          {where}
        </Text>
        <Row>
          <Button
            variant="ghost"
            icon="open-external"
            onPress={() => void shell.openExternal(story.url)}
          >
            Open in Shortcut
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}

function Stories() {
  const current = read(list)
  const problem = read(listError)
  if (current === null) {
    return problem ? <Callout tone="danger">{problem}</Callout> : <Spinner label="Loading stories" />
  }
  const story = findItem(current.groups, read(selected))
  return (
    <Stack gap="md">
      <Filters current={current} />
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      {current.truncated ? (
        <Callout tone="warning">Some states have more stories than the list shows.</Callout>
      ) : null}
      {current.groups.length === 0 ? (
        <EmptyState
          title="No stories"
          description="Nothing matches these filters."
          icon="search"
        />
      ) : (
        <Tree
          label="Stories"
          items={current.groups.map((group) => storyItem(group, current.filter.states.length > 1))}
          selected={read(selected) ?? undefined}
          expanded={read(expanded)}
          onSelect={({ key }) => set(selected, key)}
          onToggle={({ key, expanded: open }) =>
            set(expanded, (open
              ? [...read(expanded), key]
              : read(expanded).filter((candidate) => candidate !== key)))
          }
        />
      )}
      {story ? <Detail story={story} /> : null}
    </Stack>
  )
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
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Shortcut</Heading>
        {status?.connected ? (
          <IconButton
            icon="refresh"
            label="Refresh"
            disabled={read(loading)}
            onPress={() => void loadStories()}
          />
        ) : null}
      </Row>
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      {status === null ? (
        problem ? null : <Spinner label="Loading" />
      ) : status.connected ? (
        <Stack gap="md">
          <Stories />
          <Row justify="between">
            <Text muted size="xs">
              {`Connected as @${status.member.mentionName} · ${status.member.workspaceName}`}
            </Text>
            <Button variant="ghost" onPress={disconnect}>
              Disconnect
            </Button>
          </Row>
        </Stack>
      ) : (
        <ConnectForm secretsAvailable={status.secretsAvailable} />
      )}
    </Stack>
  )
}
