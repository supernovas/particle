import { describe, expect, it } from 'vitest';
import type { ParticleEvent } from '@particle/core';
import type { Config } from '../src/config.ts';
import { serializeWorkspace } from '../src/serialize.ts';

const config: Config = {
  host: { repo: 'acme/site' },
  channels: {
    githubIssues: {
      repo: 'acme/site',
      label: 'particle:project',
      seedIssues: [1],
      pollIntervalSeconds: 15,
      mirror: false,
    },
  },
  runner: { command: null, timeoutSeconds: 900 },
};

let lamport = 0;
function evt(type: ParticleEvent['type'], actor: string, data: unknown): ParticleEvent {
  lamport += 1;
  return {
    v: 0,
    id: `evt_${String(lamport).padStart(4, '0')}`,
    type,
    project: 'prj_1',
    actor: actor as ParticleEvent['actor'],
    clock: { lamport, wall: `2026-08-23T09:${String(lamport).padStart(2, '0')}:00.000Z` },
    parents: [],
    data,
  };
}

const events: ParticleEvent[] = [
  evt('project.created', 'github:ada', {
    title: 'Fix the flaky suite',
    source: { kind: 'github-issue', repo: 'acme/site', number: 7 },
  }),
  evt('message.posted', 'github:ada', { body: 'Deflake everything that failed twice.' }),
  evt('plan.proposed', 'agent:planner/run_1', {
    summary: 'Plan — 2 tasks',
    taskIds: ['tsk_a', 'tsk_b'],
  }),
  evt('task.created', 'agent:planner/run_1', {
    taskId: 'tsk_a',
    title: 'Quarantine',
    spec: '',
    deps: [],
  }),
  evt('task.created', 'agent:planner/run_1', {
    taskId: 'tsk_b',
    title: 'Fix races',
    spec: '',
    deps: [],
  }),
  evt('task.claimed', 'agent:impl/run_2', { taskId: 'tsk_a' }),
  evt('task.updated', 'agent:impl/run_2', { taskId: 'tsk_a', status: 'done' }),
  evt('artifact.linked', 'agent:impl/run_2', { kind: 'commit', locator: 'abc1234' }),
  evt('review.posted', 'agent:reviewer/run_3', {
    verdict: 'request_changes',
    comments: [{ body: 'Shard three drops webkit.' }],
  }),
  evt('project.status', 'github:ada', { status: 'executing' }),
];

describe('serializeWorkspace', () => {
  const payload = serializeWorkspace([{ id: 'prj_1', events }], config, 'kate');

  it('maps the project with protocol status, derived changes state', () => {
    expect(payload.projects).toHaveLength(1);
    const project = payload.projects[0]!;
    expect(project.title).toBe('Fix the flaky suite');
    expect(project.issue).toBe(7);
    // executing + request_changes review surfaces as "changes"
    expect(project.status).toBe('changes');
    expect(project.round).toBe(1);
    expect(project.tasks).toEqual([
      { id: 'tsk_a', title: 'Quarantine', state: 'queued', assignee: 'agent:impl/run_2' },
      { id: 'tsk_b', title: 'Fix races', state: 'queued', assignee: undefined },
    ]);
    expect(project.watchers).toEqual(['github:ada']);
  });

  it('derives actors from events plus the operator', () => {
    const ids = payload.actors.map((a) => a.id).sort();
    expect(ids).toEqual([
      'agent:impl/run_2',
      'agent:planner/run_1',
      'agent:reviewer/run_3',
      'github:ada',
      'github:kate',
    ]);
    const planner = payload.actors.find((a) => a.id === 'agent:planner/run_1')!;
    expect(planner).toMatchObject({ kind: 'agent', name: 'planner', role: 'planner' });
    expect(payload.currentUserId).toBe('github:kate');
  });

  it('surfaces the founding prompt as the channel message', () => {
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({
      channelId: 'github-issues',
      authorId: 'github:ada',
      text: 'Deflake everything that failed twice.',
      projectId: 'prj_1',
      time: '09:02',
    });
  });

  it('maps events to transcript turns in canonical order', () => {
    const kinds = payload.turns.map((t) => t.kind);
    expect(kinds).toEqual([
      'status', // project created
      'comment', // founding prompt
      'plan',
      'status', // claimed
      'status', // task done
      'commit',
      'review',
      'status', // project status
    ]);
    const plan = payload.turns.find((t) => t.kind === 'plan')!;
    expect(plan.body).toBe('1. Quarantine\n2. Fix races');
    const review = payload.turns.find((t) => t.kind === 'review')!;
    expect(review.title).toBe('Review — changes requested (1)');
  });

  it('links the new-project entry point', () => {
    expect(payload.workspace.newProjectUrl).toBe(
      'https://github.com/acme/site/issues/new?labels=particle%3Aproject',
    );
  });
});
