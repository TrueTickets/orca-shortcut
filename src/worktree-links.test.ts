import { assert, test } from 'orca/testing'
import type { StoryItem } from './protocol'
import { storyItem, worktreeRef } from './test-fixtures'
import {
  indexWorktrees,
  isProblem,
  linkWorktrees,
  shortBranch,
  storyFlags,
  storyIdOfBranch,
  type ListedWorkspace
} from './worktree-links'

test('reads the story id from branches as people and Orca name them', () => {
  // Shaped like real Orca worktree branches: a removed em dash leaves `--`, a removed
  // closing parenthesis can leave a trailing `-`, and teammates' branches carry their prefix.
  assert.equal(
    storyIdOfBranch('refs/heads/ada/sc-1794/difference-engine--column-2-tables-'),
    1794
  )
  assert.equal(
    storyIdOfBranch('refs/heads/grace/sc-1938/log-failed-cards-in-the-mill'),
    1938
  )
  assert.equal(storyIdOfBranch('ada/sc-2124/rewrite-the-bernoulli-note-as-tables'), 2124)
  // Orca's own naming turns the slashes of a name into dashes.
  assert.equal(storyIdOfBranch('ada/sc-1841-operation-cards'), 1841)
  assert.equal(storyIdOfBranch('sc-7'), 7)
  assert.equal(storyIdOfBranch('SC-7/upper'), 7)
})

test('ignores branches that only look like they name a story', () => {
  assert.equal(storyIdOfBranch('main'), null)
  assert.equal(storyIdOfBranch('ada/disc-12/thing'), null)
  assert.equal(storyIdOfBranch('ada/sc-12x/thing'), null)
  assert.equal(storyIdOfBranch('ada/describe-sc-12'), null)
  assert.equal(storyIdOfBranch(null), null)
  assert.equal(storyIdOfBranch(''), null)
})

test('strips refs/heads/ only at the start', () => {
  assert.equal(shortBranch('refs/heads/ada/sc-1/x'), 'ada/sc-1/x')
  assert.equal(shortBranch('ada/refs/heads/x'), 'ada/refs/heads/x')
})

test('indexes worktrees by story, skipping folders and branchless rows', () => {
  const workspaces: ListedWorkspace[] = [
    { id: 'a', kind: 'worktree', name: 'one', project: 'infra', projectId: 'p1', path: '/a', branch: 'refs/heads/ada/sc-1/x', status: { state: 'working' } },
    { id: 'b', kind: 'worktree', name: 'two', project: null, path: '/b', branch: 'ada/sc-1-again' },
    { id: 'c', kind: 'worktree', name: 'main', path: '/c', branch: 'main' },
    { id: 'd', kind: 'folder', name: 'sc-2 notes', path: '/d', branch: 'sc-2' },
    { id: 'e', kind: 'worktree', name: 'detached', path: '/e', branch: null },
    { id: 'f', kind: 'worktree', name: 'odd', path: '/f', branch: 'sc-3', status: { state: 'mystery' } }
  ]
  const index = indexWorktrees(workspaces)
  assert.deepEqual([...index.keys()].sort(), [1, 3])
  assert.deepEqual(index.get(1), [
    { workspaceId: 'a', name: 'one', branch: 'ada/sc-1/x', path: '/a', project: 'infra', projectId: 'p1', agent: 'working' },
    { workspaceId: 'b', name: 'two', branch: 'ada/sc-1-again', path: '/b', project: null, projectId: null, agent: null }
  ])
  // An agent state Orca adds later is not passed on as one the panel knows.
  assert.equal(index.get(3)?.[0].agent, null)
})

const flagsOf = (fields: Partial<StoryItem>) => {
  const { flags: _ignored, ...item } = storyItem(1, fields)
  return storyFlags(item)
}

test('flags in-progress sub-tasks without a worktree', () => {
  assert.deepEqual(flagsOf({ parentId: 9, stateType: 'started' }), ['no-worktree'])
  // Ready work, and stories, need no worktree yet.
  assert.deepEqual(flagsOf({ parentId: 9, stateType: 'unstarted' }), [])
  assert.deepEqual(flagsOf({ parentId: null, stateType: 'started' }), [])
})

test('flags duplicate worktrees, worktrees on stories, and stale worktrees', () => {
  assert.deepEqual(
    flagsOf({ parentId: 9, stateType: 'started', worktrees: [worktreeRef(1), worktreeRef(1, { workspaceId: 'x' })] }),
    ['duplicate']
  )
  assert.deepEqual(flagsOf({ parentId: null, worktrees: [worktreeRef(1)] }), ['on-story'])
  assert.deepEqual(flagsOf({ parentId: 9, stateType: 'done', worktrees: [worktreeRef(1)] }), ['stale'])
  assert.deepEqual(flagsOf({ parentId: 9, archived: true, worktrees: [worktreeRef(1)] }), ['stale'])
  assert.deepEqual(flagsOf({ parentId: 9, stateType: 'started', worktrees: [worktreeRef(1)] }), [])
})

test('links worktrees to their stories: problems first, the focused one marked', () => {
  const index = new Map([
    [5, [worktreeRef(5)]],
    [6, [worktreeRef(6)]],
    [7, [worktreeRef(7)]]
  ])
  const stories = new Map([
    [5, storyItem(5, { parentId: 1, stateType: 'started', worktrees: index.get(5) })],
    [6, storyItem(6, { parentId: 1, stateType: 'done', worktrees: index.get(6), flags: ['stale'] })]
    // Story 7: Shortcut did not return it.
  ])
  const linked = linkWorktrees(index, stories, 'refs/heads/ada/sc-5/work')
  assert.deepEqual(
    linked.map((worktree) => [worktree.storyId, worktree.flags, worktree.focused]),
    [
      [7, ['missing-story'], false],
      [6, ['stale'], false],
      [5, [], true]
    ]
  )
  assert.equal(linked[0].story, null)
})

test('the Worktrees tab never says a worktree has no worktree', () => {
  const index = new Map([[5, [worktreeRef(5)]]])
  // A story item built before its worktree was indexed may carry the flag; the link drops it.
  const stories = new Map([[5, storyItem(5, { parentId: 1, flags: ['no-worktree'] })]])
  assert.deepEqual(linkWorktrees(index, stories, null)[0].flags, [])
})

test('a worktree on work still in the backlog is a heads-up, not a problem', () => {
  const flags = flagsOf({ parentId: 9, stateType: 'backlog', worktrees: [worktreeRef(1)] })
  assert.deepEqual(flags, ['not-started'])
  assert.equal(isProblem('not-started'), false)
  assert.equal(isProblem('stale'), true)
  // Ready work with a worktree is about to start: no flag. Done wins over backlog.
  assert.deepEqual(flagsOf({ parentId: 9, stateType: 'unstarted', worktrees: [worktreeRef(1)] }), [])
  assert.deepEqual(flagsOf({ parentId: 9, stateType: 'backlog' }), [])
})
