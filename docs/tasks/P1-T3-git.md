# P1.T3 — `@particle/git`: the ref store

**Depends on:** T2 type surface (already on main). **Parallel with:** T2, T4, T6, T7, T8.

## Context

Phase 0 journals events to `.particle/journal.ndjson`. The real backend is git
(SPEC §3, §5, §6): per-actor append-only refs under `refs/particle/<project>/…`, CAS pushes,
and a deterministic octopus "view" commit. This package makes that real and is the heart of
Particle's no-lost-updates guarantee.

## Goal

A new workspace package `packages/git` (`@particle/git`) that any process can use to append
events as an actor, sync with a remote, and materialize/verify view commits — implemented by
shelling out to the system `git` binary (do **not** use a reimplementation library; we need
exact ref/transport semantics).

## Deliverables

`packages/git/src/` with:

```ts
export interface RefStoreOptions {
  gitDir: string;
  remote?: string;
} // bare repo or .git
export class RefStore {
  constructor(opts: RefStoreOptions);
  /** Append a batch to this actor's log. CAS on the local ref; throws StaleRefError. */
  append(project: string, actor: ActorId, events: ParticleEvent[]): Promise<string>; // new tip sha
  /** All events for a project, deduped, from all actor refs (+ meta). */
  readEvents(project: string): Promise<ParticleEvent[]>;
  /** List project ids present under refs/particle/. */
  listProjects(): Promise<string[]>;
  /** Create refs/particle/<id>/meta from a project.created event. */
  createProject(event: ParticleEvent<ProjectCreated>): Promise<void>;
  /** Fetch/push refs/particle/* with the remote; push uses --force-with-lease per ref. */
  sync(project?: string): Promise<SyncReport>;
  /** Build (or verify byte-identical) the view commit per SPEC §6. */
  materialize(project: string): Promise<{ sha: string; state: ProjectState }>;
}
export class StaleRefError extends Error {}
```

Plus `worktrees.ts`:

```ts
/** Create/dispose an isolated worktree for a task, branch particle/<project>/<task>. */
export function createTaskWorktree(repoDir: string, project: string, task: string): Promise<string>;
export function removeTaskWorktree(repoDir: string, path: string): Promise<void>;
```

## Step-by-step

1. Read SPEC §3, §5, §6 carefully — they are the contract; where code and SPEC disagree,
   raise it on the tracking issue before improvising.
2. `git.ts`: tiny `run(gitDir, args, {input?})` wrapper over `child_process.execFile`
   (never a shell), with stderr captured into thrown errors.
3. Appending without touching any worktree: build blobs with `git hash-object -w --stdin`,
   trees with `git mktree`, commits with `git commit-tree`, then
   `git update-ref refs/particle/<p>/actors/<slug> <new> <expected-old>` — that last argument
   _is_ the CAS. Tree layout: `events/<event-id>.json` (canonical JSON from T2).
4. `readEvents`: `git ls-tree -r` each actor tip, `git cat-file blob`, `parseEvent` (T2),
   dedupe by id.
5. `materialize`: fold (T2), build tree (`state.json` + union of event files), create commit
   with parents = actor tips sorted by ref name, fixed identity `particle <particle@supernova.ai>`,
   `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` = max `clock.wall`. Verify determinism in tests by
   materializing twice/from shuffled inputs and comparing shas.
6. `sync`: explicit refspecs `refs/particle/*:refs/particle/*`; pushes per-ref with
   `--force-with-lease=<ref>:<expected>`; report accepted/rejected per ref.
7. Worktrees: `git worktree add <path> -b particle/<project>/<task>` from the default branch;
   removal with `git worktree remove --force` + branch cleanup.

## Acceptance criteria

- Two `RefStore`s on two clones of one bare "origin": both append concurrently to their own
  actor logs, both `sync`, both `readEvents` → identical event sets; both `materialize` →
  **identical view sha**.
- A deliberately stale `update-ref` expected-old throws `StaleRefError` and writes nothing.
- A kill at any step never corrupts refs (objects without ref updates are just garbage).
- `npm run typecheck && npm test` green; tests use temp dirs (`fs.mkdtemp`), no network.

## Out of scope

GitHub API (T4), scheduling (T5), webhook transport, signatures (Phase 4).
