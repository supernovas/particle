# Particle — Execution Plan

Particle is a self-recursive, multiplayer agent harness: a coding/working harness like the
single-player agent CLIs, but built for whole teams. Everyone in a company — founders, sales,
engineers, designers, PMs — writes prompts in a shared chat space. Projects run as threads,
agents plan/implement/review in a loop until a fixed point, and everything is backed by git.

This plan was produced for [#1](https://github.com/supernovas/particle/issues/1) and is the
working source of truth. It will be revised by follow-up projects (particle dogfoods itself:
this repo is its own host workspace).

## 1. Concepts

| Concept   | Meaning                                                           | Backed by                                                             |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Workspace | An org's chat space (all channels + members)                      | A git repo (this one, for us)                                         |
| Channel   | `#eng`, `#product`, `#project-titan`, `#github-issues`            | Config in `particle.yaml`                                             |
| Project   | One thread in a channel; the unit of work                         | A family of git refs under `refs/particle/<project-id>/`              |
| Event     | One immutable fact: a message, a task claim, a review verdict     | A JSON blob committed to a project ref                                |
| Actor     | A human (`github:drx`) or an agent run (`agent:planner/run_01J…`) | Its own single-writer ref per project                                 |
| Role      | planner / implementer / reviewer (extensible)                     | Prompt templates + scheduling rules in the repo                       |
| Worker    | Daemon that runs turns, spawns agents, mirrors channels           | Phase 1: TypeScript (`npm run particle-worker`); Phase 3: Rust on GCP |
| Runner    | Adapter that executes one agent turn                              | Subprocess wrapping any headless agent CLI                            |

## 2. The git backend: an event-log CRDT

The failure mode to design out: two actors pushing to one branch and clobbering each other.
Particle avoids merges on the write path entirely:

1. **Project state is an append-only event log.** Events are immutable JSON documents; project
   state (messages, tasks, reviews, status) is a deterministic fold over the event _set_.
2. **Every actor writes only to its own ref**: `refs/particle/<project-id>/actors/<actor>`.
   Single writer per ref ⇒ every push is a fast-forward, enforced with compare-and-swap
   (`--force-with-lease`). Nobody can overwrite anyone else's work — git rejects it.
3. **A materializer folds all actor logs into a view ref** (`refs/particle/<project-id>/view`)
   with an octopus commit whose parents are the actor tips. Events form a grow-only set;
   ordering is a deterministic total order (lamport clock, then actor id, then event id), so
   the fold commutes: any worker that has the same events produces a **byte-identical** view
   commit. Convergence without coordination — the CRDT property.
4. **Integrity is inherited from git**: every log is a hash chain, so history is tamper-evident;
   signed commits per actor land in Phase 4.

The normative protocol lives in [`docs/SPEC.md`](./SPEC.md). It is the contract the Phase 3
Rust worker will be written against, with cross-implementation conformance fixtures.

## 3. The project loop (fixed-point iteration)

```
prompt (human or agent, in a thread)
  → planner: detailed execution plan, split into parallelizable tasks
  → implementers: claim tasks, work in isolated git worktrees, emit artifacts (PRs)
  → reviewer: adversarial review; approve | request_changes (+ comments)
  → request_changes reopens tasks → implementers …
  → fixed point: all tasks done ∧ latest review approves ⇒ project converged
```

Guardrails: review cycles are capped (default 3) before the project escalates to humans;
agents open PRs but humans hold merge authority until reviewer agents earn a track record.

## 4. Phases

### Phase 0 — Bootstrap (this project)

GitHub App registered (`particle-agent`, id 4694898, installed on this repo), repo scaffolded,
plan + spec drafted, minimal worker running. Exit: `npm i && npm run particle-worker` tails
this issue as a live project.

### Phase 1 — Single-node loop (`npm run particle-worker`)

Everything needed for one dev machine to run real projects end to end from GitHub issues.
Tasks below; all are parallelizable except where deps are noted. Exit criteria: an issue
labeled `particle:project` gets planned, implemented via PRs, reviewed, and converges with no
human in the loop except merges.

| Task  | Title                                                             | Depends on       | Issue             |
| ----- | ----------------------------------------------------------------- | ---------------- | ----------------- |
| P1.T2 | `@particle/core` — event model & deterministic fold (harden)      | —                | tracked on GitHub |
| P1.T3 | `@particle/git` — ref store: CAS appends, octopus view, worktrees | T2 types         | "                 |
| P1.T4 | GitHub channel adapter — bidirectional issue↔project mirror       | T2 types         | "                 |
| P1.T5 | Worker daemon — scheduler & turn loop                             | T2–T4 interfaces | "                 |
| P1.T6 | Agent runner — subprocess adapter + role prompts                  | T2 types         | "                 |
| P1.T7 | `particle` CLI — init/status/log/post for local driving           | T2, T3           | "                 |
| P1.T8 | SPEC v1 + conformance fixture corpus                              | T2, T3           | "                 |

T2 ships its type surface first (it already exists in skeleton form from Phase 0), which
unblocks T3–T7 to proceed in parallel. Per-task junior-executable plans live in
[`docs/tasks/`](./tasks/) and are mirrored into the tracking issues.

### Phase 2 — Multiplayer chat surface

Particle's own Slack-_like_ chat UI (not a Slack integration) — three panes: channel/project
list, chat window, detailed transcript. Design groundwork is
[#2](https://github.com/supernovas/particle/issues/2); the UI is a `ChannelAdapter` client of
the same event log. Plus identity mapping (chat user ↔ github login ↔ actor id) and
permissions v0. Exit: a non-engineer starts a project from the chat UI and watches it
converge.

### Phase 3 — `particle-worker` in Rust on GCP

Rust implementation of SPEC v1 (same refs, same bytes — proven by the T8 conformance corpus),
container-isolated task workspaces, VM image + Terraform, horizontal scaling of agent runs.
The TS worker remains as the local dev harness. Exit: this repo's projects run on a GCP VM
with the laptop closed.

### Phase 4 — Hardening

Signed events (commit signatures per actor), quotas and budgets, redaction story for
public-repo workspaces, audit views, multi-repo workspaces, custom roles beyond
planner/implementer/reviewer.

## 5. Risks

- **Materializer determinism drift** between TS and Rust — mitigated by making SPEC normative
  early and testing both against one fixture corpus (T8).
- **Prompt/feedback loops** (bot triggering itself) — mirror rules exclude bot-authored
  comments from becoming prompts; every mirrored message carries provenance (`via`).
- **Ref namespace abuse on the host repo** — `refs/particle/*` is invisible to normal git UX;
  document it, and add server-side protections when GitHub permits.
- **Runaway agents** — per-project budgets, capped review cycles, humans hold merge.

## 6. Resolved questions

Asked and answered in the thread on
[#1](https://github.com/supernovas/particle/issues/1):

1. Chat surface: Particle ships its **own** Slack-like UI (three-pane; see
   [#2](https://github.com/supernovas/particle/issues/2)) — Slack was only an analogy.
2. Agent CLI: reference runner targets **codex, reusing the operator's OAuth login**
   ("bring your own harness"); the adapter stays CLI-agnostic. Researching the
   auth-reuse mechanics is part of P1.T6.
3. Public event logs on this repo: **yes** — with care: nothing embarrassing, and never leak
   anything from personal machines (paths, tokens, private context) into events or comments.
4. Budgets confirmed: 1 planner run, 1 implementer per task, 3 review cycles, then escalate.
5. License: **MIT**.
6. GCP project/billing: TBD — ask when Phase 3 needs it.

Identifier style (suggestion round): TypeID-style prefixed ids — `prj_…`, `evt_…`, `tsk_…`,
`run_…` — keeping ULID time-sortability under the prefix.
