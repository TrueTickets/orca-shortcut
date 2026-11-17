// Starting work on a sub-task, carried out: Orca's worktree, Git's branch, Shortcut's states and
// an agent. The decisions are in start-work.ts; this does them in order and reports each step.
// A step after the worktree exists never undoes it: its failure becomes a warning.
import type { OrcaWorkerApi } from 'orca/worker'
import { shortcutBranchName } from './branch-name'
import { GitError, moveToBranch, type GitRunner } from './git-branch'
import type { ProjectOption, StartResult, WorkOptions } from './protocol'
import { codedError, type ShortcutClient, type ShortcutStory } from './shortcut-api'
import { buildAgentPrompt, planShortcutUpdates, suggestProject } from './start-work'
import { indexWorktrees } from './worktree-links'

/** Agents offered for a new worktree, by Orca's agent id. */
export const AGENTS = ['claude', 'codex', 'gemini', 'opencode', 'copilot', 'cursor'] as const

/** Storage key for the project work was last started in. */
const LAST_PROJECT = 'lastProject'

export type WorkContext = {
  client: ShortcutClient
  mentionName: string
  git: GitRunner
}

async function setting(orca: OrcaWorkerApi, key: string, fallback: string): Promise<string> {
  const value = await orca.settings.get(key)
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

async function gitProjects(orca: OrcaWorkerApi): Promise<ProjectOption[]> {
  const { projects } = await orca.host.call('project.list')
  return projects
    .filter((project) => project.kind === 'git' && !project.hidden)
    .map((project) => ({ id: project.id, name: project.name, hostId: project.hostId }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function defaultAgent(orca: OrcaWorkerApi): Promise<string | null> {
  const agent = await setting(orca, 'defaultAgent', 'claude')
  return agent === 'none' ? null : agent
}

/** Refuses a story with no parent while the `requireSubtask` setting is on (the default). */
async function requireSubtask(orca: OrcaWorkerApi, story: ShortcutStory): Promise<void> {
  if (story.parentStoryId === null && (await orca.settings.get('requireSubtask')) !== false) {
    throw codedError(
      'invalid_params',
      `sc-${story.id} is a story: start work on one of its sub-tasks, or create one.`
    )
  }
}

export async function workOptions(
  orca: OrcaWorkerApi,
  ctx: WorkContext,
  storyId: number,
  signal?: AbortSignal
): Promise<WorkOptions> {
  const story = await ctx.client.getStory(storyId, signal)
  const [projects, { workspaces }, lastProject, agent] = await Promise.all([
    gitProjects(orca),
    orca.host.call('workspace.list'),
    orca.storage.get(LAST_PROJECT),
    defaultAgent(orca)
  ])
  // Projects the story's other sub-tasks are being worked on in.
  const siblings = new Set<number>()
  if (story.parentStoryId !== null) {
    const parent = await ctx.client.getStory(story.parentStoryId, signal).catch(() => null)
    parent?.subTaskIds.forEach((id) => siblings.add(id))
  }
  const index = indexWorktrees(workspaces)
  const siblingProjectIds = [...siblings]
    .flatMap((id) => index.get(id) ?? [])
    .map((ref) => ref.projectId)
    .filter((id): id is string => id !== null)
  return {
    projects,
    suggestedProjectId: suggestProject({
      projects,
      siblingProjectIds,
      lastProjectId: typeof lastProject === 'string' ? lastProject : null
    }),
    branch: shortcutBranchName(ctx.mentionName, story.id, story.name),
    agents: agent ? [agent, ...AGENTS.filter((id) => id !== agent)] : [...AGENTS],
    defaultAgent: agent
  }
}

export async function startWork(
  orca: OrcaWorkerApi,
  ctx: WorkContext,
  input: { storyId: number; projectId: string; agent: string | null }
): Promise<StartResult> {
  const subtask = await ctx.client.getStory(input.storyId)
  await requireSubtask(orca, subtask)
  const branch = shortcutBranchName(ctx.mentionName, subtask.id, subtask.name)

  // A sub-task with a worktree is opened, never given a second one.
  const before = indexWorktrees((await orca.host.call('workspace.list')).workspaces)
  const existing = before.get(subtask.id)?.[0]
  if (existing) {
    await orca.host.call('workspace.open', { workspaceId: existing.workspaceId })
    return {
      workspaceId: existing.workspaceId,
      branch: existing.branch,
      existing: true,
      done: [`Opened the worktree sc-${subtask.id} already has.`],
      warnings: []
    }
  }

  const projects = await gitProjects(orca)
  const project = projects.find((candidate) => candidate.id === input.projectId)
  if (!project) {
    throw codedError('invalid_params', 'Pick a Git project to make the worktree in.')
  }

  const done: string[] = []
  const warnings: string[] = []

  // 1. The worktree, named after the sub-task as Orca's sidebar shows it.
  const { workspaceId } = await orca.host.call('workspace.create', {
    projectId: project.id,
    ...(project.hostId ? { hostId: project.hostId } : {}),
    name: subtask.name.slice(0, 80),
    open: true
  })
  done.push(`Created a worktree in ${project.name}.`)
  await orca.storage.set(LAST_PROJECT, project.id)

  // 2. The Shortcut branch.
  const created = (await orca.host.call('workspace.list')).workspaces.find(
    (workspace) => workspace.id === workspaceId
  )
  if (!created) {
    warnings.push(`Orca does not list the new worktree yet, so its branch was left as Orca named it.`)
  } else if (created.hostId && created.hostId !== 'local') {
    warnings.push(
      `The worktree is on ${created.hostId}; rename its branch to ${branch} there (git branch -m ${branch}).`
    )
  } else {
    try {
      const outcome = await moveToBranch(ctx.git, created.path, branch)
      done.push(
        outcome.kind === 'reused'
          ? `Switched to the existing branch ${branch}.`
          : `Put the worktree on ${branch}.`
      )
    } catch (error) {
      warnings.push(error instanceof GitError ? error.message : `Branch: ${String(error)}`)
    }
  }

  // The parent story, for Shortcut and for the agent's prompt; work goes on without it.
  const parent =
    subtask.parentStoryId === null
      ? null
      : await ctx.client.getStory(subtask.parentStoryId).catch((error: unknown) => {
          warnings.push(`Could not read story sc-${subtask.parentStoryId}: ${String(error)}`)
          return null
        })

  // 3. Shortcut: the sub-task and its story move along; the person owns the sub-task.
  try {
    const [member, states] = await Promise.all([
      ctx.client.getCurrentMember(),
      ctx.client.listWorkflowStates()
    ])
    const { updates, notes } = planShortcutUpdates({
      subtask,
      parent,
      states,
      memberId: member.id,
      startStates: {
        subtask: await setting(orca, 'subtaskStartedState', 'In Development (Sub-tasks)'),
        story: await setting(orca, 'storyStartedState', 'In Progress (Stories)')
      }
    })
    for (const planned of updates) {
      try {
        await ctx.client.updateStory(planned.storyId, planned.update)
        done.push(`Shortcut ${planned.describe}.`)
      } catch (error) {
        warnings.push(`Could not update sc-${planned.storyId}: ${String(error)}`)
      }
    }
    warnings.push(...notes)
  } catch (error) {
    warnings.push(`Could not update Shortcut: ${String(error)}`)
  }

  // 4. The agent, once the branch and Shortcut are in place.
  if (input.agent) {
    try {
      await orca.host.call('agent.launch', {
        workspaceId,
        agent: input.agent,
        prompt: buildAgentPrompt(subtask, parent)
      })
      done.push(`Started ${input.agent} on it.`)
    } catch (error) {
      warnings.push(`Could not start ${input.agent}: ${String(error)}`)
    }
  }

  orca.panels.post('worktrees.changed', null)
  return { workspaceId, branch, existing: false, done, warnings }
}
