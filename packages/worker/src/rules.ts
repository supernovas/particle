import { isConverged, type ProjectState } from '@particle/core';

export type AgentRole = 'planner' | 'implementer' | 'reviewer';

export interface AgentRunRequest {
  role: AgentRole;
  project: string;
  taskId?: string;
}

export interface SchedulerRule {
  name: string;
  /** A rule is safe to evaluate after every fold; log evidence provides its edge trigger. */
  when(state: ProjectState): boolean;
  run(state: ProjectState): AgentRunRequest[];
}

function runnableTasks(state: ProjectState) {
  return Object.values(state.tasks).filter(
    (task) =>
      task.status === 'open' &&
      task.deps.every((dependency) => state.tasks[dependency]?.status === 'done'),
  );
}

export const defaultRules: SchedulerRule[] = [
  {
    name: 'plan',
    when: (state) =>
      state.messages.length > 0 &&
      Object.keys(state.tasks).length === 0 &&
      !state.agentRuns.some((run) => run.role === 'planner'),
    run: (state) => [{ role: 'planner', project: state.id }],
  },
  {
    name: 'implement',
    when: (state) => runnableTasks(state).length > 0,
    run: (state) =>
      runnableTasks(state).map((task) => ({
        role: 'implementer',
        project: state.id,
        taskId: task.id,
      })),
  },
  {
    name: 'review',
    when: (state) => {
      const tasks = Object.values(state.tasks);
      if (tasks.length === 0 || !tasks.every((task) => task.status === 'done')) return false;
      const lastDone = Math.max(...tasks.map((task) => task.updatedOrder ?? -1));
      return state.lastReview === undefined || state.lastReview.order < lastDone;
    },
    run: (state) => [{ role: 'reviewer', project: state.id }],
  },
  {
    name: 'reopen',
    when: (state) => state.lastReview?.verdict === 'request_changes',
    // The fold reopens the commented tasks, so the implement rule emits the work.
    run: () => [],
  },
  {
    name: 'converge',
    when: isConverged,
    // Convergence is a worker event, emitted directly by Scheduler.tick.
    run: () => [],
  },
];
