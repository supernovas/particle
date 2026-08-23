#!/bin/bash
# particle worker VM bootstrap. Runs as root on every boot; a finished install
# is detected and just (re)started. Redeploy by recreating the instance:
#   terraform apply -replace=google_compute_instance.worker
set -euo pipefail
exec >>/var/log/particle-startup.log 2>&1
echo "=== particle startup $(date -Is) ==="

SRC=/opt/particle/src
BIN=/opt/particle/bin/particle-worker

if [ -x "$BIN" ]; then
  systemctl restart particle-worker
  echo "already installed; restarted"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -qy git build-essential pkg-config curl python3

id -u particle >/dev/null 2>&1 || useradd -r -m -s /usr/sbin/nologin particle

mkdir -p /opt/particle/bin
git clone --depth 1 --branch "${branch}" "${repo_url}" "$SRC"

# Build with a system-wide toolchain kept out of any user home.
export RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
/opt/cargo/bin/cargo build --release --manifest-path "$SRC/rust/Cargo.toml"
install -m 0755 "$SRC/rust/target/release/particle-worker" "$BIN"

# App credentials come from Secret Manager via the instance service account;
# they exist only on this disk, mode 0600, owned by the service user.
mkdir -p "$SRC/.particle"
TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
fetch_secret() {
  curl -sf -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/$1/versions/latest:access" \
    | python3 -c "import sys,json,base64;sys.stdout.buffer.write(base64.b64decode(json.load(sys.stdin)['payload']['data']))"
}
fetch_secret particle-github-app-json >"$SRC/.particle/github-app.json"
fetch_secret particle-github-app-pem >"$SRC/.particle/github-app.private-key.pem"
chown -R particle:particle "$SRC/.particle"
chmod 600 "$SRC"/.particle/*

cat >/etc/systemd/system/particle-worker.service <<'UNIT'
[Unit]
Description=particle worker
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

chown -R particle:particle "$SRC"
systemctl daemon-reload
systemctl enable --now particle-worker
echo "=== particle startup done $(date -Is) ==="
