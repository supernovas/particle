import { join } from 'node:path';
import {
  compareEvents,
  fold,
  type ParticleEvent,
  type ProjectCreated,
  type ProjectState,
} from '@particle/core';
import { openStore, type EventStore } from '@particle/worker/store';
import { workspaceRoot, type CommandContext } from './context.ts';

export interface StoredProject {
  key: string;
  id: string;
  state: ProjectState;
  events: ParticleEvent[];
}

export function storeFor(context: CommandContext): EventStore {
  return openStore(join(workspaceRoot(context), '.particle'));
}

export function canonicalEvents(events: Iterable<ParticleEvent>): ParticleEvent[] {
  const sorted = [...events].sort(compareEvents);
  const seen = new Set<string>();
  return sorted.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export function projectKey(state: ProjectState): string {
  const source = state.source;
  if (source?.kind === 'github-issue') return `gh-${source.number}`;
  if (source?.kind === 'chat' && source.thread) return source.thread;
  return state.id;
}

export async function loadProjects(store: EventStore): Promise<StoredProject[]> {
  const grouped = new Map<string, ParticleEvent[]>();
  for (const event of await store.load()) {
    const events = grouped.get(event.project) ?? [];
    events.push(event);
    grouped.set(event.project, events);
  }

  const projects: StoredProject[] = [];
  for (const [id, events] of grouped) {
    // Key, title, task/message counts, and status all come from the fold. The
    // canonical event sequence is retained only for log rendering/appends.
    const state = fold(id, events);
    if (!state.source) continue;
    projects.push({ key: projectKey(state), id, state, events: canonicalEvents(events) });
  }
  return projects.sort((a, b) => a.key.localeCompare(b.key));
}

export function projectTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]!.trim();
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;
}

export function createdData(title: string, key: string): ProjectCreated {
  return { title, source: { kind: 'chat', channel: '#cli', thread: key } };
}
