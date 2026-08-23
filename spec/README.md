# Particle SPEC v1 conformance corpus

This directory is the executable definition of Particle Protocol SPEC v1. An implementation
is conformant when it accepts every `fixtures/*/events/*.json` document, derives the exact
bytes in `expected/state.json` and `expected/order.txt`, and, for cases containing
`expected/view.txt`, derives that exact lowercase SHA-1 view commit id from the parent tips in
`case.json`. Input filenames preserve a deliberately non-canonical delivery order; they are
not protocol paths.

Run the TypeScript implementation with `npm run conformance`. The ordinary `npm test` suite
runs the same check. Expectations are normative review artifacts, not snapshots to update in
response to an implementation failure.

Only a protocol change may regenerate the corpus, and that change MUST update `docs/SPEC.md`
in the same pull request. Use `npm run conformance:bless`; the command requires the explicit
`--bless` flag through its script definition. Review the resulting JSON and Git object SHA
bytes before commit.

The envelope `v` is independent of the document's SPEC revision. SPEC v1 retains `v: 0`.
When an incompatible envelope or fold change is necessary, new events MUST use `v: 1`, and
new versioned fixtures MUST be added alongside these v0 fixtures. Existing fixtures are never
rewritten or removed merely because a newer envelope exists; an implementation may advertise
which envelope versions it supports.

`spec/codec.ts` is a small, independent reference for canonical event input generation and raw
Git-object assembly. The runner uses `@particle/core`'s `canonicalJson`, `stateToJson`, and
`parseEvent` exports directly. The raw-object path makes the octopus SHA portable and
reviewable without a worktree or Git configuration. After P1.T3 is integrated, its final gate
is to replay the materialization fixture through `RefStore.materialize` and compare the same
tree, commit headers, and SHA.
