import {
  compareEvents,
  fold,
  type ActorId,
  type ArtifactLinked,
  type MessagePosted,
  type ParticleEvent,
  type PlanProposed,
  type ProjectState,
  type ProjectStatusChanged,
  type ReviewPosted,
  type TaskCreated,
  type TaskState,
  type TaskUpdated,
} from '@particle/core';
import type { Config } from './config.ts';

/**
 * Serialize worker state into the UI's domain model (packages/ui/src/types.ts).
 * The UI is a pure function of this payload; keeping the mapping here means the
 * protocol can evolve without touching components.
 */

export interface UiActor {
  kind: 'human' | 'agent' | 'app';
  id: string;
  name: string;
  handle?: string;
  hue?: number;
  role?: string;
  online?: boolean;
}

export interface UiTask {
  id: string;
  title: string;
  state: 'queued' | 'running' | 'done' | 'blocked';
  assignee?: string;
}

export interface UiProject {
  id: string;
  title: string;
  /** Empty until the git ref store lands (P1.T3); the journal is the stand-in. */
  ref: string;
  channelId: string;
  status: 'open' | 'planning' | 'executing' | 'review' | 'changes' | 'converged' | 'abandoned';
  startedBy: string;
  issue?: number;
  round: number;
  tasks: UiTask[];
  diff: { files: number; additions: number; deletions: number };
  watchers: string[];
}

export interface UiTurn {
  id: string;
  projectId: string;
  actorId: string;
  kind: 'plan' | 'commit' | 'action' | 'review' | 'comment' | 'status';
  time: string;
  title: string;
  body?: string;
  meta?: string;
}

export interface UiMessage {
  id: string;
  channelId: string;
  authorId: string;
  time: string;
  text: string;
  projectId?: string;
}

export interface UiChannel {
  id: string;
  name: string;
  topic: string;
}

export interface WorkspacePayload {
  workspace: { repo: string; operator: string; newProjectUrl: string };
  currentUserId: string;
  channels: UiChannel[];
  actors: UiActor[];
  messages: UiMessage[];
  projects: UiProject[];
  turns: UiTurn[];
}

const CHANNEL_ID = 'github-issues';

export function actorHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

function uiActor(id: ActorId): UiActor {
  if (id.startsWith('github:')) {
    const login = id.slice('github:'.length);
    return { kind: 'human', id, name: login, handle: login, hue: actorHue(login) };
  }
  const rest = id.slice('agent:'.length);
  const role = rest.split('/')[0] ?? 'agent';
  return { kind: 'agent', id, name: role, role };
}

function uiTaskState(status: TaskState['status']): UiTask['state'] {
  switch (status) {
    case 'open':
      return 'queued';
    case 'claimed':
    case 'in_progress':
      return 'running';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
  }
}

function uiStatus(state: ProjectState): UiProject['status'] {
  if (
    state.lastReview?.verdict === 'request_changes' &&
    (state.status === 'executing' || state.status === 'review')
  ) {
    return 'changes';
  }
  return state.status;
}

function turnFor(event: ParticleEvent, state: ProjectState): UiTurn | null {
  const base = {
    id: event.id,
    projectId: event.project,
    actorId: event.actor,
    time: hhmm(event.clock.wall),
  };
  switch (event.type) {
    case 'project.created':
      return { ...base, kind: 'status', title: 'project created' };
    case 'message.posted': {
      const data = event.data as MessagePosted;
      return { ...base, kind: 'comment', title: data.body };
    }
    case 'plan.proposed': {
      const data = event.data as PlanProposed;
      const tasks = data.taskIds
        .map((id, i) => {
          const task = state.tasks[id];
          return task ? `${i + 1}. ${task.title}` : null;
        })
        .filter((line): line is string => line !== null);
      return {
        ...base,
        kind: 'plan',
        title: data.summary,
        body: tasks.length > 0 ? tasks.join('\n') : undefined,
      };
    }
    case 'task.created':
      return null; // folded into the plan turn and the task list
    case 'task.claimed': {
      const task = state.tasks[(event.data as { taskId: string }).taskId];
      return { ...base, kind: 'status', title: `claimed “${task?.title ?? 'task'}”` };
    }
    case 'task.updated': {
      const data = event.data as TaskUpdated;
      const task = state.tasks[data.taskId];
      const title = `${task?.title ?? 'task'} → ${data.status.replace('_', ' ')}`;
      return data.note
        ? { ...base, kind: 'action', title, body: data.note }
        : { ...base, kind: 'status', title };
    }
    case 'review.requested':
      return { ...base, kind: 'status', title: 'review requested' };
    case 'review.posted': {
      const data = event.data as ReviewPosted;
      const verdict = data.verdict === 'approve' ? 'approved' : 'changes requested';
      const title = `Review — ${verdict}${data.comments.length > 0 ? ` (${data.comments.length})` : ''}`;
      const body = data.comments.map((c) => c.body).join('\n') || undefined;
      return { ...base, kind: 'review', title, body };
    }
    case 'artifact.linked': {
      const data = event.data as ArtifactLinked;
      if (data.kind === 'commit') {
        return { ...base, kind: 'commit', title: data.locator, meta: data.locator };
      }
      return { ...base, kind: 'action', title: `${data.kind}: ${data.locator}` };
    }
    case 'project.status': {
      const data = event.data as ProjectStatusChanged;
      return { ...base, kind: 'status', title: `status → ${data.status}` };
    }
    default:
      return null; // unknown event types are preserved upstream, ignored here
  }
}

export interface ProjectLogView {
  id: string;
  events: ParticleEvent[];
}

export function serializeWorkspace(
  logs: ProjectLogView[],
  config: Config,
  operator: string,
): WorkspacePayload {
  const actors = new Map<string, UiActor>();
  const messages: UiMessage[] = [];
  const projects: UiProject[] = [];
  const turns: UiTurn[] = [];

  const operatorId = `github:${operator}`;
  actors.set(operatorId, { ...uiActor(operatorId as ActorId), online: true });

  for (const log of logs) {
    const sorted = [...log.events].sort(compareEvents);
    const state = fold(log.id, sorted);
    const humans = new Set<string>();

    for (const event of sorted) {
      if (!actors.has(event.actor)) actors.set(event.actor, uiActor(event.actor));
      if (event.actor.startsWith('github:')) humans.add(event.actor);
      const turn = turnFor(event, state);
      if (turn) turns.push(turn);
    }

    const founding = sorted.find((e) => e.type === 'message.posted');
    const created = sorted.find((e) => e.type === 'project.created');
    if (founding) {
      const data = founding.data as MessagePosted;
      messages.push({
        id: founding.id,
        channelId: CHANNEL_ID,
        authorId: founding.actor,
        time: hhmm(founding.clock.wall),
        text: data.body,
        projectId: log.id,
      });
    }

    const reviews = sorted.filter((e) => e.type === 'review.posted');
    projects.push({
      id: log.id,
      title: state.title || `project ${log.id.slice(0, 12)}…`,
      ref: '',
      channelId: CHANNEL_ID,
      status: uiStatus(state),
      startedBy: created?.actor ?? founding?.actor ?? operatorId,
      issue: state.source?.kind === 'github-issue' ? state.source.number : undefined,
      round: Math.max(1, reviews.length),
      tasks: Object.values(state.tasks).map((t) => ({
        id: t.id,
        title: t.title,
        state: uiTaskState(t.status),
        assignee: t.assignee,
      })),
      diff: { files: 0, additions: 0, deletions: 0 },
      watchers: [...humans],
    });
  }

  const gh = config.channels.githubIssues;
  return {
    workspace: {
      repo: config.host.repo,
      operator,
      newProjectUrl: `https://github.com/${gh.repo}/issues/new?labels=${encodeURIComponent(gh.label)}`,
    },
    currentUserId: operatorId,
    channels: [
      {
        id: CHANNEL_ID,
        name: CHANNEL_ID,
        topic: `Projects from ${gh.repo} issues · label “${gh.label}”`,
      },
    ],
    actors: [...actors.values()],
    messages,
    projects,
    turns,
  };
}
