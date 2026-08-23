#!/bin/bash
# particle worker VM bootstrap. Runs as root at boot; installs toolchains,
# services, and the converge timer, then hands off to particle-redeploy.
#
# Deploys are gitops: a 60s timer compares main against the installed sha and
# runs a staged rebuild in place — the site keeps serving the old build until
# a seconds-long cutover, which Caddy bridges by holding requests
# (lb_try_duration). No VM resets, no reboot, no deploy credentials anywhere.
#
# Services:
#   particle-worker    — integrated TS poller + git store + scheduler + Codex runner
#   particle-ui        — read-only TS UI observer on loopback :7455
#   particle-worker-rust — installed reference binary, deliberately disabled
#   particle-redeploy  — oneshot staged rebuild, fired by timer and at boot
set -euo pipefail
exec >>/var/log/particle-startup.log 2>&1
echo "=== particle startup $(date -Is) ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -qy git build-essential pkg-config curl python3 \
  debian-keyring debian-archive-keyring apt-transport-https

id -u particle >/dev/null 2>&1 || useradd -r -m -s /usr/sbin/nologin particle

# --- toolchains (each install skipped when already present) ---
export RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
[ -x /opt/cargo/bin/cargo ] || curl -fsSL https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable
if ! node --version 2>/dev/null | grep -Eq '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -qy nodejs
fi
node --version | grep -Eq '^v22\.'

# Pin the executable the checked-in runner argv names. npm's moving latest tag
# must never silently change the production agent on a reboot.
CODEX_VERSION=0.149.0
mkdir -p /opt/particle/tools
npm install --global --prefix /opt/particle/tools "@openai/codex@$CODEX_VERSION"
test "$(/opt/particle/tools/bin/codex --version)" = "codex-cli $CODEX_VERSION"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -qy caddy
fi

mkdir -p /opt/particle/bin

# --- the redeploy script: staged build, cutover only on a new sha ---
cat >/opt/particle/bin/particle-redeploy <<'REDEPLOY'
#!/bin/bash
set -euo pipefail
exec 9>/var/lock/particle-redeploy
flock -n 9 || exit 0
exec >>/var/log/particle-redeploy.log 2>&1

BASE=/opt/particle
SRC=$BASE/src
APP=$BASE/app
RUST_BIN=$BASE/bin/particle-worker-rust
SHA_FILE=$BASE/installed-sha
STATE=$BASE/state
WORKSPACE=$BASE/workspace.git
WORKTREES=$BASE/worktrees
CODEX_HOME=$BASE/credentials/codex
export RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo

REMOTE_SHA=$(git ls-remote "${repo_url}" "refs/heads/${branch}" | cut -f1)
if [ -x "$RUST_BIN" ] && [ -d "$APP/node_modules" ] && [ -f "$SHA_FILE" ] \
  && [ "$(cat "$SHA_FILE")" = "$REMOTE_SHA" ]; then
  exit 0
fi
echo "=== redeploy to $REMOTE_SHA $(date -Is) ==="

# Staged: nothing serving is touched until the swap at the end.
rm -rf "$SRC.new" "$APP.new"
git clone --depth 1 --branch "${branch}" "${repo_url}" "$SRC.new"
git clone --depth 1 --branch "${branch}" "${repo_url}" "$APP.new"
/opt/cargo/bin/cargo build --release --manifest-path "$SRC.new/rust/Cargo.toml"
cd "$APP.new"
npm ci
npm run build --workspace @particle/ui

# Task branches and ownership markers outlive staged deploy checkouts. Agents
# only run inside worktrees created from this dedicated bare host repository.
if [ ! -d "$WORKSPACE" ]; then
  git clone --bare "${repo_url}" "$WORKSPACE"
fi
git --git-dir="$WORKSPACE" fetch --no-tags origin \
  "+refs/heads/${branch}:refs/heads/${branch}"
mkdir -p "$WORKTREES" "$CODEX_HOME"

install -m 0755 "$APP.new/scripts/codex-auth-bootstrap.sh" \
  "$BASE/bin/particle-codex-auth"

# App credentials from Secret Manager via the instance service account. The
# TS worker's durable state dir lives outside the deploy blast radius; with
# PARTICLE_STORE=git its contents mirror refs/particle/* on the host repo.
MTOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
fetch_secret() {
  curl -sf -H "Authorization: Bearer $MTOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/$1/versions/latest:access" \
    | python3 -c "import sys,json,base64;sys.stdout.buffer.write(base64.b64decode(json.load(sys.stdin)['payload']['data']))"
}
for dir in "$SRC.new/.particle" "$STATE"; do
  mkdir -p "$dir"
  fetch_secret particle-github-app-json >"$dir/github-app.json"
  fetch_secret particle-github-app-pem >"$dir/github-app.private-key.pem"
  chmod 600 "$dir"/github-app.*
done
fetch_secret particle-github-webhook-secret >"$STATE/webhook-secret"
chmod 600 "$STATE/webhook-secret"
chown -R particle:particle "$SRC.new" "$APP.new" "$STATE"

# Authentication must already be provisioned in the dedicated credential
# directory. Refuse the cutover when it is absent or invalid; the prior worker
# keeps serving instead of starting an execution-capable but unauthenticated
# deployment.
chown -R particle:particle "$WORKSPACE" "$WORKTREES" "$CODEX_HOME"
sudo -u particle env HOME=/home/particle CODEX_HOME="$CODEX_HOME" \
  "$BASE/bin/particle-codex-auth" status

# Cutover: seconds; Caddy buffers requests across the restart window.
install -m 0755 "$SRC.new/rust/target/release/particle-worker" "$RUST_BIN"
systemctl stop particle-ui particle-worker 2>/dev/null || true
rm -rf "$SRC" "$APP"
mv "$SRC.new" "$SRC"
mv "$APP.new" "$APP"
echo "$REMOTE_SHA" >"$SHA_FILE"
systemctl start particle-worker particle-ui
echo "=== redeploy done at $REMOTE_SHA $(date -Is) ==="
REDEPLOY
chmod 0755 /opt/particle/bin/particle-redeploy

cat >/etc/systemd/system/particle-worker.service <<'UNIT'
[Unit]
Description=particle integrated scheduler and agent runner
After=network-online.target
Wants=network-online.target

[Service]
User=particle
WorkingDirectory=/opt/particle/app
Environment=HOME=/home/particle
Environment=CODEX_HOME=/opt/particle/credentials/codex
Environment=PATH=/opt/particle/tools/bin:/usr/local/bin:/usr/bin:/bin
Environment=TMPDIR=/opt/particle/worktrees
Environment=PARTICLE_CONFIG=/opt/particle/app/particle.yaml
Environment=PARTICLE_STORE=git
Environment=PARTICLE_STATE_DIR=/opt/particle/state
Environment=PARTICLE_REPO_DIR=/opt/particle/workspace.git
Environment=PARTICLE_OPERATOR=particle-agent
ExecStartPre=/opt/particle/bin/particle-codex-auth status
ExecStart=/usr/bin/npm run particle-worker -- --no-serve
Restart=always
RestartSec=10
KillMode=control-group
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateDevices=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/particle-worker-rust.service <<'UNIT'
[Unit]
Description=particle reference Rust poller (disabled; TS service owns polling)
ConditionPathExists=/opt/particle/bin/particle-worker-rust

[Service]
User=particle
WorkingDirectory=/opt/particle/src
ExecStart=/opt/particle/bin/particle-worker-rust
Restart=on-failure
KillMode=control-group

# Deliberately no [Install] section. Enabling this alongside particle-worker
# would create two pollers and duplicate delivery.
UNIT

cat >/etc/systemd/system/particle-ui.service <<'UNIT'
[Unit]
Description=particle workspace UI (ts worker)
After=network-online.target
Wants=network-online.target

[Service]
User=particle
WorkingDirectory=/opt/particle/app
Environment=PARTICLE_UI_PORT=7455
Environment=PARTICLE_STORE=git
Environment=PARTICLE_STATE_DIR=/opt/particle/state
Environment=PARTICLE_CONFIG=/opt/particle/app/particle.yaml
ExecStart=/usr/bin/npm run particle-worker -- --no-poll --no-schedule
Restart=always
RestartSec=10
KillMode=control-group
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/particle-redeploy.service <<'UNIT'
[Unit]
Description=particle converge-on-main (staged redeploy)

[Service]
Type=oneshot
ExecStart=/opt/particle/bin/particle-redeploy
UNIT

cat >/etc/systemd/system/particle-redeploy.timer <<'UNIT'
[Unit]
Description=particle converge-on-main fallback (webhook is the fast path)

[Timer]
OnBootSec=90
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
UNIT

# The fast path: GitHub delivers push events here (~1s after a merge). The
# listener verifies the app webhook's HMAC and kicks particle-redeploy.
cat >/opt/particle/bin/particle-hooks.py <<'HOOKS'
#!/usr/bin/env python3
import hashlib, hmac, json, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = open('/opt/particle/state/webhook-secret', 'rb').read().strip()

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/hooks/github':
            self.send_response(404); self.end_headers(); return
        body = self.rfile.read(int(self.headers.get('content-length', 0) or 0))
        sig = self.headers.get('x-hub-signature-256', '')
        expected = 'sha256=' + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            self.send_response(401); self.end_headers(); return
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
        if self.headers.get('x-github-event') == 'push' and payload.get('ref') == 'refs/heads/${branch}':
            subprocess.Popen(['systemctl', 'start', '--no-block', 'particle-redeploy'])
        self.send_response(202); self.end_headers(); self.wfile.write(b'ok')

    def log_message(self, *args):
        pass

HTTPServer(('127.0.0.1', 7456), Handler).serve_forever()
HOOKS
chmod 0755 /opt/particle/bin/particle-hooks.py

cat >/etc/systemd/system/particle-hooks.service <<'UNIT'
[Unit]
Description=particle github webhook listener
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /opt/particle/bin/particle-hooks.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Public read-only: browsing and the live event stream work for anyone, but
# nothing that appends events is reachable until identity lands (Phase 2).
# lb_try_duration bridges the redeploy cutover so clients never see it.
cat >/etc/caddy/Caddyfile <<CADDY
${web_domain} {
	handle /hooks/github {
		reverse_proxy 127.0.0.1:7456
	}
	handle {
		@writes {
			method POST PUT PATCH DELETE
		}
		respond @writes "read-only deployment" 403
		reverse_proxy 127.0.0.1:7455 {
			lb_try_duration 20s
			lb_try_interval 250ms
		}
	}
}
CADDY

systemctl daemon-reload
systemctl disable --now particle-worker-rust 2>/dev/null || true
systemctl enable particle-worker particle-ui
systemctl enable --now particle-redeploy.timer
systemctl restart caddy
/opt/particle/bin/particle-redeploy
# After redeploy so the webhook secret exists in the state dir.
systemctl enable --now particle-hooks
echo "=== particle startup done $(date -Is) ==="
