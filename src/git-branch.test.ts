import { assert, test } from 'orca/testing'
import { GitError, moveToBranch, type GitResult, type GitRunner } from './git-branch'

/** A fake git: answers by the command's first words, and records every command. */
function fakeGit(answers: Record<string, Partial<GitResult>>): { run: GitRunner; ran: string[] } {
  const ran: string[] = []
  const run: GitRunner = async (args) => {
    const command = args.join(' ')
    ran.push(command)
    const key = Object.keys(answers).find((prefix) => command.startsWith(prefix))
    return { code: 0, stdout: '', stderr: '', ...(key ? answers[key] : {}) }
  }
  return { run, ran }
}

const TARGET = 'ada/sc-1841/lay-out-the-operation-cards'

test('renames the fresh branch Orca made', async () => {
  const { run, ran } = fakeGit({
    'rev-parse': { stdout: 'ada/lay-out-the-operation-cards\n' },
    'show-ref': { code: 1 }
  })
  assert.deepEqual(await moveToBranch(run, '/w', TARGET), {
    kind: 'renamed',
    from: 'ada/lay-out-the-operation-cards'
  })
  assert.deepEqual(ran.at(-1), `branch -m ${TARGET}`)
})

test('moves to the story branch when earlier work left one, and drops the fresh branch', async () => {
  const { run, ran } = fakeGit({
    'rev-parse': { stdout: 'ada/fresh' },
    'show-ref': { code: 0 },
    'worktree list': { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /w\nHEAD def\nbranch refs/heads/ada/fresh\n' }
  })
  assert.deepEqual(await moveToBranch(run, '/w', TARGET), { kind: 'reused', from: 'ada/fresh' })
  assert.deepEqual(ran.slice(-2), [`switch ${TARGET}`, 'branch -D ada/fresh'])
})

test('does nothing when already on the story branch', async () => {
  const { run, ran } = fakeGit({ 'rev-parse': { stdout: TARGET } })
  assert.deepEqual(await moveToBranch(run, '/w', TARGET), { kind: 'unchanged' })
  assert.equal(ran.length, 1)
})

test('refuses when the story branch is checked out in another worktree', async () => {
  const { run, ran } = fakeGit({
    'rev-parse': { stdout: 'ada/fresh' },
    'show-ref': { code: 0 },
    'worktree list': { stdout: `worktree /elsewhere\nHEAD abc\nbranch refs/heads/${TARGET}\n` }
  })
  await assert.rejects(moveToBranch(run, '/w', TARGET), (error: unknown) => {
    assert.ok(error instanceof GitError)
    assert.match((error as Error).message, /already checked out in \/elsewhere/)
    return true
  })
  assert.ok(!ran.some((command) => command.startsWith('switch') || command.startsWith('branch -D')))
})

test("reports git's own words when a command fails", async () => {
  const { run } = fakeGit({
    'rev-parse': { stdout: 'ada/fresh' },
    'show-ref': { code: 1 },
    'branch -m': { code: 128, stderr: 'fatal: a branch named x already exists' }
  })
  await assert.rejects(moveToBranch(run, '/w', TARGET), /branch -m .* failed: fatal: a branch named x/)
})
