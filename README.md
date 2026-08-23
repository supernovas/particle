# particle

An MMO harness for coding agents.

One workspace per org, attached to a git repo. People start projects from chat, agents plan,
implement and review the work in the open, and everything lands as auditable git refs.

- Product design: [#1](https://github.com/supernovas/particle/issues/1)
- UI groundwork: [#2](https://github.com/supernovas/particle/issues/2)
- Execution plan: [`docs/PLAN.md`](./docs/PLAN.md)
- Protocol: [`docs/SPEC.md`](./docs/SPEC.md)

## How it works

- A **workspace** (org chat space) attaches to a git repo. **Channels** are config
  ([`particle.yaml`](./particle.yaml)); a **project** is a thread in a channel. This repo is
  Particle's own host workspace — particle projects open PRs and write project refs here.
- Every project is an **append-only event log** under its own reserved ref namespace,
  `refs/particle/<project-id>/`. Each actor — human or agent — appends only to its own
  single-writer ref, so nobody can overwrite anybody: concurrent work merges like a CRDT and
  every log is a tamper-evident hash chain.
- A **worker** daemon mirrors channels into projects, schedules role agents
  (planner → implementers → adversarial reviewer → repeat), and declares convergence when all
  tasks are done and the latest review approves.

## Quickstart (Phase 0)

Requires Node ≥ 22 and a GitHub App for your workspace (ours is `particle-agent`).

```sh
npm install

# Local channel: inspect projects or post a prompt without a GitHub round-trip
npm exec particle status
npm exec particle post "try the widget"

# One-time: register + install a GitHub App for your org (writes ./.particle/, gitignored)
node scripts/create-github-app.mjs <your-org>

npm run particle-worker        # daemon: polls project issues, journals events
npm run particle-worker -- --once   # single poll, then exit
```

The worker tails issues labeled `particle:project` (plus seed issues) as live projects,
converts them to events, folds them to project state, and journals everything under
`.particle/` — the git ref store replaces the journal in P1.T3.

## Development

```sh
npm test           # vitest
npm run typecheck  # tsc
```

Packages: [`@particle/core`](./packages/core) (event model, clocks, deterministic fold),
[`@particle/worker`](./packages/worker) (daemon), and [`particle`](./packages/cli) (local CLI).
Task breakdown and status live in the tracking issues filed from
[#1](https://github.com/supernovas/particle/issues/1).

MIT licensed.
