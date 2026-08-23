/**
 * Domain model for the particle workspace UI.
 *
 * This mirrors the shapes the worker will eventually serve. The UI is a pure
 * function of this data — swapping the mock module for a live feed should not
 * require touching components.
 */

export type ActorId = string

export interface Human {
  kind: 'human'
  id: ActorId
  name: string
  /** Mention handle, e.g. "ada". */
  handle: string
  /** Avatar tint, 0–360. */
  hue: number
  online?: boolean
}

export type AgentRole = 'planner' | 'implementer' | 'reviewer'

export interface Agent {
  kind: 'agent'
  id: ActorId
  name: string
  role: AgentRole
}

/** Integrations that post on their own behalf, e.g. the GitHub bridge. */
export interface AppActor {
  kind: 'app'
  id: ActorId
  name: string
}

export type Actor = Human | Agent | AppActor

/**
 * Project lifecycle. `implementing` ⇄ `reviewing`/`changes` loop until the
 * reviewer approves (fixed point) and the work merges.
 */
export type ProjectStatus =
  | 'planning'
  | 'implementing'
  | 'reviewing'
  | 'changes'
  | 'merged'
  | 'failed'

export type TaskState = 'queued' | 'running' | 'done' | 'blocked'

export interface Task {
  id: string
  title: string
  state: TaskState
  assignee?: ActorId
}

export interface DiffStat {
  files: number
  additions: number
  deletions: number
}

/**
 * A unit of agent work. Lives as a thread in a channel and as a reserved,
 * append-only ref in the host repo.
 */
export interface Project {
  id: string
  title: string
  /** The reserved git ref the project's work accumulates on. */
  ref: string
  channelId: string
  status: ProjectStatus
  startedBy: ActorId
  /** Set when the project was kicked off from a GitHub issue. */
  issue?: number
  /** Which pass of the implement → review loop we are on. */
  round: number
  tasks: Task[]
  diff: DiffStat
  watchers: ActorId[]
}

export type TurnKind = 'plan' | 'commit' | 'action' | 'review' | 'comment' | 'status'

/** One entry in a project's transcript. */
export interface Turn {
  id: string
  projectId: string
  actorId: ActorId
  kind: TurnKind
  time: string
  title: string
  body?: string
  /** Short metadata line, e.g. "9f3ce21 · +38 −12" on commits. */
  meta?: string
}

export interface Message {
  id: string
  channelId: string
  authorId: ActorId
  time: string
  text: string
  /** When set, the message is a project prompt and renders the project card. */
  projectId?: string
}

export interface Channel {
  id: string
  name: string
  topic: string
  unread?: number
}

/** A scripted event used by the mock live feed. */
export interface SimEvent {
  /** ms after load */
  delay: number
  turn: Turn
  project?: Partial<Project> & { id: string }
  task?: { projectId: string; taskId: string; state: TaskState }
}
