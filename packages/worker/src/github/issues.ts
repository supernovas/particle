import type { GithubIssuesChannelConfig } from '../config.ts';
import { ghJson, type InstallationTokenProvider } from './auth.ts';

/** A human utterance pulled from the channel, not yet a particle event. */
export interface Prompt {
  /** Stable channel-local project key, e.g. "gh-1". */
  projectKey: string;
  issueNumber: number;
  issueTitle: string;
  /** Absent when the prompt is the issue body itself. */
  commentId?: number;
  author: string;
  body: string;
  url: string;
  at: string;
}

export interface Cursor {
  /** Per issue number: highest comment id already turned into a prompt. */
  issues: Record<string, { lastCommentId: number }>;
}

export const emptyCursor = (): Cursor => ({ issues: {} });

/**
 * Read side of the #github-issues channel: issues labeled as projects (plus
 * seed issues) become projects; their bodies and comments become prompts.
 * Comments authored by our own app are never prompts — that's the loop guard.
 */
export class IssueChannel {
  constructor(
    private readonly tokens: InstallationTokenProvider,
    private readonly cfg: GithubIssuesChannelConfig,
    private readonly botSlug: string,
  ) {}

  private isSelf(user: { login?: string; type?: string }): boolean {
    return user.type === 'Bot' && user.login === `${this.botSlug}[bot]`;
  }

  async poll(cursor: Cursor): Promise<{ prompts: Prompt[]; cursor: Cursor }> {
    const token = await this.tokens.get();
    const issues = new Map<number, any>();

    const labeled = await ghJson(
      `/repos/${this.cfg.repo}/issues?state=open&labels=${encodeURIComponent(this.cfg.label)}&per_page=100`,
      token,
    );
    for (const issue of labeled) if (!issue.pull_request) issues.set(issue.number, issue);
    for (const n of this.cfg.seedIssues) {
      if (!issues.has(n)) {
        const issue = await ghJson(`/repos/${this.cfg.repo}/issues/${n}`, token);
        if (!issue.pull_request) issues.set(n, issue);
      }
    }

    const prompts: Prompt[] = [];
    const next: Cursor = { issues: { ...cursor.issues } };

    for (const [number, issue] of issues) {
      const key = String(number);
      const known = cursor.issues[key];
      if (!known) {
        // First sighting: the issue body is the founding prompt.
        prompts.push({
          projectKey: `gh-${number}`,
          issueNumber: number,
          issueTitle: issue.title,
          author: issue.user.login,
          body: issue.body ?? '',
          url: issue.html_url,
          at: issue.created_at,
        });
      }
      let lastCommentId = known?.lastCommentId ?? 0;
      if (issue.comments > 0) {
        const comments = await ghJson(
          `/repos/${this.cfg.repo}/issues/${number}/comments?per_page=100`,
          token,
        );
        for (const comment of comments) {
          if (comment.id <= lastCommentId) continue;
          lastCommentId = Math.max(lastCommentId, comment.id);
          if (this.isSelf(comment.user)) continue;
          prompts.push({
            projectKey: `gh-${number}`,
            issueNumber: number,
            issueTitle: issue.title,
            commentId: comment.id,
            author: comment.user.login,
            body: comment.body ?? '',
            url: comment.html_url,
            at: comment.created_at,
          });
        }
      }
      next.issues[key] = { lastCommentId };
    }

    return { prompts, cursor: next };
  }

  async post(issueNumber: number, body: string): Promise<string> {
    const token = await this.tokens.get();
    const res = await ghJson(`/repos/${this.cfg.repo}/issues/${issueNumber}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    return res.html_url;
  }
}
