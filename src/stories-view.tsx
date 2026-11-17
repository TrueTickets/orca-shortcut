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
            ? item.worktrees[0].name
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
      current={read(selected) === key}
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
 * Rows, with the selected one's details opened right under it. A List holds only rows and a row
 * holds no buttons, so the list is split around the details.
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
  const open = items.findIndex((item) => keyOf(item.id) === read(selected))
  const list = (part: readonly StoryItem[], key: string) =>
    part.length === 0 ? null : (
      <List key={key} label={label}>
        {part.map((item) => (
          <StoryRow key={item.id} item={item} focusedStoryId={focusedStoryId} />
        ))}
      </List>
    )
  if (open < 0) {
    return list(items, 'all')
  }
  return (
    <Stack gap="xs">
      {list(items.slice(0, open + 1), 'above')}
      <StoryDetails story={items[open]} />
      {list(items.slice(open + 1), 'below')}
    </Stack>
  )
}

/** A parent story as a header, like a project in Orca's left sidebar, with its sub-tasks under it. */
function Group({ group, focusedStoryId }: { group: StoryGroup; focusedStoryId: number | null }) {
  const { story } = group
  if (group.subtasks.length === 0) {
    // A story that matched on its own: one row, like any other.
    return <Rows label={story.name} items={[story]} focusedStoryId={focusedStoryId} />
  }
  return (
    <Stack gap="xs">
      <Row justify="between" gap="sm">
        <Text weight="semibold" size="sm" truncate>
          {story.name}
        </Text>
        <StatePill item={story} />
      </Row>
      <Rows label={story.name} items={group.subtasks} focusedStoryId={focusedStoryId} />
    </Stack>
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
        <Box gap="lg">
          {current.groups.map((group) => (
            <Group key={group.story.id} group={group} focusedStoryId={focusedStoryId} />
          ))}
        </Box>
      )}
    </Stack>
  )
}
