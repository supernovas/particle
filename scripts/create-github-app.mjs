#!/usr/bin/env node
// Register a GitHub App for a particle workspace via the app-manifest flow.
//
//   node scripts/create-github-app.mjs <org> [app-name]
//
// Serves a local page that hands the manifest to GitHub; after you approve it
// there, GitHub redirects back and the one-time code is exchanged for the app's
// credentials, which are written to ./.particle/ (gitignored). Install the app
// on your host repo afterwards: https://github.com/apps/<slug>/installations/new
import http from 'node:http';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

const ORG = process.argv[2];
const NAME = process.argv[3] ?? 'particle';
if (!ORG) {
  console.error('usage: node scripts/create-github-app.mjs <org> [app-name]');
  process.exit(1);
}
const PORT = 8923;
const OUT_DIR = path.resolve('.particle');

const manifest = {
  name: NAME,
  url: `https://github.com/${ORG}`,
  redirect_url: `http://localhost:${PORT}/callback`,
  description:
    'Multiplayer agent harness for teams. Turns issues and threads into planned, reviewed, merged work.',
  public: false,
  hook_attributes: {
    url: 'https://example.com/particle/webhook',
    active: false,
  },
  default_permissions: {
    contents: 'write',
    issues: 'write',
    pull_requests: 'write',
    checks: 'write',
  },
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:40px">
      <h1>Create the "${NAME}" GitHub App on org "${ORG}"</h1>
      <form action="https://github.com/organizations/${ORG}/settings/apps/new" method="post">
        <input type="hidden" name="manifest" id="m">
        <button type="submit" style="font-size:18px;padding:10px 20px">Create GitHub App</button>
      </form>
      <script>document.getElementById('m').value = ${JSON.stringify(JSON.stringify(manifest))};</script>
    </body></html>`);
  } else if (u.pathname === '/callback') {
    const code = u.searchParams.get('code');
    try {
      const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: 'POST',
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'particle-bootstrap' },
      });
      if (!r.ok) throw new Error(`conversion failed: ${r.status} ${await r.text()}`);
      const app = await r.json();
      mkdirSync(OUT_DIR, { recursive: true });
      const pemPath = path.join(OUT_DIR, 'github-app.private-key.pem');
      writeFileSync(pemPath, app.pem);
      chmodSync(pemPath, 0o600);
      writeFileSync(
        path.join(OUT_DIR, 'github-app.json'),
        JSON.stringify(
          {
            id: app.id,
            slug: app.slug,
            name: app.name,
            client_id: app.client_id,
            html_url: app.html_url,
            owner: app.owner?.login,
            created_at: app.created_at,
          },
          null,
          2,
        ) + '\n',
      );
      const secretsPath = path.join(OUT_DIR, 'github-app.secrets.json');
      writeFileSync(
        secretsPath,
        JSON.stringify(
          { webhook_secret: app.webhook_secret, client_secret: app.client_secret },
          null,
          2,
        ) + '\n',
      );
      chmodSync(secretsPath, 0o600);
      console.log(`created app "${app.slug}" (id ${app.id}) — credentials in ${OUT_DIR}`);
      console.log(`install it: https://github.com/apps/${app.slug}/installations/new`);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:40px">
        <h1>App "${app.slug}" created (id ${app.id})</h1>
        <p>Credentials saved to ${OUT_DIR}. You can close this tab.</p>
        <p><a href="https://github.com/apps/${app.slug}/installations/new">Install the app on a repo</a></p>
      </body></html>`);
      setTimeout(() => server.close(() => process.exit(0)), 3000);
    } catch (err) {
      console.error('conversion error:', err.message);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Error: ' + err.message);
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`open http://localhost:${PORT} in a browser where you're a GitHub admin of "${ORG}"`);
});

setTimeout(
  () => {
    console.error('timed out waiting for the manifest callback');
    process.exit(1);
  },
  15 * 60 * 1000,
);
