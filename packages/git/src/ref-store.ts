import {
  canonicalJson,
  compareEvents,
  fold,
  parseEvent,
  stateToJson,
  type ActorId,
  type ParticleEvent,
  type ProjectCreated,
  type ProjectState,
} from '@particle/core';
import { randomBytes } from 'node:crypto';
import { GitError, run } from './git.ts';

const PARTICLE_PREFIX = 'refs/particle/';
const PROJECT_ID = /^prj_[0-9A-HJKMNP-TV-Z]{26}$/;
const ZERO_SHA1 = '0'.repeat(40);
const FIXED_ENV = {
  GIT_AUTHOR_NAME: 'particle',
  GIT_AUTHOR_EMAIL: 'particle@supernova.ai',
  GIT_COMMITTER_NAME: 'particle',
  GIT_COMMITTER_EMAIL: 'particle@supernova.ai',
};

export interface RefStoreOptions {
  gitDir: string;
  remote?: string;
}

export interface SyncRefResult {
  ref: string;
  sha: string;
  status: 'accepted' | 'rejected';
  error?: string;
}

export interface SyncReport {
  /** Remote refs incorporated into the local store. */
  fetched: string[];
  /** One result for every local Particle ref offered to the remote. */
  pushed: SyncRefResult[];
}

export class StaleRefError extends Error {
  readonly ref: string;

  constructor(ref: string, cause?: unknown) {
    super(`stale Particle ref: ${ref}`, { cause });
    this.name = 'StaleRefError';
    this.ref = ref;
  }
}

interface RefTip {
  ref: string;
  sha: string;
}

interface EventFile {
  event: ParticleEvent;
  json: string;
}

export class RefStore {
  readonly gitDir: string;
  readonly remote?: string;

  constructor(options: RefStoreOptions) {
    if (!options.gitDir) throw new TypeError('gitDir is required');
    this.gitDir = options.gitDir;
    this.remote = options.remote;
  }

  /** Append a batch without checking out or modifying a worktree. */
  async append(project: string, actor: ActorId, events: ParticleEvent[]): Promise<string> {
    assertProject(project);
    if (events.length === 0) throw new TypeError('append requires at least one event');

    const ref = actorRef(project, actor);
    await this.assertValidRef(ref);
    const expected = await this.readRef(ref);
    const files = expected ? await this.readEventFiles(expected) : new Map<string, EventFile>();

    let changed = false;
    for (const value of events) {
      const event = parseEvent(value);
      if (event.project !== project)
        throw new TypeError(`event ${event.id} belongs to ${event.project}`);
      if (event.actor !== actor)
        throw new TypeError(`event ${event.id} belongs to actor ${event.actor}`);
      const json = canonicalJson(event);
      const prior = files.get(event.id);
      if (prior) {
        if (prior.json !== json)
          throw new TypeError(`event id ${event.id} already has different content`);
        continue;
      }
      files.set(event.id, { event, json });
      changed = true;
    }

    if (!changed && expected) return expected;
    const tree = await this.writeEventRoot(files);
    const message =
      events.length === 1
        ? `particle: ${events[0]!.type} ${events[0]!.id}\n`
        : `particle: batch ${events.length} events\n`;
    const date = maxWall([...files.values()].map(({ event }) => event));
    const commit = await this.commitTree(tree, expected ? [expected] : [], message, date);
    try {
      await run(this.gitDir, ['update-ref', ref, commit, expected ?? (await this.zeroOid())]);
    } catch (error) {
      throw new StaleRefError(ref, error);
    }
    return commit;
  }

  /** Read and validate every event from actor logs and the project birth certificate. */
  async readEvents(project: string): Promise<ParticleEvent[]> {
    assertProject(project);
    const refs = await this.listRefs(`${PARTICLE_PREFIX}${project}/`);
    const files: EventFile[] = [];
    for (const tip of refs) {
      if (tip.ref.endsWith('/view')) continue;
      files.push(...(await this.readEventFiles(tip.sha)).values());
    }

    files.sort((a, b) => compareEvents(a.event, b.event));
    const seen = new Set<string>();
    const events: ParticleEvent[] = [];
    for (const file of files) {
      if (seen.has(file.event.id)) continue;
      seen.add(file.event.id);
      events.push(file.event);
    }
    return events;
  }

  async listProjects(): Promise<string[]> {
    const refs = await this.listRefs(PARTICLE_PREFIX);
    const projects = new Set<string>();
    for (const { ref } of refs) {
      const project = ref.slice(PARTICLE_PREFIX.length).split('/', 1)[0];
      if (project && PROJECT_ID.test(project)) projects.add(project);
    }
    return [...projects].sort();
  }

  async createProject(value: ParticleEvent<ProjectCreated>): Promise<void> {
    const event = parseEvent(value) as ParticleEvent<ProjectCreated>;
    if (event.type !== 'project.created')
      throw new TypeError('createProject requires project.created');
    assertProject(event.project);
    const ref = `${PARTICLE_PREFIX}${event.project}/meta`;
    await this.assertValidRef(ref);
    const current = await this.readRef(ref);
    if (current) {
      const existing = await this.readEventFiles(current);
      const match = existing.get(event.id);
      if (match?.json === canonicalJson(event) && existing.size === 1) return;
      throw new StaleRefError(ref);
    }

    const files = new Map([[event.id, { event, json: canonicalJson(event) }]]);
    const tree = await this.writeEventRoot(files);
    const commit = await this.commitTree(
      tree,
      [],
      `particle: project.created ${event.id}\n`,
      event.clock.wall,
    );
    try {
      await run(this.gitDir, ['update-ref', ref, commit, await this.zeroOid()]);
    } catch (error) {
      throw new StaleRefError(ref, error);
    }
  }

  async sync(project?: string): Promise<SyncReport> {
    if (!this.remote) throw new Error('sync requires a remote');
    if (project) assertProject(project);
    const prefix = project ? `${PARTICLE_PREFIX}${project}/` : PARTICLE_PREFIX;
    const remotePattern = project ? `${prefix}*` : `${PARTICLE_PREFIX}*`;
    const token = randomBytes(8).toString('hex');
    const staging = `refs/particle-sync/${token}/`;
    const fetched: string[] = [];
    const stagedRefs: string[] = [];

    try {
      const advertised = parseLsRemote(
        await run(this.gitDir, ['ls-remote', this.remote, remotePattern]),
      );
      if (advertised.length > 0) {
        const refspecs = advertised.map(({ ref }) => {
          const staged = `${staging}${ref.slice(PARTICLE_PREFIX.length)}`;
          stagedRefs.push(staged);
          return `+${ref}:${staged}`;
        });
        await run(this.gitDir, ['fetch', '--no-tags', this.remote, ...refspecs]);
      }

      const remoteTips = new Map<string, string>();
      for (const staged of stagedRefs) {
        const sha = await this.readRef(staged);
        if (!sha) continue;
        const ref = `${PARTICLE_PREFIX}${staged.slice(staging.length)}`;
        remoteTips.set(ref, sha);
        fetched.push(ref);
        await this.integrateFetchedRef(ref, sha);
      }

      const pushed: SyncRefResult[] = [];
      for (const { ref, sha } of await this.listRefs(prefix)) {
        const expected = remoteTips.get(ref) ?? '';
        try {
          await run(this.gitDir, [
            'push',
            this.remote,
            `--force-with-lease=${ref}:${expected}`,
            `${ref}:${ref}`,
          ]);
          pushed.push({ ref, sha, status: 'accepted' });
        } catch (error) {
          pushed.push({
            ref,
            sha,
            status: 'rejected',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { fetched: fetched.sort(), pushed };
    } finally {
      for (const ref of stagedRefs) {
        try {
          await run(this.gitDir, ['update-ref', '-d', ref]);
        } catch {
          // Staging refs are disposable and never part of the Particle namespace.
        }
      }
    }
  }

  async materialize(project: string): Promise<{ sha: string; state: ProjectState }> {
    assertProject(project);
    const viewRef = `${PARTICLE_PREFIX}${project}/view`;
    await this.assertValidRef(viewRef);

    for (let attempt = 0; attempt < 3; attempt++) {
      const actorTips = (await this.listRefs(`${PARTICLE_PREFIX}${project}/actors/`)).sort((a, b) =>
        byteCompare(a.ref, b.ref),
      );
      if (actorTips.length === 0) throw new Error(`project ${project} has no actor refs`);
      const events = await this.readEvents(project);
      if (events.length === 0) throw new Error(`project ${project} has no events`);
      const state = fold(project, events);
      const files = new Map(
        events.map((event) => [event.id, { event, json: canonicalJson(event) }]),
      );
      const eventsTree = await this.writeEventsTree(files);
      const stateBlob = await this.writeBlob(canonicalJson(stateToJson(state)));
      const tree = await this.writeTree([
        { mode: '040000', type: 'tree', sha: eventsTree, name: 'events' },
        { mode: '100644', type: 'blob', sha: stateBlob, name: 'state.json' },
      ]);
      const sha = await this.commitTree(
        tree,
        actorTips.map(({ sha }) => sha),
        `particle: materialize ${project}\n`,
        maxWall(events),
      );
      const expected = await this.readRef(viewRef);
      if (expected === sha) return { sha, state };
      try {
        await run(this.gitDir, ['update-ref', viewRef, sha, expected ?? (await this.zeroOid())]);
        return { sha, state };
      } catch (error) {
        const winner = await this.readRef(viewRef);
        if (winner === sha) return { sha, state };
        if (attempt === 2) throw new StaleRefError(viewRef, error);
      }
    }
    throw new StaleRefError(viewRef);
  }

  private async integrateFetchedRef(ref: string, remoteSha: string): Promise<void> {
    const localSha = await this.readRef(ref);
    if (!localSha) {
      await run(this.gitDir, ['update-ref', ref, remoteSha, await this.zeroOid()]);
      return;
    }
    if (localSha === remoteSha) return;
    // The view is a replaceable cache, not an append-only actor history. A
    // remote materialization with a different octopus parent set therefore
    // supersedes the local cache even when neither commit is an ancestor.
    if (ref.endsWith('/view')) {
      try {
        await run(this.gitDir, ['update-ref', ref, remoteSha, localSha]);
      } catch (error) {
        throw new StaleRefError(ref, error);
      }
      return;
    }
    if (await this.isAncestor(remoteSha, localSha)) return;
    if (await this.isAncestor(localSha, remoteSha)) {
      try {
        await run(this.gitDir, ['update-ref', ref, remoteSha, localSha]);
      } catch (error) {
        throw new StaleRefError(ref, error);
      }
      return;
    }
    throw new StaleRefError(ref);
  }

  private async isAncestor(older: string, newer: string): Promise<boolean> {
    try {
      await run(this.gitDir, ['merge-base', '--is-ancestor', older, newer]);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }

  private async readEventFiles(commit: string): Promise<Map<string, EventFile>> {
    const output = await run(this.gitDir, [
      'ls-tree',
      '-r',
      '-z',
      '--full-tree',
      commit,
      '--',
      'events',
    ]);
    const files = new Map<string, EventFile>();
    for (const entry of output.split('\0')) {
      if (!entry) continue;
      const match = /^100644 blob ([0-9a-f]+)\tevents\/([^/]+)\.json$/.exec(entry);
      if (!match) continue;
      const [, blob, id] = match;
      if (!blob || !id) continue;
      const json = await run(this.gitDir, ['cat-file', 'blob', blob]);
      const event = parseEvent(JSON.parse(json));
      if (event.id !== id) throw new Error(`event filename ${id} does not match id ${event.id}`);
      files.set(id, { event, json: canonicalJson(event) });
    }
    return files;
  }

  private async writeEventRoot(files: Map<string, EventFile>): Promise<string> {
    const eventsTree = await this.writeEventsTree(files);
    return this.writeTree([{ mode: '040000', type: 'tree', sha: eventsTree, name: 'events' }]);
  }

  private async writeEventsTree(files: Map<string, EventFile>): Promise<string> {
    const entries: TreeEntry[] = [];
    for (const [id, { json }] of [...files.entries()].sort(([a], [b]) => byteCompare(a, b))) {
      entries.push({
        mode: '100644',
        type: 'blob',
        sha: await this.writeBlob(json),
        name: `${id}.json`,
      });
    }
    return this.writeTree(entries);
  }

  private async writeBlob(input: string): Promise<string> {
    return (await run(this.gitDir, ['hash-object', '-w', '--stdin'], { input })).trim();
  }

  private async writeTree(entries: TreeEntry[]): Promise<string> {
    const input = [...entries]
      .sort((a, b) => byteCompare(a.name, b.name))
      .map(({ mode, type, sha, name }) => `${mode} ${type} ${sha}\t${name}\n`)
      .join('');
    return (await run(this.gitDir, ['mktree'], { input })).trim();
  }

  private async commitTree(
    tree: string,
    parents: string[],
    message: string,
    date: string,
  ): Promise<string> {
    const args = ['commit-tree', tree];
    for (const parent of parents) args.push('-p', parent);
    return (
      await run(this.gitDir, args, {
        input: message,
        env: {
          ...FIXED_ENV,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      })
    ).trim();
  }

  private async listRefs(prefix: string): Promise<RefTip[]> {
    const output = await run(this.gitDir, [
      'for-each-ref',
      '--format=%(refname)\t%(objectname)',
      prefix,
    ]);
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, sha] = line.split('\t');
        if (!ref || !sha) throw new Error(`invalid git ref output: ${line}`);
        return { ref, sha };
      });
  }

  private async readRef(ref: string): Promise<string | undefined> {
    try {
      return (await run(this.gitDir, ['rev-parse', '--verify', ref])).trim();
    } catch (error) {
      if (error instanceof GitError) return undefined;
      throw error;
    }
  }

  private async assertValidRef(ref: string): Promise<void> {
    await run(this.gitDir, ['check-ref-format', ref]);
  }

  private async zeroOid(): Promise<string> {
    const format = (await run(this.gitDir, ['rev-parse', '--show-object-format'])).trim();
    return format === 'sha256' ? '0'.repeat(64) : ZERO_SHA1;
  }
}

interface TreeEntry {
  mode: '040000' | '100644';
  type: 'tree' | 'blob';
  sha: string;
  name: string;
}

function actorRef(project: string, actor: ActorId): string {
  // Core accepts GitHub App logins such as dependabot[bot], while `[` is not
  // legal in a Git ref. Keep the SPEC slug for ordinary actors and percent-
  // encode the bracket suffix so every validated ActorId remains storable.
  const slug = actor.replace(/[:/]/g, '-').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  return `${PARTICLE_PREFIX}${project}/actors/${slug}`;
}

function assertProject(project: string): void {
  if (!PROJECT_ID.test(project)) throw new TypeError(`invalid project id: ${project}`);
}

function maxWall(events: ParticleEvent[]): string {
  if (events.length === 0) throw new TypeError('cannot choose a date without events');
  return events.reduce(
    (max, event) => (event.clock.wall > max ? event.clock.wall : max),
    events[0]!.clock.wall,
  );
}

function byteCompare(a: string, b: string): number {
  return Buffer.from(a).compare(Buffer.from(b));
}

function parseLsRemote(output: string): RefTip[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/, 2);
      if (!sha || !ref || !ref.startsWith(PARTICLE_PREFIX)) {
        throw new Error(`invalid ls-remote output: ${line}`);
      }
      return { ref, sha };
    });
}
