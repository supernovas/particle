import type { Actor, Message, Project, ProjectStatus, Task, Turn } from '../types';

/**
 * The self-build story: particle's real first day, replayed as workspace
 * states. Every beat is something that actually happened in this repo —
 * issue #1 at 20:06 UTC through the live product — compressed to ~15s.
 */

export const TL_ACTORS: Record<string, Actor> = Object.fromEntries(
  (
    [
      { kind: 'human', id: 'drx', name: 'drx', handle: 'drx', hue: 250, online: true },
      {
        kind: 'human',
        id: 'kate',
        name: 'wildkakapo',
        handle: 'wildkakapo',
        hue: 340,
        online: true,
      },
      { kind: 'app', id: 'particle', name: 'particle' },
      { kind: 'agent', id: 'planner', name: 'planner', role: 'planner' },
      { kind: 'agent', id: 'codex-1', name: 'codex-1', role: 'implementer' },
      { kind: 'agent', id: 'codex-2', name: 'codex-2', role: 'implementer' },
      { kind: 'agent', id: 'codex-3', name: 'codex-3', role: 'implementer' },
      { kind: 'agent', id: 'codex-4', name: 'codex-4', role: 'implementer' },
      { kind: 'agent', id: 'codex-5', name: 'codex-5', role: 'implementer' },
      { kind: 'agent', id: 'codex-6', name: 'codex-6', role: 'implementer' },
      { kind: 'agent', id: 'codex-7', name: 'codex-7', role: 'implementer' },
      { kind: 'agent', id: 'greptile', name: 'greptile', role: 'reviewer' },
    ] satisfies Actor[]
  ).map((a) => [a.id, a]),
);

const CH = 'github-issues';

function project(
  id: string,
  title: string,
  status: ProjectStatus,
  startedBy: string,
  opts: { issue?: number; tasks?: Task[]; watchers?: string[]; round?: number } = {},
): Project {
  return {
    id,
    title,
    ref: '',
    channelId: CH,
    status,
    startedBy,
    issue: opts.issue,
    round: opts.round ?? 1,
    tasks: opts.tasks ?? [],
    diff: { files: 0, additions: 0, deletions: 0 },
    watchers: opts.watchers ?? [startedBy],
  };
}

export interface Beat {
  caption: string;
  focus?: string;
  messages?: Message[];
  turns?: Turn[];
  projects?: Project[];
  /** status patches applied to already-visible projects */
  patch?: Array<{ id: string; status: ProjectStatus }>;
}

let n = 0;
const id = (p: string) => `${p}-${++n}`;

const P1_TASKS: Array<[string, string, string]> = [
  ['p1-core', 'P1.T2 — harden the event model & fold', 'codex-1'],
  ['p1-git', 'P1.T3 — git ref store with CAS appends', 'codex-2'],
  ['p1-github', 'P1.T4 — bidirectional issue↔project mirror', 'codex-3'],
  ['p1-worker', 'P1.T5 — worker daemon: scheduler & turns', 'codex-4'],
  ['p1-runner', 'P1.T6 — agent runner & role prompts', 'codex-5'],
  ['p1-cli', 'P1.T7 — particle CLI', 'codex-6'],
  ['p1-spec', 'P1.T8 — SPEC v1 & conformance corpus', 'codex-7'],
];

export const BEATS: Beat[] = [
  {
    caption: '20:06 UTC — a repo and a prompt',
    focus: 'bootstrap',
    projects: [
      project('bootstrap', 'Bootstrap Particle', 'open', 'drx', {
        issue: 1,
        watchers: ['drx', 'kate'],
      }),
    ],
    messages: [
      {
        id: id('m'),
        channelId: CH,
        authorId: 'drx',
        time: '20:06',
        text: 'In the beginning was the Prompt',
        projectId: 'bootstrap',
      },
    ],
    turns: [
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'drx',
        kind: 'comment',
        time: '20:06',
        title: 'In the beginning was the Prompt',
      },
    ],
  },
  {
    caption: 'the vision lands as a thread',
    turns: [
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'drx',
        kind: 'comment',
        time: '20:15',
        title:
          'a massively multiplayer harness: your whole org prompts in shared channels. planner → implementers → adversarial reviewer, looping to a fixed point. git is the backend — every project an append-only ref.',
      },
    ],
  },
  {
    caption: 'a planner splits it into parallel tasks',
    turns: [
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'planner',
        kind: 'plan',
        time: '20:31',
        title: 'Execution plan — phases 0–3',
        body: 'P0 bootstrap: worker loop, event model, spec draft\nP1 × 7 parallel tasks: core · git store · mirror · scheduler · runner · CLI · conformance\nP2 workspace UI · P3 Rust worker on GCP',
      },
    ],
    patch: [{ id: 'bootstrap', status: 'planning' }],
  },
  {
    caption: 'P0 — the worker bootstraps: events, clocks, deterministic folds',
    turns: [
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'codex-1',
        kind: 'commit',
        time: '20:52',
        title: 'worker: event loop and turn executor',
        meta: 'b3f10aa',
      },
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'codex-2',
        kind: 'commit',
        time: '20:58',
        title: 'core: lamport clocks, canonical order, fold',
        meta: 'f77c2d9',
      },
    ],
    patch: [{ id: 'bootstrap', status: 'executing' }],
  },
  {
    caption: 'seven agents pick up phase 1 — in parallel',
    projects: P1_TASKS.map(([pid, title, agent]) =>
      project(pid, title, 'executing', 'particle', {
        tasks: [
          {
            id: `${pid}-t`,
            title: title.split('— ')[1] ?? title,
            state: 'running',
            assignee: agent,
          },
        ],
        watchers: ['drx', 'kate'],
      }),
    ),
    messages: P1_TASKS.slice(0, 3).map(([pid, title]) => ({
      id: id('m'),
      channelId: CH,
      authorId: 'particle',
      time: '20:57',
      text: `Issue opened: “${title}”`,
      projectId: pid,
    })),
  },
  {
    caption: 'greptile reviews every PR — adversarially',
    focus: 'p1-github',
    turns: [
      {
        id: id('t'),
        projectId: 'p1-github',
        actorId: 'greptile',
        kind: 'review',
        time: '21:02',
        title: 'Review — changes requested (2)',
        body: 'Loop guard: bot comments must never round-trip into events.\nCursor misses comments on the first poll after a restart.',
      },
    ],
    patch: [{ id: 'p1-github', status: 'changes' }],
  },
  {
    caption: 'fixes land; reviews flip green',
    turns: [
      {
        id: id('t'),
        projectId: 'p1-github',
        actorId: 'codex-3',
        kind: 'commit',
        time: '21:07',
        title: 'adapter: loop guard + cursor replay fix',
        meta: 'e16f8d1',
      },
      {
        id: id('t'),
        projectId: 'p1-github',
        actorId: 'greptile',
        kind: 'review',
        time: '21:11',
        title: 'Review — approved',
      },
    ],
    patch: [
      { id: 'p1-core', status: 'converged' },
      { id: 'p1-github', status: 'review' },
      { id: 'p1-cli', status: 'converged' },
    ],
  },
  {
    caption: 'the workspace UI ships — the one you are looking at',
    focus: 'ui',
    projects: [
      project('ui', 'UI groundwork', 'executing', 'kate', { issue: 2, watchers: ['kate', 'drx'] }),
    ],
    messages: [
      {
        id: id('m'),
        channelId: CH,
        authorId: 'particle',
        time: '21:19',
        text: 'Issue #2 opened: “UI groundwork”',
        projectId: 'ui',
      },
    ],
    turns: [
      {
        id: id('t'),
        projectId: 'ui',
        actorId: 'particle',
        kind: 'commit',
        time: '21:24',
        title: 'ui: three-pane workspace — channels, chat, transcripts',
        meta: 'PR #24',
      },
    ],
  },
  {
    caption: 'the UI connects live — real projects, real transcripts, SSE',
    turns: [
      {
        id: id('t'),
        projectId: 'ui',
        actorId: 'particle',
        kind: 'commit',
        time: '21:41',
        title: 'ui: live workspace over /api + SSE; replies post into the log',
        meta: 'PR #29',
      },
    ],
    patch: [{ id: 'ui', status: 'converged' }],
  },
  {
    caption: 'a CLI and a Rust worker on GCP take shape',
    patch: [
      { id: 'p1-worker', status: 'review' },
      { id: 'p1-git', status: 'review' },
      { id: 'p1-spec', status: 'review' },
    ],
    turns: [
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'codex-4',
        kind: 'commit',
        time: '21:52',
        title: 'p3: rust worker + gcp runtime groundwork',
        meta: 'f16ab16',
      },
    ],
  },
  {
    caption: 'agents opened the PRs; humans owned the merge button',
    focus: 'bootstrap',
    turns: [
      {
        id: id('t'),
        projectId: 'bootstrap',
        actorId: 'kate',
        kind: 'status',
        time: '21:55',
        title: 'merged 12 pull requests',
      },
    ],
  },
  {
    caption: 'one day: zero → a working product',
    patch: [
      { id: 'bootstrap', status: 'converged' },
      { id: 'p1-github', status: 'converged' },
      { id: 'p1-git', status: 'converged' },
      { id: 'p1-worker', status: 'converged' },
      { id: 'p1-runner', status: 'converged' },
      { id: 'p1-spec', status: 'converged' },
    ],
  },
  {
    caption: 'this deck is rendering inside that product',
  },
];

export interface TimelapseState {
  messages: Message[];
  turns: Turn[];
  projects: Project[];
  focus: string;
  caption: string;
}

/** Fold beats 0..index into a renderable workspace state. */
export function timelapseState(index: number): TimelapseState {
  const state: TimelapseState = {
    messages: [],
    turns: [],
    projects: [],
    focus: 'bootstrap',
    caption: '',
  };
  for (let i = 0; i <= Math.min(index, BEATS.length - 1); i++) {
    const beat = BEATS[i]!;
    if (beat.projects) state.projects = [...state.projects, ...beat.projects];
    if (beat.messages) state.messages = [...state.messages, ...beat.messages];
    if (beat.turns) state.turns = [...state.turns, ...beat.turns];
    if (beat.patch) {
      for (const patch of beat.patch) {
        state.projects = state.projects.map((p) =>
          p.id === patch.id ? { ...p, status: patch.status } : p,
        );
      }
    }
    if (beat.focus) state.focus = beat.focus;
    state.caption = beat.caption;
  }
  return state;
}
