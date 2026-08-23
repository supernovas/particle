# Codex CLI runner

Particle can run Codex non-interactively with a dedicated file-backed login. Run the worker as the
same operating-system user that ran `codex login`, and preserve that user's `HOME`. If `CODEX_HOME`
was set during login, preserve the same absolute `CODEX_HOME` for the worker.
Verify the service account before starting Particle:

```sh
codex login status
```

The Codex CLI stores credentials either in `auth.json` under `CODEX_HOME` (default `~/.codex`) or in
the operating-system credential store, according to `cli_auth_credentials_store`. A keyring-backed
login therefore also requires the spawned process to run as an OS identity and session that can
access that keyring. See the official [Codex authentication documentation][auth].

[auth]: https://learn.chatgpt.com/docs/auth#credential-storage

The production command template is checked into `particle.yaml`. Its important boundaries are:

```yaml
runner:
  command:
    - /opt/particle/tools/bin/codex
    - exec
    - --ephemeral
    - --ignore-user-config
    - --sandbox
    - workspace-write
    - -c
    - 'approval_policy="never"'
    - -c
    - 'shell_environment_policy.inherit="none"'
    - Read and follow the complete role instructions in {prompt}.
  timeout-seconds: 900
```

`codex exec` is the CLI's non-interactive mode. Particle sets the subprocess working directory to
the task workspace and replaces `{prompt}` with the rendered prompt's absolute path. `--ephemeral`
avoids persisting a Codex session; it does not bypass authentication or the workspace sandbox.
Production keeps network access disabled and prevents login shells. The command is an argv array
and is never evaluated by a shell.

## Secret boundary

- Never copy `CODEX_HOME`, `auth.json`, a keychain export, access tokens, or API keys into a task
  workspace.
- Never add credentials to a role prompt, `events.ndjson`, the subprocess command, or a Particle
  event. These are durable or reviewable artifacts.
- Never print credentials to stdout or stderr; both streams are captured in the run transcript.
- Keep the credential home outside every task workspace and accessible only to the worker's OS user.
  Codex may need to update cached authentication as tokens refresh, so follow the storage permissions
  recommended for the selected credential backend.
- Particle passes a small allowlist of ordinary runtime variables, including `HOME`, `CODEX_HOME`,
  `PATH`, locale, certificate, and proxy settings. It does not pass arbitrary worker variables such
  as GitHub tokens. Operators can explicitly add runner environment values in code, but should
  treat that as granting the agent access to them.

For file-backed authentication, protect `$CODEX_HOME/auth.json` as a password: it contains access
tokens. For keyring-backed authentication, do not export the keyring secret into a file as a
workaround. Fix the worker service's OS identity/session access instead.
