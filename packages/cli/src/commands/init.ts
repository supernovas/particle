import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '@particle/worker/config';
import type { CommandContext } from '../context.ts';

function appSlug(stateDir: string): string {
  const meta = JSON.parse(readFileSync(join(stateDir, 'github-app.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const pem = readFileSync(join(stateDir, 'github-app.private-key.pem'), 'utf8');
  if (
    typeof meta.id !== 'number' ||
    typeof meta.slug !== 'string' ||
    typeof meta.client_id !== 'string' ||
    pem.trim() === ''
  ) {
    throw new Error('invalid GitHub App credentials');
  }
  return meta.slug;
}

export async function init(args: string[], context: CommandContext): Promise<number> {
  try {
    parseArgs({ args, strict: true, allowPositionals: false });
  } catch (error) {
    context.stderr(`particle init: ${(error as Error).message}\n`);
    return 2;
  }

  let ok = true;
  const git = context.run('git', ['rev-parse', '--show-toplevel']);
  if (git.status === 0) {
    context.stdout(`ok  git repository (${git.stdout.trim()})\n`);
  } else {
    ok = false;
    context.stderr('missing  git repository (run this command inside a git worktree)\n');
  }

  const configPath = join(context.cwd, 'particle.yaml');
  try {
    loadConfig(configPath);
    context.stdout(`ok  particle.yaml\n`);
  } catch (error) {
    ok = false;
    const detail = existsSync(configPath) ? (error as Error).message : 'file not found';
    context.stderr(`missing  particle.yaml (${detail})\n`);
  }

  const stateDir = join(context.cwd, '.particle');
  try {
    context.stdout(`ok  GitHub App credentials (${appSlug(stateDir)})\n`);
  } catch {
    ok = false;
    context.stderr(
      'missing  GitHub App credentials; run `node scripts/create-github-app.mjs <org>`\n',
    );
  }

  if (ok) context.stdout('particle workspace is ready\n');
  return ok ? 0 : 1;
}
