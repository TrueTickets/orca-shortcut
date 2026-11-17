// The status bar count: how many sub-tasks the default filter lists, such as your sub-tasks in
// Ready. Only sub-tasks count, since work starts on them. No I/O here.
import type { StoryFilter } from './protocol'
import { shortStateName } from './state-tone'

/** Orca cuts a status bar tooltip at 256 characters. */
const TOOLTIP_MAX = 256
/** Sub-tasks named in the tooltip; the rest are counted. */
const TOOLTIP_ITEMS = 5

export type ReadySubtask = { id: number; name: string }

export type ReadyCountItem = { text: string; icon: 'layers'; tone: 'accent' | 'neutral'; tooltip: string }

/** "Ready" for one state, "to do" for several: the word after the count. */
function stateWord(filter: StoryFilter): string {
  return filter.states.length === 1 ? shortStateName(filter.states[0]).toLowerCase() : 'to do'
}

/** "3 sub-tasks in Ready, yours": what was counted, in words. */
export function describeCount(count: number, filter: StoryFilter, truncated: boolean): string {
  const owner = { me: ', yours', anyone: '', unassigned: ', unassigned' }[filter.owner]
  const states = filter.states.length > 0 ? filter.states.join(', ') : 'no states'
  return `${count}${truncated ? '+' : ''} sub-task${count === 1 ? '' : 's'} in ${states}${owner}`
}

function line(subtask: ReadySubtask): string {
  return `sc-${subtask.id} ${subtask.name}`
}

export function readyCountItem(
  subtasks: readonly ReadySubtask[],
  filter: StoryFilter,
  truncated: boolean
): ReadyCountItem {
  const lines = [`Shortcut: ${describeCount(subtasks.length, filter, truncated)}`]
  for (const subtask of subtasks.slice(0, TOOLTIP_ITEMS)) {
    lines.push(line(subtask))
  }
  if (subtasks.length > TOOLTIP_ITEMS) {
    lines.push(`and ${subtasks.length - TOOLTIP_ITEMS} more`)
  }
  let tooltip = lines.join('\n')
  if (tooltip.length > TOOLTIP_MAX) {
    tooltip = `${tooltip.slice(0, TOOLTIP_MAX - 1)}…`
  }
  return {
    text: `${subtasks.length}${truncated ? '+' : ''} ${stateWord(filter)}`,
    icon: 'layers',
    tone: subtasks.length > 0 ? 'accent' : 'neutral',
    tooltip
  }
}

/** What pressing the item shows: every counted sub-task, one per line. */
export function readyCountMessage(
  subtasks: readonly ReadySubtask[],
  filter: StoryFilter,
  truncated: boolean
): string {
  return [`${describeCount(subtasks.length, filter, truncated)}.`, ...subtasks.map(line)].join('\n')
}
