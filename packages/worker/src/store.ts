import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RefStore } from '@particle/git';
import { GitEventStore } from './git-store.ts';
import { Journal, type EventStore } from './journal.ts';

export interface StoreOptions {
  /** "owner/name" of the host repo; enables remote sync for the git store. */
  hostRepo?: string;
  /** Called before each remote sync; used to refresh push credentials. */
  beforeSync?: () => Promise<void>;
}

/**
 * Open Particle's current event store.
 *
 * Keeping this boundary shared by the worker and local clients means every
 * consumer switches storage in one place. `PARTICLE_STORE=git` selects the
 * SPEC §3 ref store — state as refs/particle/* in a local bare repo, synced
 * with the host repo — and anything else selects the Phase-0 journal.
 */
export function openStore(stateDir = '.particle', options: StoreOptions = {}): EventStore {
  if (process.env.PARTICLE_STORE === 'git') {
    return openGitStore(stateDir, options);
  }
  return new Journal(join(stateDir, 'journal.ndjson'));
}

function openGitStore(stateDir: string, options: StoreOptions): EventStore {
  const gitDir = join(stateDir, 'store.git');
  if (!existsSync(gitDir)) {
    mkdirSync(stateDir, { recursive: true });
    execFileSync('git', ['init', '--bare', '--quiet', gitDir]);
  }
  const remote = options.hostRepo ? `https://github.com/${options.hostRepo}.git` : undefined;
  return new GitEventStore(new RefStore({ gitDir, remote }), options.beforeSync);
}

export type { EventStore } from './journal.ts';
