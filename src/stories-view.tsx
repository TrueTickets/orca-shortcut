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
  IconButton,
  Input,
  List,
  ListItem,
  read,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Switch,
  Text,
  update,
  type IconName,
  type OrcaNode
} from 'orca'
import type { StoryFilter, StoryGroup, StoryItem, StoryList, StoryOwner } from './protocol'
import {
  changeQuery,
  chosenFilter,
  clearSearch,
  collapsed,
  focus,
  keyOf,
  list,
  listError,
  loadStories,
  narrowGroups,
  openWorktree,
  query,
  searchError,
  searching,
  searchResults,
  searchShortcut,
  searchWithFilters,
  selected,
  useFiltersInSearch
} from './state'
import { shortStateName, toneOfState } from './state-tone'
import { CreateSubtask } from './create-subtask-view'
import { MoveState } from './move-state-view'
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
    return 'branch'
  }
  // No worktree yet: a sub-task is waiting for Start work, as its button's icon says.
  return item.parentId === null ? 'book' : 'play'
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
  // The header is a row too, so the story can be opened: its details hold Create sub-task and
  // Open in Shortcut. It opens on the selection tint, above the story's sub-tasks. The chevron
  // beside it folds the sub-tasks away; it sits outside the row, since rows hold no buttons.
  const folded = read(collapsed).includes(story.id)
  const hidden = folded
    ? [
        `${group.subtasks.length} sub-task${group.subtasks.length === 1 ? '' : 's'}`,
        group.subtasks.some((subtask) => subtask.id === focusedStoryId) ? 'here' : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const header = (
    <Box direction="row" gap="xs" align="center">
      <Box shrink={false}>
        <IconButton
          icon={folded ? 'next' : 'expand'}
          label={folded ? `Show sub-tasks of ${keyOf(story.id)}` : `Hide sub-tasks of ${keyOf(story.id)}`}
          variant="ghost"
          size="sm"
          onPress={() => toggleFolded(story.id)}
        />
      </Box>
      <Box grow shrink minWidth={0}>
        <List label={story.name}>
          <ListItem onPress={() => toggle(story)}>
            <Box direction="row" justify="between" gap="sm">
              <Box grow shrink minWidth={0}>
                <Text weight="semibold" size="sm" truncate>
                  {story.name}
                </Text>
              </Box>
              <Box direction="row" gap="xs" shrink={false} align="center">
                {hidden ? (
                  <Text size="xs" muted>
                    {hidden}
                  </Text>
                ) : null}
                <StatePill item={story} />
              </Box>
            </Box>
          </ListItem>
        </List>
      </Box>
    </Box>
  )
  return (
    <Box radius="md" background="muted" padding="xs" gap="xs">
      {keyOf(story.id) === read(selected) ? (
        <Box radius="md" background="accent" padding="xs" gap="xs">
          {header}
          <StoryDetails story={story} />
        </Box>
      ) : (
        header
      )}
      {folded ? null : (
        // Sub-tasks indented under the story's title, as a tree draws children under a parent.
        <Box direction="row">
          <Box width={22} shrink={false} />
          <Box grow shrink minWidth={0}>
            <Rows label={story.name} items={group.subtasks} focusedStoryId={focusedStoryId} />
          </Box>
        </Box>
      )}
    </Box>
  )
}

function toggleFolded(storyId: number): void {
  update(collapsed, (ids) =>
    ids.includes(storyId) ? ids.filter((id) => id !== storyId) : [...ids, storyId]
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
        {/* Components have no fieldset, so the checkboxes get a heading like the Select's label. */}
        <Stack gap="xs">
          <Text size="sm" weight="medium">
            States
          </Text>
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
          <CreateSubtask story={story} />
        )}
        <MoveState story={story} />
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

/** Narrows the list as it is typed; Enter searches all of Shortcut. */
function SearchBox() {
  const text = read(query)
  return (
    <Row gap="xs">
      <Box grow shrink minWidth={0}>
        <Input
          label="Search stories"
          labelHidden
          type="search"
          placeholder="Search, Enter for all of Shortcut"
          value={text}
          onChange={changeQuery}
          onSubmit={(value) => void searchShortcut(value)}
        />
      </Box>
      {text ? <IconButton icon="close" label="Clear search" onPress={clearSearch} /> : null}
    </Row>
  )
}

function Groups({ groups, focusedStoryId }: { groups: readonly StoryGroup[]; focusedStoryId: number | null }) {
  return (
    <Box gap="md">
      {groups.map((group) => (
        <Group key={group.story.id} group={group} focusedStoryId={focusedStoryId} />
      ))}
    </Box>
  )
}

/** All of Shortcut searched, in place of the list; the filters do not apply. */
function ShortcutResults({ focusedStoryId }: { focusedStoryId: number | null }) {
  const results = read(searchResults)
  if (!results) {
    return null
  }
  const count = results.groups.reduce((total, group) => total + 1 + group.subtasks.length, 0)
  const scope = results.filter ? describeFilter(results.filter) : 'All of Shortcut'
  return (
    <Stack gap="md">
      <Row justify="between">
        <Text size="xs" muted>
          {`${scope} · ${results.groups.length === 0 ? 'no' : count} match${count === 1 ? '' : 'es'}`}
        </Text>
        <Button variant="ghost" onPress={clearSearch}>
          Back to my list
        </Button>
      </Row>
      <Switch label="Use my filters" checked={read(searchWithFilters)} onChange={useFiltersInSearch} />
      {results.truncated ? (
        <Callout tone="warning">Shortcut has more matches than shown: search for something narrower.</Callout>
      ) : null}
      {results.groups.length === 0 ? (
        <EmptyState
          title="No stories"
          description={
            results.filter
              ? `Nothing in Shortcut matches "${results.query}" with these filters.`
              : `Nothing in Shortcut matches "${results.query}".`
          }
          icon="search"
        />
      ) : (
        <Groups groups={results.groups} focusedStoryId={focusedStoryId} />
      )}
    </Stack>
  )
}

export function StoriesView() {
  const current = read(list)
  const problem = read(listError)
  if (current === null) {
    return problem ? <Callout tone="danger">{problem}</Callout> : <Spinner label="Loading stories" />
  }
  const focusedStoryId = read(focus).storyId
  const text = read(query).trim()
  const failed = read(searchError)
  const header = (
    <>
      <SearchBox />
      {read(searching) ? <Spinner label="Searching Shortcut" /> : null}
      {failed ? <Callout tone="danger">{failed}</Callout> : null}
    </>
  )
  if (read(searchResults)) {
    return (
      <Stack gap="md">
        {header}
        {/* With the filter on, it can be changed here; a change searches again. */}
        {read(searchWithFilters) ? <Filters current={current} /> : null}
        <ShortcutResults focusedStoryId={focusedStoryId} />
      </Stack>
    )
  }
  const groups = narrowGroups(current.groups, text)
  return (
    <Stack gap="md">
      {header}
      <Filters current={current} />
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      {current.truncated ? (
        <Callout tone="warning">Some states have more stories than the list shows.</Callout>
      ) : null}
      {groups.length > 0 ? (
        <Groups groups={groups} focusedStoryId={focusedStoryId} />
      ) : text ? (
        <EmptyState
          title="No matches here"
          description={`Nothing in this list matches "${text}". Press Enter to search all of Shortcut.`}
          icon="search"
        />
      ) : (
        <EmptyState title="No stories" description="Nothing matches these filters." icon="search" />
      )}
    </Stack>
  )
}
