import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ParticleEvent } from '@particle/core';

/**
 * Phase-0 stand-in for the git ref store (P1.T3): an append-only NDJSON event
 * journal on disk. Same events, same fold — only the transport is temporary.
 */
export class Journal {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): ParticleEvent[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as ParticleEvent);
  }

  append(events: ParticleEvent[]): void {
    if (events.length === 0) return;
    appendFileSync(this.path, events.map((e) => JSON.stringify(e) + '\n').join(''));
  }
}
