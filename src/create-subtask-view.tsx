// Creating a sub-task from a story's details. Work starts on sub-tasks, so a story without one
// is otherwise a dead end; once created, the sub-task opens with its Start work form ready.
import { atom, Button, Callout, Input, plugin, read, Row, set, Stack, Text } from 'orca'
import type { CreatedSubtask, StoryItem } from './protocol'
import { keyOf, list, loadStories, messageOf, selected } from './state'
import { prepareStartWork } from './start-work-view'

/** The title being typed, for the story it is typed for. */
const draft = atom<{ parentId: number; title: string } | null>(null)
const creating = atom<number | null>(null)
const created = atom<(CreatedSubtask & { parentId: number; shown: boolean }) | null>(null)
const failure = atom<{ parentId: number; message: string } | null>(null)

function shownInList(id: number): boolean {
  return (read(list)?.groups ?? []).some(
    (group) => group.story.id === id || group.subtasks.some((subtask) => subtask.id === id)
  )
}

async function create(parentId: number): Promise<void> {
  const title = read(draft)?.parentId === parentId ? read(draft)?.title ?? '' : ''
  set(creating, parentId)
  set(failure, null)
  try {
    const answer = await plugin.request('subtask.create', { parentId, name: title })
    set(draft, null)
    await loadStories()
    const shown = shownInList(answer.id)
    set(created, { ...answer, parentId, shown })
    if (shown) {
      // Straight to its details, with Start work ready.
      set(selected, keyOf(answer.id))
      void prepareStartWork(answer.id)
    }
  } catch (reason) {
    set(failure, { parentId, message: messageOf(reason) })
  } finally {
    set(creating, null)
  }
}

export function CreateSubtask({ story }: { story: StoryItem }) {
  const title = read(draft)?.parentId === story.id ? read(draft)?.title ?? '' : ''
  const busy = read(creating) === story.id
  const done = read(created)
  const failed = read(failure)
  return (
    <Stack gap="xs">
      {done?.parentId === story.id ? (
        <Callout tone={done.warnings.length > 0 ? 'warning' : 'success'}>
          {[
            `Created ${keyOf(done.id)} in ${done.state}.`,
            done.shown ? '' : 'The current filter does not show it.',
            ...done.warnings
          ]
            .filter(Boolean)
            .join(' ')}
        </Callout>
      ) : null}
      {failed?.parentId === story.id ? <Callout tone="danger">{failed.message}</Callout> : null}
      <Text size="xs" muted>
        Work starts on a story's sub-tasks.
      </Text>
      <Row gap="xs">
        <Input
          label="New sub-task"
          labelHidden
          placeholder="New sub-task title"
          value={title}
          disabled={busy}
          onChange={(value) => set(draft, { parentId: story.id, title: value })}
          onSubmit={() => void create(story.id)}
        />
        <Button icon="add" disabled={busy || !title.trim()} onPress={() => void create(story.id)}>
          {busy ? 'Creating…' : 'Create sub-task'}
        </Button>
      </Row>
    </Stack>
  )
}
