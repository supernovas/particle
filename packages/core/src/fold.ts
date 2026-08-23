import { compareEvents } from './clock.ts';
import type {
  ActorId,
  ArtifactLinked,
  MessagePosted,
  ParticleEvent,
  PlanProposed,
  ProjectCreated,
  ProjectStatusChanged,
  ProjectSource,
  ReviewPosted,
  ReviewRequested,
  TaskClaimed,
  TaskCreated,
  TaskUpdated,
} from './types.ts';

export interface MessageState {
  id: string;
  actor: ActorId;
  body: string;
  at: string;
  via?: string;
}

export interface TaskState {
  id: string;
  title: string;
  spec: string;
  deps: string[];
  status: 'open' | 'claimed' | 'in_progress' | 'blocked' | 'done';
  assignee?: ActorId;
}

export interface ProjectState {
  id: string;
  title: string;
  status: ProjectStatusChanged['status'];
  source?: ProjectSource;
  /** Latest proposal in canonical event order. */
  plan?: PlanProposed;
  messages: MessageState[];
  tasks: Record<string, TaskState>;
  /** Latest review request in canonical event order. */
  reviewRequested?: ReviewRequested;
  lastReview?: { verdict: ReviewPosted['verdict']; by: ActorId; at: string };
  artifacts: ArtifactLinked[];
  /** Highest lamport clock folded in. */
  clock: number;
  /** Ids of all folded events, for dedupe and causal parents. */
  seen: Set<string>;
}

export function emptyState(projectId: string): ProjectState {
  return {
    id: projectId,
    title: '',
    status: 'open',
    messages: [],
    tasks: {},
    artifacts: [],
    clock: 0,
    seen: new Set(),
  };
}

/**
 * Deterministically fold a set of events into project state. Events are sorted
 * into the canonical total order first, and duplicate ids are ignored, so any
 * replica that has the same *set* of events computes the same state — this is
 * the property that lets actors append concurrently without coordination.
 */
export function fold(projectId: string, events: Iterable<ParticleEvent>): ProjectState {
  const sorted = [...events].sort(compareEvents);
  const state = emptyState(projectId);
  for (const event of sorted) apply(state, event);
  return state;
}

/** Fold an event set into one deterministic state per project id. */
export function foldMany(events: Iterable<ParticleEvent>): Map<string, ProjectState> {
  const grouped = new Map<string, ParticleEvent[]>();
  for (const event of events) {
    const projectEvents = grouped.get(event.project);
    if (projectEvents) projectEvents.push(event);
    else grouped.set(event.project, [event]);
  }

  const states = new Map<string, ProjectState>();
  for (const projectId of [...grouped.keys()].sort()) {
    states.set(projectId, fold(projectId, grouped.get(projectId)!));
  }
  return states;
}

function apply(state: ProjectState, event: ParticleEvent): void {
  if (event.project !== state.id || state.seen.has(event.id)) return;
  state.seen.add(event.id);
  if (event.clock.lamport > state.clock) state.clock = event.clock.lamport;

  switch (event.type) {
    case 'project.created': {
      const data = event.data as ProjectCreated;
      state.title = data.title;
      state.source = data.source;
      break;
    }
    case 'message.posted': {
      const data = event.data as MessagePosted;
      state.messages.push({
        id: event.id,
        actor: event.actor,
        body: data.body,
        at: event.clock.wall,
        ...(data.via === undefined ? {} : { via: data.via }),
      });
      break;
    }
    case 'plan.proposed': {
      const data = event.data as PlanProposed;
      state.plan = { summary: data.summary, taskIds: [...data.taskIds] };
      break;
    }
    case 'task.created': {
      const data = event.data as TaskCreated;
      if (!state.tasks[data.taskId]) {
        state.tasks[data.taskId] = {
          id: data.taskId,
          title: data.title,
          spec: data.spec,
          deps: data.deps,
          status: 'open',
        };
      }
      break;
    }
    case 'task.claimed': {
      const data = event.data as TaskClaimed;
      const task = state.tasks[data.taskId];
      // First claim in canonical order wins; later claims on a held task are no-ops.
      if (task && task.status === 'open') {
        task.status = 'claimed';
        task.assignee = event.actor;
      }
      break;
    }
    case 'task.updated': {
      const data = event.data as TaskUpdated;
      const task = state.tasks[data.taskId];
      if (task && event.actor === task.assignee) task.status = data.status;
      break;
    }
    case 'review.posted': {
      const data = event.data as ReviewPosted;
      state.lastReview = { verdict: data.verdict, by: event.actor, at: event.clock.wall };
      break;
    }
    case 'review.requested': {
      const data = event.data as ReviewRequested;
      state.reviewRequested = { taskIds: [...data.taskIds] };
      break;
    }
    case 'artifact.linked': {
      state.artifacts.push(event.data as ArtifactLinked);
      break;
    }
    case 'project.status': {
      state.status = (event.data as ProjectStatusChanged).status;
      break;
    }
    default:
      break;
  }
}

/**
 * A project has reached its fixed point when every task is done and the most
 * recent review approves.
 */
export function isConverged(state: ProjectState): boolean {
  const tasks = Object.values(state.tasks);
  if (tasks.length === 0) return false;
  if (!tasks.every((t) => t.status === 'done')) return false;
  return state.lastReview?.verdict === 'approve';
}

/** JSON-compatible ProjectState used as the materialized state.json shape. */
export interface ProjectStateJson extends Omit<ProjectState, 'seen'> {
  seen: string[];
}

/** Descriptive alias for consumers that prefer an explicit serializability name. */
export type SerializableProjectState = ProjectStateJson;

export function stateToJson(state: ProjectState): ProjectStateJson {
  return {
    id: state.id,
    title: state.title,
    status: state.status,
    ...(state.source === undefined ? {} : { source: state.source }),
    ...(state.plan === undefined
      ? {}
      : { plan: { summary: state.plan.summary, taskIds: [...state.plan.taskIds] } }),
    messages: state.messages.map((message) => ({ ...message })),
    tasks: Object.fromEntries(
      Object.entries(state.tasks).map(([id, task]) => [id, { ...task, deps: [...task.deps] }]),
    ),
    ...(state.reviewRequested === undefined
      ? {}
      : { reviewRequested: { taskIds: [...state.reviewRequested.taskIds] } }),
    ...(state.lastReview === undefined ? {} : { lastReview: { ...state.lastReview } }),
    artifacts: state.artifacts.map((artifact) => ({ ...artifact })),
    clock: state.clock,
    seen: [...state.seen].sort(),
  };
}
