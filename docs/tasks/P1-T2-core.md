# P1.T2 — Harden `@particle/core`

**Depends on:** nothing (the Phase-0 skeleton is in place). **Parallel with:** T3–T8.

## Context

`packages/core` already contains the event envelope (`types.ts`), lamport clock + canonical
ordering (`clock.ts`), ULIDs (`ulid.ts`), and a deterministic fold (`fold.ts`) with
permutation-invariance tests. It is the type surface every other task imports. This task
turns the skeleton into the trustworthy kernel of the protocol.

## Goal

Anything can hand `@particle/core` a pile of event JSON of unknown provenance and get back
either a validated, deterministic project state or a precise error — never a corrupted fold.

## Deliverables

1. **Validation** — `src/validate.ts`:
   ```ts
   export function parseEvent(json: unknown): ParticleEvent; // throws EventValidationError
   export function isEvent(json: unknown): json is ParticleEvent;
   export class EventValidationError extends Error {
     /** JSON-path of the offending field, e.g. "clock.lamport" */
     readonly path: string;
   }
   ```
   Hand-rolled structural checks (no schema dependency yet): envelope fields, id shape
   (`evt_`/`prj_` prefix + 26-char Crockford ULID, SPEC §2), actor id shape, ISO-8601
   `wall`, per-type payload checks
   for every type in the v0 catalog. Unknown `type` values pass envelope validation and are
   preserved (SPEC §4.1 forward-compat rule).
2. **Canonical JSON** — `src/canonical.ts`:
   ```ts
   export function canonicalJson(value: unknown): string; // sorted keys, LF, trailing \n
   ```
   This is the encoding SPEC §6 requires for `state.json` and event files; the Rust worker
   must reproduce it byte-for-byte, so keep the rules dead simple and documented in the file.
3. **Fold completion** — extend `fold.ts` to apply `plan.proposed` and `review.requested`
   (currently ignored), and export `foldMany(events)` grouping by `project` id into
   `Map<string, ProjectState>`.
4. **Serializable state** — `stateToJson(state)` / round-trip type so `ProjectState`
   (currently holds a `Set`) has a canonical JSON form for SPEC §6.

## Step-by-step

1. Read `docs/SPEC.md` §4 (events, ordering) and the existing `packages/core/src/*.ts`.
2. Write `validate.ts` top-down: envelope first, then a `switch` per event type delegating to
   small `checkX(data, path)` helpers. Every failure throws `EventValidationError` with the
   JSON-path.
3. Write `canonical.ts` (recursive: objects → sorted keys; arrays in order; numbers via
   `JSON.stringify`; reject `undefined`/`NaN`/`Infinity` with clear errors).
4. Extend the fold; keep `apply` private and pure-per-state as it is now.
5. Tests (see below), then update `src/index.ts` exports.

## Acceptance criteria

- `parseEvent` accepts every event the Phase-0 worker journals (`.particle/journal.ndjson`)
  and rejects each of: missing field, bad ULID, bad actor, lamport ≤ 0, wall not ISO,
  payload/type mismatch — with the correct `path`.
- `canonicalJson({b:1,a:[{d:2,c:3}]})` === `'{"a":[{"c":3,"d":2}],"b":1}\n'`.
- All existing tests keep passing; permutation-invariance test extended to cover the two
  newly folded event types.
- `npm run typecheck && npm test` green.

## Tests (add to `packages/core/test/`)

- `validate.test.ts`: table-driven good/bad events, `path` assertions.
- `canonical.test.ts`: ordering, nesting, unicode, rejection cases.
- Extend `fold.test.ts` per above.

## Out of scope

Git I/O (T3), any network, zod/schema-library migration (note as a future consideration in
code comments only if you feel strongly).
