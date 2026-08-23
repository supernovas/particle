/** A human via a chat surface (`github:drx`) or an agent run (`agent:planner/run_01J...`). */
export type ActorId = `github:${string}` | `agent:${string}`;

export interface Clock {
  /** Lamport clock: max(observed) + 1 at append time. Primary ordering key. */
  lamport: number;
  /** Wall time in ISO 8601 UTC. Informational only — never used for ordering. */
  wall: string;
}

export type EventType =
  | 'project.created'
  | 'message.posted'
  | 'plan.proposed'
  | 'task.created'
  | 'task.claimed'
  | 'task.updated'
  | 'review.requested'
  | 'review.posted'
  | 'artifact.linked'
  | 'project.status';

/**
 * The envelope every particle event shares. Events are immutable; project state
 * is a deterministic fold over the *set* of events (see fold.ts), which is what
 * makes concurrent appends from different actors commute.
 */
export interface ParticleEvent<T = unknown> {
  v: 0;
  /** "evt_" + ULID. Unique per event; also the tiebreaker of last resort in ordering. */
  id: string;
  type: EventType;
  /** "prj_" + ULID of the project this event belongs to. */
  project: string;
  actor: ActorId;
  clock: Clock;
  /** Ids of events this one causally depends on (usually the appender's view of the tips). */
  parents: string[];
  data: T;
}

export type ProjectSource =
  | { kind: 'github-issue'; repo: string; number: number }
  | { kind: 'chat'; channel: string; thread?: string };

export interface ProjectCreated {
  title: string;
  source: ProjectSource;
}

export interface MessagePosted {
  body: string;
  /** Event id of the message being replied to, if any. */
  replyTo?: string;
  /** External locator when mirrored from a channel (e.g. an issue-comment URL). */
  via?: string;
}

export interface PlanProposed {
  summary: string;
  taskIds: string[];
}

export interface TaskCreated {
  taskId: string;
  title: string;
  spec: string;
  /** Task ids that must be done before this one can start. */
  deps: string[];
}

export interface TaskClaimed {
  taskId: string;
}

export interface TaskUpdated {
  taskId: string;
  status: 'in_progress' | 'blocked' | 'done';
  note?: string;
}

export interface ReviewRequested {
  taskIds: string[];
}

export interface ReviewComment {
  taskId?: string;
  body: string;
}

export interface ReviewPosted {
  verdict: 'approve' | 'request_changes';
  comments: ReviewComment[];
}

export interface ArtifactLinked {
  kind: 'pr' | 'commit' | 'ref';
  locator: string;
}

export interface ProjectStatusChanged {
  status: 'open' | 'planning' | 'executing' | 'review' | 'converged' | 'abandoned';
}
