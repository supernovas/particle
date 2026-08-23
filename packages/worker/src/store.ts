import { join } from 'node:path';
import { Journal, type EventStore } from './journal.ts';

/**
 * Open Particle's current event store.
 *
 * Keeping this boundary shared by the worker and local clients means the
 * Phase-0 journal can be replaced by the git ref store without creating two
 * storage paths.
 */
export function openStore(stateDir = '.particle'): EventStore {
  return new Journal(join(stateDir, 'journal.ndjson'));
}

export type { EventStore } from './journal.ts';
