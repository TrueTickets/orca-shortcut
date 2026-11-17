import { assert, test } from 'orca/testing'
import { shortStateName, toneOfState } from './state-tone'

test('colours the Development workflow by stage', () => {
  // Every state of the workflow this plugin was built for, as Shortcut types them.
  const workflow: [string, string, string][] = [
    ['New', 'backlog', 'neutral'],
    ['Discovery (Stories)', 'backlog', 'neutral'],
    ['Prioritized (Stories)', 'backlog', 'neutral'],
    ['Ready', 'unstarted', 'accent'],
    ['In Progress (Stories)', 'started', 'warning'],
    ['In Development (Sub-tasks)', 'started', 'warning'],
    ['PR Review (Sub-tasks)', 'started', 'success'],
    ['Acceptance Testing (Stories)', 'started', 'success'],
    ['Complete', 'done', 'success']
  ]
  for (const [name, type, tone] of workflow) {
    assert.equal(toneOfState(name, type), tone, name)
  }
})

test('a review-like name only counts while work is started', () => {
  assert.equal(toneOfState('QA', 'started'), 'success')
  assert.equal(toneOfState('Needs review', 'backlog'), 'neutral')
  assert.equal(toneOfState('Squash', 'started'), 'warning')
  assert.equal(toneOfState('Anything', 'some-new-type'), 'neutral')
})

test('drops the level a workflow adds to a state name', () => {
  assert.equal(shortStateName('In Development (Sub-tasks)'), 'In Development')
  assert.equal(shortStateName('Acceptance Testing (Stories)'), 'Acceptance Testing')
  assert.equal(shortStateName('Ready'), 'Ready')
  assert.equal(shortStateName('(Stories)'), '(Stories)')
})
