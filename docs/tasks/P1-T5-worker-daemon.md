# P1.T5 — Worker daemon: scheduler & turn loop

**Depends on:** interfaces of T2 (on main), T3 (`RefStore`), T4 (`ChannelAdapter`), T6
(`AgentRunner`). Start against the Phase-0 stand-ins (journal, in-process no-op runner) and
swap the real implementations as they merge. **Parallel with:** all, given the stubs.

## Context

Phase-0 `main.ts` polls, journals, folds, prints. The daemon this task builds is Particle's
engine: it watches project state and _decides which agent runs next_, driving every project
toward its fixed point (SPEC §8).

## Goal

An event-driven scheduler with declarative rules, replacing the ad-hoc loop in `main.ts`.

## Deliverables

```ts
// packages/worker/src/scheduler.ts
export interface SchedulerRule {
  name: string;
  /** Fires when this predicate goes false→true for a project. */
  when(state: ProjectState): boolean;
  /** Emit the agent run(s) to start. */
  run(state: ProjectState): AgentRunRequest[];
}
export interface AgentRunRequest {
  role: 'planner' | 'implementer' | 'reviewer';
  project: string;
  taskId?: string;
}
export class Scheduler {
  constructor(rules: SchedulerRule[], runner: AgentRunner, limits: Budgets);
  /** Idempotent: called after every fold; starts only runs not already in flight/logged. */
  tick(state: ProjectState): Promise<void>;
}
```

v0 rule set (`rules.ts`):

| Rule      | `when`                                                  | `run`                                         |
| --------- | ------------------------------------------------------- | --------------------------------------------- |
| plan      | has messages, no tasks, no planner run yet              | planner                                       |
| implement | task `open`, deps `done`, unassigned                    | implementer(task)                             |
| review    | all tasks `done`, no approving review after last `done` | reviewer                                      |
| reopen    | latest review `request_changes`                         | (fold reopens tasks; rule re-fires implement) |
| converge  | `isConverged(state)`                                    | emit `project.status: converged`, stop        |

Budgets (`Budgets`): max planner runs (1), max implementer runs per task (3), max review
cycles (3); exceeding a budget emits `message.posted` asking for human help and pauses the
project.

**Idempotence is the hard requirement:** the scheduler derives "already ran" from the event
log itself (`agent:` actor events / `task.claimed` / `review.posted`), never from memory, so
a worker crash/restart never double-spawns an agent.

## Step-by-step

1. Read SPEC §8 and `fold.ts`; add to core if a derived accessor is missing (coordinate on
   the tracking issue — tiny PRs).
2. Build `Scheduler.tick` as: compute wanted runs from rules → subtract runs evidenced in the
   log or in flight → start the remainder via `AgentRunner`, recording a `task.claimed` (or
   role-run marker event) _before_ starting the process.
3. Restructure `main.ts`: poll channels → append events → fold → `tick` each touched
   project → repeat. Keep `--once`.
4. Simulation tests with a fake runner that scripts agent behavior (e.g. planner emits two
   tasks; implementers complete; reviewer rejects once then approves) — assert the project
   converges within budget and that replaying the same log causes zero new runs.

## Acceptance criteria

- The scripted simulation reaches `converged` with exactly: 1 planner, 2 implementer,
  2 reviewer runs (reject → fix → approve), across arbitrary worker restarts mid-flow.
- Budget exhaustion pauses the project and posts a human-help message, never loops.
- `npm run typecheck && npm test` green (all offline).

## Out of scope

Real agent CLI execution (T6), multi-worker leasing (Phase 3 — single worker owns a
workspace in Phase 1), webhooks.
