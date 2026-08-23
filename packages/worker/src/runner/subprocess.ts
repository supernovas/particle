import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { newId } from '@particle/core';
import { runnerEnvironment } from './environment.ts';
import { ingestAgentEventLines } from './ingest.ts';
import { writeRolePrompt } from './prompt.ts';
import {
  parseAgentRole,
  type AgentRunContext,
  type AgentRunResult,
  type AgentRunner,
} from './runner.ts';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_MAX_EVENT_FILE_BYTES = 1024 * 1024;

export interface SubprocessRunnerOptions {
  timeoutMs?: number;
  terminationGraceMs?: number;
  maxEventFileBytes?: number;
  templatesDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  runId?: () => string;
}

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly transcriptPath: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentRunError';
  }
}

export class SubprocessRunner implements AgentRunner {
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly maxEventFileBytes: number;

  constructor(
    private readonly command: readonly string[],
    private readonly options: SubprocessRunnerOptions = {},
  ) {
    if (command.length === 0 || command[0]?.trim() === '') {
      throw new Error('runner.command must contain an executable');
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    this.maxEventFileBytes = options.maxEventFileBytes ?? DEFAULT_MAX_EVENT_FILE_BYTES;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('runner timeout must be a positive number');
    }
  }

  async start(ctx: AgentRunContext): Promise<AgentRunResult> {
    const role = parseAgentRole(ctx.role);
    const runId = this.options.runId?.() ?? newId('run');
    const workdir = resolve(ctx.workdir);
    const runDir = join(workdir, '.particle', 'runs', runId);
    const transcriptPath = join(runDir, 'transcript.log');
    const eventsPath = join(workdir, 'events.ndjson');

    await mkdir(runDir, { recursive: true });
    await unlink(eventsPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const promptPath = await writeRolePrompt(ctx, role, this.options.templatesDir);
    const argv = this.command.map((part) =>
      part.replaceAll('{prompt}', promptPath).replaceAll('{workdir}', workdir),
    );
    const executable = argv[0]!;
    const args = argv.slice(1);
    const transcript = createWriteStream(transcriptPath, { flags: 'wx', mode: 0o600 });

    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd: workdir,
        env: runnerEnvironment(process.env, this.options.env),
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      transcript.end();
      await finished(transcript).catch(() => undefined);
      throw new AgentRunError(
        `failed to start agent process: ${errorMessage(cause)}`,
        transcriptPath,
        {
          cause,
        },
      );
    }

    child.stdout!.pipe(transcript, { end: false });
    child.stderr!.pipe(transcript, { end: false });

    let timedOut = false;
    let hardKill: Promise<void> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      signalProcessTree(child, 'SIGTERM');
      hardKill = new Promise((resolveKill) => {
        setTimeout(() => {
          signalProcessTree(child, 'SIGKILL');
          resolveKill();
        }, this.terminationGraceMs);
      });
    }, this.timeoutMs);

    let outcome: { code: number | null; signal: NodeJS.Signals | null };
    try {
      outcome = await waitForChild(child);
    } catch (cause) {
      clearTimeout(timeout);
      transcript.end();
      await finished(transcript).catch(() => undefined);
      throw new AgentRunError(`agent process failed: ${errorMessage(cause)}`, transcriptPath, {
        cause,
      });
    }
    clearTimeout(timeout);
    if (timedOut) await hardKill;
    transcript.end();
    await finished(transcript);

    if (timedOut) {
      throw new AgentRunError(`agent process timed out after ${this.timeoutMs}ms`, transcriptPath);
    }
    if (outcome.code === null) {
      throw new AgentRunError(
        `agent process exited from signal ${outcome.signal ?? 'unknown'}`,
        transcriptPath,
      );
    }

    let contents: string;
    try {
      const metadata = await stat(eventsPath);
      if (metadata.size > this.maxEventFileBytes) {
        throw new Error(`events.ndjson exceeds ${this.maxEventFileBytes} bytes`);
      }
      contents = await readFile(eventsPath, 'utf8');
    } catch (cause) {
      throw new AgentRunError(
        `could not read agent events: ${errorMessage(cause)}`,
        transcriptPath,
        {
          cause,
        },
      );
    }

    try {
      return {
        events: ingestAgentEventLines(contents, ctx, role, runId, { now: this.options.now }),
        exitCode: outcome.code,
        transcriptPath,
      };
    } catch (cause) {
      throw new AgentRunError(
        `could not ingest agent events: ${errorMessage(cause)}`,
        transcriptPath,
        {
          cause,
        },
      );
    }
  }
}

function waitForChild(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveChild, rejectChild) => {
    child.once('error', rejectChild);
    child.once('close', (code, signal) => resolveChild({ code, signal }));
  });
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      if (signal === 'SIGKILL') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('error', () => undefined);
      } else {
        child.kill(signal);
      }
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // A concurrently exiting process group is already in the desired state.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
