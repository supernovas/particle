#!/bin/bash
# particle worker VM bootstrap + redeploy. Runs as root on every boot; the
# deploy workflow triggers it with a VM reset. Fast path when main hasn't
# moved; otherwise a staged rebuild in *.new dirs swaps in at the end, so the
# site serves the old build until seconds before cutover.
#
# Services:
#   particle-worker  — Rust worker (/opt/particle/src), canonical Phase-3 daemon
#   particle-ui      — TS worker (/opt/particle/app): ingest + /api + built UI
#                      on loopback :7455, fronted by Caddy (TLS, read-only)
# Separate checkouts because each worker keeps state in ./.particle of its cwd.
set -euo pipefail
exec >>/var/log/particle-startup.log 2>&1
echo "=== particle startup $(date -Is) ==="

BASE=/opt/particle
SRC=$BASE/src
APP=$BASE/app
BIN=$BASE/bin/particle-worker
SHA_FILE=$BASE/installed-sha

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -qy git build-essential pkg-config curl python3 \
  debian-keyring debian-archive-keyring apt-transport-https

REMOTE_SHA=$(git ls-remote "${repo_url}" "refs/heads/${branch}" | cut -f1)
if [ -x "$BIN" ] && [ -d "$APP/node_modules" ] && [ -f "$SHA_FILE" ] \
  && [ "$(cat "$SHA_FILE")" = "$REMOTE_SHA" ]; then
  systemctl restart particle-worker particle-ui caddy
  echo "up to date at $REMOTE_SHA; restarted"
  exit 0
fi

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

# --- staged build: nothing serving is touched until the swap below ---
mkdir -p "$BASE/bin"
rm -rf "$SRC.new" "$APP.new"
git clone --depth 1 --branch "${branch}" "${repo_url}" "$SRC.new"
git clone --depth 1 --branch "${branch}" "${repo_url}" "$APP.new"
/opt/cargo/bin/cargo build --release --manifest-path "$SRC.new/rust/Cargo.toml"
cd "$APP.new"
npm ci
npm run build --workspace @particle/ui

# App credentials come from Secret Manager via the instance service account.
# The TS worker's state dir lives OUTSIDE the deploy blast radius at
# /opt/particle/state: with PARTICLE_STORE=git its contents mirror
# refs/particle/* on the host repo, so even losing the disk loses nothing —
# a fresh machine recovers by fetching. The Rust worker keeps its per-clone
# journal until it speaks the ref store.
STATE=/opt/particle/state
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

# Public read-only: browsing and the live event stream work for anyone, but
# nothing that appends events is reachable until identity lands (Phase 2).
cat >/etc/caddy/Caddyfile <<CADDY
${web_domain} {
	@writes {
		method POST PUT PATCH DELETE
	}
	respond @writes "read-only deployment" 403
	reverse_proxy 127.0.0.1:7455
}
CADDY

# --- cutover: seconds of downtime, then the new build serves ---
systemctl daemon-reload
install -m 0755 "$SRC.new/rust/target/release/particle-worker" "$BIN"
systemctl stop particle-ui particle-worker 2>/dev/null || true
rm -rf "$SRC" "$APP"
mv "$SRC.new" "$SRC"
mv "$APP.new" "$APP"
echo "$REMOTE_SHA" >"$SHA_FILE"
systemctl enable --now particle-worker particle-ui
systemctl restart caddy
echo "=== particle startup done at $REMOTE_SHA $(date -Is) ==="
