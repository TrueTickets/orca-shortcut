# Shortcut for Orca

An [Orca](https://github.com/stablyai/orca) plugin that brings
[Shortcut](https://www.shortcut.com) stories and sub-tasks into Orca.

> Work in progress.
> Today it connects to Shortcut with an API token.
> Browsing stories and starting worktrees from sub-tasks are next.

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
- `src/protocol.ts` types every panel ↔ worker request.

The API token is checked against Shortcut before it is saved,
and is stored in the plugin's encrypted secrets (the OS key store).
On a machine without an OS key store, the plugin refuses to save it.

The plugin runs as a `trusted-worker`:
the worker is a Node.js process with your user account's access,
which it needs to reach the Shortcut API.

## Develop

Needs Orca 1.4.246 or later.

```sh
orca plugin validate .
orca plugin test .        # src/*.test.ts(x), in Node with orca/testing
orca plugin check .       # renders the panel in each src/panel.check.ts scenario
orca plugin types .       # writes the typings to .orca/types (git-ignored)
npx tsc -p .              # type check
orca plugin dev watch .   # loads this folder into Orca and streams its logs; Ctrl-C unloads it
```

There is no build step: Orca transpiles the TypeScript when it loads.
