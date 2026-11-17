// Moving a story or sub-task to a later workflow state, from its details. Only forward: the
// worker offers the later states and checks the move again. A done state asks first, since the
// story then leaves the default list.
import { atom, Box, Button, Callout, plugin, read, Row, Select, set, Stack } from 'orca'
import type { MovedStory, StateOption, StoryItem } from './protocol'
import { keyOf, messageOf, worktreesChanged } from './state'

/** The state picked, for the story it was picked for. */
const choice = atom<{ storyId: number; stateId: number } | null>(null)
/** A done state waiting for the person to confirm. */
const confirming = atom<number | null>(null)
const moving = atom<number | null>(null)
const moved = atom<MovedStory | null>(null)
const failure = atom<{ storyId: number; message: string } | null>(null)

async function move(story: StoryItem, target: StateOption): Promise<void> {
  set(confirming, null)
  set(moving, story.id)
  set(failure, null)
  set(moved, null)
  try {
    set(moved, await plugin.request('story.move', { storyId: story.id, stateId: target.id }))
    set(choice, null)
    // Its state, pills and maybe its place in the list changed; so may the Worktrees tab.
    worktreesChanged()
  } catch (reason) {
    set(failure, { storyId: story.id, message: messageOf(reason) })
  } finally {
    set(moving, null)
  }
}

function press(story: StoryItem, target: StateOption): void {
  if (target.type === 'done') {
    set(confirming, story.id)
    return
  }
  void move(story, target)
}

export function MoveState({ story }: { story: StoryItem }) {
  const done = read(moved)
  const failed = read(failure)
  const outcome = (
    <>
      {done?.id === story.id ? (
        <Callout tone="success">{`Moved ${keyOf(story.id)} to ${done.state}.`}</Callout>
      ) : null}
      {failed?.storyId === story.id ? <Callout tone="danger">{failed.message}</Callout> : null}
    </>
  )
  if (story.nextStates.length === 0) {
    return outcome
  }
  const picked = read(choice)
  const target = story.nextStates.find(
    (state) => picked?.storyId === story.id && state.id === picked.stateId
  )
  const busy = read(moving) === story.id
  return (
    <Stack gap="xs">
      {outcome}
      <Row gap="xs">
        <Box grow shrink minWidth={0}>
          <Select
            label="Move to"
            labelHidden
            placeholder="Move to…"
            value={target ? String(target.id) : undefined}
            options={story.nextStates.map((state) => ({ value: String(state.id), label: state.name }))}
            disabled={busy}
            onChange={(value) => {
              set(confirming, null)
              set(choice, { storyId: story.id, stateId: Number(value) })
            }}
          />
        </Box>
        <Button disabled={busy || !target} onPress={() => target && press(story, target)}>
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </Row>
      {target && read(confirming) === story.id ? (
        <Callout tone="warning">
          <Stack gap="xs">
            {`Move ${keyOf(story.id)} to ${target.name}? It will leave lists that show work in progress.`}
            <Row gap="xs">
              <Button onPress={() => void move(story, target)}>{`Move to ${target.name}`}</Button>
              <Button variant="ghost" onPress={() => set(confirming, null)}>
                Cancel
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
    </Stack>
  )
}
