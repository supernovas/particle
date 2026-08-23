import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  fold,
  newId,
  parseEvent,
  stateToJson,
  type ActorId,
  type EventType,
  type ParticleEvent,
  type ProjectState,
} from '@particle/core';
import { defaultRules } from '../src/rules.ts';
import {
  Scheduler,
  type AgentRunContext,
  type AgentRunner,
  type Budgets,
} from '../src/scheduler.ts';

const PROJECT = newId('prj');
const BUDGETS: Budgets = {
  maxPlannerRuns: 1,
  maxImplementerRunsPerTask: 3,
  maxReviewCycles: 3,
};

function event<T>(type: EventType, actor: ActorId, lamport: number, data: T): ParticleEvent<T> {
  return {
    v: 0,
    id: newId('evt'),
    type,
    project: PROJECT,
    actor,
    clock: { lamport, wall: new Date(lamport * 1000).toISOString() },
    parents: [],
    data,
  };
}

function foundingEvents(): ParticleEvent[] {
  return [
    event('project.created', 'github:alice', 1, {
      title: 'Build the harness',
      source: { kind: 'github-issue', repo: 'acme/particle', number: 7 },
    }),
    event('message.posted', 'github:alice', 2, { body: 'Please implement it.' }),
  ];
}

class ScriptedRunner implements AgentRunner {
  readonly calls: AgentRunContext[] = [];
  private reviews = 0;

  async start(ctx: AgentRunContext) {
    this.calls.push(ctx);
    let events: ParticleEvent[];
    if (ctx.role === 'planner') {
      events = [
        event('task.created', 'agent:planner/untrusted', 1, {
          taskId: 'task-1',
          title: 'Implement the daemon',
          spec: 'Reach the fixed point',
          deps: [],
        }),
      ];
    } else if (ctx.role === 'implementer') {
      events = [
        event('task.updated', 'agent:implementer/untrusted', 1, {
          taskId: ctx.taskId!,
          status: 'done',
        }),
      ];
    } else {
      this.reviews += 1;
      events = [
        event('review.posted', 'agent:reviewer/untrusted', 1, {
          verdict: this.reviews === 1 ? 'request_changes' : 'approve',
          comments: this.reviews === 1 ? [{ taskId: 'task-1', body: 'Please revise.' }] : [],
        }),
      ];
    }
    return { events, exitCode: 0, transcriptPath: `/tmp/${ctx.runId}.log` };
  }
}

async function driveWithRestarts(
  events: ParticleEvent[],
  runner: AgentRunner,
  budgets = BUDGETS,
): Promise<ProjectState> {
  for (let turn = 0; turn < 12; turn++) {
    const state = fold(PROJECT, events);
    // A fresh Scheduler each turn proves decisions come from the log, not process memory.
    const scheduler = new Scheduler(defaultRules, runner, budgets, {
      append: (fresh) => {
        events.push(...fresh);
      },
      now: () => new Date(10_000 + turn * 1000),
    });
    await scheduler.tick(state);
    const next = fold(PROJECT, events);
    if (next.status === 'paused' || next.status === 'converged') return next;
  }
  throw new Error('simulation did not reach a terminal state');
}

describe('Scheduler', () => {
  it('converges across arbitrary restarts without duplicate runs', async () => {
    const events = foundingEvents();
    const runner = new ScriptedRunner();
    const state = await driveWithRestarts(events, runner);

    expect(state.status).toBe('converged');
    expect(runner.calls.map((call) => call.role)).toEqual([
      'planner',
      'implementer',
      'reviewer',
      'implementer',
      'reviewer',
    ]);
    expect(runner.calls.filter((call) => call.role === 'planner')).toHaveLength(1);
    expect(runner.calls.filter((call) => call.role === 'implementer')).toHaveLength(2);
    expect(runner.calls.filter((call) => call.role === 'reviewer')).toHaveLength(2);
    for (const emitted of events.slice(2)) expect(() => parseEvent(emitted)).not.toThrow();

    const json = stateToJson(state);
    expect(state.agentRuns).toHaveLength(5);
    expect(state.lastEventId).toMatch(/^evt_/);
    expect(state.lastReview?.order).toBeTypeOf('number');
    expect(state.tasks['task-1']?.updatedOrder).toBeTypeOf('number');
    expect(Object.hasOwn(json, 'agentRuns')).toBe(false);
    expect(Object.hasOwn(json, 'lastEventId')).toBe(false);
    expect(Object.hasOwn(json.lastReview!, 'order')).toBe(false);
    expect(Object.hasOwn(json.tasks['task-1']!, 'updatedOrder')).toBe(false);
    expect(() => canonicalJson(json)).not.toThrow();

    const replay = new Scheduler(defaultRules, runner, BUDGETS, {
      append: (fresh) => {
        events.push(...fresh);
      },
    });
    await replay.tick(fold(PROJECT, events));
    expect(runner.calls).toHaveLength(5);
  });

  it('pauses once and asks for human help when a task exhausts its budget', async () => {
    const events = foundingEvents();
    const runner = new ScriptedRunner();
    const state = await driveWithRestarts(events, runner, {
      ...BUDGETS,
      maxImplementerRunsPerTask: 1,
    });

    expect(state.status).toBe('paused');
    expect(state.messages.at(-1)?.body).toMatch(/Human help is required/);
    expect(runner.calls.filter((call) => call.role === 'implementer')).toHaveLength(1);
    for (const emitted of events.slice(2)) expect(() => parseEvent(emitted)).not.toThrow();
    const eventCount = events.length;

    const replay = new Scheduler(defaultRules, runner, BUDGETS, {
      append: (fresh) => {
        events.push(...fresh);
      },
    });
    await replay.tick(fold(PROJECT, events));
    expect(events).toHaveLength(eventCount);
  });

  it('records a claim before launch and does not respawn it after a crash', async () => {
    const events = [
      ...foundingEvents(),
      event('task.created', 'agent:planner/existing', 3, {
        taskId: 'task-1',
        title: 'Crash safely',
        spec: '',
        deps: [],
      }),
    ];
    let calls = 0;
    const crashing: AgentRunner = {
      async start() {
        calls += 1;
        throw new Error('process lost');
      },
    };
    const first = new Scheduler(defaultRules, crashing, BUDGETS, {
      append: (fresh) => {
        events.push(...fresh);
      },
    });
    await expect(first.tick(fold(PROJECT, events))).rejects.toThrow('process lost');
    expect(fold(PROJECT, events).tasks['task-1']?.status).toBe('claimed');

    const restarted = new Scheduler(defaultRules, crashing, BUDGETS, {
      append: (fresh) => {
        events.push(...fresh);
      },
    });
    await restarted.tick(fold(PROJECT, events));
    expect(calls).toBe(1);
  });

  it('preserves rejection ownership until the next implementer atomically reclaims', async () => {
    const original = `agent:implementer/${newId('run')}` as ActorId;
    const events = [
      ...foundingEvents(),
      event('task.created', `agent:planner/${newId('run')}`, 3, {
        taskId: 'task-1',
        title: 'Revise safely',
        spec: '',
        deps: [],
      }),
      event('task.claimed', original, 4, { taskId: 'task-1' }),
      event('task.updated', original, 5, { taskId: 'task-1', status: 'done' }),
      event('review.posted', `agent:reviewer/${newId('run')}`, 6, {
        verdict: 'request_changes',
        comments: [{ taskId: 'task-1', body: 'Revise it.' }],
      }),
    ];
    const reopened = fold(PROJECT, events);
    expect(reopened.tasks['task-1']).toMatchObject({ status: 'open', assignee: original });
    const resumedByOriginal = fold(PROJECT, [
      ...events,
      event('task.updated', original, 7, { taskId: 'task-1', status: 'in_progress' }),
      event('task.updated', original, 8, { taskId: 'task-1', status: 'done' }),
    ]);
    expect(resumedByOriginal.tasks['task-1']).toMatchObject({
      status: 'done',
      assignee: original,
    });

    const runner: AgentRunner = {
      async start(ctx) {
        return {
          events: [
            event('task.updated', 'agent:implementer/untrusted', 1, {
              taskId: ctx.taskId!,
              status: 'done',
            }),
          ],
          exitCode: 0,
          transcriptPath: '',
        };
      },
    };
    const scheduler = new Scheduler(defaultRules, runner, BUDGETS, {
      append: (fresh) => {
        events.push(...fresh);
      },
    });
    await scheduler.tick(reopened);

    const reclaimed = fold(PROJECT, events).tasks['task-1']!;
    expect(reclaimed.status).toBe('done');
    expect(reclaimed.assignee).toMatch(/^agent:implementer\/run_/);
    expect(reclaimed.assignee).not.toBe(original);
  });

  it('pauses when a rejecting review references no completed task', async () => {
    const implementer = `agent:implementer/${newId('run')}` as ActorId;
    const events = [
      ...foundingEvents(),
      event('task.created', `agent:planner/${newId('run')}`, 3, {
        taskId: 'task-1',
        title: 'Review safely',
        spec: '',
        deps: [],
      }),
      event('task.claimed', implementer, 4, { taskId: 'task-1' }),
      event('task.updated', implementer, 5, { taskId: 'task-1', status: 'done' }),
      event('review.posted', `agent:reviewer/${newId('run')}`, 6, {
        verdict: 'request_changes',
        comments: [{ taskId: 'missing-task', body: 'This target is stale.' }],
      }),
    ];
    const runner = new ScriptedRunner();
    const scheduler = new Scheduler(defaultRules, runner, BUDGETS, {
      append: (fresh) => {
        events.push(...fresh);
      },
    });
    await scheduler.tick(fold(PROJECT, events));

    const paused = fold(PROJECT, events);
    expect(paused.status).toBe('paused');
    expect(paused.messages.at(-1)?.body).toMatch(/rejecting review did not reopen/);
    expect(runner.calls).toHaveLength(0);
  });

  it('pauses cyclic and blocked task graphs instead of silently stalling', async () => {
    const cyclic = [
      ...foundingEvents(),
      event('task.created', `agent:planner/${newId('run')}`, 3, {
        taskId: 'task-a',
        title: 'A',
        spec: '',
        deps: ['task-b'],
      }),
      event('task.created', `agent:planner/${newId('run')}`, 4, {
        taskId: 'task-b',
        title: 'B',
        spec: '',
        deps: ['task-a'],
      }),
    ];
    const runner = new ScriptedRunner();
    const cyclicScheduler = new Scheduler(defaultRules, runner, BUDGETS, {
      append: (fresh) => {
        cyclic.push(...fresh);
      },
    });
    await cyclicScheduler.tick(fold(PROJECT, cyclic));
    expect(fold(PROJECT, cyclic).status).toBe('paused');

    const implementer = `agent:implementer/${newId('run')}` as ActorId;
    const blocked = [
      ...foundingEvents(),
      event('task.created', `agent:planner/${newId('run')}`, 3, {
        taskId: 'task-1',
        title: 'Blocked',
        spec: '',
        deps: [],
      }),
      event('task.claimed', implementer, 4, { taskId: 'task-1' }),
      event('task.updated', implementer, 5, { taskId: 'task-1', status: 'blocked' }),
    ];
    const blockedScheduler = new Scheduler(defaultRules, runner, BUDGETS, {
      append: (fresh) => {
        blocked.push(...fresh);
      },
    });
    await blockedScheduler.tick(fold(PROJECT, blocked));
    const blockedState = fold(PROJECT, blocked);
    expect(blockedState.status).toBe('paused');
    expect(blockedState.messages.at(-1)?.body).toMatch(/no task is runnable/);
    expect(runner.calls).toHaveLength(0);
  });
});
