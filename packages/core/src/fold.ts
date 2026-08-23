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
  /** Canonical fold position of the most recent task update. */
  updatedOrder?: number;
}

export interface AgentRunState {
  actor: ActorId;
  role: 'planner' | 'implementer' | 'reviewer';
  taskId?: string;
  /** The role emitted at least one result event after its start marker. */
  completed: boolean;
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
  lastReview?: { verdict: ReviewPosted['verdict']; by: ActorId; at: string; order: number };
  artifacts: ArtifactLinked[];
  /** Durable scheduler evidence, derived from agent-authored events in the log. */
  agentRuns: AgentRunState[];
  /** Highest lamport clock folded in. */
  clock: number;
  /** Ids of all folded events, for dedupe and causal parents. */
  seen: Set<string>;
  /** Last event in canonical order, used as the causal parent for worker events. */
  lastEventId?: string;
}

export function emptyState(projectId: string): ProjectState {
  return {
    id: projectId,
    title: '',
    status: 'open',
    messages: [],
    // Task ids come from events, so do not let inherited names such as
    // `constructor` or the `__proto__` setter masquerade as stored tasks.
    tasks: Object.create(null) as Record<string, TaskState>,
    artifacts: [],
    agentRuns: [],
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
  for (const event of sorted) apply(state, event, state.seen.size);
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

function apply(state: ProjectState, event: ParticleEvent, order: number): void {
  if (event.project !== state.id || state.seen.has(event.id)) return;
  state.seen.add(event.id);
  state.lastEventId = event.id;
  if (event.clock.lamport > state.clock) state.clock = event.clock.lamport;

  recordAgentRun(state, event);

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
      if (!Object.hasOwn(state.tasks, data.taskId)) {
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
      if (task && event.actor === task.assignee) {
        task.status = data.status;
        task.updatedOrder = order;
      }
      break;
    }
    case 'review.posted': {
      const data = event.data as ReviewPosted;
      state.lastReview = {
        verdict: data.verdict,
        by: event.actor,
        at: event.clock.wall,
        order,
      };
      if (data.verdict === 'request_changes') {
        const requested = new Set(
          data.comments.flatMap((comment) => (comment.taskId ? [comment.taskId] : [])),
        );
        const tasks = Object.values(state.tasks);
        const reopen = requested.size > 0 ? tasks.filter((task) => requested.has(task.id)) : tasks;
        for (const task of reopen) {
          if (task.status === 'done') {
            task.status = 'open';
            task.updatedOrder = order;
          }
        }
      }
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

function recordAgentRun(state: ProjectState, event: ParticleEvent): void {
  const match = /^agent:(planner|implementer|reviewer)\/(.+)$/.exec(event.actor);
  if (!match) return;
  const role = match[1] as AgentRunState['role'];
  const taskId =
    role === 'implementer' &&
    (event.type === 'task.claimed' || event.type === 'task.updated') &&
    typeof (event.data as { taskId?: unknown }).taskId === 'string'
      ? ((event.data as { taskId: string }).taskId ?? undefined)
      : undefined;
  const existing = state.agentRuns.find((run) => run.actor === event.actor);
  const completed =
    (role === 'planner' &&
      (event.type === 'plan.proposed' ||
        event.type === 'task.created' ||
        event.type === 'message.posted')) ||
    (role === 'implementer' && event.type === 'task.updated') ||
    (role === 'reviewer' && (event.type === 'review.posted' || event.type === 'message.posted'));
  if (existing) {
    if (taskId && !existing.taskId) existing.taskId = taskId;
    if (completed) existing.completed = true;
    return;
  }
  state.agentRuns.push({ actor: event.actor, role, completed, ...(taskId ? { taskId } : {}) });
}

/**
 * A project has reached its fixed point when every task is done and the most
 * recent review approves.
 */
export function isConverged(state: ProjectState): boolean {
  const tasks = Object.values(state.tasks);
  if (tasks.length === 0) return false;
  if (!tasks.every((t) => t.status === 'done')) return false;
  if (state.lastReview?.verdict !== 'approve') return false;
  const lastDone = Math.max(...tasks.map((task) => task.updatedOrder ?? -1));
  return state.lastReview.order > lastDone;
}

/** SPEC-visible task shape; scheduler-only ordering evidence stays runtime-only. */
export type TaskStateJson = Omit<TaskState, 'updatedOrder'>;

/** JSON-compatible SPEC state used as the materialized state.json shape. */
export interface ProjectStateJson {
  id: string;
  title: string;
  status: ProjectStatusChanged['status'];
  source?: ProjectSource;
  plan?: PlanProposed;
  messages: MessageState[];
  tasks: Record<string, TaskStateJson>;
  reviewRequested?: ReviewRequested;
  lastReview?: { verdict: ReviewPosted['verdict']; by: ActorId; at: string };
  artifacts: ArtifactLinked[];
  clock: number;
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
      Object.entries(state.tasks).map(([id, task]) => {
        const { updatedOrder: _updatedOrder, ...visible } = task;
        return [id, { ...visible, deps: [...visible.deps] }];
      }),
    ),
    ...(state.reviewRequested === undefined
      ? {}
      : { reviewRequested: { taskIds: [...state.reviewRequested.taskIds] } }),
    ...(state.lastReview === undefined
      ? {}
      : {
          lastReview: {
            verdict: state.lastReview.verdict,
            by: state.lastReview.by,
            at: state.lastReview.at,
          },
        }),
    artifacts: state.artifacts.map((artifact) => ({ ...artifact })),
    clock: state.clock,
    seen: [...state.seen].sort(),
  };
}
