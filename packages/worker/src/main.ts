import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getOrCreateTaskWorktree } from '@particle/git';
import {
  fold,
  isConverged,
  newId,
  nextClock,
  type Clock,
  type MessagePosted,
  type ParticleEvent,
  type ProjectCreated,
} from '@particle/core';
import { loadConfig } from './config.ts';
import { GithubIssuesChannel } from './channels/github.ts';
import type { InboundMessage } from './channels/adapter.ts';
import { InstallationTokenProvider, loadAppCreds } from './github/auth.ts';
import type { OpenIssue } from './channels/github.ts';
import { serializeWorkspace } from './serialize.ts';
import { startServer, type UiServer } from './server.ts';
import { openStore } from './store.ts';
import { defaultRules } from './rules.ts';
import { DEFAULT_BUDGETS, Scheduler, type AgentRunContext, type AgentRunner } from './scheduler.ts';
import { SubprocessRunner } from './runner/index.ts';

const STATE_DIR = process.env.PARTICLE_STATE_DIR ?? '.particle';
const CURSOR_PATH = `${STATE_DIR}/cursor.json`;

interface ProjectLog {
  id: string;
  key: string;
  events: ParticleEvent[];
}

/**
 * Give the git store's pushes credentials without ever writing a long-lived
 * secret: GIT_ASKPASS reads a token file that this refresher rewrites (from
 * the app's installation-token provider) before every sync.
 */
function setupGitPushAuth(tokens: InstallationTokenProvider): () => Promise<void> {
  const tokenFile = resolve(STATE_DIR, 'git-token');
  const askpass = resolve(STATE_DIR, 'git-askpass.sh');
  writeFileSync(
    askpass,
    `#!/bin/sh\ncase "$1" in\n  Username*) echo x-access-token ;;\n  *) cat ${JSON.stringify(tokenFile)} ;;\nesac\n`,
  );
  chmodSync(askpass, 0o700);
  process.env.GIT_ASKPASS = askpass;
  process.env.GIT_TERMINAL_PROMPT = '0';
  return async () => {
    writeFileSync(tokenFile, await tokens.get());
    chmodSync(tokenFile, 0o600);
  };
}

class NoopRunner implements AgentRunner {
  async start(ctx: AgentRunContext) {
    console.log(`[${ctx.project}] ${ctx.role}${ctx.taskId ? `(${ctx.taskId})` : ''} queued`);
    return { events: [], exitCode: 0, transcriptPath: '' };
  }
}
function lastClock(log: ProjectLog): Clock | undefined {
  return log.events.at(-1)?.clock;
}

function messageToEvents(
  log: ProjectLog,
  message: InboundMessage,
  repo: string,
  isNew: boolean,
): ParticleEvent[] {
  const events: ParticleEvent[] = [];
  const parents = () => (log.events.length > 0 ? [log.events.at(-1)!.id] : []);
  if (isNew) {
    const created: ParticleEvent<ProjectCreated> = {
      v: 0,
      id: newId('evt'),
      type: 'project.created',
      project: log.id,
      actor: `github:${message.author}`,
      clock: nextClock(lastClock(log), [], new Date(message.at)),
      parents: parents(),
      data: {
        title: message.title,
        source: {
          kind: 'github-issue',
          repo,
          number: Number(message.projectKey.slice('gh-'.length)),
        },
      },
    };
    log.events.push(created);
    events.push(created);
  }
  const posted: ParticleEvent<MessagePosted> = {
    v: 0,
    id: newId('evt'),
    type: 'message.posted',
    project: log.id,
    actor: `github:${message.author}`,
    clock: nextClock(lastClock(log), [], new Date(message.at)),
    parents: parents(),
    data: { body: message.body, via: message.via },
  };
  log.events.push(posted);
  events.push(posted);
  return events;
}

async function main() {
  const once = process.argv.includes('--once');
  const noPoll = process.argv.includes('--no-poll');
  const noSchedule = process.argv.includes('--no-schedule');
  const config = loadConfig(process.env.PARTICLE_CONFIG ?? 'particle.yaml');
  const creds = loadAppCreds(STATE_DIR);
  const [owner] = config.host.repo.split('/');
  const tokens = new InstallationTokenProvider(creds, owner!);
  const channel = new GithubIssuesChannel(
    tokens,
    config.channels.githubIssues,
    creds.slug,
    CURSOR_PATH,
  );
  const store = openStore(STATE_DIR, {
    hostRepo: config.host.repo,
    beforeSync: process.env.PARTICLE_STORE === 'git' ? setupGitPushAuth(tokens) : undefined,
  });
  const operator = process.env.PARTICLE_OPERATOR ?? 'operator';

  console.log(`particle-worker v0 — host ${config.host.repo}, app ${creds.slug} (#${creds.id})`);

  const projects = new Map<string, ProjectLog>();
  let openIssues: OpenIssue[] = [];
  for (const event of await store.load()) {
    if (event.type === 'project.created') {
      const source = (event.data as ProjectCreated).source;
      if (source.kind === 'github-issue') {
        projects.set(`gh-${source.number}`, {
          id: event.project,
          key: `gh-${source.number}`,
          events: [],
        });
      }
    }
    for (const log of projects.values()) {
      if (log.id === event.project) log.events.push(event);
    }
  }
  if (projects.size > 0) {
    console.log(`replayed store: ${projects.size} project(s)`);
  }

  let server: UiServer | undefined;
  if (!process.argv.includes('--no-serve')) {
    const port = Number(process.env.PARTICLE_UI_PORT ?? 7455);
    server = startServer(
      {
        payload: () => serializeWorkspace([...projects.values()], config, operator, openIssues),
        async postMessage(projectId, body) {
          const log = [...projects.values()].find((l) => l.id === projectId);
          if (!log) return false;
          const event: ParticleEvent<MessagePosted> = {
            v: 0,
            id: newId('evt'),
            type: 'message.posted',
            project: log.id,
            actor: `github:${operator}`,
            clock: nextClock(lastClock(log), [], new Date()),
            parents: log.events.length > 0 ? [log.events.at(-1)!.id] : [],
            data: { body },
          };
          log.events.push(event);
          await store.append([event]);
          server?.broadcast();
          if (config.channels.githubIssues.mirror) {
            const state = fold(log.id, log.events);
            if (state.source?.kind === 'github-issue') {
              await channel.post(state.source.number, `**${operator}** via particle:\n\n${body}`);
            }
          }
          return true;
        },
      },
      port,
      'packages/ui/dist',
    );
    console.log(`ui: http://localhost:${port} (api + events; dist served when built)`);
  }

  const runner = config.runner.command
    ? new SubprocessRunner(config.runner.command, {
        timeoutMs: config.runner.timeoutSeconds * 1000,
      })
    : new NoopRunner();
  if (!config.runner.command) {
    console.warn(
      'runner.command is absent; polling remains active but agent scheduling is disabled',
    );
  }
  let worktreeSetup: Promise<void> = Promise.resolve();
  const scheduler = new Scheduler(defaultRules, runner, DEFAULT_BUDGETS, {
    async append(events) {
      await store.append(events);
      for (const event of events) {
        const log = [...projects.values()].find((candidate) => candidate.id === event.project);
        if (log && !log.events.some((existing) => existing.id === event.id)) log.events.push(event);
      }
    },
    workdir(request) {
      const task = request.taskId ?? request.role;
      const next = worktreeSetup.then(() =>
        getOrCreateTaskWorktree(
          process.env.PARTICLE_REPO_DIR ?? process.cwd(),
          request.project,
          task,
        ),
      );
      worktreeSetup = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  });
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
    console.log('\nstopping…');
  };
  // SIGTERM is how systemd asks nicely during a redeploy cutover.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  do {
    try {
      const messages = noPoll ? [] : await channel.poll();
      if (!noPoll) openIssues = await channel.listOpen();
      // Re-evaluate replayed projects too: durable log evidence makes every tick idempotent.
      const touched = new Set(projects.keys());
      const fresh: ParticleEvent[] = [];
      for (const message of messages) {
        let log = projects.get(message.projectKey);
        const isNew = log === undefined;
        if (!log) {
          log = { id: newId('prj'), key: message.projectKey, events: [] };
          projects.set(message.projectKey, log);
        }
        fresh.push(...messageToEvents(log, message, config.channels.githubIssues.repo, isNew));
        touched.add(message.projectKey);
      }
      await store.append(fresh);
      if (fresh.length > 0) server?.broadcast();
      if (config.channels.githubIssues.mirror) {
        for (const log of projects.values()) {
          for (const event of log.events) {
            if (event.type === 'message.posted') {
              await channel.deliver(log.key, event as ParticleEvent<MessagePosted>);
            }
          }
        }
      }
      for (const key of touched) {
        const log = projects.get(key)!;
        // Runner output is itself an event edge. Keep folding until no rule emits anything.
        if (config.runner.command && !noSchedule) {
          for (;;) {
            const before = log.events.length;
            await scheduler.tick(fold(log.id, log.events));
            if (log.events.length === before) break;
          }
        }
        const state = fold(log.id, log.events);
        const tasks = Object.values(state.tasks);
        console.log(
          `[${key}] "${state.title}" msgs=${state.messages.length} tasks=${tasks.filter((t) => t.status === 'done').length}/${tasks.length} status=${state.status}${isConverged(state) ? ' ✓ converged' : ''}`,
        );
      }
      if (touched.size === 0 && !once) {
        process.stdout.write('.');
      }
    } catch (err) {
      console.error(`poll failed: ${(err as Error).message}`);
    }
    if (once || stopping) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      const timer = setTimeout(resolve, config.channels.githubIssues.pollIntervalSeconds * 1000);
      timer.unref?.();
    });
    wake = undefined;
  } while (!stopping);
  server?.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
