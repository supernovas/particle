# particle worker on GCP

One Debian VM (`particle-worker-0`) that builds the Rust worker from this repo and runs it
under systemd, polling the workspace's project issues. No inbound traffic; the GitHub App
credentials live in Secret Manager and reach the VM only through its dedicated service
account. Project: `particle-production-506421` by default.

## Deploy

```sh
# 0. one-time auth, with rights to create secrets/SAs/instances in the project
gcloud auth application-default login

# 1. upload the app credentials (kept out of Terraform state on purpose)
scripts/gcp-upload-secrets.sh particle-production-506421

# 2. provision
cd infra/gcp
terraform init
terraform apply
```

First boot takes a few minutes (apt + rustup + `cargo build --release`); progress is in
`/var/log/particle-startup.log` on the VM. Then:

```sh
terraform output -raw logs_hint   # prints the journalctl ssh one-liner
```

## Deploys (gitops, zero downtime)

Merging to `main` is the deploy. The app's webhook delivers the push event to
`https://particle.supernova.ai/hooks/github` (~1s after merge); an HMAC-verified listener
kicks `particle-redeploy`, which runs a **staged** rebuild — rust and the UI compile in
`*.new` dirs while the old build keeps serving, then a seconds-long cutover swaps them,
which Caddy bridges with `lb_try_duration` so clients never see it (SSE streams
auto-reconnect). A 60s converge timer is the fallback for missed deliveries. Logs:
`/var/log/particle-redeploy.log` on the VM. No workflow, no deploy credentials; the manual
break-glass remains `terraform apply -replace=google_compute_instance.worker`.

One-time app setup for the fast path (org admin): app settings → Webhook → **Active**, and
Subscribe to events → **Push**. (The webhook URL + secret are already configured via API.)

CI-built release binaries instead of on-VM builds are a known follow-up, tracked with the
rest of Phase 3 in [#17](https://github.com/supernovas/particle/issues/17).

## Web: particle.supernova.ai

The worker VM also serves the workspace UI. `web.tf` reserves a static IP (`terraform output
web_ip`), opens 80/443 to the VM, and the startup script runs the TS worker (ingest +
`/api` + built `packages/ui`) on loopback with Caddy in front — TLS via Let's Encrypt,
**read-only** (non-GET `/api` calls are rejected until identity lands in Phase 2).

DNS is on Cloudflare: create an A record `particle` → `web_ip` with proxying **off**
(grey cloud); Caddy needs to answer the ACME challenge directly. Certificate issuance is
automatic once the record resolves.

## CI runners (self-hosted GitHub Actions)

`runners.tf` adds `runner_count` (default 1) org-level self-hosted runner VMs
(`particle-ci-runner-N`, labels `gcp,linux,x64`). Registration uses a short-lived token
minted **on the operator machine** at apply time (`scripts/gh-runner-token.mjs`); the VMs
hold no GitHub App credentials and their service account has no IAM roles, so a CI job that
compromises a runner can escalate to nothing. A recreated runner needs a fresh
`terraform apply` (which mints a fresh token). One-time org-admin setup:

1. Grant the app the org permission **Self-hosted runners: Read and write**
   (app settings → Permissions & events), and approve the change on the installation.
2. Allow public repositories on the **Default** runner group
   (org settings → Actions → Runner groups) — this repo is public.

Fork PRs still require maintainer approval before workflows run on these machines; keep it
that way. Bootstrap log on a runner VM: `/var/log/particle-runner-startup.log`.

## Teardown

```sh
terraform destroy          # secrets survive; delete them with gcloud if you mean it
```

Cost: an `e2-small` + 20 GB disk is roughly $15/month.
