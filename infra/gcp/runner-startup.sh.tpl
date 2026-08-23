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

# --- fetch app credentials from Secret Manager via the instance SA ---
WORK=/root/.particle-bootstrap
mkdir -p "$WORK" && chmod 700 "$WORK"
MTOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
fetch_secret() {
  curl -sf -H "Authorization: Bearer $MTOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/$1/versions/latest:access" \
    | python3 -c "import sys,json,base64;sys.stdout.buffer.write(base64.b64decode(json.load(sys.stdin)['payload']['data']))"
}
fetch_secret particle-github-app-json >"$WORK/app.json"
fetch_secret particle-github-app-pem >"$WORK/app.pem"
chmod 600 "$WORK"/app.*
CLIENT_ID=$(python3 -c "import json;print(json.load(open('$WORK/app.json'))['client_id'])")

# --- mint app JWT -> installation token -> org runner registration token ---
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
NOW=$(date +%s)
HEADER=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
PAYLOAD=$(printf '{"iat":%s,"exp":%s,"iss":"%s"}' "$((NOW - 60))" "$((NOW + 540))" "$CLIENT_ID" | b64url)
SIG=$(printf '%s.%s' "$HEADER" "$PAYLOAD" | openssl dgst -sha256 -sign "$WORK/app.pem" | b64url)
JWT="$HEADER.$PAYLOAD.$SIG"

INSTALL_ID=$(curl -sf -H "Authorization: Bearer $JWT" -H "Accept: application/vnd.github+json" \
  https://api.github.com/app/installations \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(i['id'] for i in d if i['account']['login']=='${github_org}'))")
ITOKEN=$(curl -sf -X POST -H "Authorization: Bearer $JWT" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/$INSTALL_ID/access_tokens" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
REG_TOKEN=$(curl -sf -X POST -H "Authorization: Bearer $ITOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/orgs/${github_org}/actions/runners/registration-token" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

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
