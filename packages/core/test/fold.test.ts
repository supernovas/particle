import { describe, expect, it } from 'vitest';
import {
  fold,
  foldMany,
  isConverged,
  newId,
  nextClock,
  stateToJson,
  ulid,
  type ActorId,
  type Clock,
  type EventType,
  type ParticleEvent,
  type ProjectState,
} from '@particle/core';

const PROJECT = newId('prj');

function event<T>(
  type: EventType,
  actor: ActorId,
  lamport: number,
  data: T,
  id = newId('evt'),
): ParticleEvent<T> {
  return {
    v: 0,
    id,
    type,
    project: PROJECT,
    actor,
    clock: { lamport, wall: new Date(1_000_000_000_000 + lamport * 1000).toISOString() },
    parents: [],
    data,
  };
}

function sampleEvents(): ParticleEvent[] {
  return [
    event('project.created', 'github:alice', 1, {
      title: 'Ship the widget',
      source: { kind: 'github-issue', repo: 'acme/widget', number: 7 },
    }),
    event('message.posted', 'github:alice', 2, { body: 'please build the widget' }),
    event('plan.proposed', 'agent:planner/p1', 3, {
      summary: 'Build in dependency order',
      taskIds: ['t1', 't2'],
    }),
    event('task.created', 'agent:planner/p1', 4, {
      taskId: 't1',
      title: 'scaffold',
      spec: 'set up the repo',
      deps: [],
    }),
    event('task.created', 'agent:planner/p1', 5, {
      taskId: 't2',
      title: 'implement',
      spec: 'build the thing',
      deps: ['t1'],
    }),
    event('task.claimed', 'agent:impl/i1', 6, { taskId: 't1' }),
    event('task.updated', 'agent:impl/i1', 7, { taskId: 't1', status: 'done' }),
    event('task.claimed', 'agent:impl/i2', 8, { taskId: 't2' }),
    event('task.updated', 'agent:impl/i2', 9, { taskId: 't2', status: 'done' }),
    event('review.requested', 'agent:impl/i2', 10, { taskIds: ['t1', 't2'] }),
    event('review.posted', 'agent:reviewer/r1', 11, { verdict: 'approve', comments: [] }),
  ];
}

function comparable(state: ProjectState) {
  const { seen, ...rest } = state;
  return { ...rest, seen: [...seen].sort() };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('fold', () => {
  it('builds project state from an event log', () => {
    const state = fold(PROJECT, sampleEvents());
    expect(state.title).toBe('Ship the widget');
    expect(state.messages).toHaveLength(1);
    expect(Object.keys(state.tasks)).toEqual(['t1', 't2']);
    expect(state.tasks['t1']!.status).toBe('done');
    expect(state.tasks['t1']!.assignee).toBe('agent:impl/i1');
    expect(state.plan).toEqual({
      summary: 'Build in dependency order',
      taskIds: ['t1', 't2'],
    });
    expect(state.reviewRequested).toEqual({ taskIds: ['t1', 't2'] });
    expect(state.lastReview?.verdict).toBe('approve');
    expect(isConverged(state)).toBe(true);
  });

  it('is invariant under delivery order (permutation invariance)', () => {
    const events = sampleEvents();
    const reference = comparable(fold(PROJECT, events));
    for (let seed = 1; seed <= 25; seed++) {
      expect(comparable(fold(PROJECT, shuffle(events, seed)))).toEqual(reference);
    }
  });

  it('ignores duplicate deliveries of the same event', () => {
    const events = sampleEvents();
    const once = comparable(fold(PROJECT, events));
    const twice = comparable(fold(PROJECT, [...events, ...events]));
    expect(twice).toEqual(once);
  });

  it('resolves concurrent claims deterministically regardless of arrival order', () => {
    const base = [
      event('project.created', 'github:alice', 1, {
        title: 'race',
        source: { kind: 'chat', channel: '#eng' },
      }),
      event('task.created', 'agent:planner/p1', 2, {
        taskId: 't1',
        title: 'contested',
        spec: '',
        deps: [],
      }),
    ];
    // Two actors claim concurrently with the same lamport clock.
    const claimA = event('task.claimed', 'agent:impl/a', 3, { taskId: 't1' });
    const claimB = event('task.claimed', 'agent:impl/b', 3, { taskId: 't1' });
    const s1 = fold(PROJECT, [...base, claimA, claimB]);
    const s2 = fold(PROJECT, [...base, claimB, claimA]);
    expect(s1.tasks['t1']!.assignee).toBe(s2.tasks['t1']!.assignee);
    expect(s1.tasks['t1']!.assignee).toBe('agent:impl/a');
  });

  it('ignores events from other projects', () => {
    const foreign = { ...sampleEvents()[0]!, project: newId('prj') };
    const state = fold(PROJECT, [foreign]);
    expect(state.title).toBe('');
    expect(state.seen.size).toBe(0);
  });

  it('folds multiple projects independently in stable project order', () => {
    const other = newId('prj');
    const events = sampleEvents();
    const otherCreated = { ...events[0]!, id: newId('evt'), project: other };
    const states = foldMany([otherCreated, ...events]);
    expect([...states.keys()]).toEqual([PROJECT, other].sort());
    expect(states.get(PROJECT)?.title).toBe('Ship the widget');
    expect(states.get(other)?.seen.size).toBe(1);
  });

  it('converts state Sets to a detached, deterministically ordered JSON shape', () => {
    const state = fold(PROJECT, sampleEvents());
    const json = stateToJson(state);
    expect(json.seen).toEqual([...state.seen].sort());
    expect(json.plan).toEqual(state.plan);
    json.seen.push('evt_00000000000000000000000000');
    json.tasks['t1']!.deps.push('mutated');
    expect(state.seen.has('evt_00000000000000000000000000')).toBe(false);
    expect(state.tasks['t1']!.deps).not.toContain('mutated');
  });
});

describe('clock', () => {
  it('advances past everything observed', () => {
    const observed: Clock[] = [
      { lamport: 4, wall: '2026-01-01T00:00:00.000Z' },
      { lamport: 9, wall: '2026-01-01T00:00:01.000Z' },
    ];
    const next = nextClock({ lamport: 2, wall: '2026-01-01T00:00:02.000Z' }, observed, new Date(0));
    expect(next.lamport).toBe(10);
  });
});

describe('ids', () => {
  it('ulid is 26 chars, sortable by time, and unique', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a).toHaveLength(26);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
  });

  it('newId carries its type prefix', () => {
    expect(newId('prj')).toMatch(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newId('evt')).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
