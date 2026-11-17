// The Stories tab: sub-tasks under their parent story, each marked with the worktree its branch
// names, and the focused worktree's story selected.
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  EmptyState,
  read,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  Tree,
  type IconName,
  type TreeItem
} from 'orca'
import type { StoryFilter, StoryGroup, StoryItem, StoryList, StoryOwner } from './protocol'
import {
  chosenFilter,
  expanded,
  focus,
  keyOf,
  list,
  listError,
  loadStories,
  openWorktree,
  selected
} from './state'
import { describeFilter } from './story-tree'
import { FLAG_TEXT } from './worktree-links'

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

/** A row's icon: a problem first, then an agent at work, then a worktree, then the kind. */
function iconOf(item: StoryItem): IconName {
  if (item.flags.length > 0) {
    return 'warning'
  }
  if (item.worktrees.some((worktree) => worktree.agent === 'working')) {
    return 'bot'
  }
  if (item.worktrees.length > 0) {
    return 'folder'
  }
  return item.parentId === null ? 'book' : 'branch'
}

/** The short marks after a row's id: where you are, its worktree, and what is off. */
function marksOf(item: StoryItem, focusedStoryId: number | null): string[] {
  const marks: string[] = []
  if (item.id === focusedStoryId) {
    marks.push('here')
  } else if (item.worktrees.some((worktree) => worktree.agent === 'working')) {
    marks.push('agent working')
  } else if (item.worktrees.length > 0) {
    marks.push('worktree')
  }
  if (item.flags.includes('no-worktree')) {
    marks.push('no worktree')
  }
  if (item.flags.includes('duplicate')) {
    marks.push(`${item.worktrees.length} worktrees`)
  }
  return marks
}

/**
 * Rows are narrow, so a row names its state only when the filter spans several states and the
 * state tells rows apart; the detail card always shows it.
 */
function treeItem(group: StoryGroup, showState: boolean, focusedStoryId: number | null): TreeItem {
  // Marks come before the state: a narrow row cuts its end, and the marks matter more.
  const describe = (item: StoryItem, matched: boolean, extra: string[] = []) =>
    [
      keyOf(item.id),
      ...marksOf(item, focusedStoryId),
      ...extra,
      // A parent shown only as context keeps its state out: its state is not what was filtered.
      showState && matched ? item.state : ''
    ]
      .filter(Boolean)
      .join(' · ')
  const { story } = group
  const noSubtasks = group.matched && story.parentId === null && story.subTaskCount === 0
  return {
    key: keyOf(story.id),
    label: story.name,
    description: describe(story, group.matched, noSubtasks ? ['no sub-tasks'] : []),
    icon: iconOf(story),
    children:
      group.subtasks.length > 0
        ? group.subtasks.map((subtask) => ({
            key: keyOf(subtask.id),
            label: subtask.name,
            description: describe(subtask, true),
            icon: iconOf(subtask)
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
        {story.flags.map((flag) => (
          <Callout key={flag} tone="warning">
            {FLAG_TEXT[flag]}
          </Callout>
        ))}
        {story.worktrees.map((worktree) => (
          <Row key={worktree.workspaceId} justify="between">
            <Text size="xs">{`${worktree.name} · ${worktree.branch}`}</Text>
            <Button
              variant="ghost"
              icon="folder"
              onPress={() => void openWorktree(worktree.workspaceId)}
            >
              Open worktree
            </Button>
          </Row>
        ))}
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

export function StoriesView() {
  const current = read(list)
  const problem = read(listError)
  if (current === null) {
    return problem ? <Callout tone="danger">{problem}</Callout> : <Spinner label="Loading stories" />
  }
  const story = findItem(current.groups, read(selected))
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
        <Tree
          label="Stories"
          items={current.groups.map((group) =>
            treeItem(group, current.filter.states.length > 1, focusedStoryId)
          )}
          selected={read(selected) ?? undefined}
          expanded={read(expanded)}
          onSelect={({ key }) => set(selected, key)}
          onToggle={({ key, expanded: open }) =>
            set(
              expanded,
              open ? [...read(expanded), key] : read(expanded).filter((candidate) => candidate !== key)
            )
          }
        />
      )}
      {story ? <Detail story={story} /> : null}
    </Stack>
  )
}
