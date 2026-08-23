import {
  isConverged,
  newId,
  type ActorId,
  type MessagePosted,
  type ParticleEvent,
  type ProjectState,
  type ProjectStatusChanged,
  type ReviewRequested,
  type TaskClaimed,
} from '@particle/core';
import type { AgentRole, AgentRunRequest, SchedulerRule } from './rules.ts';

export type { AgentRunRequest, SchedulerRule } from './rules.ts';

export interface AgentRunContext {
  role: AgentRole;
  project: string;
  taskId?: string;
  state: ProjectState;
  workdir: string;
  promptPath: string;
  /** Optional correlation supplied by the scheduler stand-in; T6 may ignore it. */
  runId?: string;
}

export interface AgentRunResult {
  events: ParticleEvent[];
  exitCode: number;
  transcriptPath: string;
}

/** Structurally compatible with the P1.T6 AgentRunner interface. */
export interface AgentRunner {
  start(ctx: AgentRunContext): Promise<AgentRunResult>;
}

export interface Budgets {
  maxPlannerRuns: number;
  maxImplementerRunsPerTask: number;
  maxReviewCycles: number;
}

export const DEFAULT_BUDGETS: Readonly<Budgets> = {
  maxPlannerRuns: 1,
  maxImplementerRunsPerTask: 3,
  maxReviewCycles: 3,
};

export interface SchedulerOptions {
  /** Durable append hook. Production wires this to Journal now and RefStore after P1.T3. */
  append?: (events: ParticleEvent[]) => void | Promise<void>;
  workdir?: string;
  promptPath?: (request: AgentRunRequest) => string;
  now?: () => Date;
}

const WORKER_ACTOR: ActorId = `agent:worker/${newId('run')}`;

export class Scheduler {
  private readonly inFlight = new Set<string>();
  private readonly outbox: ParticleEvent[] = [];
  private readonly append: (events: ParticleEvent[]) => void | Promise<void>;
  private readonly workdir: string;
  private readonly promptPath: (request: AgentRunRequest) => string;
  private readonly now: () => Date;

  constructor(
    private readonly rules: SchedulerRule[],
    private readonly runner: AgentRunner,
    private readonly limits: Budgets,
    options: SchedulerOptions = {},
  ) {
    this.append =
      options.append ??
      ((events) => {
        this.outbox.push(...events);
      });
    this.workdir = options.workdir ?? process.cwd();
    this.promptPath = options.promptPath ?? (() => '');
    this.now = options.now ?? (() => new Date());
  }

  /** Events collected when no durable append hook was supplied (useful for small embedders). */
  drainEvents(): ParticleEvent[] {
    return this.outbox.splice(0);
  }

  /**
   * Re-evaluate declarative rules after a fold. Durable marker events are appended before
   * processes start, while the in-memory set closes the gap until the next fold completes.
   */
  async tick(state: ProjectState): Promise<void> {
    if (state.status === 'paused' || state.status === 'converged' || state.status === 'abandoned') {
      return;
    }
    if (isConverged(state)) {
      await this.appendEvents(state, [
        this.event<ProjectStatusChanged>(state, WORKER_ACTOR, 'project.status', {
          status: 'converged',
        }),
      ]);
      return;
    }

    const wanted = this.rules.flatMap((rule) => (rule.when(state) ? rule.run(state) : []));
    const runnable: AgentRunRequest[] = [];
    for (const request of dedupeRequests(wanted)) {
      const key = requestKey(request);
      if (this.inFlight.has(key) || this.hasOutstandingRun(state, request)) continue;
      const reason = this.budgetReason(state, request);
      if (reason) {
        await this.pauseForHuman(state, reason);
        return;
      }
      runnable.push(request);
    }

    // A completed planner that produced no tasks has exhausted the one-shot planning budget.
    if (
      runnable.length === 0 &&
      state.messages.length > 0 &&
      Object.keys(state.tasks).length === 0 &&
      state.agentRuns.filter((run) => run.role === 'planner' && run.completed).length >=
        this.limits.maxPlannerRuns
    ) {
      await this.pauseForHuman(state, 'planner budget exhausted before producing a task');
      return;
    }

    if (runnable.length === 0) {
      const reason = this.stalledReason(state);
      if (reason) {
        await this.pauseForHuman(state, reason);
        return;
      }
    }

    await Promise.all(runnable.map((request) => this.start(state, request)));
  }

  private stalledReason(state: ProjectState): string | undefined {
    const tasks = Object.values(state.tasks);
    if (
      state.lastReview?.verdict === 'request_changes' &&
      tasks.length > 0 &&
      tasks.every((task) => task.status === 'done')
    ) {
      return 'the latest rejecting review did not reopen a completed task';
    }

    const stranded = tasks.filter(
      (task) =>
        task.status === 'open' || task.status === 'blocked' || task.status === 'in_progress',
    );
    if (stranded.length > 0) {
      return `no task is runnable; check dependencies or blocked work (${stranded
        .map((task) => task.id)
        .sort()
        .join(', ')})`;
    }
    return undefined;
  }

  private async start(state: ProjectState, request: AgentRunRequest): Promise<void> {
    const key = requestKey(request);
    this.inFlight.add(key);
    const runId = newId('run');
    const actor = `agent:${request.role}/${runId}` as ActorId;
    try {
      const marker = this.runMarker(state, request, actor);
      await this.appendEvents(state, [marker]);
      const result = await this.runner.start({
        ...request,
        state,
        workdir: this.workdir,
        promptPath: this.promptPath(request),
        runId,
      });
      const normalized = this.normalizeResultEvents(state, marker, actor, result.events);
      if (normalized.length > 0) await this.appendEvents(state, normalized);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private runMarker(state: ProjectState, request: AgentRunRequest, actor: ActorId): ParticleEvent {
    if (request.role === 'implementer') {
      return this.event<TaskClaimed>(state, actor, 'task.claimed', { taskId: request.taskId! });
    }
    if (request.role === 'reviewer') {
      return this.event<ReviewRequested>(state, actor, 'review.requested', {
        taskIds: Object.keys(state.tasks).sort(),
      });
    }
    return this.event<ProjectStatusChanged>(state, actor, 'project.status', {
      status: 'planning',
    });
  }

  private normalizeResultEvents(
    state: ProjectState,
    marker: ParticleEvent,
    actor: ActorId,
    events: ParticleEvent[],
  ): ParticleEvent[] {
    let lamport = state.clock + 1;
    let parent: string | undefined = marker.id;
    return events.map((event) => {
      lamport += 1;
      const normalized: ParticleEvent = {
        ...event,
        project: state.id,
        actor,
        clock: { lamport, wall: this.now().toISOString() },
        parents: parent ? [parent] : [],
      };
      parent = normalized.id;
      return normalized;
    });
  }

  private hasOutstandingRun(state: ProjectState, request: AgentRunRequest): boolean {
    if (request.role === 'planner') {
      return state.agentRuns.some((run) => run.role === 'planner');
    }
    if (request.role === 'implementer') {
      // A claimed/in-progress task is durable evidence that this attempt already started.
      const task = state.tasks[request.taskId!];
      return task?.status === 'claimed' || task?.status === 'in_progress';
    }
    // review.requested is recorded before start; a run with no posted review remains claimed.
    return (
      state.agentRuns.some((run) => run.role === 'reviewer' && !run.completed) ||
      this.inFlight.has(requestKey(request))
    );
  }

  private budgetReason(state: ProjectState, request: AgentRunRequest): string | undefined {
    if (request.role === 'planner') {
      const count = state.agentRuns.filter((run) => run.role === 'planner').length;
      if (count >= this.limits.maxPlannerRuns) return `planner budget exhausted (${count})`;
    }
    if (request.role === 'implementer') {
      const count = state.agentRuns.filter(
        (run) => run.role === 'implementer' && run.taskId === request.taskId,
      ).length;
      if (count >= this.limits.maxImplementerRunsPerTask) {
        return `implementer budget exhausted for task ${request.taskId} (${count})`;
      }
    }
    if (request.role === 'reviewer') {
      const count = state.agentRuns.filter((run) => run.role === 'reviewer').length;
      if (count >= this.limits.maxReviewCycles) return `review budget exhausted (${count})`;
    }
    return undefined;
  }

  private async pauseForHuman(state: ProjectState, reason: string): Promise<void> {
    const message = this.event<MessagePosted>(state, WORKER_ACTOR, 'message.posted', {
      body: `Particle paused this project: ${reason}. Human help is required.`,
    });
    const paused = this.event<ProjectStatusChanged>(state, WORKER_ACTOR, 'project.status', {
      status: 'paused',
    });
    paused.parents = [message.id];
    paused.clock.lamport = message.clock.lamport + 1;
    await this.appendEvents(state, [message, paused]);
  }

  private event<T>(
    state: ProjectState,
    actor: ActorId,
    type: ParticleEvent<T>['type'],
    data: T,
  ): ParticleEvent<T> {
    return {
      v: 0,
      id: newId('evt'),
      type,
      project: state.id,
      actor,
      clock: { lamport: state.clock + 1, wall: this.now().toISOString() },
      parents: state.lastEventId ? [state.lastEventId] : [],
      data,
    };
  }

  private async appendEvents(_state: ProjectState, events: ParticleEvent[]): Promise<void> {
    await this.append(events);
  }
}

function requestKey(request: AgentRunRequest): string {
  return `${request.project}:${request.role}:${request.taskId ?? ''}`;
}

function dedupeRequests(requests: AgentRunRequest[]): AgentRunRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = requestKey(request);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
