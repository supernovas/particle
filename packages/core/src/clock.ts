import type { Clock, ParticleEvent } from './types.ts';

/** Next clock for an appender that has `observed` events and last wrote `prev`. */
export function nextClock(prev: Clock | undefined, observed: Clock[], wall: Date): Clock {
  let lamport = prev?.lamport ?? 0;
  for (const c of observed) if (c.lamport > lamport) lamport = c.lamport;
  return { lamport: lamport + 1, wall: wall.toISOString() };
}

/**
 * Total order over events: lamport, then actor, then id. Deterministic for any
 * two distinct events, so every replica sorts an event set identically.
 */
export function compareEvents(a: ParticleEvent, b: ParticleEvent): number {
  if (a.clock.lamport !== b.clock.lamport) return a.clock.lamport - b.clock.lamport;
  if (a.actor !== b.actor) return a.actor < b.actor ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
