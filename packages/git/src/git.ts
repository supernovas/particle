import { execFile } from 'node:child_process';

export interface RunOptions {
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export class GitError extends Error {
  readonly args: string[];
  readonly stderr: string;
  readonly stdout: string;

  constructor(args: string[], stderr: string, stdout: string) {
    const detail = stderr.trim() || stdout.trim() || 'git command failed';
    super(`git ${args.join(' ')}: ${detail}`);
    this.name = 'GitError';
    this.args = args;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

/** Run git against a bare repository or a worktree's .git directory. */
export async function run(
  gitDir: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  const gitArgs = ['--git-dir', gitDir, ...args];
  return execute(gitArgs, options);
}

/** Run git from a repository worktree (used only by worktree management). */
export async function runIn(repoDir: string, args: string[]): Promise<string> {
  const gitArgs = ['-C', repoDir, ...args];
  return execute(gitArgs);
}

function execute(args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        encoding: 'utf8',
        env: options.env ? { ...process.env, ...options.env } : process.env,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('git executable not found'));
          return;
        }
        reject(new GitError(args, stderr, stdout));
      },
    );
    child.stdin?.end(options.input);
  });
}
