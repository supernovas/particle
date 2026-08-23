import type { Actor, ActorId, Channel, Message, Project, SimEvent, Turn } from './types';

/** Whose seat this prototype renders. */
export const CURRENT_USER: ActorId = 'ada';

export const REPO_URL = 'https://github.com/supernovas/particle';

const ACTOR_LIST: Actor[] = [
  { kind: 'human', id: 'mira', name: 'Mira Patel', handle: 'mira', hue: 340, online: true },
  { kind: 'human', id: 'jonas', name: 'Jonas Weber', handle: 'jonas', hue: 250, online: true },
  { kind: 'human', id: 'sam', name: 'Sam Torres', handle: 'sam', hue: 28 },
  { kind: 'human', id: 'ada', name: 'Ada Kravets', handle: 'ada', hue: 182, online: true },
  { kind: 'human', id: 'theo', name: 'Theo Lindqvist', handle: 'theo', hue: 210, online: true },
  { kind: 'human', id: 'nadia', name: 'Nadia Osei', handle: 'nadia', hue: 285 },
  { kind: 'human', id: 'priya', name: 'Priya Sharma', handle: 'priya', hue: 130, online: true },
  { kind: 'agent', id: 'planner', name: 'planner', role: 'planner' },
  { kind: 'agent', id: 'impl-1', name: 'impl-1', role: 'implementer' },
  { kind: 'agent', id: 'impl-2', name: 'impl-2', role: 'implementer' },
  { kind: 'agent', id: 'reviewer', name: 'reviewer', role: 'reviewer' },
  { kind: 'app', id: 'particle', name: 'particle' },
];

export const ACTORS: Record<ActorId, Actor> = Object.fromEntries(ACTOR_LIST.map((a) => [a.id, a]));

export const CHANNELS: Channel[] = [
  { id: 'particle', name: 'particle', topic: 'Building particle, with particle' },
  { id: 'eng', name: 'eng', topic: 'CI, infra, releases' },
  { id: 'product', name: 'product', topic: 'Roadmap, specs, launches', unread: 2 },
  { id: 'sales', name: 'sales', topic: 'Deals and demos' },
  {
    id: 'github-issues',
    name: 'github-issues',
    topic: 'Projects kicked off from GitHub issues',
    unread: 1,
  },
];

export const PROJECTS: Project[] = [
  {
    id: 'speed-up-ci',
    title: 'Speed up CI',
    ref: 'refs/particle/speed-up-ci',
    channelId: 'eng',
    status: 'implementing',
    startedBy: 'theo',
    round: 1,
    tasks: [
      {
        id: 't1',
        title: 'Cache dependency installs keyed on the lockfile',
        state: 'done',
        assignee: 'impl-1',
      },
      {
        id: 't2',
        title: 'Shard the e2e suite across three runners',
        state: 'done',
        assignee: 'impl-2',
      },
      { id: 't3', title: 'Per-shard test reporting', state: 'running', assignee: 'impl-1' },
      {
        id: 't4',
        title: 'Update contributor docs for the new pipeline',
        state: 'queued',
        assignee: 'impl-2',
      },
    ],
    diff: { files: 9, additions: 181, deletions: 96 },
    watchers: ['theo', 'ada', 'priya'],
  },
  {
    id: 'deflake-auth',
    title: 'Deflake the auth test suite',
    ref: 'refs/particle/deflake-auth',
    channelId: 'eng',
    status: 'merged',
    startedBy: 'ada',
    round: 2,
    tasks: [
      {
        id: 't1',
        title: 'Quarantine every spec that failed twice this week',
        state: 'done',
        assignee: 'impl-1',
      },
      { id: 't2', title: 'Fix the underlying races', state: 'done', assignee: 'impl-2' },
      { id: 't3', title: 'Empty the quarantine list', state: 'done', assignee: 'impl-1' },
    ],
    diff: { files: 5, additions: 64, deletions: 212 },
    watchers: ['ada', 'jonas'],
  },
  {
    id: 'bootstrap',
    title: 'Bootstrap Particle',
    ref: 'refs/particle/bootstrap',
    channelId: 'github-issues',
    status: 'implementing',
    startedBy: 'jonas',
    issue: 1,
    round: 1,
    tasks: [
      {
        id: 't1',
        title: 'Worker loop behind `npm run particle-worker`',
        state: 'running',
        assignee: 'impl-1',
      },
      {
        id: 't2',
        title: 'Append-only merge model for project refs',
        state: 'running',
        assignee: 'impl-2',
      },
      { id: 't3', title: 'GitHub App: issues → projects', state: 'queued' },
    ],
    diff: { files: 12, additions: 640, deletions: 0 },
    watchers: ['jonas', 'mira', 'ada'],
  },
  {
    id: 'ui-groundwork',
    title: 'UI groundwork',
    ref: 'refs/particle/ui-groundwork',
    channelId: 'github-issues',
    status: 'reviewing',
    startedBy: 'mira',
    issue: 2,
    round: 1,
    tasks: [
      { id: 't1', title: 'Three-pane workspace layout', state: 'done', assignee: 'impl-2' },
      { id: 't2', title: 'Project cards and transcript pane', state: 'done', assignee: 'impl-2' },
      { id: 't3', title: 'Design notes for the next pass', state: 'running', assignee: 'impl-1' },
    ],
    diff: { files: 16, additions: 1380, deletions: 22 },
    watchers: ['mira', 'nadia', 'jonas'],
  },
  {
    id: 'changelog-page',
    title: 'Public changelog page',
    ref: 'refs/particle/changelog-page',
    channelId: 'product',
    status: 'planning',
    startedBy: 'priya',
    round: 1,
    tasks: [],
    diff: { files: 0, additions: 0, deletions: 0 },
    watchers: ['priya', 'nadia'],
  },
  {
    id: 'demo-env',
    title: 'Refresh the demo environment',
    ref: 'refs/particle/demo-env',
    channelId: 'sales',
    status: 'planning',
    startedBy: 'sam',
    round: 1,
    tasks: [],
    diff: { files: 0, additions: 0, deletions: 0 },
    watchers: ['sam', 'mira'],
  },
];

export const MESSAGES: Message[] = [
  // #particle
  {
    id: 'p1',
    channelId: 'particle',
    authorId: 'jonas',
    time: '07:45',
    text: 'norms reminder: agents open the PRs, humans own the merge button. if a review loop goes past round 3, step in.',
  },
  {
    id: 'p2',
    channelId: 'particle',
    authorId: 'mira',
    time: '07:51',
    text: 'and every project is a ref — if a thread looks odd, fetch it and read the commits yourself.',
  },
  {
    id: 'p3',
    channelId: 'particle',
    authorId: 'ada',
    time: '07:54',
    text: 'the transcript pane makes that mostly unnecessary. mostly.',
  },

  // #eng
  {
    id: 'e1',
    channelId: 'eng',
    authorId: 'ada',
    time: '08:31',
    text: 'Deflake the auth suite: quarantine everything that failed twice this week, fix the underlying races, then empty the quarantine list.',
    projectId: 'deflake-auth',
  },
  {
    id: 'e2',
    channelId: 'eng',
    authorId: 'jonas',
    time: '08:58',
    text: 'zero auth flakes in the last 40 runs. nice.',
  },
  {
    id: 'e3',
    channelId: 'eng',
    authorId: 'theo',
    time: '09:02',
    text: 'morning — CI hit 14 minutes again on the release branch. almost all of it is dependency install plus the serial e2e run.',
  },
  {
    id: 'e4',
    channelId: 'eng',
    authorId: 'ada',
    time: '09:04',
    text: 'same on my branch. cache the installs and shard the e2e suite and it should drop under five.',
  },
  {
    id: 'e5',
    channelId: 'eng',
    authorId: 'theo',
    time: '09:06',
    text: 'Speed up CI: cache dependency installs keyed on the lockfile and shard the e2e suite across three runners. Do not touch the release workflow.',
    projectId: 'speed-up-ci',
  },
  {
    id: 'e6',
    channelId: 'eng',
    authorId: 'priya',
    time: '09:12',
    text: 'watching this one — release cut is thursday.',
  },

  // #product
  {
    id: 'pr1',
    channelId: 'product',
    authorId: 'priya',
    time: '08:40',
    text: 'changelog page is still on the launch list for next week. copy is ready, we just never had frontend time.',
  },
  {
    id: 'pr2',
    channelId: 'product',
    authorId: 'priya',
    time: '08:41',
    text: 'Public changelog page: render entries from changelog.md, match the marketing site header, ship behind /changelog.',
    projectId: 'changelog-page',
  },
  {
    id: 'pr3',
    channelId: 'product',
    authorId: 'nadia',
    time: '08:44',
    text: 'attaching spacing tokens in the thread so the implementers do not guess.',
  },

  // #sales
  {
    id: 's1',
    channelId: 'sales',
    authorId: 'sam',
    time: '07:58',
    text: 'prospect call at 3pm — the demo env still shows the old onboarding. can we refresh it without pulling an engineer in?',
  },
  {
    id: 's2',
    channelId: 'sales',
    authorId: 'mira',
    time: '08:01',
    text: 'that is what particle is for. write the prompt, watch the thread.',
  },
  {
    id: 's3',
    channelId: 'sales',
    authorId: 'sam',
    time: '08:03',
    text: 'Refresh the demo environment: latest main, seed the acme sandbox org, enable the new onboarding flow.',
    projectId: 'demo-env',
  },

  // #github-issues
  {
    id: 'g1',
    channelId: 'github-issues',
    authorId: 'particle',
    time: '08:12',
    text: 'Issue #1 opened: “Bootstrap Particle”. Started a project on refs/particle/bootstrap.',
    projectId: 'bootstrap',
  },
  {
    id: 'g2',
    channelId: 'github-issues',
    authorId: 'particle',
    time: '08:47',
    text: 'Issue #2 opened: “UI groundwork”. Started a project on refs/particle/ui-groundwork.',
    projectId: 'ui-groundwork',
  },
  {
    id: 'g3',
    channelId: 'github-issues',
    authorId: 'jonas',
    time: '08:52',
    text: 'self-hosting from day one — this repo is the host repo for itself.',
  },
];

export const TURNS: Turn[] = [
  // Speed up CI
  {
    id: 'c1',
    projectId: 'speed-up-ci',
    actorId: 'planner',
    kind: 'plan',
    time: '09:07',
    title: 'Execution plan — 4 tasks, 2 implementers',
    body: '1. Cache dependency installs keyed on the lockfile → impl‑1\n2. Shard the e2e suite across three runners → impl‑2\n3. Per-shard test reporting → impl‑1\n4. Update contributor docs for the new pipeline → impl‑2\n\nConstraint honored: the release workflow is untouched.',
  },
  {
    id: 'c2',
    projectId: 'speed-up-ci',
    actorId: 'impl-1',
    kind: 'commit',
    time: '09:14',
    title: 'ci: cache the package store keyed on the lockfile',
    meta: '9f3ce21 · +38 −12',
  },
  {
    id: 'c3',
    projectId: 'speed-up-ci',
    actorId: 'impl-2',
    kind: 'commit',
    time: '09:18',
    title: 'test: shard the e2e suite across three runners',
    meta: 'a41d02f · +97 −61',
  },
  {
    id: 'c4',
    projectId: 'speed-up-ci',
    actorId: 'impl-1',
    kind: 'action',
    time: '09:21',
    title: 'Workflow dry-run',
    body: 'Install step: 11m 02s → 2m 41s.\ne2e wall clock: 9m 44s → 3m 58s on three shards.',
  },

  // Deflake auth
  {
    id: 'f1',
    projectId: 'deflake-auth',
    actorId: 'planner',
    kind: 'plan',
    time: '08:32',
    title: 'Execution plan — 3 tasks',
    body: '1. Quarantine every spec that failed twice this week → impl‑1\n2. Fix the underlying races → impl‑2\n3. Empty the quarantine list once green → impl‑1',
  },
  {
    id: 'f2',
    projectId: 'deflake-auth',
    actorId: 'impl-1',
    kind: 'commit',
    time: '08:39',
    title: 'test: quarantine six flaky auth specs',
    meta: 'e01b332 · +12 −3',
  },
  {
    id: 'f3',
    projectId: 'deflake-auth',
    actorId: 'impl-2',
    kind: 'commit',
    time: '08:47',
    title: 'fix: await session rotation before asserting',
    meta: '5b8ac10 · +52 −209',
  },
  {
    id: 'f4',
    projectId: 'deflake-auth',
    actorId: 'reviewer',
    kind: 'review',
    time: '08:55',
    title: 'Round 2 — approved',
    body: 'Races fixed at the root rather than papered over with retries. Quarantine list is empty again. Merging.',
  },
  {
    id: 'f5',
    projectId: 'deflake-auth',
    actorId: 'particle',
    kind: 'status',
    time: '08:56',
    title: 'merged refs/particle/deflake-auth into main',
  },

  // Bootstrap
  {
    id: 'b1',
    projectId: 'bootstrap',
    actorId: 'planner',
    kind: 'plan',
    time: '08:15',
    title: 'Execution plan — phase 1',
    body: '1. Worker loop behind `npm run particle-worker` → impl‑1\n2. Append-only merge model for project refs → impl‑2\n3. GitHub App bridging issues to projects → queued\n\nRuntime target is the hosted worker; phase 1 is a local dev loop.',
  },
  {
    id: 'b2',
    projectId: 'bootstrap',
    actorId: 'impl-1',
    kind: 'commit',
    time: '08:26',
    title: 'worker: bootstrap event loop and turn executor',
    meta: 'b3f10aa · +412 −0',
  },
  {
    id: 'b3',
    projectId: 'bootstrap',
    actorId: 'impl-2',
    kind: 'commit',
    time: '08:33',
    title: 'refs: append-only commit merge for project refs',
    meta: 'f77c2d9 · +228 −0',
  },
  {
    id: 'b4',
    projectId: 'bootstrap',
    actorId: 'impl-2',
    kind: 'action',
    time: '08:41',
    title: 'Property test: concurrent turns merge without loss',
    body: '1,000 generated interleavings, no dropped or reordered turns.',
  },

  // UI groundwork
  {
    id: 'u1',
    projectId: 'ui-groundwork',
    actorId: 'planner',
    kind: 'plan',
    time: '08:49',
    title: 'Execution plan — 3 tasks',
    body: 'Three-pane workspace: channels on the left, conversation in the middle, project transcript on the right. Prototype against mock data, no backend coupling.',
  },
  {
    id: 'u2',
    projectId: 'ui-groundwork',
    actorId: 'impl-2',
    kind: 'commit',
    time: '09:01',
    title: 'ui: three-pane workspace shell',
    meta: '44e0c1b · +612 −0',
  },
  {
    id: 'u3',
    projectId: 'ui-groundwork',
    actorId: 'impl-2',
    kind: 'commit',
    time: '09:09',
    title: 'ui: project cards, transcript pane, live status',
    meta: '9d21f4e · +540 −22',
  },
  {
    id: 'u4',
    projectId: 'ui-groundwork',
    actorId: 'reviewer',
    kind: 'review',
    time: '09:16',
    title: 'Round 1 — in review',
    body: 'Checking keyboard reach, empty states and dark-mode contrast.',
  },

  // Changelog page
  {
    id: 'l1',
    projectId: 'changelog-page',
    actorId: 'planner',
    kind: 'action',
    time: '08:42',
    title: 'Drafting the plan',
    body: 'Reading changelog.md and the marketing site header before splitting tasks.',
  },

  // Demo environment
  {
    id: 'd1',
    projectId: 'demo-env',
    actorId: 'planner',
    kind: 'action',
    time: '08:05',
    title: 'Drafting the plan',
    body: 'Inspecting the demo org and the current seed scripts.',
  },
];

/**
 * A short scripted feed so the prototype demonstrates live behavior:
 * a commit lands, the reviewer requests changes, an implementer responds —
 * one pass of the loop, then it goes quiet.
 */
export const SIM: SimEvent[] = [
  {
    delay: 7000,
    turn: {
      id: 'sim1',
      projectId: 'speed-up-ci',
      actorId: 'impl-1',
      kind: 'commit',
      time: '09:26',
      title: 'ci: publish per-shard test reports',
      meta: '77b0e4c · +46 −23',
    },
    project: { id: 'speed-up-ci', diff: { files: 11, additions: 227, deletions: 119 } },
    task: { projectId: 'speed-up-ci', taskId: 't3', state: 'done' },
  },
  {
    delay: 15000,
    turn: {
      id: 'sim2',
      projectId: 'speed-up-ci',
      actorId: 'reviewer',
      kind: 'review',
      time: '09:29',
      title: 'Round 1 — changes requested (2)',
      body: 'Shard three drops the webkit project, so the suite loses coverage.\nThe cache key ignores the dependency override patches — stale installs are possible.',
    },
    project: { id: 'speed-up-ci', status: 'changes' },
  },
  {
    delay: 23000,
    turn: {
      id: 'sim3',
      projectId: 'speed-up-ci',
      actorId: 'impl-1',
      kind: 'comment',
      time: '09:31',
      title:
        'On it — restoring webkit to shard three and folding the overrides into the cache key.',
    },
  },
  {
    delay: 31000,
    turn: {
      id: 'sim4',
      projectId: 'speed-up-ci',
      actorId: 'impl-1',
      kind: 'commit',
      time: '09:34',
      title: 'ci: include webkit in shard three, hash overrides into the cache key',
      meta: 'c0dd41e · +21 −6',
    },
    project: { id: 'speed-up-ci', status: 'reviewing', round: 2 },
  },
];
