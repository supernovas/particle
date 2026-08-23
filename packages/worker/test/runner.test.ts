import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyState, newId, type ParticleEvent } from '@particle/core';
import {
  AgentEventIngestionError,
  AgentRunError,
  FakeRunner,
  SubprocessRunner,
  ingestAgentEventLines,
  runnerEnvironment,
  writeRolePrompt,
  type AgentRunContext,
} from '../src/runner/index.ts';

function context(workdir: string, role = 'planner'): AgentRunContext {
  const project = newId('prj');
  const state = emptyState(project);
  state.clock = 7;
  state.seen.add(newId('evt'));
  return {
    role,
    project,
    state,
    workdir,
    promptPath: '.particle/prompt.md',
  };
}

describe('agent event ingestion', () => {
  it('accepts a valid fake run and overwrites every untrusted envelope field', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'particle-fake-runner-'));
    const ctx = context(workdir);
    const untrustedId = newId('evt');
    const fake = new FakeRunner({
      planner: [
        [
          {
            v: 99,
            id: untrustedId,
            type: 'task.created',
            project: newId('prj'),
            actor: 'github:mallory',
            clock: { lamport: 999, wall: '2000-01-01T00:00:00.000Z' },
            parents: ['untrusted'],
            data: { taskId: newId('tsk'), title: 'Build it', spec: 'Do the work', deps: [] },
          },
        ],
      ],
    });

    const result = await fake.start(ctx);
    const event = result.events[0]!;
    expect(event.v).toBe(0);
    expect(event.id).not.toBe(untrustedId);
    expect(event.project).toBe(ctx.project);
    expect(event.actor).toMatch(/^agent:planner\/run_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(event.clock.lamport).toBe(8);
    expect(event.clock.wall).not.toBe('2000-01-01T00:00:00.000Z');
    expect(event.parents).toEqual([...ctx.state.seen]);
  });

  it.each([
    ['planner', 'review.posted'],
    ['implementer', 'plan.proposed'],
    ['reviewer', 'task.created'],
  ] as const)('rejects %s output of disallowed type %s', (role, type) => {
    const ctx = context('/tmp', role);
    const line = JSON.stringify({ type, data: {} });
    expect(() => ingestAgentEventLines(line, ctx, role, newId('run'))).toThrow(
      new RegExp(`role ${role} may not emit`),
    );
  });

  it('reports the physical line number for malformed JSON', () => {
    const ctx = context('/tmp');
    const input = `${JSON.stringify({ type: 'message.posted', data: { body: 'ok' } })}\n\n{"type":`;
    expect(() => ingestAgentEventLines(input, ctx, 'planner', newId('run'))).toThrow(
      'events.ndjson line 3: invalid JSON',
    );
  });

  it('reports payload validation errors with the line number', () => {
    const ctx = context('/tmp');
    const input = JSON.stringify({ type: 'task.created', data: { title: 42 } });
    expect(() => ingestAgentEventLines(input, ctx, 'planner', newId('run'))).toThrow(
      AgentEventIngestionError,
    );
    expect(() => ingestAgentEventLines(input, ctx, 'planner', newId('run'))).toThrow(
      /^events\.ndjson line 1: invalid task\.created event:/,
    );
  });

  it('uses sequential fresh clocks and causal parents within one batch', () => {
    const ctx = context('/tmp');
    const input = [
      { type: 'message.posted', data: { body: 'one' } },
      { type: 'message.posted', data: { body: 'two' } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const times = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:01Z')];
    const events = ingestAgentEventLines(input, ctx, 'planner', newId('run'), {
      now: () => times.shift()!,
    });
    expect(events.map((event) => event.clock.lamport)).toEqual([8, 9]);
    expect(events[1]!.parents).toEqual([events[0]!.id]);
  });
});

describe('role prompt rendering', () => {
  it('writes a private prompt with canonical state and the selected task', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'particle-prompt-'));
    const ctx = context(workdir, 'implementer');
    const taskId = newId('tsk');
    ctx.taskId = taskId;
    ctx.state.tasks[taskId] = {
      id: taskId,
      title: 'Selected task',
      spec: 'Implement it',
      deps: [],
      status: 'open',
    };

    const path = await writeRolePrompt(ctx, 'implementer');
    const prompt = await readFile(path, 'utf8');
    expect(prompt).toContain('"title":"Selected task"');
    expect(prompt).toContain(`"seen":[${JSON.stringify([...ctx.state.seen][0])}]`);
    expect(prompt).not.toContain('{{state}}');
    expect(prompt).not.toContain('{{task}}');
  });
});

describe('SubprocessRunner', () => {
  it('runs an argv command without a shell and ingests events.ndjson', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'particle-subprocess-'));
    const ctx = context(workdir);
    const taskId = newId('tsk');
    const agent = [
      `const fs = require('node:fs');`,
      `fs.writeFileSync('events.ndjson', JSON.stringify({`,
      `  type: 'task.created',`,
      `  data: { taskId: ${JSON.stringify(taskId)}, title: 'Test', spec: 'Test it', deps: [] }`,
      `}) + '\\n');`,
      `process.stdout.write('agent stdout\\n');`,
      `process.stderr.write('agent stderr\\n');`,
    ].join('\n');
    const runner = new SubprocessRunner([process.execPath, '-e', agent, '{prompt}'], {
      runId: () => 'run_01J8ZC3AH2V9FYQ6MZ0X7T4KDB',
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });

    const result = await runner.start(ctx);
    expect(result.exitCode).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'task.created',
      project: ctx.project,
      actor: 'agent:planner/run_01J8ZC3AH2V9FYQ6MZ0X7T4KDB',
      clock: { lamport: 8, wall: '2026-08-23T20:00:00.000Z' },
    } satisfies Partial<ParticleEvent>);
    const transcript = await readFile(result.transcriptPath, 'utf8');
    expect(transcript).toContain('agent stdout');
    expect(transcript).toContain('agent stderr');
  });

  it('removes stale events before starting the subprocess', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'particle-stale-events-'));
    await writeFile(
      join(workdir, 'events.ndjson'),
      JSON.stringify({ type: 'message.posted', data: { body: 'stale' } }),
    );
    const runner = new SubprocessRunner([process.execPath, '-e', ''], {
      runId: () => 'run_01J8ZC3AH2V9FYQ6MZ0X7T4KDC',
    });
    await expect(runner.start(context(workdir))).rejects.toThrow(
      'could not read agent events: ENOENT',
    );
  });

  it('terminates a timed-out subprocess instead of hanging', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'particle-timeout-'));
    const runner = new SubprocessRunner(
      [process.execPath, '-e', 'setInterval(() => undefined, 1_000)'],
      {
        timeoutMs: 75,
        terminationGraceMs: 25,
        runId: () => 'run_01J8ZC3AH2V9FYQ6MZ0X7T4KDD',
      },
    );
    await expect(runner.start(context(workdir))).rejects.toMatchObject({
      name: AgentRunError.name,
      message: 'agent process timed out after 75ms',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'terminates descendants in the subprocess group',
    async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'particle-timeout-tree-'));
      const agent = [
        `const { spawn } = require('node:child_process');`,
        `const fs = require('node:fs');`,
        `const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)'], { stdio: 'ignore' });`,
        `fs.writeFileSync('descendant.pid', String(child.pid));`,
        `setInterval(() => undefined, 1_000);`,
      ].join('\n');
      const runner = new SubprocessRunner([process.execPath, '-e', agent], {
        timeoutMs: 500,
        terminationGraceMs: 50,
        runId: () => 'run_01J8ZC3AH2V9FYQ6MZ0X7T4KDE',
      });

      await expect(runner.start(context(workdir))).rejects.toThrow('timed out after 500ms');
      const descendantPid = Number(await readFile(join(workdir, 'descendant.pid'), 'utf8'));
      await expectProcessToExit(descendantPid);
    },
  );
});

describe('runnerEnvironment', () => {
  it('keeps required homes but drops unrelated worker secrets', () => {
    expect(
      runnerEnvironment({
        HOME: '/operator',
        CODEX_HOME: '/operator/codex-home',
        PATH: '/bin',
        PARTICLE_GITHUB_TOKEN: 'secret',
        OPENAI_API_KEY: 'also-secret',
      }),
    ).toEqual({ HOME: '/operator', CODEX_HOME: '/operator/codex-home', PATH: '/bin' });
  });

  it('allows explicit environment overrides', () => {
    expect(runnerEnvironment({ PATH: '/bin' }, { SPECIAL_AGENT_VALUE: 'ok' })).toEqual({
      PATH: '/bin',
      SPECIAL_AGENT_VALUE: 'ok',
    });
  });
});

async function expectProcessToExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process ${pid} is still alive`);
}
