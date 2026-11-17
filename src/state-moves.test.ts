import { assert, test } from 'orca/testing'
import type { ShortcutWorkflowState } from './shortcut-api'
import { forwardStates } from './state-moves'

// A workflow that mixes story and sub-task states, as the one this plugin was built for does,
// plus a second workflow whose states must never be offered.
const STATES: ShortcutWorkflowState[] = [
  ['New', 'backlog'],
  ['Discovery (Stories)', 'backlog'],
  ['Ready', 'unstarted'],
  ['In Progress (Stories)', 'started'],
  ['In Development (Sub-tasks)', 'started'],
  ['PR Review (Sub-tasks)', 'started'],
  ['Acceptance Testing (Stories)', 'started'],
  ['Complete', 'done']
].map(([name, type], position) => ({ id: 100 + position, name, type, position, workflowId: 1 }))
STATES.push({ id: 900, name: 'Shipped', type: 'done', position: 99, workflowId: 2 })

const names = (stateId: number, isSubtask: boolean) =>
  forwardStates(stateId, isSubtask, STATES).map((state) => state.name)

test('a sub-task can move to the later sub-task states and the shared ones', () => {
  assert.deepEqual(names(102, true), [
    'In Development (Sub-tasks)',
    'PR Review (Sub-tasks)',
    'Complete'
  ])
  assert.deepEqual(names(104, true), ['PR Review (Sub-tasks)', 'Complete'])
})

test('a story can move to the later story states and the shared ones', () => {
  assert.deepEqual(names(102, false), [
    'In Progress (Stories)',
    'Acceptance Testing (Stories)',
    'Complete'
  ])
})

test('nothing comes before the current state, from another workflow, or after the last', () => {
  assert.ok(!names(104, true).includes('Ready'))
  assert.ok(!names(100, false).includes('Shipped'))
  assert.deepEqual(names(107, true), [])
})

test('an unknown current state offers nothing', () => {
  assert.deepEqual(forwardStates(555, true, STATES), [])
})

test('each option carries the id and type the move needs', () => {
  assert.deepEqual(forwardStates(105, true, STATES), [{ id: 107, name: 'Complete', type: 'done' }])
})
