#!/usr/bin/env bash
# Upload the workspace GitHub App credentials from ./.particle/ to Secret
# Manager, where the worker VM's service account reads them. Run from the repo
# root (or anywhere — it cd's itself). Usage:
#   scripts/gcp-upload-secrets.sh [project-id]
set -euo pipefail
PROJECT="${1:-particle-production-506421}"
cd "$(dirname "$0")/.."

for f in .particle/github-app.json .particle/github-app.private-key.pem; do
  [ -f "$f" ] || { echo "missing $f — run scripts/create-github-app.mjs first" >&2; exit 1; }
done

ensure() {
  local name="$1" file="$2"
  if ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$name" --project "$PROJECT" --replication-policy automatic
  fi
  gcloud secrets versions add "$name" --project "$PROJECT" --data-file "$file"
}

ensure particle-github-app-json .particle/github-app.json
ensure particle-github-app-pem .particle/github-app.private-key.pem

# Webhook secret (deploy fast path): extracted from the app secrets file.
node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('.particle/github-app.secrets.json','utf8')).webhook_secret)" \
  >.particle/webhook-secret
chmod 600 .particle/webhook-secret
ensure particle-github-webhook-secret .particle/webhook-secret
echo "secrets uploaded to project $PROJECT"
