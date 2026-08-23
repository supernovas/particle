import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join } from 'node:path';

export interface AppCreds {
  id: number;
  slug: string;
  clientId: string;
  pem: string;
}

export function loadAppCreds(dir = '.particle'): AppCreds {
  let meta: { id: number; slug: string; client_id: string };
  let pem: string;
  try {
    meta = JSON.parse(readFileSync(join(dir, 'github-app.json'), 'utf8'));
    pem = readFileSync(join(dir, 'github-app.private-key.pem'), 'utf8');
  } catch (err) {
    throw new Error(
      `No GitHub App credentials in ${dir}/. Run \`node scripts/create-github-app.mjs <org>\` first. (${(err as Error).message})`,
    );
  }
  return { id: meta.id, slug: meta.slug, clientId: meta.client_id, pem };
}

export function appJwt(creds: AppCreds, now = Date.now()): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iat: iat - 60,
    exp: iat + 540,
    iss: creds.clientId,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(creds.pem).toString('base64url');
  return `${unsigned}.${sig}`;
}

/** Caches an installation token and refreshes it shortly before expiry. */
export class InstallationTokenProvider {
  private token?: { value: string; expiresAt: number };
  private installationId?: number;

  constructor(
    private readonly creds: AppCreds,
    private readonly owner: string,
  ) {}

  async get(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 5 * 60 * 1000) {
      return this.token.value;
    }
    const jwt = appJwt(this.creds);
    if (this.installationId === undefined) {
      const installs = await ghJson(`/app/installations`, jwt);
      const install = installs.find((i: any) => i.account?.login === this.owner) ?? installs[0];
      if (!install) throw new Error(`App ${this.creds.slug} has no installations`);
      this.installationId = install.id;
    }
    const tok = await ghJson(`/app/installations/${this.installationId}/access_tokens`, jwt, {
      method: 'POST',
    });
    this.token = { value: tok.token, expiresAt: Date.parse(tok.expires_at) };
    return this.token.value;
  }
}

export async function ghJson(path: string, bearer: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${bearer}`,
      'user-agent': 'particle-worker',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
