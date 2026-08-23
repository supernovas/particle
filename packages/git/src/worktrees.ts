import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  const branch = `particle/${project}/${task}`;
  const start = await defaultBranch(repoDir);
  if (await refExists(repoDir, `refs/heads/${branch}`)) {
    throw new Error(`task branch already exists: ${branch}`);
  }

  const path = await mkdtemp(join(tmpdir(), `particle-${project}-${task}-`));
  try {
    await runIn(repoDir, ['worktree', 'add', path, '-b', branch, start]);
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }

  try {
    return await writeOwnership(repoDir, path, branch);
  } catch (error) {
    await runIn(repoDir, ['worktree', 'remove', '--force', path]).catch(() => undefined);
    await runIn(repoDir, ['branch', '-D', branch]).catch(() => undefined);
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}

/** Return Particle's owned task worktree, creating it on the first attempt. */
export async function getOrCreateTaskWorktree(
  repoDir: string,
  project: string,
  task: string,
): Promise<string> {
  assertSegment(project, 'project');
  assertSegment(task, 'task');
  const branch = `particle/${project}/${task}`;
  const registered = (await registeredWorktrees(repoDir)).find((entry) => entry.branch === branch);
  if (!registered) {
    if (await refExists(repoDir, `refs/heads/${branch}`)) {
      throw new Error(`task branch exists without an owned worktree: ${branch}`);
    }
    return createTaskWorktree(repoDir, project, task);
  }

  const ownership = await readOwnership(repoDir, registered.path);
  if (ownership.branch !== branch) {
    throw new Error(`task worktree branch does not match ownership marker: ${ownership.branch}`);
  }
  await verifyWorktreeIdentity(registered.path, ownership.nonce);
  return registered.path;
}

/** Remove an isolated task worktree and its task branch. */
export async function removeTaskWorktree(repoDir: string, path: string): Promise<void> {
  let ownership = await readOwnership(repoDir, path);
  const registered = await registeredWorktreeAt(repoDir, ownership.registeredPath);
  if (registered && registered.branch !== ownership.branch) {
    throw new Error(`task worktree branch does not match ownership marker: ${registered.branch}`);
  }
  if (registered) {
    await verifyWorktreeIdentity(registered.path, ownership.nonce);
    const expectedTip = await readRef(repoDir, `refs/heads/${ownership.branch}`);
    if (!expectedTip) {
      throw new Error(`task worktree branch is missing: ${ownership.branch}`);
    }
    ownership = { ...ownership, phase: 'removing', expectedTip };
    await replaceOwnershipMarker(ownership);
    await runIn(repoDir, ['worktree', 'remove', '--force', registered.path]);
  } else if (ownership.phase === 'active') {
    if (await refExists(repoDir, `refs/heads/${ownership.branch}`)) {
      throw new Error(`refusing to delete branch from stale ownership marker: ${ownership.branch}`);
    }
    await rm(ownership.marker);
    return;
  }

  const checkedOut = (await registeredWorktrees(repoDir)).find(
    ({ branch }) => branch === ownership.branch,
  );
  if (checkedOut) {
    throw new Error(`task branch is checked out in another worktree: ${checkedOut.path}`);
  }
  const branchRef = `refs/heads/${ownership.branch}`;
  const actualTip = await readRef(repoDir, branchRef);
  if (actualTip) {
    if (actualTip !== ownership.expectedTip) {
      throw new Error(`refusing to remove replacement task branch: ${ownership.branch}`);
    }
    await runIn(repoDir, ['update-ref', '-d', branchRef, ownership.expectedTip]);
  }
  await rm(ownership.marker);
}

async function defaultBranch(repoDir: string): Promise<string> {
  try {
    return (
      await runIn(repoDir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    ).trim();
  } catch {
    const configured = await configuredDefaultBranch(repoDir);
    if (configured) return configured;
    for (const conventional of ['main', 'master']) {
      if (await refExists(repoDir, `refs/heads/${conventional}`)) return conventional;
    }
    const branches = (
      await runIn(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    if (branches.length === 1) return branches[0]!;
    throw new Error('cannot determine default branch; configure origin/HEAD or init.defaultBranch');
  }
}

async function configuredDefaultBranch(repoDir: string): Promise<string | undefined> {
  try {
    const branch = (await runIn(repoDir, ['config', '--get', 'init.defaultBranch'])).trim();
    return branch && (await refExists(repoDir, `refs/heads/${branch}`)) ? branch : undefined;
  } catch {
    return undefined;
  }
}

async function refExists(repoDir: string, ref: string): Promise<boolean> {
  try {
    await runIn(repoDir, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

async function readRef(repoDir: string, ref: string): Promise<string | undefined> {
  try {
    return (await runIn(repoDir, ['rev-parse', '--verify', ref])).trim();
  } catch {
    return undefined;
  }
}

interface RegisteredWorktree {
  path: string;
  branch: string;
}

async function registeredWorktrees(repoDir: string): Promise<RegisteredWorktree[]> {
  const blocks = (await runIn(repoDir, ['worktree', 'list', '--porcelain'])).split('\n\n');
  const worktrees: RegisteredWorktree[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const worktree = lines[0]?.startsWith('worktree ') ? lines[0].slice('worktree '.length) : '';
    if (!worktree) continue;
    const branch = lines.find((line) => line.startsWith('branch '));
    if (!branch?.startsWith('branch refs/heads/')) continue;
    worktrees.push({ path: worktree, branch: branch.slice('branch refs/heads/'.length) });
  }
  return worktrees;
}

async function registeredWorktreeAt(
  repoDir: string,
  registeredPath: string,
): Promise<RegisteredWorktree | undefined> {
  return (await registeredWorktrees(repoDir)).find(({ path }) => path === registeredPath);
}

async function registeredWorktreeForBranch(
  repoDir: string,
  branch: string,
): Promise<RegisteredWorktree> {
  const matches = (await registeredWorktrees(repoDir)).filter((entry) => entry.branch === branch);
  if (matches.length !== 1) {
    throw new Error(`expected one registered worktree for ${branch}, found ${matches.length}`);
  }
  return matches[0]!;
}

interface OwnershipBase {
  path: string;
  registeredPath: string;
  branch: string;
  nonce: string;
  marker: string;
}

type Ownership = OwnershipBase &
  ({ phase: 'active'; expectedTip?: never } | { phase: 'removing'; expectedTip: string });

async function writeOwnership(repoDir: string, path: string, branch: string): Promise<string> {
  const registered = await registeredWorktreeForBranch(repoDir, branch);
  const marker = await markerPath(repoDir, registered.path);
  await mkdir(resolve(marker, '..'), { recursive: true });
  const nonce = randomBytes(32).toString('hex');
  const identity = await worktreeIdentityPath(registered.path);
  await writeFile(identity, `${nonce}\n`, { flag: 'wx' });
  const ownership = {
    path: resolve(registered.path),
    registeredPath: registered.path,
    branch,
    nonce,
    phase: 'active',
  };
  await writeFile(marker, `${JSON.stringify(ownership)}\n`, { flag: 'wx' });
  return registered.path;
}

async function replaceOwnershipMarker(ownership: Ownership): Promise<void> {
  const temporary = `${ownership.marker}.tmp-${randomBytes(16).toString('hex')}`;
  const { marker: _marker, ...serialized } = ownership;
  try {
    await writeFile(temporary, `${JSON.stringify(serialized)}\n`, { flag: 'wx' });
    await rename(temporary, ownership.marker);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readOwnership(repoDir: string, path: string): Promise<Ownership> {
  const marker = await markerPath(repoDir, path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(marker, 'utf8'));
  } catch {
    throw new Error(`refusing to remove unowned task worktree: ${resolve(path)}`);
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('path' in value) ||
    value.path !== resolve(path) ||
    !('registeredPath' in value) ||
    typeof value.registeredPath !== 'string' ||
    !('branch' in value) ||
    typeof value.branch !== 'string' ||
    !('nonce' in value) ||
    typeof value.nonce !== 'string' ||
    !('phase' in value) ||
    (value.phase !== 'active' && value.phase !== 'removing')
  ) {
    throw new Error(`invalid task worktree ownership marker: ${marker}`);
  }
  const base = {
    path: value.path as string,
    registeredPath: value.registeredPath,
    branch: value.branch,
    nonce: value.nonce,
    marker,
  };
  if (value.phase === 'active') return { ...base, phase: 'active' };
  if (!('expectedTip' in value) || typeof value.expectedTip !== 'string') {
    throw new Error(`invalid task worktree ownership marker: ${marker}`);
  }
  return { ...base, phase: 'removing', expectedTip: value.expectedTip };
}

async function verifyWorktreeIdentity(path: string, nonce: string): Promise<void> {
  try {
    const actual = (await readFile(await worktreeIdentityPath(path), 'utf8')).trim();
    if (actual === nonce) return;
  } catch {
    // Missing identity means this path now belongs to a different worktree.
  }
  throw new Error(`refusing to remove replacement task worktree: ${path}`);
}

async function worktreeIdentityPath(path: string): Promise<string> {
  const gitDir = (await runIn(path, ['rev-parse', '--git-dir'])).trim();
  return join(resolve(path, gitDir), 'particle-owner');
}

async function markerPath(repoDir: string, path: string): Promise<string> {
  const common = (await runIn(repoDir, ['rev-parse', '--git-common-dir'])).trim();
  const commonDir = resolve(repoDir, common);
  const key = createHash('sha256').update(resolve(path)).digest('hex');
  return join(commonDir, 'particle', 'worktrees', `${key}.json`);
}

function assertSegment(value: string, label: string): void {
  if (!SEGMENT.test(value) || value === '.' || value === '..') {
    throw new TypeError(`invalid ${label} branch segment: ${value}`);
  }
}
