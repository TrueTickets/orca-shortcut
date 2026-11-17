// The colour of a workflow state, from Orca's theme tones. Derived from the state's type so it
// fits any Shortcut workflow; a review or testing stage reads as nearly done.
import type { Tone } from 'orca'

const REVIEW = /review|testing|\bqa\b|accept|verif/i

export function toneOfState(name: string, type: string): Tone {
  switch (type) {
    case 'unstarted':
      return 'accent'
    case 'started':
      return REVIEW.test(name) ? 'success' : 'warning'
    case 'done':
      return 'success'
    default:
      // backlog, and any type Shortcut adds later
      return 'neutral'
  }
}

/** A state name without the "(Stories)" or "(Sub-tasks)" a workflow adds to tell levels apart. */
export function shortStateName(name: string): string {
  return name.replace(/\s*\((stories|sub-tasks|subtasks)\)\s*$/i, '').trim() || name
}
