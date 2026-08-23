import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ParticleEvent } from '@particle/core';
import { openStore } from '@particle/worker/store';
import { run, type CommandContext } from '../src/main.ts';

interface Harness {
  context: CommandContext;
  out: string[];
  err: string[];
}

const dirs: string[] = [];

afterEach(() => {
  // Temporary directories intentionally live under the OS temp root and are
  // left for the OS to reap; avoiding recursive deletion keeps tests harmless.
  dirs.length = 0;
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'particle-cli-'));
  dirs.push(dir);
  return dir;
}

function harness(cwd: string, gitName = 'alice'): Harness {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    context: {
      cwd,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      run: (command, args) => {
        if (command === 'git' && args[0] === 'rev-parse') {
          return { status: 0, stdout: `${cwd}\n`, stderr: '' };
        }
        if (command === 'git' && args[0] === 'config') {
          return { status: 0, stdout: `${gitName}\n`, stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'not available' };
      },
    },
  };
}

describe('particle init', () => {
  it('reports missing setup and succeeds once config and credentials exist', async () => {
    const cwd = tempRepo();
    const first = harness(cwd);
    expect(await run(['init'], first.context)).toBe(1);
    expect(first.err.join('')).toContain('missing  particle.yaml');
    expect(first.err.join('')).toContain('missing  GitHub App credentials');

    writeFileSync(
      join(cwd, 'particle.yaml'),
      'host:\n  repo: acme/widgets\nchannels:\n  github-issues: {}\n',
    );
    mkdirSync(join(cwd, '.particle'));
    writeFileSync(
      join(cwd, '.particle', 'github-app.json'),
      JSON.stringify({ id: 7, slug: 'particle-agent', client_id: 'Iv1.test' }),
    );
    writeFileSync(join(cwd, '.particle', 'github-app.private-key.pem'), 'test key');

    const second = harness(cwd);
    expect(await run(['init'], second.context)).toBe(0);
    expect(second.out.join('')).toContain('particle workspace is ready');
  });
});

describe('particle post/status/log', () => {
  it('creates and appends to projects through the shared journal', async () => {
    const cwd = tempRepo();
    const postFirst = harness(cwd);
    expect(await run(['post', 'try', 'the', 'widget'], postFirst.context)).toBe(0);
    const key = postFirst.out.join('').match(/^created (.+)\n$/)?.[1];
    expect(key).toMatch(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/);

    const postAgain = harness(cwd);
    expect(await run(['post', '--project', key!, 'ship it'], postAgain.context)).toBe(0);
    expect(postAgain.out.join('')).toBe(`posted to ${key}\n`);

    const events = openStore(join(cwd, '.particle')).load();
    expect(events.map((event) => event.type)).toEqual([
      'project.created',
      'message.posted',
      'message.posted',
    ]);
    expect(events.every((event) => event.actor === 'github:alice')).toBe(true);
    expect(events[0]!.data).toEqual({
      title: 'try the widget',
      source: { kind: 'chat', channel: '#cli', thread: key },
    });

    const status = harness(cwd);
    expect(await run(['status'], status.context)).toBe(0);
    const normalizedTable = status.out.join('').replace(key!, '<key>').replace(/ {2,}/g, ' | ');
    expect(normalizedTable).toMatchInlineSnapshot(`
      "KEY | TITLE | MSGS | TASKS | STATUS
      <key> | try the widget | 2 | 0/0 | open
      "
    `);
  });

  it('renders canonical, deduplicated human and NDJSON logs', async () => {
    const cwd = tempRepo();
    const posted = harness(cwd);
    await run(['post', 'canonical order'], posted.context);
    const key = posted.out.join('').match(/^created (.+)\n$/)![1]!;
    const store = openStore(join(cwd, '.particle'));
    const original = store.load();
    const lateArrival: ParticleEvent = {
      v: 0,
      id: 'evt_00000000000000000000000000',
      type: 'message.posted',
      project: original[0]!.project,
      actor: 'github:aaron',
      clock: { lamport: 1, wall: '2026-08-23T11:00:00.000Z' },
      parents: [],
      data: { body: 'concurrent message\non two lines' },
    };
    const futureEvent: ParticleEvent = {
      v: 0,
      id: 'evt_00000000000000000000000001',
      type: 'future.signal' as ParticleEvent['type'],
      project: original[0]!.project,
      actor: 'github:zoe',
      clock: { lamport: 3, wall: '2026-08-23T13:00:00.000Z' },
      parents: [original[1]!.id],
      data: { payload: 'future value' },
    };
    store.append([futureEvent, lateArrival, original[1]!]);

    const human = harness(cwd);
    expect(await run(['log', key], human.context)).toBe(0);
    const humanLines = human.out.join('').trim().split('\n');
    expect(humanLines[0]).toContain(
      'github:aaron  message.posted  concurrent message on two lines',
    );
    expect(humanLines).toHaveLength(4);
    expect(humanLines[3]).toContain('github:zoe  future.signal  {"payload":"future value"}');

    const json = harness(cwd);
    expect(await run(['log', key, '--json'], json.context)).toBe(0);
    const jsonEvents = json.out
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ParticleEvent);
    expect(jsonEvents.map((event) => event.id)).toEqual([
      lateArrival.id,
      original[0]!.id,
      original[1]!.id,
      futureEvent.id,
    ]);
    expect(jsonEvents[3]).toEqual(futureEvent);
  });

  it('rejects unknown projects and missing post text', async () => {
    const cwd = tempRepo();
    const unknown = harness(cwd);
    expect(await run(['post', '--project', 'missing', 'hello'], unknown.context)).toBe(1);
    expect(unknown.err.join('')).toContain('project not found: missing');

    const empty = harness(cwd);
    expect(await run(['post'], empty.context)).toBe(2);
    expect(empty.err.join('')).toContain('usage: particle post');
  });
});
