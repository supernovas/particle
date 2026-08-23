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
#   particle-worker    — Rust worker (/opt/particle/src), canonical Phase-3 daemon
#   particle-ui        — TS worker (/opt/particle/app): ingest + /api + built UI
#                        on loopback :7455, fronted by Caddy (TLS, read-only)
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
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -qy nodejs
fi
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
BIN=$BASE/bin/particle-worker
SHA_FILE=$BASE/installed-sha
STATE=$BASE/state
export RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo

REMOTE_SHA=$(git ls-remote "${repo_url}" "refs/heads/${branch}" | cut -f1)
if [ -x "$BIN" ] && [ -d "$APP/node_modules" ] && [ -f "$SHA_FILE" ] \
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
chown -R particle:particle "$SRC.new" "$APP.new" "$STATE"

# Cutover: seconds; Caddy buffers requests across the restart window.
install -m 0755 "$SRC.new/rust/target/release/particle-worker" "$BIN"
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
Description=particle worker (rust)
After=network-online.target
Wants=network-online.target

[Service]
User=particle
WorkingDirectory=/opt/particle/src
ExecStart=/opt/particle/bin/particle-worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
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
ExecStart=/usr/bin/npm run particle-worker
Restart=always
RestartSec=10

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
Description=particle converge-on-main every minute

[Timer]
OnBootSec=90
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
UNIT

# Public read-only: browsing and the live event stream work for anyone, but
# nothing that appends events is reachable until identity lands (Phase 2).
# lb_try_duration bridges the redeploy cutover so clients never see it.
cat >/etc/caddy/Caddyfile <<CADDY
${web_domain} {
	@writes {
		method POST PUT PATCH DELETE
	}
	respond @writes "read-only deployment" 403
	reverse_proxy 127.0.0.1:7455 {
		lb_try_duration 20s
		lb_try_interval 250ms
	}
}
CADDY

systemctl daemon-reload
systemctl enable particle-worker particle-ui
systemctl enable --now particle-redeploy.timer
systemctl restart caddy
/opt/particle/bin/particle-redeploy
echo "=== particle startup done $(date -Is) ==="
