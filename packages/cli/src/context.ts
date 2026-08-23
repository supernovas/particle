import { spawnSync } from 'node:child_process';

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now: () => Date;
  run: (command: string, args: string[]) => CommandResult;
}

export function workspaceRoot(context: CommandContext): string {
  const result = context.run('git', ['rev-parse', '--show-toplevel']);
  const root = result.stdout.trim();
  return result.status === 0 && root !== '' ? root : context.cwd;
}

export function defaultContext(): CommandContext {
  const cwd = process.cwd();
  return {
    cwd,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    now: () => new Date(),
    run(command, args) {
      const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? result.error?.message ?? '',
      };
    },
  };
}
