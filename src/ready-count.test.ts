import { assert, test } from 'orca/testing'
import { describeCount, readyCountItem, readyCountMessage } from './ready-count'

const mine = { states: ['Ready'], owner: 'me' as const }
const subtasks = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: 11 + index, name: `Sub-task ${index + 1}` }))

test('counts in the words of the filter', () => {
  assert.equal(readyCountItem(subtasks(3), mine, false).text, '3 ready')
  assert.equal(readyCountItem(subtasks(3), mine, true).text, '3+ ready')
  assert.equal(
    readyCountItem(subtasks(2), { states: ['Ready', 'In Development (Sub-tasks)'], owner: 'me' }, false).text,
    '2 to do'
  )
  assert.equal(
    readyCountItem([], { states: ['In Development (Sub-tasks)'], owner: 'me' }, false).text,
    '0 in development'
  )
  assert.equal(describeCount(1, { states: ['Ready'], owner: 'unassigned' }, false), '1 sub-task in Ready, unassigned')
  assert.equal(describeCount(2, { states: ['Ready'], owner: 'anyone' }, false), '2 sub-tasks in Ready')
})

test('stands out only when there is something to start', () => {
  assert.equal(readyCountItem(subtasks(1), mine, false).tone, 'accent')
  assert.equal(readyCountItem([], mine, false).tone, 'neutral')
})

test('the tooltip names the first five and counts the rest, within Orca’s limit', () => {
  assert.equal(
    readyCountItem(subtasks(7), mine, false).tooltip,
    [
      'Shortcut: 7 sub-tasks in Ready, yours',
      'sc-11 Sub-task 1',
      'sc-12 Sub-task 2',
      'sc-13 Sub-task 3',
      'sc-14 Sub-task 4',
      'sc-15 Sub-task 5',
      'and 2 more'
    ].join('\n')
  )
  const long = [{ id: 1, name: 'x'.repeat(400) }]
  const tooltip = readyCountItem(long, mine, false).tooltip
  assert.equal(tooltip.length, 256)
  assert.ok(tooltip.endsWith('…'))
})

test('pressing it lists every one', () => {
  assert.equal(
    readyCountMessage(subtasks(2), mine, false),
    '2 sub-tasks in Ready, yours.\nsc-11 Sub-task 1\nsc-12 Sub-task 2'
  )
})
