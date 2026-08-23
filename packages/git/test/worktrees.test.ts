import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
    const { stdout: mainSha } = await exec('git', ['-C', repoDir, 'rev-parse', 'main']);
    await exec('git', ['-C', repoDir, 'checkout', '-b', 'feature']);
    await writeFile(join(repoDir, 'feature.txt'), 'unrelated\n');
    await exec('git', ['-C', repoDir, 'add', 'feature.txt']);
    await exec('git', ['-C', repoDir, 'commit', '-m', 'feature']);

    const path = await createTaskWorktree(repoDir, 'prj_demo', 'tsk_demo');
    roots.push(path);
    const { stdout: branch } = await exec('git', ['-C', path, 'branch', '--show-current']);
    const { stdout: taskSha } = await exec('git', ['-C', path, 'rev-parse', 'HEAD']);
    expect(branch.trim()).toBe('particle/prj_demo/tsk_demo');
    expect(taskSha.trim()).toBe(mainSha.trim());
    await expect(readFile(join(path, 'feature.txt'))).rejects.toThrow();

    await removeTaskWorktree(repoDir, path);
    const { stdout: branches } = await exec('git', ['-C', repoDir, 'branch', '--list']);
    expect(branches).not.toContain('particle/prj_demo/tsk_demo');
    roots.splice(roots.indexOf(path), 1);

    const failedPrefix = 'particle-prj_demo-bad.lock-';
    const beforeFailure = (await readdir(tmpdir())).filter((name) => name.startsWith(failedPrefix));
    await expect(createTaskWorktree(repoDir, 'prj_demo', 'bad.lock')).rejects.toThrow();
    const afterFailure = (await readdir(tmpdir())).filter((name) => name.startsWith(failedPrefix));
    expect(afterFailure).toEqual(beforeFailure);
  });

  it('does not allocate a temporary directory when the default branch is ambiguous', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'particle-worktrees-ambiguous-'));
    roots.push(repoDir);
    await exec('git', ['init', '-b', 'trunk', repoDir]);
    await exec('git', ['-C', repoDir, 'config', 'user.name', 'test']);
    await exec('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    await writeFile(join(repoDir, 'README.md'), 'root\n');
    await exec('git', ['-C', repoDir, 'add', 'README.md']);
    await exec('git', ['-C', repoDir, 'commit', '-m', 'initial']);
    await exec('git', ['-C', repoDir, 'branch', 'feature']);
    const prefix = 'particle-prj_ambiguous-tsk_ambiguous-';
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));

    await expect(createTaskWorktree(repoDir, 'prj_ambiguous', 'tsk_ambiguous')).rejects.toThrow(
      /cannot determine default branch/,
    );
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));
    expect(after).toEqual(before);
  });

  it('refuses to remove a Particle-named worktree it did not create', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'particle-worktrees-unowned-'));
    roots.push(repoDir);
    await exec('git', ['init', '-b', 'main', repoDir]);
    await exec('git', ['-C', repoDir, 'config', 'user.name', 'test']);
    await exec('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    await writeFile(join(repoDir, 'README.md'), 'root\n');
    await exec('git', ['-C', repoDir, 'add', 'README.md']);
    await exec('git', ['-C', repoDir, 'commit', '-m', 'initial']);
    const path = await mkdtemp(join(tmpdir(), 'particle-unowned-'));
    roots.push(path);
    await exec('git', [
      '-C',
      repoDir,
      'worktree',
      'add',
      path,
      '-b',
      'particle/unrelated/manual',
      'main',
    ]);
    await writeFile(join(path, 'dirty.txt'), 'preserve me\n');

    await expect(removeTaskWorktree(repoDir, path)).rejects.toThrow(/unowned task worktree/);
    await expect(readFile(join(path, 'dirty.txt'), 'utf8')).resolves.toBe('preserve me\n');
    const { stdout: branch } = await exec('git', ['-C', path, 'branch', '--show-current']);
    expect(branch.trim()).toBe('particle/unrelated/manual');

    await exec('git', ['-C', repoDir, 'worktree', 'remove', '--force', path]);
    await exec('git', ['-C', repoDir, 'branch', '-D', 'particle/unrelated/manual']);
    roots.splice(roots.indexOf(path), 1);
  });

  it('retries branch cleanup after a partial removal', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'particle-worktrees-retry-'));
    roots.push(repoDir);
    await exec('git', ['init', '-b', 'main', repoDir]);
    await exec('git', ['-C', repoDir, 'config', 'user.name', 'test']);
    await exec('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    await writeFile(join(repoDir, 'README.md'), 'root\n');
    await exec('git', ['-C', repoDir, 'add', 'README.md']);
    await exec('git', ['-C', repoDir, 'commit', '-m', 'initial']);
    const path = await createTaskWorktree(repoDir, 'prj_retry', 'tsk_retry');
    roots.push(path);
    const competingPath = await mkdtemp(join(tmpdir(), 'particle-worktrees-competing-'));
    roots.push(competingPath);
    await exec('git', [
      '-C',
      repoDir,
      'worktree',
      'add',
      '--force',
      '--force',
      competingPath,
      'particle/prj_retry/tsk_retry',
    ]);

    await expect(removeTaskWorktree(repoDir, path)).rejects.toThrow();
    await expect(readFile(join(path, 'README.md'))).rejects.toThrow();
    roots.splice(roots.indexOf(path), 1);

    await exec('git', ['-C', repoDir, 'worktree', 'remove', '--force', competingPath]);
    roots.splice(roots.indexOf(competingPath), 1);
    await expect(removeTaskWorktree(repoDir, path)).resolves.toBeUndefined();
    const { stdout: branches } = await exec('git', ['-C', repoDir, 'branch', '--list']);
    expect(branches).not.toContain('particle/prj_retry/tsk_retry');
  });

  it('refuses a replacement worktree at a stale owned path and branch', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'particle-worktrees-replaced-'));
    roots.push(repoDir);
    await exec('git', ['init', '-b', 'main', repoDir]);
    await exec('git', ['-C', repoDir, 'config', 'user.name', 'test']);
    await exec('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    await writeFile(join(repoDir, 'README.md'), 'root\n');
    await exec('git', ['-C', repoDir, 'add', 'README.md']);
    await exec('git', ['-C', repoDir, 'commit', '-m', 'initial']);
    const path = await createTaskWorktree(repoDir, 'prj_replaced', 'tsk_replaced');
    roots.push(path);
    await exec('git', ['-C', repoDir, 'worktree', 'remove', '--force', path]);
    roots.splice(roots.indexOf(path), 1);
    await exec('git', [
      '-C',
      repoDir,
      'worktree',
      'add',
      path,
      'particle/prj_replaced/tsk_replaced',
    ]);
    roots.push(path);
    await writeFile(join(path, 'dirty.txt'), 'replacement data\n');

    await expect(removeTaskWorktree(repoDir, path)).rejects.toThrow(/replacement task worktree/);
    await expect(readFile(join(path, 'dirty.txt'), 'utf8')).resolves.toBe('replacement data\n');

    await exec('git', ['-C', repoDir, 'worktree', 'remove', '--force', path]);
    await exec('git', ['-C', repoDir, 'branch', '-D', 'particle/prj_replaced/tsk_replaced']);
    roots.splice(roots.indexOf(path), 1);
  });
});
