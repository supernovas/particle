#!/usr/bin/env bash
# Manage the production worker's file-backed Codex login without placing the
# OpenAI API key in argv, the environment, Terraform state, or a task worktree.
set -euo pipefail

: "${CODEX_HOME:?CODEX_HOME must name the dedicated credential directory}"
CODEX_BIN="${CODEX_BIN:-/opt/particle/tools/bin/codex}"
CONFIG="$CODEX_HOME/config.toml"
AUTH="$CODEX_HOME/auth.json"

status() {
  [ -s "$CONFIG" ] && [ -s "$AUTH" ]
  "$CODEX_BIN" login status >/dev/null
}

case "${1:-}" in
  status)
    status
    ;;
  login)
    umask 077
    mkdir -p "$CODEX_HOME"
    printf '%s\n' 'cli_auth_credentials_store = "file"' >"$CONFIG"

    credential=''
    IFS= read -r credential || true
    if [ -z "$credential" ]; then
      echo 'OpenAI API key input is empty; refusing to create Codex auth' >&2
      exit 1
    fi
    printf '%s\n' "$credential" | "$CODEX_BIN" login --with-api-key >/dev/null
    credential=''
    [ -s "$AUTH" ] || { echo "Codex login did not create $AUTH" >&2; exit 1; }
    chmod 600 "$CONFIG" "$AUTH"
    status
    ;;
  *)
    echo 'usage: codex-auth-bootstrap.sh status|login' >&2
    exit 2
    ;;
esac
