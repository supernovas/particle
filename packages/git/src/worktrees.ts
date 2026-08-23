import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIn } from './git.ts';

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Create an isolated task branch and worktree from the repository's default branch. */
export async function createTaskWorktree(
  repoDir: string,
  project: string,
  task: string,
): Promise<string> {
  assertSegment(project, 'project');
  assertSegment(task, 'task');
  const path = await mkdtemp(join(tmpdir(), `particle-${project}-${task}-`));
  const branch = `particle/${project}/${task}`;
  const start = await defaultBranch(repoDir);
  await runIn(repoDir, ['worktree', 'add', path, '-b', branch, start]);
  return path;
}

/** Remove an isolated task worktree and its task branch. */
export async function removeTaskWorktree(repoDir: string, path: string): Promise<void> {
  const branch = (await runIn(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  if (!branch.startsWith('particle/'))
    throw new Error(`refusing to delete non-Particle branch: ${branch}`);
  await runIn(repoDir, ['worktree', 'remove', '--force', path]);
  await runIn(repoDir, ['branch', '-D', branch]);
}

async function defaultBranch(repoDir: string): Promise<string> {
  try {
    return (
      await runIn(repoDir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    ).trim();
  } catch {
    return (await runIn(repoDir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  }
}

function assertSegment(value: string, label: string): void {
  if (!SEGMENT.test(value) || value === '.' || value === '..') {
    throw new TypeError(`invalid ${label} branch segment: ${value}`);
  }
}
