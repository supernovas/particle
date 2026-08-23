import { useEffect, useRef, useState } from 'react';
import type { Project, Task, Turn } from '../types';
import { ACTORS, REPO_URL } from '../data';
import { Avatar, Facepile } from './Avatar';
import { Composer } from './Composer';
import { IconBranch, IconCheck, IconCopy, IconPause, IconPlay, IconX } from './icons';
import { StatusChip } from './StatusChip';

interface ProjectPaneProps {
  project: Project;
  turns: Turn[];
  paused: boolean;
  onClose: () => void;
  onTogglePause: () => void;
  onReply: (text: string) => void;
}

function TaskRow({ task }: { task: Task }) {
  const assignee = task.assignee ? ACTORS[task.assignee] : undefined;
  return (
    <li className={`task ${task.state}`}>
      <span className="task-mark">{task.state === 'done' ? <IconCheck size={10} /> : null}</span>
      <span className="task-title">{task.title}</span>
      {assignee ? <Avatar actor={assignee} size={16} /> : null}
    </li>
  );
}

const KIND_LABEL: Partial<Record<Turn['kind'], string>> = {
  plan: 'plan',
  commit: 'commit',
  action: 'run',
  review: 'review',
};

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.kind === 'status') {
    return (
      <div className="sys-turn">
        {turn.title} · {turn.time}
      </div>
    );
  }
  const actor = ACTORS[turn.actorId];
  const label = KIND_LABEL[turn.kind];
  // Prototype-only: the mock encodes the verdict in the title.
  const verdict =
    turn.kind === 'review' ? (turn.title.toLowerCase().includes('approved') ? 'ok' : 'warn') : '';

  return (
    <div className="turn">
      <Avatar actor={actor} size={24} />
      <div className="turn-main">
        <div className="turn-head">
          <span className="turn-name">{actor.name}</span>
          {label ? <span className={`turn-kind k-${turn.kind}`}>{label}</span> : null}
          <span className="turn-time">{turn.time}</span>
        </div>
        {turn.kind === 'commit' ? (
          <div className="turn-commit">
            <code className="commit-msg">{turn.title}</code>
            {turn.meta ? <span className="commit-meta">{turn.meta}</span> : null}
          </div>
        ) : turn.kind === 'comment' ? (
          <p className="turn-text">{turn.title}</p>
        ) : (
          <div className={`turn-title ${verdict}`}>{turn.title}</div>
        )}
        {turn.body ? <pre className="turn-body">{turn.body}</pre> : null}
      </div>
    </div>
  );
}

export function ProjectPane(props: ProjectPaneProps) {
  const { project } = props;
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnCount = props.turns.length;
  const prevView = useRef({ id: project.id, count: turnCount });

  // Follow new turns only when already reading near the bottom; start new
  // projects at the top.
  useEffect(() => {
    const el = scrollRef.current;
    const was = prevView.current;
    prevView.current = { id: project.id, count: turnCount };
    if (!el) return;
    if (was.id !== project.id) {
      el.scrollTop = 0;
      return;
    }
    if (turnCount > was.count) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 320;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
  }, [turnCount, project.id]);
  const watchers = project.watchers.map((id) => ACTORS[id]).filter(Boolean);

  function copyFetch() {
    navigator.clipboard.writeText(`git fetch origin ${project.ref}`).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <aside className="detail">
      <header className="pane-head detail-head">
        <div className="pane-head-text">
          <span className="overline">Project</span>
          <h2>{project.title}</h2>
        </div>
        <div className="detail-actions">
          <button
            className="icon-btn"
            onClick={props.onTogglePause}
            aria-label={props.paused ? 'Resume agents' : 'Pause agents'}
            title={props.paused ? 'Resume agents' : 'Pause agents'}
          >
            {props.paused ? <IconPlay /> : <IconPause />}
          </button>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close" title="Close">
            <IconX />
          </button>
        </div>
      </header>

      <div className="detail-scroll" ref={scrollRef}>
        <div className="detail-meta">
          <div className="meta-row">
            <StatusChip status={project.status} />
            <span className="meta-dim">round {project.round}</span>
            {project.issue ? (
              <a
                className="issue-chip"
                href={`${REPO_URL}/issues/${project.issue}`}
                target="_blank"
                rel="noreferrer"
              >
                issue #{project.issue} ↗
              </a>
            ) : null}
            <span className="meta-spacer" />
            <Facepile actors={watchers} size={16} />
          </div>
          {project.diff.files > 0 ? (
            <div className="meta-row">
              <span className="diffstat">
                {project.diff.files} files <b className="add">+{project.diff.additions}</b>{' '}
                <b className="del">−{project.diff.deletions}</b>
              </span>
            </div>
          ) : null}
          <div className="ref-line">
            <IconBranch />
            <code>{project.ref}</code>
            <button
              className="icon-btn"
              onClick={copyFetch}
              aria-label="Copy fetch command"
              title={`git fetch origin ${project.ref}`}
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
          </div>
        </div>

        <section className="detail-section">
          <h3>Plan</h3>
          {project.tasks.length > 0 ? (
            <ul className="task-list">
              {project.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          ) : (
            <p className="empty-line">The planner is drafting the plan…</p>
          )}
        </section>

        <section className="detail-section">
          <h3>Transcript</h3>
          <div className="turns">
            {props.turns.map((t) => (
              <TurnRow key={t.id} turn={t} />
            ))}
          </div>
        </section>
      </div>

      <Composer placeholder="Reply — people and agents will see it" onSend={props.onReply} />
    </aside>
  );
}
