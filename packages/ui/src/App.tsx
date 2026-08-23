import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTORS,
  CHANNELS,
  CURRENT_USER,
  MESSAGES,
  MOCK_ISSUES,
  PROJECTS,
  REPO_URL,
  SIM,
  TURNS,
} from './data';
import { useLiveWorkspace, type WorkspacePayload } from './live';
import type { Message, Project, Turn } from './types';
import { Workspace } from './Workspace';

function now(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-local-${seq}`;
}

export default function App() {
  const live = useLiveWorkspace();
  if (live.status === 'connecting') {
    return <div className="splash">connecting to the worker…</div>;
  }
  if (live.status === 'live' && live.data) {
    return <LiveApp data={live.data} post={live.post} />;
  }
  return <MockApp offline={live.status === 'offline'} />;
}

function LiveApp({
  data,
  post,
}: {
  data: WorkspacePayload;
  post: (projectId: string, body: string) => Promise<void>;
}) {
  const settled = new Set(['converged', 'abandoned']);
  const [channelId, setChannelId] = useState(() => data.channels[0]?.id ?? '');
  const [projectId, setProjectId] = useState<string | null>(
    () => (data.projects.find((p) => !settled.has(p.status)) ?? data.projects[0])?.id ?? null,
  );

  const actors = useMemo(() => Object.fromEntries(data.actors.map((a) => [a.id, a])), [data]);

  return (
    <Workspace
      actors={actors}
      channels={data.channels}
      messages={data.messages}
      projects={data.projects}
      turns={data.turns}
      currentUserId={data.currentUserId}
      issues={data.issues}
      newIssueUrl={data.workspace.newProjectUrl}
      workspaceLabel={data.workspace.repo}
      mode="live"
      modeHint={`Connected to the local worker · posting as ${data.workspace.operator}`}
      repoUrl={`https://github.com/${data.workspace.repo}`}
      unreads={{}}
      channelId={channelId}
      projectId={projectId}
      onSelectChannel={setChannelId}
      onJumpToProject={(id) => {
        setProjectId(id);
        const home = data.projects.find((p) => p.id === id)?.channelId;
        if (home) setChannelId(home);
      }}
      onOpenProject={setProjectId}
      onCloseProject={() => setProjectId(null)}
      startNote={{
        href: data.workspace.newProjectUrl,
        label: 'Projects in this channel start from GitHub issues.',
      }}
      onSendReply={(text) => {
        if (projectId) void post(projectId, text).catch((err) => console.error(err));
      }}
    />
  );
}

export function MockApp({ offline, embedded }: { offline: boolean; embedded?: boolean }) {
  const [channelId, setChannelId] = useState('eng');
  const [projectId, setProjectId] = useState<string | null>('speed-up-ci');
  const [messages, setMessages] = useState<Message[]>(MESSAGES);
  const [turns, setTurns] = useState<Turn[]>(TURNS);
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [unreads, setUnreads] = useState<Record<string, number>>(() =>
    Object.fromEntries(CHANNELS.filter((c) => c.unread).map((c) => [c.id, c.unread ?? 0])),
  );
  const [paused, setPaused] = useState(false);
  const timers = useRef<number[]>([]);

  // Scripted mock feed: one pass of the implement → review loop, then quiet.
  useEffect(() => {
    for (const ev of SIM) {
      timers.current.push(
        window.setTimeout(() => {
          setTurns((prev) => [...prev, ev.turn]);
          if (ev.project) {
            setProjects((prev) =>
              prev.map((p) => (p.id === ev.project?.id ? { ...p, ...ev.project } : p)),
            );
          }
          if (ev.task) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === ev.task?.projectId
                  ? {
                      ...p,
                      tasks: p.tasks.map((t) =>
                        t.id === ev.task?.taskId ? { ...t, state: ev.task.state } : t,
                      ),
                    }
                  : p,
              ),
            );
          }
        }, ev.delay),
      );
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  const projectsById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  function selectChannel(id: string) {
    setChannelId(id);
    setUnreads((u) => (u[id] ? { ...u, [id]: 0 } : u));
  }

  function togglePause() {
    if (!projectId) return;
    const me = ACTORS[CURRENT_USER];
    const name = me.kind === 'human' ? me.handle : me.name;
    if (!paused) {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    }
    setPaused(!paused);
    setTurns((prev) => [
      ...prev,
      {
        id: nextId('t'),
        projectId,
        actorId: CURRENT_USER,
        kind: 'status',
        time: now(),
        title: paused ? `${name} resumed the agents` : `${name} paused the agents`,
      },
    ]);
  }

  return (
    <Workspace
      actors={ACTORS}
      channels={CHANNELS}
      messages={messages}
      projects={projects}
      turns={turns}
      currentUserId={CURRENT_USER}
      issues={MOCK_ISSUES}
      newIssueUrl={`${REPO_URL}/issues/new`}
      workspaceLabel="Supernovas"
      mode="mock"
      modeHint={
        offline
          ? 'Worker unreachable — showing the design dataset. Start it with: npm run particle-worker'
          : 'Design dataset (?mock=1) — drop the flag to connect to the worker'
      }
      repoUrl={REPO_URL}
      unreads={unreads}
      channelId={channelId}
      projectId={projectId}
      paused={paused}
      onSelectChannel={selectChannel}
      onJumpToProject={(id) => {
        setProjectId(id);
        const home = projectsById[id]?.channelId;
        if (home && home !== channelId) selectChannel(home);
      }}
      onOpenProject={setProjectId}
      onCloseProject={() => setProjectId(null)}
      onSendChannel={(text) => {
        setMessages((prev) => [
          ...prev,
          { id: nextId('m'), channelId, authorId: CURRENT_USER, time: now(), text },
        ]);
      }}
      onSendReply={(text) => {
        if (!projectId) return;
        setTurns((prev) => [
          ...prev,
          {
            id: nextId('t'),
            projectId,
            actorId: CURRENT_USER,
            kind: 'comment',
            time: now(),
            title: text,
          },
        ]);
      }}
      onTogglePause={togglePause}
      embedded={embedded}
    />
  );
}
