import { describe, expect, it } from 'vitest';
import { EventValidationError, isEvent, parseEvent, type ParticleEvent } from '@particle/core';

const EVENT_ID = 'evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDB';
const PROJECT_ID = 'prj_01J8ZBXAH2V9FYQ6MZ0X7T4KDB';
const RUN_ID = 'run_01J8ZC3AH2V9FYQ6MZ0X7T4KDB';

function event(type: string, data: unknown): Record<string, unknown> {
  return {
    v: 0,
    id: EVENT_ID,
    type,
    project: PROJECT_ID,
    actor: 'github:alice',
    clock: { lamport: 1, wall: '2026-08-23T20:00:00.000Z' },
    parents: [],
    data,
  };
}

const payloads: Record<string, unknown> = {
  'project.created': {
    title: 'Ship it',
    source: { kind: 'github-issue', repo: 'supernovas/particle', number: 4 },
  },
  'message.posted': { body: 'hello', replyTo: EVENT_ID, via: 'https://example.test/1' },
  'plan.proposed': { summary: 'A plan', taskIds: ['t1'] },
  'task.created': { taskId: 't1', title: 'Core', spec: 'Build it', deps: [] },
  'task.claimed': { taskId: 't1' },
  'task.updated': { taskId: 't1', status: 'done', note: 'complete' },
  'review.requested': { taskIds: ['t1'] },
  'review.posted': { verdict: 'approve', comments: [{ taskId: 't1', body: 'good' }] },
  'artifact.linked': { kind: 'pr', locator: 'https://example.test/pr/1' },
  'project.status': { status: 'converged' },
};

describe('parseEvent', () => {
  it.each(Object.entries(payloads))('accepts %s', (type, data) => {
    expect(parseEvent(event(type, data))).toMatchObject({ type, data });
  });

  it('accepts the agent actor shape', () => {
    const value = event('message.posted', { body: 'hello' });
    value.actor = `agent:planner/${RUN_ID}`;
    expect(isEvent(value)).toBe(true);
  });

  it('accepts GitHub App logins that the Phase-0 worker can journal', () => {
    const value = event('message.posted', { body: 'automated comment' });
    value.actor = 'github:dependabot[bot]';
    expect(isEvent(value)).toBe(true);
  });

  it('preserves unknown event types after envelope validation', () => {
    const value = event('future.shipped', { arbitrary: ['payload'] });
    expect(parseEvent(value)).toBe(value);
  });

  it.each([
    ['missing envelope field', { ...event('message.posted', { body: 'x' }), id: undefined }, 'id'],
    ['bad event id', { ...event('message.posted', { body: 'x' }), id: 'evt_bad' }, 'id'],
    [
      'bad project id',
      { ...event('message.posted', { body: 'x' }), project: 'prj_bad' },
      'project',
    ],
    ['bad actor', { ...event('message.posted', { body: 'x' }), actor: 'alice' }, 'actor'],
    [
      'non-positive lamport',
      {
        ...event('message.posted', { body: 'x' }),
        clock: { lamport: 0, wall: '2026-08-23T20:00:00.000Z' },
      },
      'clock.lamport',
    ],
    [
      'non-ISO wall time',
      { ...event('message.posted', { body: 'x' }), clock: { lamport: 1, wall: 'yesterday' } },
      'clock.wall',
    ],
    [
      'bad parent id',
      { ...event('message.posted', { body: 'x' }), parents: ['bad'] },
      'parents[0]',
    ],
    ['payload mismatch', event('task.updated', { taskId: 't1', status: 'open' }), 'data.status'],
    ['missing payload', event('message.posted', {}), 'data.body'],
  ])('rejects %s at %s', (_name, value, expectedPath) => {
    try {
      parseEvent(value);
      expect.fail('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EventValidationError);
      expect((error as EventValidationError).path).toBe(expectedPath);
    }
    expect(isEvent(value)).toBe(false);
  });

  it('returns a ParticleEvent type guard', () => {
    const value: unknown = event('message.posted', { body: 'typed' });
    if (!isEvent(value)) throw new Error('unexpected invalid event');
    expect((value as ParticleEvent).clock.lamport).toBe(1);
  });
});
