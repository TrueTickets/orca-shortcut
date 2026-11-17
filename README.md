# Shortcut for Orca

An [Orca](https://github.com/stablyai/orca) plugin that brings
[Shortcut](https://www.shortcut.com) stories and sub-tasks into Orca.

> Work in progress.
> Today it connects to Shortcut with an API token
> and lists your stories and sub-tasks,
> with the worktree each one is checked out in.
> Starting worktrees from sub-tasks is next.

## How it works

Orca does not yet let plugins register as task providers
(the `taskSources` contribution point is reserved),
so this plugin is a sidebar panel with its own worker:

- `src/panel.tsx` is the panel, drawn with Orca's own components.
  Panel frames have no network access.
- `src/worker.ts` is the plugin's worker.
  It is the only part that talks to Shortcut
  and the only part that sees the API token.
- `src/shortcut-api.ts` is a small Shortcut REST v3 client.
- `src/story-tree.ts` turns the filter into Shortcut search queries
  and the results into a parent story → sub-task tree.
- `src/worktree-links.ts` links Orca worktrees to stories by branch name.
- `src/protocol.ts` types every panel ↔ worker request.

## Stories

The panel lists stories by workflow state and owner,
with each sub-task under its parent story,
even when the parent itself does not match the filter.
The filter defaults to the `Default states` and `Default owner` settings
(`Ready` and `me`);
changing it in the panel is remembered.

## Worktrees

A worktree belongs to the story its git branch names:
`ada/sc-1841/slug`, as Shortcut's branch helper makes it,
belongs to `sc-1841`.
The plugin reads branches live from Orca,
so worktrees made by hand count too,
and nothing is stored that could go stale.

- Sub-tasks with a worktree are marked in the Stories tab,
  with the agent status Orca reports,
  and the focused worktree's sub-task is selected.
- The Worktrees tab lists every worktree whose branch names a story,
  whatever the filter.
- The status bar names the focused worktree's story and its state.
- Flagged: a sub-task in progress without a worktree,
  more than one worktree for a story,
  a worktree on a story instead of a sub-task,
  and a worktree whose story is done or archived.

## Token

The API token is checked against Shortcut before it is saved,
and is stored in the plugin's encrypted secrets (the OS key store).
On a machine without an OS key store, the plugin refuses to save it.

The plugin runs as a `trusted-worker`:
the worker is a Node.js process with your user account's access,
which it needs to reach the Shortcut API.

## Develop

Needs Orca 1.4.248 or later.

```sh
orca plugin validate .
orca plugin test .        # src/*.test.ts(x), in Node with orca/testing
orca plugin check .       # renders the panel in each src/panel.check.ts scenario
orca plugin types .       # writes the typings to .orca/types (git-ignored)
npx tsc -p .              # type check
orca plugin dev watch .   # loads this folder into Orca and streams its logs; Ctrl-C unloads it
```

There is no build step: Orca transpiles the TypeScript when it loads.

## License

MIT. See [LICENSE](LICENSE).
