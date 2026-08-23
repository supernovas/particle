import type { ActorId, ParticleEvent } from './types.ts';

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const EVENT_ID = new RegExp(`^evt_${ULID}$`);
const PROJECT_ID = new RegExp(`^prj_${ULID}$`);
const RUN_ID = new RegExp(`^run_${ULID}$`);
const GITHUB_LOGIN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?|[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\[bot\])$/;
const AGENT_ROLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type JsonObject = Record<string, unknown>;

export class EventValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'EventValidationError';
    this.path = path;
  }
}

/** Validate an untrusted value as a Particle event, preserving unknown types. */
export function parseEvent(json: unknown): ParticleEvent {
  const event = object(json, 'event');
  exact(event.v, 0, 'v');
  id(event.id, EVENT_ID, 'id', 'evt_ id');
  string(event.type, 'type', true);
  id(event.project, PROJECT_ID, 'project', 'prj_ id');
  actor(event.actor, 'actor');

  const clock = object(event.clock, 'clock');
  if (!Number.isSafeInteger(clock.lamport) || (clock.lamport as number) <= 0) {
    fail('clock.lamport', 'must be a positive safe integer');
  }
  isoWall(clock.wall, 'clock.wall');

  const parents = array(event.parents, 'parents');
  parents.forEach((parent, index) => id(parent, EVENT_ID, `parents[${index}]`, 'evt_ id'));
  if (!Object.hasOwn(event, 'data')) fail('data', 'is required');

  switch (event.type) {
    case 'project.created':
      projectCreated(event.data, 'data');
      break;
    case 'message.posted':
      messagePosted(event.data, 'data');
      break;
    case 'plan.proposed':
      planProposed(event.data, 'data');
      break;
    case 'task.created':
      taskCreated(event.data, 'data');
      break;
    case 'task.claimed':
      taskClaimed(event.data, 'data');
      break;
    case 'task.updated':
      taskUpdated(event.data, 'data');
      break;
    case 'review.requested':
      reviewRequested(event.data, 'data');
      break;
    case 'review.posted':
      reviewPosted(event.data, 'data');
      break;
    case 'artifact.linked':
      artifactLinked(event.data, 'data');
      break;
    case 'project.status':
      projectStatus(event.data, 'data');
      break;
    default:
      // Future event payloads are opaque until this implementation knows them.
      break;
  }

  return json as ParticleEvent;
}

export function isEvent(json: unknown): json is ParticleEvent {
  try {
    parseEvent(json);
    return true;
  } catch {
    return false;
  }
}

function projectCreated(value: unknown, path: string): void {
  const data = object(value, path);
  string(data.title, `${path}.title`);
  const source = object(data.source, `${path}.source`);
  if (source.kind === 'github-issue') {
    string(source.repo, `${path}.source.repo`, true);
    if (!Number.isSafeInteger(source.number) || (source.number as number) <= 0) {
      fail(`${path}.source.number`, 'must be a positive safe integer');
    }
  } else if (source.kind === 'chat') {
    string(source.channel, `${path}.source.channel`, true);
    optionalString(source, 'thread', `${path}.source.thread`);
  } else {
    fail(`${path}.source.kind`, 'must be "github-issue" or "chat"');
  }
}

function messagePosted(value: unknown, path: string): void {
  const data = object(value, path);
  string(data.body, `${path}.body`);
  if (Object.hasOwn(data, 'replyTo')) {
    id(data.replyTo, EVENT_ID, `${path}.replyTo`, 'evt_ id');
  }
  optionalString(data, 'via', `${path}.via`);
}

function planProposed(value: unknown, path: string): void {
  const data = object(value, path);
  string(data.summary, `${path}.summary`);
  stringArray(data.taskIds, `${path}.taskIds`);
}

function taskCreated(value: unknown, path: string): void {
  const data = object(value, path);
  string(data.taskId, `${path}.taskId`, true);
  string(data.title, `${path}.title`);
  string(data.spec, `${path}.spec`);
  stringArray(data.deps, `${path}.deps`);
}

function taskClaimed(value: unknown, path: string): void {
  const data = object(value, path);
  string(data.taskId, `${path}.taskId`, true);
}

function taskUpdated(value: unknown, path: string): void {
  const data = object(value, path);
  string(data.taskId, `${path}.taskId`, true);
  oneOf(data.status, ['in_progress', 'blocked', 'done'], `${path}.status`);
  optionalString(data, 'note', `${path}.note`);
}

function reviewRequested(value: unknown, path: string): void {
  const data = object(value, path);
  stringArray(data.taskIds, `${path}.taskIds`);
}

function reviewPosted(value: unknown, path: string): void {
  const data = object(value, path);
  oneOf(data.verdict, ['approve', 'request_changes'], `${path}.verdict`);
  const comments = array(data.comments, `${path}.comments`);
  comments.forEach((comment, index) => {
    const commentPath = `${path}.comments[${index}]`;
    const item = object(comment, commentPath);
    optionalString(item, 'taskId', `${commentPath}.taskId`);
    string(item.body, `${commentPath}.body`);
  });
}

function artifactLinked(value: unknown, path: string): void {
  const data = object(value, path);
  oneOf(data.kind, ['pr', 'commit', 'ref'], `${path}.kind`);
  string(data.locator, `${path}.locator`, true);
}

function projectStatus(value: unknown, path: string): void {
  const data = object(value, path);
  oneOf(
    data.status,
    ['open', 'planning', 'executing', 'review', 'paused', 'converged', 'abandoned'],
    `${path}.status`,
  );
}

function actor(value: unknown, path: string): asserts value is ActorId {
  if (typeof value !== 'string') fail(path, 'must be an actor id');
  if (value.startsWith('github:')) {
    if (!GITHUB_LOGIN.test(value.slice('github:'.length))) fail(path, 'must be a valid actor id');
    return;
  }
  if (value.startsWith('agent:')) {
    const parts = value.slice('agent:'.length).split('/');
    if (parts.length === 2 && AGENT_ROLE.test(parts[0]!) && RUN_ID.test(parts[1]!)) return;
  }
  fail(path, 'must be github:<login> or agent:<role>/<run-id>');
}

function isoWall(value: unknown, path: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !ISO_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(path, 'must be an ISO-8601 UTC timestamp');
  }
}

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as JsonObject;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function string(value: unknown, path: string, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && value.length === 0)) {
    fail(path, nonempty ? 'must be a non-empty string' : 'must be a string');
  }
}

function optionalString(object: JsonObject, key: string, path: string): void {
  if (Object.hasOwn(object, key)) string(object[key], path);
}

function stringArray(value: unknown, path: string): void {
  const items = array(value, path);
  items.forEach((item, index) => string(item, `${path}[${index}]`, true));
}

function id(
  value: unknown,
  pattern: RegExp,
  path: string,
  description: string,
): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(path, `must be a ${description} with a 26-character Crockford ULID`);
  }
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail(path, `must be ${JSON.stringify(expected)}`);
}

function oneOf(value: unknown, allowed: readonly string[], path: string): asserts value is string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(path, `must be one of ${allowed.map((item) => JSON.stringify(item)).join(', ')}`);
  }
}

function fail(path: string, message: string): never {
  throw new EventValidationError(path, message);
}
