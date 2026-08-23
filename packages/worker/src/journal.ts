import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ParticleEvent } from '@particle/core';

export interface EventStore {
  load(): Promise<ParticleEvent[]>;
  append(events: ParticleEvent[]): Promise<void>;
}

/**
 * Phase-0 stand-in for the git ref store (P1.T3): an append-only NDJSON event
 * journal on disk. Same events, same fold — only the transport is temporary.
 */
export class Journal implements EventStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async load(): Promise<ParticleEvent[]> {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as ParticleEvent);
  }

  async append(events: ParticleEvent[]): Promise<void> {
    if (events.length === 0) return;
    appendFileSync(this.path, events.map((e) => JSON.stringify(e) + '\n').join(''));
  }
}
