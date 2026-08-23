/**
 * Domain model for the particle workspace UI.
 *
 * This mirrors the shapes the worker will eventually serve. The UI is a pure
 * function of this data — swapping the mock module for a live feed should not
 * require touching components.
 */

export type ActorId = string;

export interface Human {
  kind: 'human';
  id: ActorId;
  name: string;
  /** Mention handle, e.g. "ada". */
  handle: string;
  /** Avatar tint, 0–360. */
  hue: number;
  avatarUrl?: string;
  online?: boolean;
}

export interface Agent {
  kind: 'agent';
  id: ActorId;
  name: string;
  /** planner | implementer | reviewer | any future role */
  role: string;
  avatarUrl?: string;
}

/** Integrations that post on their own behalf, e.g. the GitHub bridge. */
export interface AppActor {
  kind: 'app';
  id: ActorId;
  name: string;
  avatarUrl?: string;
}

export type Actor = Human | Agent | AppActor;

/**
 * Project lifecycle, mirroring the protocol (docs/SPEC.md §8): the
 * executing ⇄ review/changes loop runs until the reviewer approves and the
 * project converges. `changes` is the review verdict surfaced as a state.
 */
export type ProjectStatus =
  'open' | 'planning' | 'executing' | 'review' | 'changes' | 'converged' | 'abandoned';

export type TaskState = 'queued' | 'running' | 'done' | 'blocked';

export interface Task {
  id: string;
  title: string;
  state: TaskState;
  assignee?: ActorId;
}

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
}

/**
 * A unit of agent work. Lives as a thread in a channel and as a reserved,
 * append-only ref in the host repo.
 */
export interface Project {
  id: string;
  title: string;
  /** The reserved git ref the project's work accumulates on. */
  ref: string;
  channelId: string;
  status: ProjectStatus;
  startedBy: ActorId;
  /** Set when the project was kicked off from a GitHub issue. */
  issue?: number;
  /** Which pass of the implement → review loop we are on. */
  round: number;
  tasks: Task[];
  diff: DiffStat;
  watchers: ActorId[];
}

export type TurnKind = 'plan' | 'commit' | 'action' | 'review' | 'comment' | 'status';

/** One entry in a project's transcript. */
export interface Turn {
  id: string;
  projectId: string;
  actorId: ActorId;
  kind: TurnKind;
  time: string;
  title: string;
  body?: string;
  /** Short metadata line, e.g. "9f3ce21 · +38 −12" on commits. */
  meta?: string;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: ActorId;
  time: string;
  text: string;
  /** When set, the message is a project prompt and renders the project card. */
  projectId?: string;
  /** Repo-event flavor — drives the icon in channel streams. */
  kind?: 'issue' | 'pr' | 'merge' | 'comment';
}

export interface Channel {
  id: string;
  name: string;
  topic: string;
  unread?: number;
}

/** A scripted event used by the mock live feed. */
export interface SimEvent {
  /** ms after load */
  delay: number;
  turn: Turn;
  project?: Partial<Project> & { id: string };
  task?: { projectId: string; taskId: string; state: TaskState };
}
