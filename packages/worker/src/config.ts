import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface GithubIssuesChannelConfig {
  repo: string;
  /** Issues carrying this label become particle projects. */
  label: string;
  /** Issue numbers that are projects regardless of label (e.g. the founding issue). */
  seedIssues: number[];
  pollIntervalSeconds: number;
  /** When true, agent-authored project messages are mirrored back as issue comments. */
  mirror: boolean;
}

export interface Config {
  host: { repo: string };
  channels: { githubIssues: GithubIssuesChannelConfig };
  runner: { command: string[] | null };
}

export function loadConfig(path = 'particle.yaml'): Config {
  const raw = parse(readFileSync(path, 'utf8')) as Record<string, any>;
  const host = raw?.host ?? {};
  const gh = raw?.channels?.['github-issues'] ?? {};
  if (typeof host.repo !== 'string' || !host.repo.includes('/')) {
    throw new Error(`${path}: host.repo must be "owner/name"`);
  }
  return {
    host: { repo: host.repo },
    channels: {
      githubIssues: {
        repo: typeof gh.repo === 'string' ? gh.repo : host.repo,
        label: typeof gh.label === 'string' ? gh.label : 'particle:project',
        seedIssues: Array.isArray(gh['seed-issues']) ? gh['seed-issues'].map(Number) : [],
        pollIntervalSeconds: Number(gh['poll-interval-seconds'] ?? 15),
        mirror: gh.mirror === true,
      },
    },
    runner: { command: Array.isArray(raw?.runner?.command) ? raw.runner.command : null },
  };
}
