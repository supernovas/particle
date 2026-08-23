import { parseArgs } from 'node:util';
import type { ParticleEvent } from '@particle/core';
import type { CommandContext } from '../context.ts';
import { loadProjects, storeFor } from '../projects.ts';

function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarize(event: ParticleEvent): string {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'project.created':
      return oneLine(data.title);
    case 'message.posted':
      return oneLine(data.body);
    case 'plan.proposed':
      return oneLine(data.summary);
    case 'task.created':
      return oneLine(data.title);
    case 'task.claimed':
      return oneLine(data.taskId);
    case 'task.updated':
      return `${oneLine(data.taskId)} ${oneLine(data.status)}${data.note ? ` — ${oneLine(data.note)}` : ''}`;
    case 'review.requested':
      return Array.isArray(data.taskIds) ? data.taskIds.join(', ') : '';
    case 'review.posted':
      return oneLine(data.verdict);
    case 'artifact.linked':
      return `${oneLine(data.kind)} ${oneLine(data.locator)}`;
    case 'project.status':
      return oneLine(data.status);
    default:
      return oneLine(JSON.stringify(event.data) ?? '');
  }
}

export async function log(args: string[], context: CommandContext): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { json: { type: 'boolean', default: false } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    context.stderr(`particle log: ${(error as Error).message}\n`);
    return 2;
  }
  if (parsed.positionals.length !== 1) {
    context.stderr('usage: particle log <key> [--json]\n');
    return 2;
  }
  const key = parsed.positionals[0]!;
  const project = loadProjects(storeFor(context)).find((item) => item.key === key);
  if (!project) {
    context.stderr(`particle log: project not found: ${key}\n`);
    return 1;
  }
  for (const event of project.events) {
    context.stdout(
      parsed.values.json
        ? `${JSON.stringify(event)}\n`
        : `${event.clock.lamport}  ${event.actor}  ${event.type}  ${summarize(event)}\n`,
    );
  }
  return 0;
}
