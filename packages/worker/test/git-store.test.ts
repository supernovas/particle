import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, nextClock, type ParticleEvent } from '@particle/core';
import { RefStore } from '@particle/git';
import { GitEventStore } from '../src/git-store.ts';

let root: string;
let origin: string;

function bare(path: string): string {
  execFileSync('git', ['init', '--bare', '--quiet', path]);
  return path;
}

/** A store the way openStore() builds one, against a local file "host repo". */
function newStore(name: string): GitEventStore {
  const stateDir = join(root, name);
  mkdirSync(stateDir, { recursive: true });
  const gitDir = bare(join(stateDir, 'store.git'));
  return new GitEventStore(new RefStore({ gitDir, remote: origin }));
}

function sampleProject(): ParticleEvent[] {
  const project = newId('prj');
  const created: ParticleEvent = {
    v: 0,
    id: newId('evt'),
    type: 'project.created',
    project,
    actor: 'github:alice',
    clock: nextClock(undefined, [], new Date('2026-08-23T12:00:00Z')),
    parents: [],
    data: {
      title: 'Ship the widget',
      source: { kind: 'github-issue', repo: 'acme/widget', number: 7 },
    },
  };
  const message: ParticleEvent = {
    v: 0,
    id: newId('evt'),
    type: 'message.posted',
    project,
    actor: 'github:alice',
    clock: nextClock(created.clock, [], new Date('2026-08-23T12:00:01Z')),
    parents: [created.id],
    data: { body: 'please build the widget', via: 'https://github.com/acme/widget/issues/7' },
  };
  return [created, message];
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'particle-git-store-'));
  origin = bare(join(root, 'origin.git'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GitEventStore', () => {
  it('appends push refs/particle/* to the host repo', async () => {
    const events = sampleProject();
    const project = events[0]!.project;
    await newStore('writer').append(events);

    const refs = execFileSync('git', ['--git-dir', origin, 'for-each-ref', '--format=%(refname)'])
      .toString()
      .trim()
      .split('\n');
    expect(refs).toContain(`refs/particle/${project}/meta`);
    expect(refs).toContain(`refs/particle/${project}/actors/github-alice`);
  });

  it('recovers full state on a cold machine by fetching from the host repo', async () => {
    const events = sampleProject();
    await newStore('writer-2').append(events);

    const recovered = await newStore('cold-reader').load();
    const ids = new Set(recovered.map((e) => e.id));
    for (const event of events) expect(ids.has(event.id)).toBe(true);
  });

  it(
    'merges concurrent appends from different actors via the remote',
    { timeout: 30_000 },
    async () => {
      const events = sampleProject();
      const project = events[0]!.project;
      const a = newStore('actor-a');
      await a.append(events);

      const b = newStore('actor-b');
      await b.load();
      const reply: ParticleEvent = {
        v: 0,
        id: newId('evt'),
        type: 'message.posted',
        project,
        actor: 'github:bob',
        clock: nextClock(events.at(-1)!.clock, [], new Date('2026-08-23T12:00:02Z')),
        parents: [events.at(-1)!.id],
        data: { body: 'on it' },
      };
      await b.append([reply]);

      const seenByA = await a.load();
      expect(seenByA.map((e) => e.id)).toContain(reply.id);
      expect(seenByA.filter((e) => e.project === project)).toHaveLength(3);
    },
  );
});
