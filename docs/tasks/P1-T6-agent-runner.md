# P1.T6 — Agent runner & role prompts

**Depends on:** T2 type surface. **Parallel with:** T2–T5, T7, T8.

## Context

Particle is agent-CLI-agnostic: any headless agent CLI (invoked as a subprocess) can serve as
the brain of a role. The issue thread calls the roles planner / implementer / reviewer. This
task builds the adapter that turns "start a planner for project X" into a subprocess with the
right prompt and workspace, and parses what comes back into particle events.

## Goal

`packages/worker/src/runner/` with a clean interface, one subprocess implementation, and the
v0 role prompt templates. The reference configuration is **codex with the operator's OAuth
login** ("bring your own harness"): part of this task is researching and documenting how the
CLI's stored login (its auth file / keychain entry) can be reused by a subprocess spawned
from the worker — what env/home it needs, what must never be copied into a task workspace or
event log — written up in `docs/runners/codex.md` alongside a working `runner.command`
example.

## Deliverables

```ts
// runner/runner.ts
export interface AgentRunContext {
  role: string;
  project: string;
  taskId?: string;
  state: ProjectState;
  workdir: string;
  promptPath: string;
}
export interface AgentRunResult {
  events: ParticleEvent[];
  exitCode: number;
  transcriptPath: string;
}
export interface AgentRunner {
  start(ctx: AgentRunContext): Promise<AgentRunResult>;
}
// runner/subprocess.ts
export class SubprocessRunner implements AgentRunner {
  /* runner.command from particle.yaml */
}
```

- **Command template** (`particle.yaml` → `runner.command`): array of argv strings; `{prompt}`
  is replaced by `promptPath`, `{workdir}` by the workspace directory. The subprocess runs
  with `cwd = workdir`, a 15-min default timeout (configurable), stdout/stderr captured to
  `transcriptPath` under `.particle/runs/<run-id>/`.
- **Role templates** (`roles/planner.md`, `roles/implementer.md`, `roles/reviewer.md` at repo
  root): each is a markdown prompt with `{{state}}` (canonical JSON of the folded project
  state) and `{{task}}` placeholders, and instructs the agent to write its output as **event
  JSON lines to a file named `events.ndjson` in the workdir** — planner: `task.created`
  events; implementer: `task.updated` + `artifact.linked`; reviewer: `review.posted`.
  Prompts must spell out the exact JSON shapes with one example each (copy from SPEC §4).
- **Result ingestion**: read `events.ndjson`, validate each line with `parseEvent` (T2),
  stamp `actor: agent:<role>/<run-id>` and fresh clocks server-side (never trust the
  agent's own envelope — only its `type` + `data`), reject anything not in the role's
  allowed-event table:

  | role        | may emit                                            |
  | ----------- | --------------------------------------------------- |
  | planner     | `plan.proposed`, `task.created`, `message.posted`   |
  | implementer | `task.updated`, `artifact.linked`, `message.posted` |
  | reviewer    | `review.posted`, `message.posted`                   |

- A `FakeRunner` for tests (scriptable: role → canned events), exported for T5's simulations.

## Step-by-step

1. Read SPEC §4 and `types.ts`; write the allowed-events table as data, not ifs.
2. `subprocess.ts` with `child_process.spawn` (argv array, never `shell: true`), timeout →
   SIGTERM then SIGKILL, transcript teeing.
3. Template rendering: trivial `{{var}}` string replacement, no template library.
4. Write the three role prompts. Treat them as code: precise output contract, no filler.
5. Tests: FakeRunner-based unit tests for ingestion (valid lines pass; envelope fields are
   overwritten; disallowed types rejected per role; malformed line → run fails with a clear
   error naming the line number). One integration test using `node -e` as the "agent CLI"
   writing a canned `events.ndjson`.

## Acceptance criteria

- With `runner.command: ["node", "test/fake-agent.js", "{prompt}"]`, a planner run on a
  sample state produces validated `task.created` events attributed to
  `agent:planner/<run-id>` with server-side clocks.
- Timeout kills the subprocess tree and surfaces a failed run, not a hang.
- A reviewer emitting `task.created` is rejected (role table enforced).
- `npm run typecheck && npm test` green; no real agent CLI required in CI.

## Out of scope

Scheduling policy (T5), container isolation (Phase 3), streaming/interactive runs.
