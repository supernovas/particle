import { newId, parseEvent, type EventType, type ParticleEvent } from '@particle/core';
import type { AgentEventInput, AgentRole, AgentRunContext } from './runner.ts';

export const ALLOWED_EVENTS: Readonly<Record<AgentRole, ReadonlySet<EventType>>> = {
  planner: new Set<EventType>(['plan.proposed', 'task.created', 'message.posted']),
  implementer: new Set<EventType>(['task.updated', 'artifact.linked', 'message.posted']),
  reviewer: new Set<EventType>(['review.posted', 'message.posted']),
};

export class AgentEventIngestionError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    options?: ErrorOptions,
  ) {
    super(line === undefined ? message : `events.ndjson line ${line}: ${message}`, options);
    this.name = 'AgentEventIngestionError';
  }
}

export interface IngestionOptions {
  now?: () => Date;
  eventId?: () => string;
}

/**
 * Turns untrusted agent output into trusted Particle envelopes. Only `type` and
 * `data` cross the boundary; ids, project, actor, clocks, and parents are new.
 */
export function ingestAgentEventLines(
  contents: string,
  ctx: AgentRunContext,
  role: AgentRole,
  runId: string,
  options: IngestionOptions = {},
): ParticleEvent[] {
  const now = options.now ?? (() => new Date());
  const eventId = options.eventId ?? (() => newId('evt'));
  const events: ParticleEvent[] = [];
  let lamport = ctx.state.clock;

  for (const [index, line] of contents.split('\n').entries()) {
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let input: unknown;
    try {
      input = JSON.parse(line);
    } catch (cause) {
      throw new AgentEventIngestionError('invalid JSON', lineNumber, { cause });
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new AgentEventIngestionError('event must be a JSON object', lineNumber);
    }

    const candidate = input as Partial<AgentEventInput>;
    if (typeof candidate.type !== 'string') {
      throw new AgentEventIngestionError('event.type must be a string', lineNumber);
    }
    if (!ALLOWED_EVENTS[role].has(candidate.type as EventType)) {
      throw new AgentEventIngestionError(
        `role ${role} may not emit ${JSON.stringify(candidate.type)}`,
        lineNumber,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(candidate, 'data')) {
      throw new AgentEventIngestionError('event.data is required', lineNumber);
    }

    lamport += 1;
    const previous = events.at(-1);
    const stamped = {
      v: 0,
      id: eventId(),
      type: candidate.type,
      project: ctx.project,
      actor: `agent:${role}/${runId}`,
      clock: { lamport, wall: now().toISOString() },
      parents: previous ? [previous.id] : [...ctx.state.seen].sort(),
      data: candidate.data,
    };

    try {
      events.push(parseEvent(stamped));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new AgentEventIngestionError(`invalid ${candidate.type} event: ${detail}`, lineNumber, {
        cause,
      });
    }
  }

  return events;
}
