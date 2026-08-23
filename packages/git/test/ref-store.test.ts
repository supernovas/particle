import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ActorId,
  type EventType,
  type ParticleEvent,
  type ProjectCreated,
} from '@particle/core';
import { RefStore, StaleRefError } from '../src/index.ts';

const exec = promisify(execFile);
const PROJECT = 'prj_01J8ZC3AH2V9FYQ6MZ0X7T4KDB';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function event<T>(
  id: string,
  type: EventType,
  actor: ActorId,
  lamport: number,
  data: T,
): ParticleEvent<T> {
  return {
    v: 0,
    id,
    type,
    project: PROJECT,
    actor,
    clock: { lamport, wall: new Date(Date.UTC(2026, 7, 23, 20, 0, lamport)).toISOString() },
    parents: [],
    data,
  };
}

function created(): ParticleEvent<ProjectCreated> {
  return event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDC', 'project.created', 'github:alice', 1, {
    title: 'Build Particle',
    source: { kind: 'github-issue', repo: 'supernovas/particle', number: 5 },
  });
}

async function bare(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `particle-git-${name}-`));
  roots.push(root);
  const gitDir = join(root, 'repo.git');
  await exec('git', ['init', '--bare', gitDir]);
  return gitDir;
}

async function clone(origin: string, name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `particle-git-${name}-`));
  roots.push(root);
  const gitDir = join(root, 'clone.git');
  await exec('git', ['clone', '--bare', origin, gitDir]);
  return gitDir;
}

describe('RefStore', () => {
  it('creates a project and appends a cumulative actor log without a worktree', async () => {
    const gitDir = await bare('append');
    const store = new RefStore({ gitDir });
    await store.createProject(created());
    const first = event(
      'evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDD',
      'message.posted',
      'github:worker-one',
      2,
      {
        body: 'first',
      },
    );
    const second = event(
      'evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDE',
      'artifact.linked',
      'github:worker-one',
      3,
      { kind: 'commit', locator: 'abc123' },
    );

    const firstTip = await store.append(PROJECT, first.actor, [first]);
    const secondTip = await store.append(PROJECT, second.actor, [second]);
    expect(secondTip).not.toBe(firstTip);
    expect((await store.readEvents(PROJECT)).map(({ id }) => id)).toEqual([
      created().id,
      first.id,
      second.id,
    ]);
    expect(await store.listProjects()).toEqual([PROJECT]);

    const { stdout: parent } = await exec('git', [
      '--git-dir',
      gitDir,
      'rev-parse',
      `${secondTip}^`,
    ]);
    expect(parent.trim()).toBe(firstTip);
  });

  it('makes a duplicate append idempotent and rejects changed immutable content', async () => {
    const gitDir = await bare('duplicates');
    const store = new RefStore({ gitDir });
    const original = event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDF', 'message.posted', 'github:alice', 1, {
      body: 'same',
    });
    const tip = await store.append(PROJECT, original.actor, [original]);
    await expect(store.append(PROJECT, original.actor, [original])).resolves.toBe(tip);
    await expect(
      store.append(PROJECT, original.actor, [{ ...original, data: { body: 'changed' } }]),
    ).rejects.toThrow(/different content/);
  });

  it('stores valid GitHub bot actors under Git-safe encoded refs', async () => {
    const gitDir = await bare('bot-actor');
    const store = new RefStore({ gitDir });
    const bot = event(
      'evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDY',
      'message.posted',
      'github:dependabot[bot]',
      1,
      { body: 'automated update' },
    );

    await store.append(PROJECT, bot.actor, [bot]);
    const { stdout: refs } = await exec('git', [
      '--git-dir',
      gitDir,
      'for-each-ref',
      '--format=%(refname)',
      `refs/particle/${PROJECT}/actors/`,
    ]);
    expect(refs.trim()).toBe(`refs/particle/${PROJECT}/actors/github-dependabot%5Bbot%5D`);
    await expect(store.readEvents(PROJECT)).resolves.toEqual([bot]);
  });

  it('CAS-rejects concurrent writers to one actor ref without losing either winner batch', async () => {
    const gitDir = await bare('cas');
    const stores = Array.from({ length: 8 }, () => new RefStore({ gitDir }));
    const writes = stores.map((store, index) => {
      const suffix = 'GHJKMNPQ'[index]!;
      const item = event(
        `evt_01J8ZC3AH2V9FYQ6MZ0X7T4KD${suffix}`,
        'message.posted',
        'github:shared-worker',
        index + 1,
        { body: String(index) },
      );
      return store.append(PROJECT, item.actor, [item]);
    });
    const results = await Promise.allSettled(writes);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(7);
    expect(rejected.every((result) => result.reason instanceof StaleRefError)).toBe(true);
    expect(await stores[0]!.readEvents(PROJECT)).toHaveLength(1);
  }, 20_000);

  it('syncs concurrent actor logs and materializes an identical deterministic view', async () => {
    const origin = await bare('origin');
    const aDir = await clone(origin, 'alice');
    const bDir = await clone(origin, 'bob');
    const a = new RefStore({ gitDir: aDir, remote: 'origin' });
    const b = new RefStore({ gitDir: bDir, remote: 'origin' });
    await a.createProject(created());
    await a.sync();
    await b.sync();

    const alice = event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDS', 'message.posted', 'github:alice', 2, {
      body: 'alice',
    });
    const bob = event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDT', 'message.posted', 'github:bob', 2, {
      body: 'bob',
    });
    await Promise.all([
      a.append(PROJECT, alice.actor, [alice]),
      b.append(PROJECT, bob.actor, [bob]),
    ]);
    expect((await a.sync()).pushed.every(({ status }) => status === 'accepted')).toBe(true);
    expect((await b.sync()).pushed.every(({ status }) => status === 'accepted')).toBe(true);
    await a.sync();

    const aEvents = await a.readEvents(PROJECT);
    const bEvents = await b.readEvents(PROJECT);
    expect(aEvents).toEqual(bEvents);
    const aView = await a.materialize(PROJECT);
    const bView = await b.materialize(PROJECT);
    expect(aView.sha).toBe(bView.sha);
    await expect(a.materialize(PROJECT)).resolves.toMatchObject({ sha: aView.sha });

    const { stdout: commit } = await exec('git', [
      '--git-dir',
      aDir,
      'show',
      '-s',
      '--format=%an%n%ae%n%cn%n%ce%n%aI%n%cI%n%P%n%s',
      aView.sha,
    ]);
    const lines = commit.trim().split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'particle',
      'particle@supernova.ai',
      'particle',
      'particle@supernova.ai',
    ]);
    expect(new Date(lines[4]!).toISOString()).toBe(bob.clock.wall);
    expect(new Date(lines[5]!).toISOString()).toBe(bob.clock.wall);
    expect(lines[6]!.split(' ')).toHaveLength(2);
    expect(lines[7]).toBe(`particle: materialize ${PROJECT}`);
  }, 20_000);

  it('reports a stale remote actor ref as a rejected CAS push', async () => {
    const origin = await bare('push-race-origin');
    const aDir = await clone(origin, 'push-race-a');
    const bDir = await clone(origin, 'push-race-b');
    const a = new RefStore({ gitDir: aDir, remote: 'origin' });
    const b = new RefStore({ gitDir: bDir, remote: 'origin' });
    const first = event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDV', 'message.posted', 'github:alice', 1, {
      body: 'a',
    });
    const competing = event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDW', 'message.posted', 'github:alice', 1, {
      body: 'b',
    });
    await Promise.all([
      a.append(PROJECT, first.actor, [first]),
      b.append(PROJECT, competing.actor, [competing]),
    ]);
    await a.sync();
    const report = await b.sync().catch((error: unknown) => error);
    expect(report).toBeInstanceOf(StaleRefError);
  });

  it('reports a remote push rejection per ref', async () => {
    const origin = await bare('reject-origin');
    const local = await clone(origin, 'reject-local');
    const store = new RefStore({ gitDir: local, remote: 'origin' });
    const item = event('evt_01J8ZC3AH2V9FYQ6MZ0X7T4KDX', 'message.posted', 'github:alice', 1, {
      body: 'rejected',
    });
    await store.append(PROJECT, item.actor, [item]);
    const hook = join(origin, 'hooks', 'pre-receive');
    await writeFile(hook, '#!/bin/sh\necho blocked >&2\nexit 1\n');
    await chmod(hook, 0o755);

    const report = await store.sync();
    expect(report.fetched).toEqual([]);
    expect(report.pushed).toHaveLength(1);
    expect(report.pushed[0]).toMatchObject({
      ref: `refs/particle/${PROJECT}/actors/github-alice`,
      status: 'rejected',
    });
    expect(report.pushed[0]!.error).toContain('blocked');
  });
});
