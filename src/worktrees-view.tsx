// The Worktrees tab: every worktree whose branch names a story, whatever the story filter, with
// the story's state now and what is off. Problems first.
import {
  Badge,
  Box,
  Callout,
  EmptyState,
  List,
  ListItem,
  read,
  Row,
  Spinner,
  Stack,
  Text,
  type IconName
} from 'orca'
import type { LinkedWorktree } from './protocol'
import { keyOf, openWorktree, worktrees, worktreesError } from './state'
import { shortStateName, toneOfState } from './state-tone'
import { RowText } from './stories-view'
import { FLAG_PILL, FLAG_TEXT, isProblem } from './worktree-links'

const AGENT_TEXT: Record<string, string> = {
  working: 'agent working',
  permission: 'agent needs permission',
  done: 'agent done'
}

function iconOf(worktree: LinkedWorktree): IconName {
  if (worktree.flags.some(isProblem)) {
    return 'warning'
  }
  if (worktree.flags.length > 0) {
    return 'flag'
  }
  return worktree.agent === 'working' || worktree.agent === 'permission' ? 'bot' : 'folder'
}

/** Like a worktree in Orca's left sidebar: the story on top, the branch under it, then pills. */
function WorktreeRow({ worktree }: { worktree: LinkedWorktree }) {
  const description = [
    keyOf(worktree.storyId),
    worktree.agent ? AGENT_TEXT[worktree.agent] : undefined,
    worktree.branch
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <ListItem
      icon={iconOf(worktree)}
      current={worktree.focused}
      onPress={() => void openWorktree(worktree.workspaceId)}
    >
      <RowText title={worktree.story?.name ?? worktree.name} description={description}>
        <Box direction="row" gap="xs" shrink={false}>
          {worktree.story ? (
            <Badge tone={toneOfState(worktree.story.state, worktree.story.stateType)}>
              {shortStateName(worktree.story.state)}
            </Badge>
          ) : null}
          {worktree.flags.map((flag) => (
            <Badge key={flag} tone={isProblem(flag) ? 'danger' : 'neutral'}>
              {FLAG_PILL[flag]}
            </Badge>
          ))}
        </Box>
      </RowText>
      {/* Only a flagged worktree gets a third line: what to do about it. */}
      {worktree.flags.length > 0 ? (
        <Text tone={worktree.flags.some(isProblem) ? 'warning' : 'accent'} size="xs">
          {worktree.flags.map((flag) => FLAG_TEXT[flag]).join(' ')}
        </Text>
      ) : null}
    </ListItem>
  )
}

export function WorktreesView() {
  const current = read(worktrees)
  const problem = read(worktreesError)
  if (current === null) {
    return problem ? (
      <Callout tone="danger">{problem}</Callout>
    ) : (
      <Spinner label="Loading worktrees" />
    )
  }
  const attention = current.worktrees.filter((worktree) => worktree.flags.length > 0).length
  return (
    <Stack gap="md">
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      {current.worktrees.length === 0 ? (
        <EmptyState
          title="No story worktrees"
          description="No worktree's branch names a Shortcut story (sc-…)."
          icon="folder"
        />
      ) : (
        <Stack gap="sm">
          <Text muted size="xs">
            {`${current.worktrees.length} worktree${current.worktrees.length === 1 ? '' : 's'}` +
              (attention > 0 ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : '')}
          </Text>
          <List label="Worktrees">
            {current.worktrees.map((worktree) => (
              <WorktreeRow key={worktree.workspaceId} worktree={worktree} />
            ))}
          </List>
        </Stack>
      )}
    </Stack>
  )
}
