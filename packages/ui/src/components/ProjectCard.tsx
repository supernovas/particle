import type { Project } from '../types';
import { ACTORS } from '../data';
import { Facepile } from './Avatar';
import { StatusChip } from './StatusChip';

interface ProjectCardProps {
  project: Project;
  active: boolean;
  onOpen: () => void;
}

export function ProjectCard({ project, active, onOpen }: ProjectCardProps) {
  const done = project.tasks.filter((t) => t.state === 'done').length;
  const total = project.tasks.length;
  const watchers = project.watchers.map((id) => ACTORS[id]).filter(Boolean);

  return (
    <button className={`project-card${active ? ' active' : ''}`} onClick={onOpen}>
      <div className="pc-top">
        <StatusChip status={project.status} />
        <span className="pc-title">{project.title}</span>
        <code className="pc-ref">{project.ref}</code>
      </div>
      {total > 0 ? (
        <div className="pc-progress">
          <span
            style={{
              width: `${(done / total) * 100}%`,
              background: project.status === 'merged' ? 'var(--st-merged)' : undefined,
            }}
          />
        </div>
      ) : null}
      <div className="pc-meta">
        {total > 0 ? (
          <span>
            {done}/{total} tasks · {project.diff.files} files{' '}
            <b className="add">+{project.diff.additions}</b>{' '}
            <b className="del">−{project.diff.deletions}</b> · round {project.round}
          </span>
        ) : (
          <span>The planner is drafting the plan…</span>
        )}
        <span className="pc-spacer" />
        <Facepile actors={watchers} size={16} />
        <span className="pc-open">Transcript →</span>
      </div>
    </button>
  );
}
