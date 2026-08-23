#!/usr/bin/env node
// Mint a fresh installation token for the workspace's GitHub App and write it
// to ./.particle/installation-token.json (chmod 600). Ops convenience; the
// worker mints its own tokens in-process.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createSign } from 'node:crypto';
import path from 'node:path';

const DIR = path.resolve('.particle');
const meta = JSON.parse(readFileSync(path.join(DIR, 'github-app.json'), 'utf8'));
const pem = readFileSync(path.join(DIR, 'github-app.private-key.pem'), 'utf8');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: meta.client_id })}`;
const sig = createSign('RSA-SHA256').update(unsigned).sign(pem).toString('base64url');
const jwt = `${unsigned}.${sig}`;

const gh = async (p, opts = {}) => {
  const r = await fetch(`https://api.github.com${p}`, {
    ...opts,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jwt}`,
      'user-agent': 'particle-bootstrap',
      ...opts.headers,
    },
  });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

const installs = await gh('/app/installations');
if (installs.length === 0) {
  console.error(`app "${meta.slug}" has no installations — install it first:`);
  console.error(`https://github.com/apps/${meta.slug}/installations/new`);
  process.exit(2);
}
const inst = installs.find((i) => i.account.login === meta.owner) ?? installs[0];
const tok = await gh(`/app/installations/${inst.id}/access_tokens`, { method: 'POST' });
const out = path.join(DIR, 'installation-token.json');
writeFileSync(
  out,
  JSON.stringify(
    { token: tok.token, expires_at: tok.expires_at, installation_id: inst.id },
    null,
    2,
  ) + '\n',
);
chmodSync(out, 0o600);
console.log(`token for ${inst.account.login} saved to ${out} (expires ${tok.expires_at})`);
