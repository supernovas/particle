#!/usr/bin/env node
// Terraform external data source: mint a short-lived (1 hour, single-purpose)
// org runner registration token from the workspace GitHub App credentials in
// ./.particle/. Reads {"org": "..."} on stdin, prints {"token": "..."}.
//
// This runs on the operator machine so the runner VMs never hold — or have
// any way to fetch — the app's private key: a CI job that compromises a
// runner gets nothing but an already-spent registration token.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import path from 'node:path';

const DIR = path.resolve(new URL('..', import.meta.url).pathname, '.particle');
const query = JSON.parse(readFileSync(0, 'utf8'));
const org = query.org;
if (!org) {
  console.error('missing "org" in query');
  process.exit(1);
}

const meta = JSON.parse(readFileSync(path.join(DIR, 'github-app.json'), 'utf8'));
const pem = readFileSync(path.join(DIR, 'github-app.private-key.pem'), 'utf8');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: meta.client_id })}`;
const sig = createSign('RSA-SHA256').update(unsigned).sign(pem).toString('base64url');
const jwt = `${unsigned}.${sig}`;

const gh = async (p, bearer, opts = {}) => {
  const r = await fetch(`https://api.github.com${p}`, {
    ...opts,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${bearer}`,
      'user-agent': 'particle-bootstrap',
    },
  });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

const installs = await gh('/app/installations', jwt);
const install = installs.find((i) => i.account.login === org) ?? installs[0];
if (!install) throw new Error(`app has no installation on ${org}`);
const itok = await gh(`/app/installations/${install.id}/access_tokens`, jwt, { method: 'POST' });
const reg = await gh(`/orgs/${org}/actions/runners/registration-token`, itok.token, {
  method: 'POST',
});
process.stdout.write(JSON.stringify({ token: reg.token }));
