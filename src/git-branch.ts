// Puts a new worktree on the branch Shortcut names for its story. Orca names the branch it
// creates after the worktree; this renames it, or moves to the story's branch when that already
// exists from earlier work. Git runs through an injected runner so tests need no repository.

export type GitResult = { code: number; stdout: string; stderr: string }
/** Runs `git <args>` in `cwd`; never throws for a non-zero exit. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>

export type BranchOutcome =
  | { kind: 'renamed'; from: string }
  | { kind: 'reused'; from: string }
  | { kind: 'unchanged' }

/** A git failure, with the command and git's own words. */
export class GitError extends Error {
  readonly code = 'action_failed'
}

async function git(run: GitRunner, cwd: string, args: readonly string[]): Promise<string> {
  const result = await run(args, cwd)
  if (result.code !== 0) {
    throw new GitError(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout.trim()
}

/** Where `branch` is checked out, from `git worktree list --porcelain`; null when nowhere. */
function checkedOutAt(porcelain: string, branch: string): string | null {
  let path: string | null = null
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
    } else if (line === `branch refs/heads/${branch}`) {
      return path
    }
  }
  return null
}

/**
 * Moves the worktree at `cwd` onto `target`. A fresh worktree's branch has no commits of its own,
 * so when `target` already exists the worktree switches to it and the fresh branch is deleted;
 * otherwise the fresh branch is renamed. Refuses when `target` is checked out elsewhere.
 */
export async function moveToBranch(run: GitRunner, cwd: string, target: string): Promise<BranchOutcome> {
  const current = await git(run, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current === target) {
    return { kind: 'unchanged' }
  }
  const exists = (await run(['show-ref', '--verify', '--quiet', `refs/heads/${target}`], cwd)).code === 0
  if (!exists) {
    await git(run, cwd, ['branch', '-m', target])
    return { kind: 'renamed', from: current }
  }
  const elsewhere = checkedOutAt(await git(run, cwd, ['worktree', 'list', '--porcelain']), target)
  if (elsewhere) {
    throw new GitError(`Branch ${target} is already checked out in ${elsewhere}.`)
  }
  await git(run, cwd, ['switch', target])
  // -D: the fresh branch was never merged anywhere, and it has nothing to lose.
  await git(run, cwd, ['branch', '-D', current])
  return { kind: 'reused', from: current }
}
