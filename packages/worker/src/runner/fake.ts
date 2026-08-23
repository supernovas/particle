import { join } from 'node:path';
import { newId } from '@particle/core';
import { ingestAgentEventLines } from './ingest.ts';
import {
  parseAgentRole,
  type AgentEventInput,
  type AgentRole,
  type AgentRunContext,
  type AgentRunner,
  type AgentRunResult,
} from './runner.ts';

export type FakeRun = readonly AgentEventInput[] | Error;
export type FakeRunnerScript = Partial<Record<AgentRole, readonly FakeRun[]>>;

/** Deterministic, queue-based runner for scheduler simulations and unit tests. */
export class FakeRunner implements AgentRunner {
  readonly calls: AgentRunContext[] = [];
  private readonly script: Map<AgentRole, FakeRun[]>;

  constructor(script: FakeRunnerScript = {}) {
    this.script = new Map(
      Object.entries(script).map(([role, runs]) => [role as AgentRole, [...(runs ?? [])]]),
    );
  }

  enqueue(role: AgentRole, ...runs: FakeRun[]): void {
    const queue = this.script.get(role) ?? [];
    queue.push(...runs);
    this.script.set(role, queue);
  }

  async start(ctx: AgentRunContext): Promise<AgentRunResult> {
    const role = parseAgentRole(ctx.role);
    this.calls.push(ctx);
    const run = this.script.get(role)?.shift();
    if (run === undefined) throw new Error(`FakeRunner has no scripted ${role} run`);
    if (run instanceof Error) throw run;

    const runId = newId('run');
    const contents = run.map((event) => JSON.stringify(event)).join('\n');
    return {
      events: ingestAgentEventLines(contents, ctx, role, runId),
      exitCode: 0,
      transcriptPath: join(ctx.workdir, '.particle', 'runs', runId, 'transcript.log'),
    };
  }
}
