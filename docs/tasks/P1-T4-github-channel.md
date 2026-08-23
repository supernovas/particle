# P1.T4 — GitHub channel adapter (bidirectional)

**Depends on:** T2 type surface. **Parallel with:** T2, T3, T6, T7, T8.

## Context

Phase 0 has the read side only (`packages/worker/src/github/issues.ts`): poll issues, turn
human comments into prompts, guard against reading our own bot's comments. This task
completes the adapter into the reusable `ChannelAdapter` shape that Slack/Discord will
implement in Phase 2, and adds the write side (mirroring agent messages back to the thread).

## Goal

A `ChannelAdapter` interface plus a complete GitHub-issues implementation, extracted into
`packages/worker/src/channels/`, with mirroring that can never feed back on itself.

## Deliverables

```ts
// packages/worker/src/channels/adapter.ts
export interface InboundMessage {
  projectKey: string;
  title: string;
  author: string;
  body: string;
  via: string;
  at: string;
}
export interface ChannelAdapter {
  readonly name: string; // "github-issues"
  poll(): Promise<InboundMessage[]>; // cursor persistence is internal
  /** Mirror a project event outward. Must be idempotent per event id. */
  deliver(projectKey: string, event: ParticleEvent<MessagePosted>): Promise<void>;
}
```

- `channels/github.ts`: today's `IssueChannel` refactored to implement it. Cursor moves
  inside the adapter (path passed in constructor).
- Mirroring rules (SPEC §7): deliver only agent-authored `message.posted`; skip any event
  whose `via` already points at this channel (it came _from_ here); prefix mirrored bodies
  with the acting agent, e.g. `**planner** · <one-line>` — the app identity already marks it
  as particle. Record delivered event ids in the cursor file so restarts never double-post.
- Config: `mirror: true|false` per channel already parses in `config.ts`; honor it.
- Rate limiting: batch `deliver` calls with ≥1s spacing; on `403` with
  `x-ratelimit-remaining: 0`, sleep until `x-ratelimit-reset`.
- Pagination: follow `Link` headers on issue and comment listings — the Phase-0 poller reads
  only the first page (100 items), which silently drops older threads once a project outgrows
  it (the founding issue will).
- Comment-edit semantics: v0 ignores edits/deletes (an edited comment does not re-prompt);
  note this in a code comment.

## Step-by-step

1. Read SPEC §7 and the existing `issues.ts` + `main.ts` wiring.
2. Introduce `channels/adapter.ts`; move `issues.ts` → `channels/github.ts`, adapting to the
   interface; keep the loop guard (`<slug>[bot]` never becomes a prompt) — add a test for it
   using recorded API fixtures (JSON files under `test/fixtures/`, fetch mocked).
3. Add `deliver` with the idempotence ledger in the cursor file.
4. Wire `main.ts` to call `deliver` for agent events when `mirror` is on.
5. Fixture-based tests: poll fixtures (issue + comments incl. bot comments), deliver twice →
   one POST; `via` loop-guard test.

## Acceptance criteria

- With `mirror: false` (default) behavior is unchanged from Phase 0.
- With `mirror: true`, an agent `message.posted` appears exactly once as an issue comment,
  attributed to the role, even across worker restarts and repeated polls.
- A comment authored by the app never becomes an `InboundMessage`; an event with `via`
  pointing at the issue never gets delivered back to it. (Both proven by tests.)
- `npm run typecheck && npm test` green; tests run offline (mocked fetch).

## Out of scope

Webhooks (later revision of SPEC §7), Slack/Discord (Phase 2), reactions/edits, scheduling.
