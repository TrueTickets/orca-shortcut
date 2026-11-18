# Shortcut for Orca

An [Orca](https://github.com/stablyai/orca) plugin that brings
[Shortcut](https://www.shortcut.com) stories and sub-tasks into Orca.

> Work in progress.
> Today it connects to Shortcut with an API token
> and lists your stories and sub-tasks
> with the worktree each one is checked out in,
> and starts work on a sub-task: worktree, branch, Shortcut states and an agent.

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
Each story's sub-tasks are indented under it,
and its chevron folds them away (remembered too);
a folded story says how many it hides, and whether you are working in one.

### Search

Typing in the search box narrows the list by title or id (`sc-123`, or just `123`);
a sub-task stays under its story, and a matching story keeps all its sub-tasks.
Press Enter to search all of Shortcut instead, whatever the state or owner
(archived stories are left out).
The query is Shortcut's own search syntax,
so quote a phrase (`"print the tables"`) to match it whole;
a bare id fetches that story.
Shortcut's results replace the list
until you clear the search, change it, or press **Back to my list**.
They ignore the filters unless you turn on **Use my filters** (remembered):
then only stories the list's owner and states allow are found,
the filters show above the results,
and changing them searches again.

### Ready count

The status bar counts the sub-tasks the default states and owner list,
such as **9 ready** for your sub-tasks in Ready
(stories and archived sub-tasks are not counted).
Its tooltip names the first five;
pressing it counts again and lists them all.
It refreshes after starting work, moving or creating a sub-task,
and when a worktree is created or removed, and every five minutes otherwise.
Orca does not let a plugin open its own panel, so pressing it cannot show the list.
Turn it off with the **Show ready count** setting.

## Worktrees

A worktree belongs to the story its git branch names:
`ada/sc-1841/slug`, as Shortcut's branch helper makes it,
belongs to `sc-1841`.
The plugin reads branches live from Orca,
so worktrees made by hand count too,
and nothing is stored that could go stale.

- Rows are laid out like Orca's left sidebar:
  each parent story is a header,
  its sub-tasks are two-line rows under it,
  and a pill coloured by workflow state follows each one
  (backlog grey, Ready blue, in progress amber, review and done green).
- Sub-tasks with a worktree are marked in the Stories tab,
  with the agent status Orca reports,
  and the focused worktree's sub-task is highlighted on a green tint,
  in the Worktrees tab too.
- The Worktrees tab lists every worktree whose branch names a story,
  whatever the filter.
- The status bar names the focused worktree's story and its state.
- Flagged: a sub-task in progress without a worktree,
  more than one worktree for a story,
  a worktree on a story instead of a sub-task,
  and a worktree whose story is archived.
- Noted, more quietly (a blue flag, not a warning):
  a worktree on work still in the backlog,
  and a worktree whose story is done, as a reminder to remove it
  from Orca's sidebar once you are finished with it.

## Starting work

Press a sub-task without a worktree to open its details under it.
They offer a project
(where the story's other sub-tasks have worktrees, else the last one used),
an agent, and the branch it will use. **Start work** then:

1. creates an Orca worktree named after the sub-task
   (the project's setup script runs as its settings say);
2. puts it on the branch Shortcut's branch helper names,
   `ada/sc-1841/lay-out-the-operation-cards`,
   or on that branch when earlier work left it;
3. moves the sub-task to **Started sub-task state**
   and its story to **Started story state** if the story has not started,
   never moving either back, and adds you as an owner;
4. with an agent, starts it in the worktree's own terminal once setup has run,
   as Orca's new-worktree dialog does,
   with the sub-task and its story as its prompt,
   their descriptions marked as data, not instructions.
   The prompt says the story describes the work
   and the sub-task may only track its pull request,
   and asks the agent to read the story in Shortcut,
   comments and tasks included, with its Shortcut tools if it has them.
   Up to 8,000 characters of the story's description are included
   (3,000 of the sub-task's); a cut one says where the rest is.

A sub-task that already has a worktree opens it instead.
Each step after the worktree exists reports a failure as a warning
rather than undoing the worktree.
Work starts only on sub-tasks unless **Work only on sub-tasks** is off.

## Creating sub-tasks

Work starts on sub-tasks, so a story's details offer to create one:
type a title and press **Create sub-task**.
It is created under the story,
in **New sub-task state** (Ready by default),
with you as its owner and the story's team and type,
then opens with Start work ready.
Sub-tasks of sub-tasks are refused.

## Moving state

A story's or sub-task's details offer the states it can move to:
the later states of its workflow,
leaving out those named for the other kind
(a sub-task is never offered a "(Stories)" state, nor a story a "(Sub-tasks)" one).
Pick one and press **Move**;
a done state asks first, since the story then leaves lists of work in progress.
The plugin only moves things forward.
To move one back, use **Open in Shortcut**.

## Token

The API token is checked against Shortcut before it is saved,
and is stored in the plugin's encrypted secrets (the OS key store).
On a machine without an OS key store, the plugin refuses to save it.

The plugin runs as a `trusted-worker`:
the worker is a Node.js process with your user account's access,
which it needs to reach the Shortcut API.

## Develop

Needs Orca 1.4.259 or later.

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
