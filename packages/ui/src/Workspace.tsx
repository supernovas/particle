import { useEffect, useMemo, useState } from 'react';
import type { Actor, ActorId, Channel, Message, Project, Turn } from './types';
import type { OpenIssue } from './live';
import { ActorsProvider } from './actors';
import { ChannelView } from './components/ChannelView';
import { ProjectPane } from './components/ProjectPane';
import { Sidebar } from './components/Sidebar';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl;
  const saved = window.localStorage.getItem('particle-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface WorkspaceProps {
  actors: Record<ActorId, Actor>;
  channels: Channel[];
  messages: Message[];
  projects: Project[];
  turns: Turn[];
  currentUserId: ActorId;
  /** Open issues that could become projects; shown in the sidebar when set. */
  issues?: OpenIssue[];
  newIssueUrl?: string;
  workspaceLabel: string;
  mode: 'live' | 'mock';
  modeHint?: string;
  repoUrl: string;
  unreads: Record<string, number>;
  channelId: string;
  projectId: string | null;
  paused?: boolean;
  onSelectChannel: (id: string) => void;
  /** Sidebar navigation: open the project and follow it to its channel. */
  onJumpToProject: (id: string) => void;
  /** Card click: open the project in place. */
  onOpenProject: (id: string) => void;
  onCloseProject: () => void;
  onSendChannel?: (text: string) => void;
  startNote?: { href: string; label: string };
  onSendReply: (text: string) => void;
  onTogglePause?: () => void;
  /** Inside the deck: pin dark, never touch document-level theme state. */
  embedded?: boolean;
}

export function Workspace(props: WorkspaceProps) {
  const [theme, setTheme] = useState<Theme>(props.embedded ? 'dark' : initialTheme);

  useEffect(() => {
    if (props.embedded) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('particle-theme', theme);
  }, [theme, props.embedded]);

  const projectsById = useMemo(
    () => Object.fromEntries(props.projects.map((p) => [p.id, p])),
    [props.projects],
  );
  const channel = props.channels.find((c) => c.id === props.channelId) ?? props.channels[0];
  const project = props.projectId ? (projectsById[props.projectId] ?? null) : null;
  const channelMessages = props.messages.filter((m) => m.channelId === channel?.id);
  const projectTurns = project ? props.turns.filter((t) => t.projectId === project.id) : [];

  if (!channel) return null;

  return (
    <ActorsProvider actors={props.actors}>
      <div className={`app${project ? '' : ' no-detail'}`}>
        <Sidebar
          channels={props.channels}
          projects={props.projects}
          unreads={props.unreads}
          channelId={channel.id}
          projectId={props.projectId}
          issues={props.issues}
          newIssueUrl={props.newIssueUrl}
          theme={theme}
          currentUserId={props.currentUserId}
          workspaceLabel={props.workspaceLabel}
          mode={props.mode}
          modeHint={props.modeHint}
          onSelectChannel={props.onSelectChannel}
          onOpenProject={props.onJumpToProject}
          onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <ChannelView
          channel={channel}
          messages={channelMessages}
          projects={projectsById}
          selectedProjectId={props.projectId}
          onOpenProject={props.onOpenProject}
          onSend={props.onSendChannel}
          startNote={props.startNote}
        />
        {project ? (
          <ProjectPane
            project={project}
            turns={projectTurns}
            paused={props.paused ?? false}
            repoUrl={props.repoUrl}
            onClose={props.onCloseProject}
            onTogglePause={props.onTogglePause}
            onReply={props.onSendReply}
          />
        ) : null}
      </div>
    </ActorsProvider>
  );
}
