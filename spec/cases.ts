import type { ActorId, ParticleEvent } from '../packages/core/src/index.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const PROJECT = `prj_${ulid(1)}`;

const ACTORS = {
  future: `agent:future/run_${ulid(101)}`,
  implementer: `agent:implementer/run_${ulid(102)}`,
  implementerA: `agent:implementer-a/run_${ulid(103)}`,
  implementerZ: `agent:implementer-z/run_${ulid(104)}`,
  load: `agent:load/run_${ulid(105)}`,
  octopusA: `agent:alpha/run_${ulid(106)}`,
  octopusB: `agent:beta/run_${ulid(107)}`,
  octopusC: `agent:gamma/run_${ulid(108)}`,
  planner: `agent:planner/run_${ulid(109)}`,
  reviewer1: `agent:reviewer/run_${ulid(110)}`,
  reviewer2: `agent:reviewer/run_${ulid(111)}`,
  worker: `agent:worker/run_${ulid(112)}`,
} as const satisfies Record<string, ActorId>;

const TASKS = {
  cycle: `tsk_${ulid(201)}`,
  left: `tsk_${ulid(202)}`,
  race: `tsk_${ulid(203)}`,
  right: `tsk_${ulid(204)}`,
  widget: `tsk_${ulid(205)}`,
} as const;

function actorRef(actor: ActorId): string {
  return `refs/particle/${PROJECT}/actors/${actor.replaceAll(/[:/]/g, '-')}`;
}

export interface MaterializeInput {
  parents: { ref: string; sha: string }[];
}

export interface FixtureCase {
  name: string;
  summary: string;
  events: ParticleEvent[];
  materialize?: MaterializeInput;
}

function ulid(value: number): string {
  let remaining = BigInt(value);
  let encoded = '';
  for (let index = 0; index < 26; index++) {
    encoded = ALPHABET[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }
  return encoded;
}

function event<T>(
  sequence: number,
  type: string,
  actor: ActorId,
  lamport: number,
  data: T,
  options: { idSequence?: number; wall?: string; parents?: string[] } = {},
): ParticleEvent<T> {
  return {
    v: 0,
    id: `evt_${ulid(options.idSequence ?? sequence)}`,
    type,
    project: PROJECT,
    actor,
    clock: {
      lamport,
      wall: options.wall ?? new Date(Date.UTC(2026, 7, 23, 20, 0, sequence)).toISOString(),
    },
    parents: options.parents ?? [],
    data,
  } as ParticleEvent<T>;
}

function happyPath(): ParticleEvent[] {
  return [
    event(1, 'project.created', 'github:alice', 1, {
      title: 'Ship the widget',
      source: { kind: 'github-issue', repo: 'acme/widget', number: 7 },
    }),
    event(2, 'message.posted', 'github:alice', 2, {
      body: 'Please build the widget.',
      via: 'https://github.com/acme/widget/issues/7#issuecomment-1',
    }),
    event(3, 'task.created', ACTORS.planner, 3, {
      taskId: TASKS.widget,
      title: 'Build widget',
      spec: 'Implement and test it.',
      deps: [],
    }),
    event(4, 'task.claimed', ACTORS.implementer, 4, { taskId: TASKS.widget }),
    event(5, 'task.updated', ACTORS.implementer, 5, {
      taskId: TASKS.widget,
      status: 'done',
      note: 'Tests pass.',
    }),
    event(6, 'artifact.linked', ACTORS.implementer, 6, {
      kind: 'pr',
      locator: 'https://github.com/acme/widget/pull/8',
    }),
    event(7, 'review.posted', ACTORS.reviewer1, 7, {
      verdict: 'approve',
      comments: [],
    }),
    event(8, 'project.status', ACTORS.worker, 8, { status: 'converged' }),
  ];
}

function reviewCycle(): ParticleEvent[] {
  return [
    event(80, 'project.created', 'github:alice', 1, {
      title: 'Review cycle',
      source: { kind: 'chat', channel: 'engineering', thread: 'cycle-1' },
    }),
    event(81, 'task.created', ACTORS.planner, 2, {
      taskId: TASKS.cycle,
      title: 'Iterate',
      spec: 'Address review feedback.',
      deps: [],
    }),
    event(82, 'task.claimed', ACTORS.implementer, 3, { taskId: TASKS.cycle }),
    event(83, 'task.updated', ACTORS.implementer, 4, {
      taskId: TASKS.cycle,
      status: 'done',
    }),
    event(84, 'review.posted', ACTORS.reviewer1, 5, {
      verdict: 'request_changes',
      comments: [{ taskId: TASKS.cycle, body: 'Add the regression test.' }],
    }),
    event(85, 'task.updated', ACTORS.implementer, 6, {
      taskId: TASKS.cycle,
      status: 'in_progress',
      note: 'Reopened after review.',
    }),
    event(86, 'task.updated', ACTORS.implementer, 7, {
      taskId: TASKS.cycle,
      status: 'done',
      note: 'Regression covered.',
    }),
    event(87, 'review.posted', ACTORS.reviewer2, 8, {
      verdict: 'approve',
      comments: [],
    }),
  ];
}

function largeLog(): ParticleEvent[] {
  const events: ParticleEvent[] = [
    event(1000, 'project.created', 'github:loadtest', 1, {
      title: 'One thousand events',
      source: { kind: 'chat', channel: 'load-test' },
    }),
  ];
  for (let index = 1; index < 1000; index++) {
    events.push(
      event(1000 + index, 'message.posted', ACTORS.load, index + 1, {
        body: `message ${index.toString().padStart(4, '0')}`,
      }),
    );
  }
  return events.reverse();
}

function octopusEvents(): ParticleEvent[] {
  const ordered = [
    event(2001, 'project.created', ACTORS.octopusA, 1, {
      title: 'Octopus',
      source: { kind: 'github-issue', repo: 'supernovas/particle', number: 10 },
    }),
    event(2002, 'task.created', ACTORS.octopusA, 2, {
      taskId: TASKS.left,
      title: 'Left',
      spec: 'Build the left side.',
      deps: [],
    }),
    event(2003, 'task.created', ACTORS.octopusA, 3, {
      taskId: TASKS.right,
      title: 'Right',
      spec: 'Build the right side.',
      deps: [],
    }),
    event(2004, 'task.claimed', ACTORS.octopusB, 4, { taskId: TASKS.left }),
    event(2005, 'task.claimed', ACTORS.octopusC, 4, { taskId: TASKS.right }),
    event(2006, 'task.updated', ACTORS.octopusB, 5, {
      taskId: TASKS.left,
      status: 'done',
    }),
    event(2007, 'task.updated', ACTORS.octopusC, 5, {
      taskId: TASKS.right,
      status: 'done',
    }),
    event(2008, 'review.posted', ACTORS.octopusC, 6, {
      verdict: 'approve',
      comments: [],
    }),
  ];
  return [
    ordered[6]!,
    ordered[1]!,
    ordered[7]!,
    ordered[3]!,
    ordered[0]!,
    ordered[5]!,
    ordered[2]!,
    ordered[4]!,
  ];
}

const duplicate = event(42, 'message.posted', 'github:alice', 2, { body: 'deliver once' });

export const CASES: FixtureCase[] = [
  {
    name: 'empty-project',
    summary:
      'Pins the exact initial state for a known project id when the input event set is empty.',
    events: [],
  },
  {
    name: 'single-actor-happy-path',
    summary:
      'Pins the ordinary create, message, task, claim, completion, artifact, approval, and convergence fold for one causal actor sequence.',
    events: happyPath(),
  },
  {
    name: 'concurrent-lamport-actor-tiebreak',
    summary:
      'Pins actor id byte ordering as the second total-order key when concurrent events share a Lamport value.',
    events: [
      event(21, 'message.posted', 'github:zoe', 4, { body: 'second by actor' }),
      event(22, 'message.posted', 'github:amy', 4, { body: 'first by actor' }),
    ],
  },
  {
    name: 'concurrent-lamport-id-tiebreak',
    summary:
      'Pins event id byte ordering as the final total-order key when both Lamport value and actor id are equal.',
    events: [
      event(31, 'message.posted', 'github:alice', 7, { body: 'higher id' }, { idSequence: 32 }),
      event(32, 'message.posted', 'github:alice', 7, { body: 'lower id' }, { idSequence: 31 }),
    ],
  },
  {
    name: 'duplicate-event-ids',
    summary:
      'Pins grow-only-set idempotence: byte-identical repeated deliveries of one event appear once in canonical order and affect state once.',
    events: [
      duplicate,
      event(43, 'message.posted', 'github:bob', 3, { body: 'after duplicate' }),
      duplicate,
    ],
  },
  {
    name: 'unknown-event-type',
    summary:
      'Pins forward compatibility: an unknown but valid envelope is ordered and recorded as seen while its payload has no fold effect.',
    events: [event(51, 'extension.example', ACTORS.future, 1, { opaque: { answer: 42 } })],
  },
  {
    name: 'claim-race',
    summary:
      'Pins first-claim-wins under a concurrent Lamport tie, including deterministic rejection of the later claimant.',
    events: [
      event(61, 'task.claimed', ACTORS.implementerZ, 3, { taskId: TASKS.race }),
      event(62, 'task.created', ACTORS.planner, 2, {
        taskId: TASKS.race,
        title: 'Contested task',
        spec: 'Only one actor may own it.',
        deps: [],
      }),
      event(63, 'task.claimed', ACTORS.implementerA, 3, { taskId: TASKS.race }),
    ],
  },
  {
    name: 'review-reject-reopen-approve',
    summary:
      'Pins a complete review cycle in which a rejection is followed by an assignee reopen, another completion, and a later canonical approval.',
    events: reviewCycle(),
  },
  {
    name: 'unicode-escaping',
    summary:
      'Pins UTF-8 preservation and JSON escaping for quotes, backslashes, controls, emoji, combining marks, and non-Latin scripts in message bodies.',
    events: [
      event(91, 'message.posted', 'github:unicode', 1, {
        body: 'quote=" slash=\\ newline=\n tab=\t emoji=🪐 combining=e\u0301 日本語 Polski: zażółć',
      }),
    ],
  },
  {
    name: 'large-log-1000',
    summary:
      'Pins deterministic ordering and folding for exactly one thousand events supplied in reverse order without making the corpus synthetic at runtime.',
    events: largeLog(),
  },
  {
    name: 'octopus-determinism',
    summary:
      'Pins a shuffled three-actor workload and the byte-level octopus view commit recipe, including parent-ref sorting, canonical trees, identity, timestamp, and message.',
    events: octopusEvents(),
    materialize: {
      parents: [
        {
          ref: actorRef(ACTORS.octopusC),
          sha: 'cccccccccccccccccccccccccccccccccccccccc',
        },
        {
          ref: actorRef(ACTORS.octopusA),
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          ref: actorRef(ACTORS.octopusB),
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    },
  },
];
