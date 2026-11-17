// The Stories tab, laid out like Orca's left sidebar: each parent story as a plain header, its
// sub-tasks as two-line rows under it, colour from small state pills. Pressing a row opens its
// details right under it, and pressing it again closes them.
import {
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  Collapsible,
  EmptyState,
  List,
  ListItem,
  read,
  Row,
  Select,
  Separator,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  type IconName,
  type OrcaNode
} from 'orca'
import type { StoryFilter, StoryGroup, StoryItem, StoryList, StoryOwner } from './protocol'
import {
  chosenFilter,
  focus,
  keyOf,
  list,
  listError,
  loadStories,
  openWorktree,
  selected
} from './state'
import { shortStateName, toneOfState } from './state-tone'
import { prepareStartWork, StartWork } from './start-work-view'
import { describeFilter } from './story-tree'
import { FLAG_PILL, FLAG_TEXT, isProblem } from './worktree-links'

const OWNER_OPTIONS: readonly { value: StoryOwner; label: string }[] = [
  { value: 'me', label: 'Me' },
  { value: 'anyone', label: 'Anyone' },
  { value: 'unassigned', label: 'Unassigned' }
]

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
    states: checked ? [...filter.states, state] : filter.states.filter((name) => name !== state)
  }))
}

/** A row's icon: a problem first, a heads-up, an agent at work, a worktree, then the kind. */
function iconOf(item: StoryItem): IconName {
  if (item.flags.some(isProblem)) {
    return 'warning'
  }
  if (item.flags.length > 0) {
    return 'flag'
  }
  if (item.worktrees.some((worktree) => worktree.agent === 'working')) {
    return 'bot'
  }
  if (item.worktrees.length > 0) {
    return 'folder'
  }
  return item.parentId === null ? 'book' : 'branch'
}

/** The second line: the id, then where its worktree stands. */
function descriptionOf(item: StoryItem, focusedStoryId: number | null): string {
  const worktree =
    item.id === focusedStoryId
      ? 'here'
      : item.worktrees.some((candidate) => candidate.agent === 'working')
        ? 'agent working'
        : item.worktrees.length > 1
          ? `${item.worktrees.length} worktrees`
          : item.worktrees.length === 1
            ? item.worktrees[0].branch
            : ''
  return [keyOf(item.id), worktree].filter(Boolean).join(' · ')
}

function StatePill({ item }: { item: StoryItem }) {
  return <Badge tone={toneOfState(item.state, item.stateType)}>{shortStateName(item.state)}</Badge>
}

function Pills({ item }: { item: StoryItem }) {
  return (
    <Box direction="row" gap="xs" shrink={false}>
      <StatePill item={item} />
      {item.flags.map((flag) => (
        <Badge key={flag} tone={isProblem(flag) ? 'danger' : 'neutral'}>
          {FLAG_PILL[flag]}
        </Badge>
      ))}
    </Box>
  )
}

/**
 * A row's two lines as Orca's left sidebar draws a worktree: the title alone on the first line,
 * the branch under it, with the row's markers at the end of the second line. Pills on a line of
 * their own made rows a third taller than the sidebar's, and on the title line they squeezed
 * the title; the branch can lose its end instead.
 */
export function RowText({
  title,
  description,
  children
}: {
  title: string
  description: string
  children?: OrcaNode
}) {
  return (
    <Stack gap="none">
      <Text size="sm" truncate>
        {title}
      </Text>
      <Box direction="row" gap="sm" justify="between">
        <Box grow shrink minWidth={0}>
          <Text size="xs" muted truncate>
            {description}
          </Text>
        </Box>
        {children}
      </Box>
    </Stack>
  )
}

function StoryRow({ item, focusedStoryId }: { item: StoryItem; focusedStoryId: number | null }) {
  const key = keyOf(item.id)
  return (
    <ListItem
      icon={iconOf(item)}
      // Orca's own highlight for the current worktree marks the focused one's sub-task, as in
      // its left sidebar; selection has its own tint around the row and its details.
      current={item.id === focusedStoryId}
      onPress={() => toggle(item)}
    >
      <RowText title={item.name} description={descriptionOf(item, focusedStoryId)}>
        <Pills item={item} />
      </RowText>
    </ListItem>
  )
}

/**
 * Selects a row, opening its details under it, or closes them when it was already selected. A
 * sub-task that could start work asks the worker for its options at once, so the form is ready.
 */
function toggle(item: StoryItem): void {
  const key = keyOf(item.id)
  if (read(selected) === key) {
    set(selected, null)
    return
  }
  set(selected, key)
  if (item.parentId !== null && item.worktrees.length === 0) {
    void prepareStartWork(item.id)
  }
}

/**
 * Rows, with two set apart on a tint of their own: the selected one, with its details opened right
 * under it (accent), and the focused worktree's sub-task (success). A List holds only rows and a
 * row holds no buttons, so the list is split around them; the rows between stay one list.
 */
function Rows({
  label,
  items,
  focusedStoryId
}: {
  label: string
  items: readonly StoryItem[]
  focusedStoryId: number | null
}) {
  const list = (part: readonly StoryItem[], key: string) => (
    <List key={key} label={label}>
      {part.map((item) => (
        <StoryRow key={item.id} item={item} focusedStoryId={focusedStoryId} />
      ))}
    </List>
  )
  const isSelected = (item: StoryItem) => keyOf(item.id) === read(selected)
  const isFocused = (item: StoryItem) => item.id === focusedStoryId
  if (!items.some((item) => isSelected(item) || isFocused(item))) {
    return list(items, 'all')
  }
  const parts: OrcaNode[] = []
  let plain: StoryItem[] = []
  const flush = () => {
    if (plain.length > 0) {
      parts.push(list(plain, `rows-${plain[0].id}`))
      plain = []
    }
  }
  for (const item of items) {
    if (isSelected(item)) {
      flush()
      // What is selected, and what the details belong to, read at a glance.
      parts.push(
        <Box key={`selected-${item.id}`} radius="md" background="accent" padding="xs" gap="xs">
          {list([item], `row-${item.id}`)}
          <StoryDetails story={item} />
        </Box>
      )
    } else if (isFocused(item)) {
      flush()
      // Where you are working: the focused worktree's sub-task.
      parts.push(
        <Box key={`focused-${item.id}`} radius="md" background="success" padding="xs">
          {list([item], `row-${item.id}`)}
        </Box>
      )
    } else {
      plain.push(item)
    }
  }
  flush()
  return <Stack gap="xs">{parts}</Stack>
}

/**
 * Each story is a card: its header, then its sub-tasks, so where one story ends and the next
 * begins is plain. A story that matched on its own is a card with just its row.
 */
function Group({ group, focusedStoryId }: { group: StoryGroup; focusedStoryId: number | null }) {
  const { story } = group
  if (group.subtasks.length === 0) {
    return (
      <Box radius="md" background="muted" padding="xs">
        <Rows label={story.name} items={[story]} focusedStoryId={focusedStoryId} />
      </Box>
    )
  }
  return (
    <Box radius="md" background="muted" padding="xs" gap="xs">
      <Box direction="row" justify="between" gap="sm" paddingX="xs" paddingY="xs">
        <Box grow shrink minWidth={0}>
          <Text weight="semibold" size="sm" truncate>
            {story.name}
          </Text>
        </Box>
        <Box shrink={false}>
          <StatePill item={story} />
        </Box>
      </Box>
      <Separator />
      <Rows label={story.name} items={group.subtasks} focusedStoryId={focusedStoryId} />
    </Box>
  )
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

/** A selected row's details, opened right under it: what is off, its worktree or starting one. */
function StoryDetails({ story }: { story: StoryItem }) {
  const where =
    story.parentId === null
      ? `Story · ${story.subTaskCount} sub-task${story.subTaskCount === 1 ? '' : 's'}`
      : `Sub-task of ${keyOf(story.parentId)}`
  return (
    <Box key="story-details" border radius="md" padding="sm" background="muted">
      <Stack gap="sm">
        <Text size="xs" muted>
          {`${keyOf(story.id)} · ${where}`}
        </Text>
        {story.flags.map((flag) => (
          <Callout
            key={flag}
            tone={isProblem(flag) ? 'warning' : 'accent'}
            icon={isProblem(flag) ? 'warning' : 'flag'}
          >
            {FLAG_TEXT[flag]}
          </Callout>
        ))}
        {story.worktrees.map((worktree) => (
          <Row key={worktree.workspaceId} justify="between">
            <Text size="xs" muted truncate>
              {worktree.branch}
            </Text>
            <Button
              variant="ghost"
              icon="folder"
              onPress={() => void openWorktree(worktree.workspaceId)}
            >
              Open worktree
            </Button>
          </Row>
        ))}
        {story.worktrees.length > 0 ? null : story.parentId !== null ? (
          <StartWork story={story} />
        ) : (
          <Text size="xs" muted>
            Work starts on a story's sub-tasks.
          </Text>
        )}
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
    </Box>
  )
}

export function StoriesView() {
  const current = read(list)
  const problem = read(listError)
  if (current === null) {
    return problem ? <Callout tone="danger">{problem}</Callout> : <Spinner label="Loading stories" />
  }
  const focusedStoryId = read(focus).storyId
  return (
    <Stack gap="md">
      <Filters current={current} />
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      {current.truncated ? (
        <Callout tone="warning">Some states have more stories than the list shows.</Callout>
      ) : null}
      {current.groups.length === 0 ? (
        <EmptyState title="No stories" description="Nothing matches these filters." icon="search" />
      ) : (
        <Box gap="md">
          {current.groups.map((group) => (
            <Group key={group.story.id} group={group} focusedStoryId={focusedStoryId} />
          ))}
        </Box>
      )}
    </Stack>
  )
}
