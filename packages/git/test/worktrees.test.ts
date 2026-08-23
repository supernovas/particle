import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createTaskWorktree, removeTaskWorktree } from '../src/worktrees.ts';

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('task worktrees', () => {
  it('creates an isolated task branch from the default branch and disposes both', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'particle-worktrees-'));
    roots.push(repoDir);
    await exec('git', ['init', '-b', 'main', repoDir]);
    await exec('git', ['-C', repoDir, 'config', 'user.name', 'test']);
    await exec('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    await writeFile(join(repoDir, 'README.md'), 'root\n');
    await exec('git', ['-C', repoDir, 'add', 'README.md']);
    await exec('git', ['-C', repoDir, 'commit', '-m', 'initial']);

    const path = await createTaskWorktree(repoDir, 'prj_demo', 'tsk_demo');
    roots.push(path);
    const { stdout: branch } = await exec('git', ['-C', path, 'branch', '--show-current']);
    expect(branch.trim()).toBe('particle/prj_demo/tsk_demo');

    await removeTaskWorktree(repoDir, path);
    const { stdout: branches } = await exec('git', ['-C', repoDir, 'branch', '--list']);
    expect(branches).not.toContain('particle/prj_demo/tsk_demo');
    roots.splice(roots.indexOf(path), 1);
  });
});
