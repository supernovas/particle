import type { ProjectStatus } from '../types';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  open: 'Open',
  planning: 'Planning',
  executing: 'Executing',
  review: 'In review',
  changes: 'Changes requested',
  converged: 'Converged',
  abandoned: 'Abandoned',
};

/** Statuses where agents are actively producing turns. */
export const LIVE_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  'open',
  'planning',
  'executing',
  'review',
  'changes',
]);

export function StatusDot({ status }: { status: ProjectStatus }) {
  const live = LIVE_STATUSES.has(status);
  return <span className={`status-dot st-${status}${live ? ' live' : ''}`} />;
}

export function StatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status-chip st-${status}`}>
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
