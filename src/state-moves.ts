// Which workflow states a story may move to from the panel: only forward. Moving back is rare and
// deliberate, so it is left to Shortcut's own UI, and Start work follows the same rule.
import type { StateOption } from './protocol'
import type { ShortcutWorkflowState } from './shortcut-api'

/** A state meant for the other kind of story, by the "(Stories)" / "(Sub-tasks)" naming convention. */
function forOtherKind(name: string, isSubtask: boolean): boolean {
  return isSubtask ? /\(stories\)\s*$/i.test(name) : /\(sub-?tasks\)\s*$/i.test(name)
}

/**
 * The states after `currentStateId` in its own workflow, in workflow order. States named for the
 * other kind of story are left out: a workflow that holds both, as "In Progress (Stories)" and
 * "In Development (Sub-tasks)", would otherwise offer a sub-task a story's state.
 */
export function forwardStates(
  currentStateId: number,
  isSubtask: boolean,
  states: readonly ShortcutWorkflowState[]
): StateOption[] {
  const current = states.find((state) => state.id === currentStateId)
  if (!current) {
    return []
  }
  return states
    .filter(
      (state) =>
        state.workflowId === current.workflowId &&
        state.position > current.position &&
        !forOtherKind(state.name, isSubtask)
    )
    .sort((a, b) => a.position - b.position)
    .map((state) => ({ id: state.id, name: state.name, type: state.type }))
}
