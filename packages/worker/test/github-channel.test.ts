import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePosted, ParticleEvent } from '@particle/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubIssuesChannelConfig } from '../src/config.ts';
import { GithubIssuesChannel, type GithubCursor } from '../src/channels/github.ts';
import type { InstallationTokenProvider } from '../src/github/auth.ts';
import fixture from './fixtures/github-issues.json' with { type: 'json' };

const cfg: GithubIssuesChannelConfig = {
  repo: 'supernovas/particle',
  label: 'particle:project',
  seedIssues: [],
  pollIntervalSeconds: 15,
  mirror: true,
};

const tokens = {
  get: vi.fn(async () => 'installation-token'),
} as unknown as InstallationTokenProvider;

function agentMessage(id: string, via?: string): ParticleEvent<MessagePosted> {
  return {
    v: 0,
    id,
    type: 'message.posted',
    project: 'prj_01J00000000000000000000000',
    actor: 'agent:planner/run_01J00000000000000000000000',
    clock: { lamport: 1, wall: '2026-08-23T10:03:00.000Z' },
    parents: [],
    data: { body: 'First line\nsecond line', via },
  };
}

describe('GithubIssuesChannel', () => {
  let directory: string;
  let cursorPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'particle-github-channel-'));
    cursorPath = join(directory, 'cursor.json');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true });
  });

  it('polls fixture messages, excludes the app bot, and ignores edits after restart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/comments')) {
          if (url.searchParams.get('page') === '2') {
            return Response.json(fixture.comments_page_2['7']);
          }
          return Response.json(fixture.comments['7'], {
            headers: {
              link: '<https://api.github.com/repos/supernovas/particle/issues/7/comments?per_page=100&page=2>; rel="next"',
            },
          });
        }
        if (url.searchParams.get('page') === '2') return Response.json(fixture.issues_page_2);
        return Response.json(fixture.issues, {
          headers: {
            link: '<https://api.github.com/repos/supernovas/particle/issues?state=open&per_page=100&page=2>; rel="next"',
          },
        });
      }),
    );

    const first = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath);
    await expect(first.poll()).resolves.toEqual([
      {
        projectKey: 'gh-7',
        title: 'Bootstrap the worker',
        author: 'drx',
        body: 'Please build the worker.',
        via: 'https://github.com/supernovas/particle/issues/7',
        at: '2026-08-23T10:00:00Z',
      },
      {
        projectKey: 'gh-7',
        title: 'Bootstrap the worker',
        author: 'reviewer',
        body: 'Use the protocol spec.',
        via: 'https://github.com/supernovas/particle/issues/7#issuecomment-102',
        at: '2026-08-23T10:02:00Z',
      },
      {
        projectKey: 'gh-7',
        title: 'Bootstrap the worker',
        author: 'maintainer',
        body: 'Pagination works.',
        via: 'https://github.com/supernovas/particle/issues/7#issuecomment-103',
        at: '2026-08-23T10:03:00Z',
      },
      {
        projectKey: 'gh-8',
        title: 'Review the worker',
        author: 'maintainer',
        body: 'Please review the implementation.',
        via: 'https://github.com/supernovas/particle/issues/8',
        at: '2026-08-23T10:03:00Z',
      },
    ]);

    const restarted = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath);
    await expect(restarted.poll()).resolves.toEqual([]);
    const cursor = JSON.parse(readFileSync(cursorPath, 'utf8')) as GithubCursor;
    expect(cursor.issues['7']).toEqual({ lastCommentId: 103 });
  });

  it('posts an event once, including across concurrent calls and restart', async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        posts.push(String(init?.body));
        return Response.json(fixture.posted);
      }),
    );
    const event = agentMessage('evt_01J00000000000000000000001');
    const channel = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath);

    await Promise.all([channel.deliver('gh-7', event), channel.deliver('gh-7', event)]);
    const restarted = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath);
    await restarted.deliver('gh-7', event);

    expect(posts).toEqual([JSON.stringify({ body: '**planner** · First line second line' })]);
    const cursor = JSON.parse(readFileSync(cursorPath, 'utf8')) as GithubCursor;
    expect(cursor.delivered[event.id]).toBe(true);
  });

  it('does not mirror human messages or events originating from the target issue', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const channel = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath);
    const fromIssue = agentMessage(
      'evt_01J00000000000000000000002',
      'https://github.com/supernovas/particle/issues/7#issuecomment-102',
    );
    const human = {
      ...agentMessage('evt_01J00000000000000000000003'),
      actor: 'github:drx' as const,
    };

    await channel.deliver('gh-7', fromIssue);
    await channel.deliver('gh-7', human);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps outbound mirroring disabled by default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const channel = new GithubIssuesChannel(
      tokens,
      { ...cfg, mirror: false },
      'particle-agent',
      cursorPath,
    );

    await channel.deliver('gh-7', agentMessage('evt_01J00000000000000000000006'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves direct issue posting for the local UI channel seam', async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        posts.push(String(init?.body));
        return Response.json(fixture.posted);
      }),
    );
    const channel = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath);

    await expect(channel.post(7, '**operator** via particle:\n\nHello')).resolves.toBe(
      fixture.posted.html_url,
    );
    expect(posts).toEqual([JSON.stringify({ body: '**operator** via particle:\n\nHello' })]);
  });

  it('spaces posts and waits for a primary rate-limit reset before retrying', async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const postTimes: number[] = [];
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        postTimes.push(now);
        attempts += 1;
        if (attempts === 2) {
          return new Response('rate limited', {
            status: 403,
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': '4',
            },
          });
        }
        return Response.json(fixture.posted);
      }),
    );
    const channel = new GithubIssuesChannel(tokens, cfg, 'particle-agent', cursorPath, {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await channel.deliver('gh-7', agentMessage('evt_01J00000000000000000000004'));
    await channel.deliver('gh-7', agentMessage('evt_01J00000000000000000000005'));

    expect(postTimes).toEqual([1_000, 2_000, 4_000]);
    expect(sleeps).toEqual([1_000, 2_000]);
  });
});
