# P1.T7 — `particle` CLI

**Depends on:** T2 (on main); `log`/`post` reach full power with T3 but start on the journal.
**Parallel with:** T2–T6, T8.

## Context

GitHub issues are the first channel, but developing Particle by commenting on issues is slow.
The CLI is the local channel: start projects, post prompts, inspect state — same event log,
no GitHub round-trip. It is also what Phase-2 chat surfaces imitate.

## Goal

A new workspace package `packages/cli` exposing a `particle` bin (wired via the root
`package.json` `"bin"` or `npm exec particle`), with four subcommands.

## Deliverables

```
particle init                       # verify repo + .particle/ creds + particle.yaml; friendly diagnostics
particle post [--project <key>] <text>   # new project (or append) via a chat-channel event
particle status [<key>]             # table: key, title, msgs, tasks done/total, status
particle log <key> [--json]         # canonical-order event log, human or NDJSON
```

- Implementation style: no CLI framework; hand-rolled argv parsing (`util.parseArgs`) — keep
  deps at zero beyond workspace packages.
- `post` emits `project.created` (source `{kind:"chat", channel:"#cli"}`) + `message.posted`
  with `actor: github:<login>` resolved from `git config user.name`/GitHub `gh auth` if
  present, else `github:local`.
- Storage: same store the worker uses — Phase-0 journal via a shared `openStore()` helper you
  extract from `main.ts`, so the CLI and worker read/write identically; when T3 merges,
  `openStore()` switches both to `RefStore` in one place.
- `status`/`log` must render from a _fold_, never from raw journal order (canonical order,
  SPEC §4.2).
- Human `log` format: `lamport  actor  type  one-line-summary`, `--json` = NDJSON of full
  events.

## Step-by-step

1. Extract `openStore()` from `packages/worker/src/main.ts` into a small shared module (tiny
   PR touching worker; coordinate on the tracking issue so it lands early for everyone).
2. Scaffold `packages/cli` mirroring `packages/worker` layout; add to root workspaces
   (already globbed) and root `"bin": {"particle": "packages/cli/src/main.ts"}` via `tsx`
   shim or a `#!/usr/bin/env npx tsx` header — verify `npm exec particle status` works from
   a fresh clone.
3. Implement subcommands as `commands/<name>.ts`, each an
   `async (args: string[]) => number` returning the exit code.
4. Tests: run commands in-process against a temp `.particle/` dir; assert exit codes, journal
   contents, and rendered tables (snapshot the table output).

## Acceptance criteria

- Fresh clone: `npm i && npm exec particle init` reports what's missing and exits non-zero;
  after `create-github-app.mjs`, exits 0.
- `particle post "try the widget"` then `particle status` shows the new project; the running
  worker picks it up on its next fold (shared store).
- `particle log gh-1` on this repo prints the founding thread in canonical order.
- `npm run typecheck && npm test` green.

## Out of scope

Mutating GitHub (that's the channel adapter's job), TUI/watch mode, auth management.
