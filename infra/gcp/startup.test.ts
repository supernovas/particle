import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../packages/worker/src/config.ts';

const root = resolve(import.meta.dirname, '../..');
const startup = readFileSync(join(root, 'infra/gcp/startup.sh.tpl'), 'utf8');

function unit(name: string): string {
  const pattern = new RegExp(
    `cat >/etc/systemd/system/${name}\\.service <<'UNIT'\\n([\\s\\S]*?)\\nUNIT`,
  );
  const match = pattern.exec(startup);
  if (!match?.[1]) throw new Error(`missing ${name}.service`);
  return match[1];
}

describe('production worker bootstrap', () => {
  it('pins Node 22 and an exact Codex CLI release', () => {
    expect(startup).toContain('setup_22.x');
    expect(startup).toContain('CODEX_VERSION=0.149.0');
    expect(startup).toContain('"@openai/codex@$CODEX_VERSION"');
  });

  it('gives polling and scheduling to one service in durable isolated roots', () => {
    const worker = unit('particle-worker');
    expect(worker).toContain('PARTICLE_STORE=git');
    expect(worker).toContain('PARTICLE_STATE_DIR=/opt/particle/state');
    expect(worker).toContain('PARTICLE_REPO_DIR=/opt/particle/workspace.git');
    expect(worker).toContain('TMPDIR=/opt/particle/worktrees');
    expect(worker).toContain('CODEX_HOME=/opt/particle/credentials/codex');
    expect(worker).toContain('particle-codex-auth status');
    expect(worker).toContain('particle-worker -- --no-serve');
    expect(worker).toContain('KillMode=control-group');

    const ui = unit('particle-ui');
    expect(ui).toContain('particle-worker -- --no-poll --no-schedule');
    expect(unit('particle-worker-rust')).not.toMatch(/^\[Install\]$/m);
    expect(startup).toContain('systemctl disable --now particle-worker-rust');
  });

  it('uses the hardened production Codex argv', () => {
    const config = loadConfig(join(root, 'particle.yaml'));
    expect(config.runner.command).toEqual(
      expect.arrayContaining([
        '/opt/particle/tools/bin/codex',
        '--ephemeral',
        'workspace-write',
        'approval_policy="never"',
        'shell_environment_policy.inherit="none"',
      ]),
    );
    expect(config.runner.command?.join(' ')).not.toContain('network_access=true');
    expect(config.runner.timeoutSeconds).toBe(900);
  });
});

describe('Codex auth bootstrap', () => {
  const helper = join(root, 'scripts/codex-auth-bootstrap.sh');

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'particle-codex-auth-'));
    const fake = join(dir, 'codex');
    writeFileSync(
      fake,
      `#!/bin/sh
set -eu
if [ "${'$'}{1:-}" != login ]; then exit 2; fi
if [ "${'$'}{2:-}" = --with-api-key ]; then
  IFS= read -r value
  [ "${'$'}value" = expected-test-value ]
  printf '{"auth_mode":"apikey"}\\n' >"${'$'}CODEX_HOME/auth.json"
else
  [ "${'$'}{2:-}" = status ]
  [ -s "${'$'}CODEX_HOME/auth.json" ]
fi
`,
      { mode: 0o700 },
    );
    return { dir, fake, env: { ...process.env, CODEX_HOME: join(dir, 'home'), CODEX_BIN: fake } };
  }

  it('fails closed when no file-backed login exists', () => {
    const { env } = fixture();
    const result = spawnSync(helper, ['status'], { env });
    expect(result.status).not.toBe(0);
  });

  it('rejects empty input and provisions private file-backed auth from stdin', () => {
    const { dir, env } = fixture();
    expect(spawnSync(helper, ['login'], { env, input: '' }).status).not.toBe(0);

    const login = spawnSync(helper, ['login'], {
      env,
      input: 'expected-test-value\n',
      encoding: 'utf8',
    });
    expect(login.status, login.stderr).toBe(0);
    expect(login.stdout).not.toContain('expected-test-value');
    expect(statSync(join(dir, 'home/auth.json')).mode & 0o777).toBe(0o600);
    expect(spawnSync(helper, ['status'], { env }).status).toBe(0);
  });
});
