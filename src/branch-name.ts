// The branch Shortcut's branch helper names for a story, so a worktree's branch links to its
// story the way the person's own branches do. No I/O.

/** Shortcut cuts the whole branch name, prefix included, at this many characters. */
const MAX_LENGTH = 50

/**
 * `<mention>/sc-<id>/<slug>`: the title lowercased, each run of whitespace a `-`, anything but
 * letters, digits, `_` and `-` dropped (so `—` between spaces leaves `--`), and the whole name cut
 * at 50 characters, a trailing `-` included. Checked against the helper's own output.
 */
export function shortcutBranchName(mentionName: string, storyId: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
  return `${mentionName}/sc-${storyId}/${slug}`.slice(0, MAX_LENGTH)
}
