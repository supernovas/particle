# P1.T8 — SPEC v1 + conformance fixture corpus

**Depends on:** T2 (canonical JSON), T3 (materializer) — final numbers; drafting and corpus
scaffolding can start immediately. **Parallel with:** everything.

## Context

`docs/SPEC.md` is a v0 draft tracking the TS implementation. Phase 3 reimplements the worker
in Rust, and the two must produce **byte-identical** materializations (SPEC §1 goal 2). The
only way that survives contact with reality is an executable spec: a corpus of fixtures that
any implementation must reproduce exactly. This task promotes the SPEC to v1 (normative) and
builds that corpus.

## Goal

`spec/fixtures/` in this repo + a runner such that "passes the corpus" is the definition of
"implements Particle", for this and every future implementation.

## Deliverables

1. **Fixture corpus** — `spec/fixtures/<case-name>/`:
   - `events/*.json` — input events (canonical JSON)
   - `expected/state.json` — folded state (canonical JSON)
   - `expected/order.txt` — event ids in canonical order, one per line
   - `expected/view.txt` — materialized view commit sha (cases that involve git)
   - `case.md` — one paragraph: what property this case pins down
     Required cases (at minimum): empty project; single actor happy path; concurrent lamport
     ties (actor/id tiebreaks); duplicate event ids; unknown event type preserved; claim race;
     review reject→reopen→approve; unicode + escaping in bodies; large-ish log (1k events);
     octopus determinism (3 actors, shuffled input).
2. **TS corpus runner** — `spec/run-conformance.ts` (wired into `npm test`): for every case,
   run fold/order (and materialize where `view.txt` exists) and diff against `expected/`.
   A `--bless` flag regenerates expectations (used only when the SPEC itself changes, in the
   same PR as the SPEC change).
3. **SPEC v1** — edit `docs/SPEC.md`: resolve every DRAFT marker, specify canonical JSON
   byte-precisely (T2's rules), specify the view-commit recipe field-by-field (exact author/
   committer strings, date format with timezone, tree layout, parent ordering), add §10
   "Conformance": an implementation is conformant iff the corpus passes.
4. **Version pinning** — corpus README states SPEC version; envelope `v` bump policy
   (breaking change ⇒ `v: 1` events + new fixtures alongside old).

## Step-by-step

1. Start from `packages/core/test/fold.test.ts` — each property test becomes a fixture case
   (generated once, committed as files, human-reviewed).
2. Write a small `spec/gen.ts` used with `--bless` to produce expectations _from the TS
   implementation_, then hand-check a sample against the SPEC text (the point is to catch
   spec/implementation drift, so actually read the bytes).
3. Corpus runner + CI wiring.
4. SPEC editing pass last, with the corpus open in the other pane; every normative "MUST"
   should point at a case name that pins it.

## Acceptance criteria

- `npm test` fails if anyone changes fold/ordering/canonical-JSON behavior without
  `--bless`-ing fixtures in the same PR (verified by mutating a comparator locally).
- The 10+ required cases exist, each with a `case.md` rationale.
- `docs/SPEC.md` carries `v1` status, no DRAFT markers, and a Conformance section; a
  hypothetical Rust implementer needs no access to the TS source to match bytes.
- Materialization cases reproduce identical shas on macOS and Linux CI.

## Out of scope

The Rust implementation itself (Phase 3), fuzzing (nice-to-have; note as follow-up),
signature verification cases (Phase 4).
