#!/bin/bash
# particle CI runner bootstrap. Registers an org-level self-hosted GitHub
# Actions runner using the workspace GitHub App credentials from Secret
# Manager. Runs as root on every boot; a configured runner is just restarted.
set -euo pipefail
exec >>/var/log/particle-runner-startup.log 2>&1
echo "=== runner startup $(date -Is) ==="

RUNNER_DIR=/opt/actions-runner

if [ -f "$RUNNER_DIR/.runner" ]; then
  cd "$RUNNER_DIR" && ./svc.sh start || true
  echo "already configured; started"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -qy git build-essential pkg-config curl python3 libicu72 || \
  apt-get install -qy git build-essential pkg-config curl python3

id -u runner >/dev/null 2>&1 || useradd -m -s /bin/bash runner

# Toolchain for CI jobs: rustup for the runner user (dtolnay/rust-toolchain
# expects it); node is provisioned per-job by actions/setup-node.
sudo -u runner sh -c 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable'

# The registration token was minted on the operator machine at apply time
# (scripts/gh-runner-token.mjs): short-lived, single-purpose, and spent by
# config.sh below. This VM holds no GitHub App credentials and its service
# account has no permissions — CI jobs can escalate to nothing.
REG_TOKEN="${reg_token}"

# --- install and register the runner ---
TAG=$(curl -sf https://api.github.com/repos/actions/runner/releases/latest \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['tag_name'])")
VERSION=$${TAG#v}
mkdir -p "$RUNNER_DIR"
curl -fsSL "https://github.com/actions/runner/releases/download/$TAG/actions-runner-linux-x64-$VERSION.tar.gz" \
  | tar -xz -C "$RUNNER_DIR"
chown -R runner:runner "$RUNNER_DIR"

cd "$RUNNER_DIR"
sudo -u runner ./config.sh --unattended \
  --url "https://github.com/${github_org}" \
  --token "$REG_TOKEN" \
  --name "$(hostname)" \
  --labels gcp,linux,x64 \
  --replace

./svc.sh install runner
./svc.sh start
echo "=== runner startup done $(date -Is) ==="
