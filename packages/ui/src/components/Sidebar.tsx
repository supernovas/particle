import type { Channel, Project } from '../types';
import type { OpenIssue } from '../live';
import { useActors } from '../actors';
import { Avatar } from './Avatar';
import { IconMoon, IconSun, Logo } from './icons';
import { STATUS_LABEL, StatusDot } from './StatusChip';

interface SidebarProps {
  channels: Channel[];
  projects: Project[];
  unreads: Record<string, number>;
  channelId: string;
  projectId: string | null;
  issues?: OpenIssue[];
  newIssueUrl?: string;
  theme: 'light' | 'dark';
  currentUserId: string;
  workspaceLabel: string;
  mode: 'live' | 'mock';
  modeHint?: string;
  onSelectChannel: (id: string) => void;
  onOpenProject: (id: string) => void;
  onToggleTheme: () => void;
}

export function Sidebar(props: SidebarProps) {
  const actor = useActors();
  const me = actor(props.currentUserId);
  const settled = new Set(['converged', 'abandoned']);
  const ordered = [
    ...props.projects.filter((p) => !settled.has(p.status)),
    ...props.projects.filter((p) => settled.has(p.status)),
  ];

  return (
    <aside className="sidebar">
      <div className="side-head">
        <Logo size={22} />
        <div className="side-title">
          <strong>particle</strong>
          <span>{props.workspaceLabel}</span>
        </div>
        <span className={`mode-chip mode-${props.mode}`} title={props.modeHint}>
          {props.mode}
        </span>
      </div>

      <nav className="side-scroll">
        <div className="side-label">Channels</div>
        {props.channels.map((c) => {
          const unread = props.unreads[c.id] ?? 0;
          const active = c.id === props.channelId;
          return (
            <button
              key={c.id}
              className={`side-item chan-item${active ? ' active' : ''}${unread ? ' unread' : ''}`}
              onClick={() => props.onSelectChannel(c.id)}
            >
              <span className="chan-hash">#</span>
              <span className="side-item-title">{c.name}</span>
              {unread ? <span className="unread-badge">{unread}</span> : null}
            </button>
          );
        })}

        <div className="side-label">
          Projects
          {ordered.length > 0 ? <span className="side-count">{ordered.length}</span> : null}
        </div>
        {ordered.length === 0 ? <p className="side-empty">No projects yet.</p> : null}
        {ordered.map((p) => {
          const active = p.id === props.projectId;
          return (
            <button
              key={p.id}
              className={`side-item proj-item${active ? ' active' : ''}`}
              onClick={() => props.onOpenProject(p.id)}
              title={`${p.title} — ${STATUS_LABEL[p.status]} · #${p.channelId}`}
            >
              <StatusDot status={p.status} />
              <span className="side-item-title">{p.title}</span>
            </button>
          );
        })}

        {props.newIssueUrl ? (
          <>
            <div className="side-label">
              Open issues
              {(props.issues ?? []).length > 0 ? (
                <span className="side-count">{(props.issues ?? []).length}</span>
              ) : null}
            </div>
            <a
              className="side-item issue-new"
              href={props.newIssueUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span className="issue-plus">+</span>
              <span className="side-item-title">Open an issue</span>
            </a>
            {(props.issues ?? []).map((issue) => (
              <a
                key={issue.number}
                className="side-item issue-item"
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                title={`#${issue.number} — ${issue.title}`}
              >
                <span className="issue-num">#{issue.number}</span>
                <span className="side-item-title">{issue.title}</span>
              </a>
            ))}
          </>
        ) : null}
      </nav>

      <div className="side-foot">
        <Avatar actor={me} size={26} />
        <div className="side-me">
          <strong>{me.name}</strong>
          <span className="presence">online</span>
        </div>
        <button
          className="icon-btn"
          onClick={props.onToggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {props.theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </aside>
  );
}
