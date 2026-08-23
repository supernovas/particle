import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MessagePosted, ParticleEvent } from '@particle/core';
import type { GithubIssuesChannelConfig } from '../config.ts';
import {
  ghJson,
  ghJsonResponse,
  GithubApiError,
  type InstallationTokenProvider,
} from '../github/auth.ts';
import type { ChannelAdapter, InboundMessage } from './adapter.ts';

export interface GithubCursor {
  /** Per issue number: highest comment id already turned into a message. */
  issues: Record<string, { lastCommentId: number }>;
  /** Event ids successfully posted by this adapter. */
  delivered: Record<string, true>;
}

export const emptyGithubCursor = (): GithubCursor => ({ issues: {}, delivered: {} });
export const emptyCursor = emptyGithubCursor;
export type Cursor = GithubCursor;

interface Timing {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const defaultTiming: Timing = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Bidirectional GitHub Issues channel with durable loop and delivery guards. */
export class IssueChannel implements ChannelAdapter {
  readonly name = 'github-issues';
  private readonly timing: Timing;
  private cursor: GithubCursor;
  private nextPostAt = 0;
  private deliveryQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly tokens: InstallationTokenProvider,
    private readonly cfg: GithubIssuesChannelConfig,
    private readonly botSlug: string,
    private readonly cursorPath: string,
    timing: Timing = defaultTiming,
  ) {
    this.timing = timing;
    this.cursor = this.loadCursor();
  }

  private loadCursor(): GithubCursor {
    if (!existsSync(this.cursorPath)) return emptyGithubCursor();
    const saved = JSON.parse(readFileSync(this.cursorPath, 'utf8')) as Partial<GithubCursor>;
    return {
      issues: saved.issues ?? {},
      delivered: saved.delivered ?? {},
    };
  }

  private saveCursor(): void {
    mkdirSync(dirname(this.cursorPath), { recursive: true });
    writeFileSync(this.cursorPath, JSON.stringify(this.cursor, null, 2) + '\n');
  }

  private isSelf(user: { login?: string; type?: string }): boolean {
    return user.type === 'Bot' && user.login === `${this.botSlug}[bot]`;
  }

  async poll(): Promise<InboundMessage[]> {
    const token = await this.tokens.get();
    const issues = new Map<number, any>();

    const labeled = await this.listPages(
      `/repos/${this.cfg.repo}/issues?state=open&labels=${encodeURIComponent(this.cfg.label)}&per_page=100`,
      token,
    );
    for (const issue of labeled) if (!issue.pull_request) issues.set(issue.number, issue);
    for (const number of this.cfg.seedIssues) {
      if (!issues.has(number)) {
        const issue = await ghJson(`/repos/${this.cfg.repo}/issues/${number}`, token);
        if (!issue.pull_request) issues.set(number, issue);
      }
    }

    const messages: InboundMessage[] = [];
    for (const [number, issue] of issues) {
      const key = String(number);
      const known = this.cursor.issues[key];
      if (!known) {
        messages.push({
          projectKey: `gh-${number}`,
          title: issue.title,
          author: issue.user.login,
          body: issue.body ?? '',
          via: issue.html_url,
          at: issue.created_at,
        });
      }

      let lastCommentId = known?.lastCommentId ?? 0;
      if (issue.comments > 0) {
        const comments = await this.listPages(
          `/repos/${this.cfg.repo}/issues/${number}/comments?per_page=100`,
          token,
        );
        for (const comment of comments) {
          if (comment.id <= lastCommentId) continue;
          lastCommentId = Math.max(lastCommentId, comment.id);
          if (this.isSelf(comment.user)) continue;
          messages.push({
            projectKey: `gh-${number}`,
            title: issue.title,
            author: comment.user.login,
            body: comment.body ?? '',
            via: comment.html_url,
            at: comment.created_at,
          });
        }
      }
      // Cursoring by immutable comment id deliberately ignores later edits and deletes in v0.
      this.cursor.issues[key] = { lastCommentId };
    }
    this.saveCursor();
    return messages;
  }

  private async listPages(path: string, token: string): Promise<any[]> {
    const items: any[] = [];
    let next: string | undefined = path;
    while (next) {
      const response = await ghJsonResponse(next, token);
      if (!Array.isArray(response.data)) {
        throw new Error(`Expected a GitHub list response for ${next}`);
      }
      items.push(...response.data);
      next = this.nextPage(response.headers.get('link'));
    }
    return items;
  }

  private nextPage(link: string | null): string | undefined {
    if (!link) return undefined;
    for (const entry of link.split(',')) {
      const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(entry);
      if (match?.[2] !== 'next') continue;
      const url = new URL(match[1]!);
      if (url.origin !== 'https://api.github.com') {
        throw new Error(`Refusing unexpected GitHub pagination URL: ${url.origin}`);
      }
      return `${url.pathname}${url.search}`;
    }
    return undefined;
  }

  deliver(projectKey: string, event: ParticleEvent<MessagePosted>): Promise<void> {
    return this.enqueue(() => this.deliverOnce(projectKey, event));
  }

  /** Compatibility write used by the local UI for human-authored messages. */
  post(issueNumber: number, body: string): Promise<string> {
    return this.enqueue(() => this.postComment(issueNumber, body));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.deliveryQueue.then(operation);
    this.deliveryQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async deliverOnce(
    projectKey: string,
    event: ParticleEvent<MessagePosted>,
  ): Promise<void> {
    if (!this.cfg.mirror) return;
    if (event.type !== 'message.posted' || !event.actor.startsWith('agent:')) return;
    if (this.cursor.delivered[event.id]) return;

    const match = /^gh-(\d+)$/.exec(projectKey);
    if (!match) throw new Error(`Invalid GitHub project key: ${projectKey}`);
    const issueNumber = Number(match[1]);
    if (this.pointsAtTarget(event.data.via, issueNumber)) return;

    const role = event.actor.slice('agent:'.length).split('/')[0]!;
    const oneLine = event.data.body.replace(/\s+/g, ' ').trim();
    const body = `**${role}** · ${oneLine}`;
    await this.postComment(issueNumber, body);
    this.cursor.delivered[event.id] = true;
    this.saveCursor();
  }

  private async postComment(issueNumber: number, body: string): Promise<string> {
    const token = await this.tokens.get();

    for (;;) {
      await this.waitForPostSlot();
      try {
        const response = await ghJson(
          `/repos/${this.cfg.repo}/issues/${issueNumber}/comments`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({ body }),
          },
        );
        return response.html_url;
      } catch (error) {
        if (
          error instanceof GithubApiError &&
          error.status === 403 &&
          error.rateLimitRemaining === '0'
        ) {
          const parsedResetAt = Number(error.rateLimitReset) * 1000;
          const resetAt = Number.isFinite(parsedResetAt) ? parsedResetAt : this.timing.now() + 1000;
          await this.timing.sleep(Math.max(0, resetAt - this.timing.now()));
          continue;
        }
        throw error;
      }
    }
  }

  private pointsAtTarget(via: string | undefined, issueNumber: number): boolean {
    if (!via) return false;
    try {
      const url = new URL(via);
      return (
        url.hostname === 'github.com' &&
        url.pathname.startsWith(`/${this.cfg.repo}/issues/${issueNumber}`)
      );
    } catch {
      return false;
    }
  }

  private async waitForPostSlot(): Promise<void> {
    const wait = this.nextPostAt - this.timing.now();
    if (wait > 0) await this.timing.sleep(wait);
    this.nextPostAt = this.timing.now() + 1000;
  }
}

export { IssueChannel as GithubIssuesChannel };
