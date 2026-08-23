import { parseArgs } from 'node:util';
import {
  newId,
  nextClock,
  type ActorId,
  type MessagePosted,
  type ParticleEvent,
  type ProjectCreated,
} from '@particle/core';
import type { CommandContext } from '../context.ts';
import { createdData, loadProjects, projectTitle, storeFor } from '../projects.ts';

function actorFrom(value: string): ActorId | undefined {
  const login = value.trim();
  return login && !/\s/.test(login) ? (`github:${login}` as ActorId) : undefined;
}

export function resolveActor(context: CommandContext): ActorId {
  const configured = context.run('git', ['config', '--get', 'user.name']);
  if (configured.status === 0) {
    const actor = actorFrom(configured.stdout);
    if (actor) return actor;
  }
  const gh = context.run('gh', ['api', 'user', '--jq', '.login']);
  if (gh.status === 0) {
    const actor = actorFrom(gh.stdout);
    if (actor) return actor;
  }
  return 'github:local';
}

export async function post(args: string[], context: CommandContext): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { project: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    context.stderr(`particle post: ${(error as Error).message}\n`);
    return 2;
  }

  const text = parsed.positionals.join(' ').trim();
  if (!text) {
    context.stderr('usage: particle post [--project <key>] <text>\n');
    return 2;
  }

  const store = storeFor(context);
  const projects = await loadProjects(store);
  const requestedKey = parsed.values.project;
  const existing = requestedKey
    ? projects.find((project) => project.key === requestedKey)
    : undefined;
  if (requestedKey && !existing) {
    context.stderr(`particle post: project not found: ${requestedKey}\n`);
    return 1;
  }

  const projectId = existing?.id ?? newId('prj');
  const key = existing?.key ?? projectId;
  const actor = resolveActor(context);
  const events: ParticleEvent[] = [];
  let previous = existing?.events.at(-1);
  const parents = () => (previous ? [previous.id] : []);
  const clock = () => nextClock(previous?.clock, [], context.now());

  if (!existing) {
    const created: ParticleEvent<ProjectCreated> = {
      v: 0,
      id: newId('evt'),
      type: 'project.created',
      project: projectId,
      actor,
      clock: clock(),
      parents: parents(),
      data: createdData(projectTitle(text), key),
    };
    events.push(created);
    previous = created;
  }

  const message: ParticleEvent<MessagePosted> = {
    v: 0,
    id: newId('evt'),
    type: 'message.posted',
    project: projectId,
    actor,
    clock: clock(),
    parents: parents(),
    data: { body: text },
  };
  events.push(message);
  await store.append(events);
  context.stdout(`${existing ? 'posted to' : 'created'} ${key}\n`);
  return 0;
}
