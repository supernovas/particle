import { createHash } from 'node:crypto';

import type { ParticleEvent } from '../packages/core/src/index.ts';

/**
 * SPEC v1 reference encoder. The runner selects @particle/core's implementation when T2 is
 * present; this copy keeps the corpus reviewable on the bootstrap base and checks the same
 * byte contract independently.
 */
export function referenceCanonicalJson(value: unknown): string {
  const stack = new Set<object>();

  function normalize(item: unknown, path: string): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError(`${path} must be a finite number`);
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item !== 'object') throw new TypeError(`${path} is not a JSON value`);
    if (stack.has(item)) throw new TypeError(`${path} contains a cycle`);
    stack.add(item);
    try {
      if (Array.isArray(item)) {
        const values: unknown[] = [];
        for (let index = 0; index < item.length; index++) {
          if (!Object.hasOwn(item, index)) throw new TypeError(`${path}[${index}] is sparse`);
          values.push(normalize(item[index], `${path}[${index}]`));
        }
        return values;
      }
      const object = item as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(object).sort()) {
        normalized[key] = normalize(object[key], `${path}.${key}`);
      }
      return normalized;
    } finally {
      stack.delete(item);
    }
  }

  return `${JSON.stringify(normalize(value, '$'))}\n`;
}

function gitObjectId(type: 'blob' | 'tree' | 'commit', body: Buffer): Buffer {
  const header = Buffer.from(`${type} ${body.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(body).digest();
}

function tree(entries: { mode: string; name: string; oid: Buffer }[]): Buffer {
  const body = Buffer.concat(
    [...entries]
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
      .flatMap(({ mode, name, oid }) => [Buffer.from(`${mode} ${name}\0`, 'utf8'), oid]),
  );
  return gitObjectId('tree', body);
}

export function referenceViewSha(input: {
  project: string;
  events: ParticleEvent[];
  stateJson: string;
  parents: { ref: string; sha: string }[];
  canonicalJson: (value: unknown) => string;
}): string {
  const deduped = new Map<string, ParticleEvent>();
  for (const event of input.events) if (!deduped.has(event.id)) deduped.set(event.id, event);
  const eventEntries = [...deduped.values()].map((event) => ({
    mode: '100644',
    name: `${event.id}.json`,
    oid: gitObjectId('blob', Buffer.from(input.canonicalJson(event), 'utf8')),
  }));
  const eventsTree = tree(eventEntries);
  const rootTree = tree([
    { mode: '40000', name: 'events', oid: eventsTree },
    {
      mode: '100644',
      name: 'state.json',
      oid: gitObjectId('blob', Buffer.from(input.stateJson, 'utf8')),
    },
  ]);
  const parents = [...input.parents].sort((left, right) =>
    Buffer.from(left.ref).compare(Buffer.from(right.ref)),
  );
  const maxWall = input.events.reduce(
    (latest, event) => (event.clock.wall > latest ? event.clock.wall : latest),
    '1970-01-01T00:00:00.000Z',
  );
  const timestamp = Math.floor(Date.parse(maxWall) / 1000);
  const identity = `particle <particle@supernova.ai> ${timestamp} +0000`;
  const commit = [
    `tree ${rootTree.toString('hex')}`,
    ...parents.map(({ sha }) => `parent ${sha}`),
    `author ${identity}`,
    `committer ${identity}`,
    '',
    `particle: materialize ${input.project}`,
    '',
  ].join('\n');
  return gitObjectId('commit', Buffer.from(commit, 'utf8')).toString('hex');
}
