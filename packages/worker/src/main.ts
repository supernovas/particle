import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { InstallationTokenProvider, loadAppCreds } from './github/auth.ts';
import { emptyCursor, IssueChannel, type Cursor, type Prompt } from './github/issues.ts';
import { Journal } from './journal.ts';
import { serializeWorkspace } from './serialize.ts';
import { startServer, type UiServer } from './server.ts';

const STATE_DIR = '.particle';
const CURSOR_PATH = `${STATE_DIR}/cursor.json`;

interface ProjectLog {
  id: string;
  key: string;
  events: ParticleEvent[];
}

function loadCursor(): Cursor {
  return existsSync(CURSOR_PATH)
    ? (JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) as Cursor)
    : emptyCursor();
}

function lastClock(log: ProjectLog): Clock | undefined {
  return log.events.at(-1)?.clock;
}

function promptToEvents(log: ProjectLog, prompt: Prompt, isNew: boolean): ParticleEvent[] {
  const events: ParticleEvent[] = [];
  const parents = () => (log.events.length > 0 ? [log.events.at(-1)!.id] : []);
  if (isNew) {
    const created: ParticleEvent<ProjectCreated> = {
      v: 0,
      id: newId('evt'),
      type: 'project.created',
      project: log.id,
      actor: `github:${prompt.author}`,
      clock: nextClock(lastClock(log), [], new Date(prompt.at)),
      parents: parents(),
      data: {
        title: prompt.issueTitle,
        source: {
          kind: 'github-issue',
          repo: prompt.url.split('/issues/')[0]!.replace('https://github.com/', ''),
          number: prompt.issueNumber,
        },
      },
    };
    log.events.push(created);
    events.push(created);
  }
  const message: ParticleEvent<MessagePosted> = {
    v: 0,
    id: newId('evt'),
    type: 'message.posted',
    project: log.id,
    actor: `github:${prompt.author}`,
    clock: nextClock(lastClock(log), [], new Date(prompt.at)),
    parents: parents(),
    data: { body: prompt.body, via: prompt.url },
  };
  log.events.push(message);
  events.push(message);
  return events;
}

async function main() {
  const once = process.argv.includes('--once');
  const config = loadConfig();
  const creds = loadAppCreds(STATE_DIR);
  const [owner] = config.host.repo.split('/');
  const tokens = new InstallationTokenProvider(creds, owner!);
  const channel = new IssueChannel(tokens, config.channels.githubIssues, creds.slug);
  const journal = new Journal(`${STATE_DIR}/journal.ndjson`);
  const operator = process.env.PARTICLE_OPERATOR ?? 'operator';

  console.log(`particle-worker v0 — host ${config.host.repo}, app ${creds.slug} (#${creds.id})`);

  const projects = new Map<string, ProjectLog>();
  for (const event of journal.load()) {
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
    console.log(`replayed journal: ${projects.size} project(s)`);
  }

  let server: UiServer | undefined;
  if (!process.argv.includes('--no-serve')) {
    const port = Number(process.env.PARTICLE_UI_PORT ?? 7455);
    server = startServer(
      {
        payload: () => serializeWorkspace([...projects.values()], config, operator),
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
          journal.append([event]);
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

  let cursor = loadCursor();
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('\nstopping…');
  });

  do {
    try {
      const result = await channel.poll(cursor);
      cursor = result.cursor;
      const touched = new Set<string>();
      const fresh: ParticleEvent[] = [];
      for (const prompt of result.prompts) {
        let log = projects.get(prompt.projectKey);
        const isNew = log === undefined;
        if (!log) {
          log = { id: newId('prj'), key: prompt.projectKey, events: [] };
          projects.set(prompt.projectKey, log);
        }
        fresh.push(...promptToEvents(log, prompt, isNew));
        touched.add(prompt.projectKey);
      }
      journal.append(fresh);
      if (fresh.length > 0) server?.broadcast();
      writeFileSync(CURSOR_PATH, JSON.stringify(cursor, null, 2) + '\n');
      for (const key of touched) {
        const log = projects.get(key)!;
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
    await new Promise((resolve) =>
      setTimeout(resolve, config.channels.githubIssues.pollIntervalSeconds * 1000),
    );
  } while (!stopping);
  server?.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
