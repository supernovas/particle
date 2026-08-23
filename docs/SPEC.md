# Particle Protocol — SPEC v0 (DRAFT)

Status: **draft**. Becomes normative (v1) when P1.T8 lands, together with a conformance
fixture corpus that every implementation (TypeScript worker, Rust worker) must pass
byte-for-byte. Until then, this document tracks the implementation in `packages/core`.

## 1. Design goals

1. **No lost updates, ever.** Two actors working on one project must never be able to
   overwrite each other, even with concurrent writes from different machines.
2. **Convergence without coordination.** Any replica holding the same set of events computes
   the same project state and the same materialized view commit, bit for bit.
3. **Integrity.** Project history is tamper-evident by construction.
4. **Plain git.** Any git host works as the backend; no server-side extensions required.

## 2. Identifiers

- All particle ids are TypeID-style — `<prefix>_<ULID>` (ULID = 26-char Crockford base32,
  lexically time-sortable), e.g. `prj_01J8ZC3AH2V9FYQ6MZ0X7T4KDB`. Prefixes: `prj` project,
  `evt` event, `tsk` task, `run` agent run.
- **Actor id**: `github:<login>` for humans via GitHub, `agent:<role>/<run-id>` for agent
  runs. Actor ids are ordered as plain byte strings where ordering is needed.
- **Actor ref slug**: actor id with `:` and `/` replaced by `-` (e.g. `github-drx`,
  `agent-planner-01J8…`).

## 3. Ref namespace

All particle state for a project lives under a reserved namespace on the host repo:

```
refs/particle/<project-id>/meta                  birth certificate (one commit)
refs/particle/<project-id>/actors/<actor-slug>   one append-only log per actor
refs/particle/<project-id>/view                  materialized fold of all actor logs
```

These are deliberately not `refs/heads/*`: normal branch tooling never sees them, and they
can't collide with human branches. They are fetched/pushed with explicit refspecs, e.g.
`git fetch origin "refs/particle/*:refs/particle/*"`.

## 4. Events

An event is one immutable JSON document (UTF-8, no BOM):

```jsonc
{
  "v": 0, // envelope version
  "id": "evt_01J8ZC3…", // unique per event
  "type": "message.posted", // see catalog below
  "project": "prj_01J8ZBX…",
  "actor": "github:drx",
  "clock": {
    "lamport": 42, // max(observed lamports, own last) + 1
    "wall": "2026-08-23T20:00:00.000Z", // informational; NEVER used for ordering
  },
  "parents": ["evt_01J8ZC2…"], // event ids this event causally follows
  "data": {}, // type-specific payload
}
```

### 4.1 Event catalog (v0)

| Type               | Payload                       | Emitted by            |
| ------------------ | ----------------------------- | --------------------- |
| `project.created`  | `{title, source}`             | channel adapter / CLI |
| `message.posted`   | `{body, replyTo?, via?}`      | anyone                |
| `plan.proposed`    | `{summary, taskIds}`          | planner               |
| `task.created`     | `{taskId, title, spec, deps}` | planner               |
| `task.claimed`     | `{taskId}`                    | implementer           |
| `task.updated`     | `{taskId, status, note?}`     | assignee              |
| `review.requested` | `{taskIds}`                   | worker                |
| `review.posted`    | `{verdict, comments}`         | reviewer              |
| `artifact.linked`  | `{kind, locator}`             | anyone                |
| `project.status`   | `{status}`                    | worker                |

Unknown event types MUST be preserved and ignored by folds (forward compatibility).

### 4.2 Total order

Events are a **grow-only set**. Where a sequence is needed, the canonical order is:

1. `clock.lamport` ascending
2. `actor` ascending (byte order)
3. `id` ascending (byte order)

This orders any two distinct events deterministically, so every replica sorts identically.
Duplicate event ids are idempotent: the first instance in canonical order wins, later
instances are ignored.

## 5. Append protocol (write path)

- Each actor appends **only to its own ref**. Single writer per ref ⇒ appends are always
  fast-forward.
- One commit per batch of events. The commit tree contains the events of the log so far at
  `events/<event-id>.json`. Commit message: `particle: <type> <event-id>` (or
  `particle: batch <n> events`).
- Pushes use compare-and-swap: `git push --force-with-lease=<ref>:<expected-tip>` (or an
  atomic `update-ref` transaction locally). A rejected push means the local view of the ref
  is stale — which, on a single-writer ref, means a misconfigured second writer: fail loudly.
- Before appending, an actor SHOULD fetch the project's other refs and advance its lamport
  clock past everything observed.

**Invariant:** no merge commits ever appear on the write path. Nothing is rebased, nothing is
force-pushed except CAS-guarded fast-forwards, so no actor can destroy another's history.

## 6. Materialized view (read path)

The view ref is a cache; any worker may (re)build it, and all builds must agree:

- Collect all `actors/*` tips; fold their event sets per §4.2 into project state.
- Write a commit whose **parents are the actor tips sorted by ref name**, with tree:
  - `state.json` — the folded state, canonical JSON (sorted keys, LF, trailing newline)
  - `events/` — union of all event files
- Determinism requirements: fixed author/committer identity (`particle <particle@supernova.ai>`);
  author/committer date = the max `clock.wall` across folded events; canonical JSON encoding.
  Same events ⇒ **byte-identical commit ⇒ identical sha** — concurrent materializers
  cannot conflict.
- Push with CAS; losing a CAS race is benign (the winner wrote the same sha or a superset).

## 7. Channel mirroring (GitHub issues, v0)

- Issues labeled `particle:project` (plus configured seed issues) map 1:1 to projects; the
  issue body and each human comment become `message.posted` events with `via` = the comment
  URL (provenance).
- **Loop guard:** comments authored by the workspace's own app (`<slug>[bot]`) are never
  converted to events; events mirrored out carry `via`, and anything with `via` pointing at
  the mirror target is never mirrored back.
- Mirroring out (project → issue comments) is per-channel opt-in (`mirror: true`).

## 8. Convergence (fixed point)

A project is **converged** when its folded state satisfies: at least one task exists, every
task is `done`, and the latest `review.posted` (canonical order) has `verdict: approve`.
The worker then emits `project.status {status: "converged"}`.

## 9. Deferred to later revisions

- Commit signatures per actor; actor identity keys and verification policy (Phase 4).
- Compaction/checkpointing of long logs; garbage collection of abandoned projects.
- Redaction of events in public workspaces (Phase 4).
- Webhook (push-based) channel adapters; polling is v0.
- Multi-repo workspaces.
