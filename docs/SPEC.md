# Particle Protocol — SPEC v1

Status: **normative**. The conformance corpus for this revision is `spec/fixtures/`.
Normative terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are interpreted as in RFC 2119.

## 1. Design goals

1. **No lost updates.** Two actors working on one project cannot overwrite one another, even
   when they write concurrently from different machines.
2. **Convergence without coordination.** Any replicas holding the same valid event set and
   actor tips compute byte-identical project state and view commits.
3. **Integrity.** Project history is tamper-evident by construction.
4. **Plain Git.** Any Git host works as the backend; no server-side extension is required.

## 2. Identifiers and text ordering

A Particle id is `<prefix>_<ulid>`. The prefixes are `prj` (project), `evt` (event), `tsk`
(task), and `run` (agent run). A ULID is exactly 26 uppercase Crockford Base32 characters
from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; its first character is `0` through `7`. Examples in
the conformance corpus use deterministic ULIDs, but producers SHOULD generate monotonic ULIDs.

An actor id is `github:<login>` for a human or `agent:<role>/<run-id>` for an agent run. Actor
ids and event ids contain only ASCII. Every ordering of refs, actors, ids, or paths specified
below is ascending unsigned UTF-8 byte order. An actor ref slug replaces every `:` and `/` in
the actor id with `-`.

See `concurrent-lamport-actor-tiebreak` and `concurrent-lamport-id-tiebreak`.

## 3. Ref namespace

All state for one project lives in these reserved refs:

```text
refs/particle/<project-id>/meta                  birth certificate (one commit)
refs/particle/<project-id>/actors/<actor-slug>   one append-only log per actor
refs/particle/<project-id>/view                  materialized fold of all actor logs
```

Implementations MUST fetch and push this namespace with explicit refspecs such as
`refs/particle/*:refs/particle/*`. These refs deliberately do not live under `refs/heads/`.

## 4. Events

An event is one immutable canonical JSON document as defined by §4.3, encoded as UTF-8 without
a BOM. SPEC v1 uses envelope version `v: 0`:

```json
{
  "v": 0,
  "id": "evt_00000000000000000000000002",
  "type": "message.posted",
  "project": "prj_00000000000000000000000001",
  "actor": "github:drx",
  "clock": { "lamport": 42, "wall": "2026-08-23T20:00:00.000Z" },
  "parents": ["evt_00000000000000000000000001"],
  "data": { "body": "hello" }
}
```

`clock.lamport` is a positive safe integer. `clock.wall` is a valid ISO 8601 UTC timestamp in
the exact form `YYYY-MM-DDTHH:mm:ss.sssZ`; wall time is informational and MUST NOT affect event
ordering. `parents` lists event ids this event causally follows. A validator MUST reject a
malformed known envelope or known payload before the event reaches the fold.

### 4.1 Event catalog for envelope v0

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

Unknown non-empty type strings MUST pass envelope validation, remain in event storage and
canonical order, and be ignored by v0 folds. See `unknown-event-type`.

### 4.2 Total order and duplicate ids

Events form a grow-only set. A sequence MUST be produced by sorting ascending on:

1. `clock.lamport` numerically;
2. `actor` by §2 byte order; then
3. `id` by §2 byte order.

After sorting, an implementation MUST retain only the first occurrence of each event id.
Repeated documents with one id MUST be byte-identical; two different documents claiming the
same id make the event set invalid and MUST be rejected. This removes input-arrival order as a
hidden tie-break. See `duplicate-event-ids`, `concurrent-lamport-actor-tiebreak`, and
`concurrent-lamport-id-tiebreak`.

### 4.3 Canonical JSON

Canonical JSON accepts only null, booleans, strings, finite IEEE-754 binary64 numbers, dense
arrays, and plain string-keyed objects. It MUST reject `undefined`, holes in arrays, NaN,
positive or negative infinity, bigint, symbols, functions, cycles, class instances, maps,
sets, dates, and other host-language values outside that data model.

The encoder MUST produce these exact bytes:

- Object keys are sorted recursively by ascending UTF-16 code-unit order, matching the
  ECMAScript default string sort. Arrays retain their input order. No insignificant spaces
  are emitted.
- Strings use the ECMAScript `JSON.stringify` string algorithm: `"`, `\`, and control
  characters are escaped; the short forms `\b`, `\t`, `\n`, `\f`, and `\r` are used;
  remaining U+0000 through U+001F code points use lowercase four-digit `\u` escapes;
  well-formed non-ASCII Unicode is emitted directly as UTF-8; lone surrogate code units use
  lowercase `\uXXXX` escapes.
- Finite numbers use the ECMAScript `Number::toString` shortest round-tripping decimal form.
  Negative zero is `0`. Lowercase `e` is used for exponent notation and a positive exponent
  includes `+`. Magnitudes from 1e-6 inclusive through 1e21 exclusive use ordinary decimal
  notation as prescribed by that algorithm.
- The top-level value is followed by exactly one LF byte (`0a`). No BOM or other trailing
  bytes are permitted.

Thus `{b:1,a:[{d:2,c:3}]}` encodes as
`{"a":[{"c":3,"d":2}],"b":1}\n`. See `unicode-escaping`; every JSON file in the corpus is
also checked for canonical bytes.

### 4.4 Normative fold and state document

The fold starts with the state below, where `<project>` is the requested project id:

```json
{
  "artifacts": [],
  "clock": 0,
  "id": "<project>",
  "messages": [],
  "seen": [],
  "status": "open",
  "tasks": {},
  "title": ""
}
```

Events for another project are ignored. For retained events of the requested project, the
fold first records the id in `seen` and sets `clock` to the maximum Lamport value observed,
then applies the following rules in canonical order:

- `project.created` replaces `title` and `source`.
- `message.posted` appends `{id, actor, body, at}` to `messages`, where `at` is `clock.wall`;
  it includes `via` only when the payload includes it.
- `plan.proposed` replaces `plan` with `{summary, taskIds}`.
- `task.created` inserts `{id, title, spec, deps, status:"open"}` only if its `taskId` is not
  already present.
- `task.claimed` changes an existing open task to `claimed` and sets `assignee`; claims after
  the first successful canonical claim are no-ops.
- `task.updated` changes `status` only when its actor is the task's assignee.
- `review.requested` replaces `reviewRequested` with `{taskIds}`.
- `review.posted` replaces `lastReview` with `{verdict, by, at}`.
- `artifact.linked` appends its `{kind, locator}` payload to `artifacts`.
- `project.status` replaces `status`.
- Unknown types have no state effect beyond `seen` and `clock`.

The serialized state is the state object with `seen` converted to an ascending id array. Its
required fields are `id`, `title`, `status`, `messages`, `tasks`, `artifacts`, `clock`, and
`seen`; `source`, `plan`, `reviewRequested`, and `lastReview` are omitted when absent. It MUST
be encoded using §4.3. See `empty-project`, `single-actor-happy-path`, `claim-race`,
`review-reject-reopen-approve`, and `large-log-1000`.

## 5. Append protocol

Each actor MUST append only to its own actor ref. An append commit tree is cumulative and
contains one canonical file per retained event at `events/<event-id>.json`. One-event commit
messages are `particle: <type> <event-id>`; batch messages are `particle: batch <n> events`.
The message has exactly one trailing LF.

Local ref updates MUST use compare-and-swap, equivalent to
`git update-ref <ref> <new> <expected-old>`. Remote pushes MUST use an explicit
`--force-with-lease=<ref>:<expected-tip>`. A rejected actor-ref update indicates a stale or
misconfigured second writer and MUST fail without changing the ref. The write path MUST NOT
create merge commits or rebase existing actor history. Before appending, an actor SHOULD fetch
the other project refs and advance its Lamport clock past every event it observed.

## 6. Materialized view

The view ref is a replaceable cache. A materializer collects the tips of every
`refs/particle/<project>/actors/*` ref, reads and validates their event union, deduplicates and
folds it under §4, and writes one Git commit with the recipe below.

### 6.1 Tree

The root tree contains exactly:

- `state.json`, mode `100644`, whose blob is the canonical state document; and
- `events`, mode `040000`, whose tree contains one `100644` blob named `<event-id>.json` for
  every retained event, encoded as canonical JSON.

Tree entry names use §2 byte ordering. There are no extra files. See `octopus-determinism`.

### 6.2 Commit

The commit MUST use SHA-1 Git object framing and these fields in this exact order:

1. `tree <root-tree-sha>`;
2. one `parent <actor-tip-sha>` line per actor tip, ordered by the actor ref's full name;
3. `author particle <particle@supernova.ai> <seconds> +0000`;
4. `committer particle <particle@supernova.ai> <seconds> +0000`;
5. one blank line;
6. `particle: materialize <project-id>` followed by one LF.

`<seconds>` is the integer Unix timestamp obtained from the lexically greatest valid
`clock.wall` in the retained event set; ISO UTC timestamps have fixed width, so lexical and
chronological order agree. Author and committer timestamps are identical. Parent order MUST
NOT depend on discovery order or SHA. The `octopus-determinism` fixture supplies explicit
actor-ref parent tips and pins the resulting commit id in `expected/view.txt`.

Materializing identical events and actor tips MUST produce the same commit id on every
platform. A view update uses compare-and-swap. Losing a view CAS is benign when the winning
commit represents the same event set or a superset; implementations SHOULD read the winner
before retrying.

## 7. GitHub issue channel mirroring

An issue labeled `particle:project`, or configured as a seed issue, maps one-to-one to a
project. The issue body and human comments become `message.posted` events whose `via` is the
source URL. Comments authored by the workspace's own app (`<slug>[bot]`) MUST NOT become
events. An event whose `via` already names the mirror destination MUST NOT be mirrored back.
Outbound mirroring occurs only when that channel has `mirror: true`.

## 8. Convergence

A project is converged exactly when at least one task exists, every task has status `done`,
and the latest `review.posted` in canonical order has verdict `approve`. A worker that reaches
this fixed point emits `project.status {"status":"converged"}`. See
`single-actor-happy-path` and `review-reject-reopen-approve`.

## 9. Versioning and deferred work

The envelope `v` changes only for an incompatible event-envelope, payload, ordering, or fold
change. Such a change MUST introduce `v: 1` events and new fixtures alongside the v0 fixtures;
it MUST NOT rewrite the meaning of already accepted v0 events. Additive unknown event types
do not require a bump because §4.1 preserves them.

Commit signatures and actor-key policy, compaction and checkpoints, garbage collection,
redaction in public workspaces, push-based channel adapters, multi-repo workspaces, fuzzing,
and signature-verification fixtures are deferred to later revisions.

## 10. Conformance

An implementation conforms to Particle Protocol SPEC v1 if and only if, for every case in
`spec/fixtures/`, it:

1. accepts every valid event document and preserves its exact canonical value;
2. emits the exact bytes in `expected/order.txt` and `expected/state.json`; and
3. when `expected/view.txt` exists, emits that exact lowercase view commit id from the parent
   tips in `case.json`.

Implementations MAY use any internal representation, but platform, locale, filesystem
enumeration order, input delivery order, and Git configuration MUST NOT change outputs. A
corpus expectation may be regenerated only with `spec/gen.ts --bless` in the same reviewed
change that updates this normative document. Passing only implementation unit tests is not a
substitute for passing the committed corpus.
