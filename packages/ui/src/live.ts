import { useCallback, useEffect, useRef, useState } from 'react';
import type { Actor, ActorId, Channel, Message, Project, Turn } from './types';

/** Shape served by the worker (packages/worker/src/serialize.ts). */
export interface WorkspacePayload {
  workspace: { repo: string; operator: string; newProjectUrl: string };
  currentUserId: ActorId;
  channels: Channel[];
  actors: Actor[];
  messages: Message[];
  projects: Project[];
  turns: Turn[];
}

export type LiveStatus = 'connecting' | 'live' | 'offline' | 'mock';

export interface LiveWorkspace {
  status: LiveStatus;
  data?: WorkspacePayload;
  /** Post a message into a project's log as the workspace operator. */
  post: (projectId: string, body: string) => Promise<void>;
}

/**
 * Connect to the local worker: one snapshot fetch plus an SSE tick per
 * appended batch (each tick refetches — snapshots are small at this scale).
 * `?mock=1` skips the worker and keeps the design-prototype dataset.
 */
export function useLiveWorkspace(): LiveWorkspace {
  const forcedMock = new URLSearchParams(window.location.search).get('mock') === '1';
  const [status, setStatus] = useState<LiveStatus>(forcedMock ? 'mock' : 'connecting');
  const [data, setData] = useState<WorkspacePayload>();
  const everLive = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/workspace', { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`workspace: ${res.status}`);
    const payload = (await res.json()) as WorkspacePayload;
    everLive.current = true;
    setData(payload);
    setStatus('live');
  }, []);

  useEffect(() => {
    if (forcedMock) return;
    let alive = true;
    let debounce: number | undefined;

    load().catch(() => alive && !everLive.current && setStatus('offline'));

    const events = new EventSource('/api/events');
    const tick = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (alive) load().catch(() => undefined);
      }, 200);
    };
    events.addEventListener('append', tick);
    events.addEventListener('hello', tick);
    events.onerror = () => {
      // EventSource retries on its own; only give up if we never connected.
      if (alive && !everLive.current) setStatus('offline');
    };

    return () => {
      alive = false;
      window.clearTimeout(debounce);
      events.close();
    };
  }, [forcedMock, load]);

  const post = useCallback(
    async (projectId: string, body: string) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`post: ${res.status}`);
      await load();
    },
    [load],
  );

  return { status, data, post };
}
