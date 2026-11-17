// Starting work from the selected sub-task's card: a first press asks the worker what it would
// do (project, branch, agents), a second does it. Creating a worktree runs the project's setup,
// so it is never one accidental click.
import { atom, Button, Callout, plugin, read, Select, set, Stack, Text } from 'orca'
import type { StartResult, StoryItem, WorkOptions } from './protocol'
import { loadStories, messageOf } from './state'

const NO_AGENT = 'none'

/** What the worker offered, for the story it was asked about. */
const options = atom<(WorkOptions & { storyId: number }) | null>(null)
const loadingOptions = atom<number | null>(null)
const project = atom<string | null>(null)
const agent = atom<string>(NO_AGENT)
const starting = atom(false)
const outcome = atom<(StartResult & { storyId: number }) | null>(null)
const problem = atom<{ storyId: number; message: string } | null>(null)

async function loadOptions(storyId: number): Promise<void> {
  set(loadingOptions, storyId)
  set(problem, null)
  try {
    const answer = await plugin.request('work.options', { storyId })
    set(options, { ...answer, storyId })
    set(project, answer.suggestedProjectId)
    set(agent, answer.defaultAgent ?? NO_AGENT)
  } catch (reason) {
    set(problem, { storyId, message: messageOf(reason) })
  } finally {
    set(loadingOptions, null)
  }
}

async function start(storyId: number): Promise<void> {
  const projectId = read(project)
  if (!projectId) {
    return
  }
  set(starting, true)
  set(problem, null)
  try {
    const chosen = read(agent)
    const result = await plugin.request(
      'work.start',
      { storyId, projectId, agent: chosen === NO_AGENT ? null : chosen },
      // Setup scripts and Shortcut calls can take a while.
      { timeoutMs: 120_000 }
    )
    set(outcome, { ...result, storyId })
    set(options, null)
    void loadStories()
  } catch (reason) {
    set(problem, { storyId, message: messageOf(reason) })
  } finally {
    set(starting, false)
  }
}

function Outcome({ result }: { result: StartResult }) {
  return (
    <Stack gap="xs">
      <Callout tone="success" title={result.existing ? 'Opened its worktree' : 'Work started'}>
        {result.done.join('\n')}
      </Callout>
      {result.warnings.length > 0 ? (
        <Callout tone="warning" title="Needs a look">
          {result.warnings.join('\n')}
        </Callout>
      ) : null}
    </Stack>
  )
}

/** The card's start section for a sub-task without a worktree. */
export function StartWork({ story }: { story: StoryItem }) {
  const done = read(outcome)
  const failed = read(problem)
  const offered = read(options)
  const failure =
    failed?.storyId === story.id ? <Callout tone="danger">{failed.message}</Callout> : null

  if (done?.storyId === story.id) {
    return <Outcome result={done} />
  }
  if (offered?.storyId !== story.id) {
    return (
      <Stack gap="xs">
        {failure}
        <Button
          icon="play"
          disabled={read(loadingOptions) === story.id}
          onPress={() => void loadOptions(story.id)}
        >
          {read(loadingOptions) === story.id ? 'Checking…' : 'Start work…'}
        </Button>
      </Stack>
    )
  }
  const busy = read(starting)
  return (
    <Stack gap="sm">
      {failure}
      <Select
        label="Project"
        value={read(project) ?? undefined}
        placeholder="Pick a project"
        options={offered.projects.map((candidate) => ({
          value: candidate.id,
          label:
            candidate.hostId && candidate.hostId !== 'local'
              ? `${candidate.name} (${candidate.hostId})`
              : candidate.name
        }))}
        disabled={busy}
        onChange={(value) => set(project, value)}
      />
      <Select
        label="Agent"
        value={read(agent)}
        options={[
          { value: NO_AGENT, label: 'No agent' },
          ...offered.agents.map((id) => ({ value: id, label: id }))
        ]}
        disabled={busy}
        onChange={(value) => set(agent, value)}
      />
      <Text size="xs" muted truncate>
        {`Branch: ${offered.branch}`}
      </Text>
      <Button icon="play" disabled={busy || !read(project)} onPress={() => void start(story.id)}>
        {busy ? 'Starting…' : 'Start work'}
      </Button>
    </Stack>
  )
}
