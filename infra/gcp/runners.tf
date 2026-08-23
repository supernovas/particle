# Self-hosted GitHub Actions runners (#20). Org-level runners registered with
# a short-lived (1 h, single-purpose) token minted on the operator machine at
# apply time. The runner VMs deliberately have NO access to the GitHub App
# credentials: CI jobs run arbitrary code, and a job that can read the app's
# private key could act as particle-agent everywhere. The spent registration
# token in metadata/state is worthless after config.sh consumes it.
#
# Prerequisites beyond the worker's (one-time, org admin):
#   - the app has the org permission "Self-hosted runners: write"
#   - the Default runner group allows public repositories

variable "runner_count" {
  description = "Number of CI runner VMs; 2+ lets CI jobs and deploys run in parallel"
  type        = number
  default     = 2
}

variable "runner_machine_type" {
  description = "Runners build Rust in CI; 2 vCPU / 8 GB is the practical floor"
  type        = string
  default     = "e2-standard-2"
}

variable "github_org" {
  type    = string
  default = "supernovas"
}

# The runner SA holds exactly one capability: resetting the worker VM, which
# is how the deploy workflow ships main (the VM rebuilds from main at boot).
# Custom role + IAM condition keep a compromised CI job down to "can reboot
# the worker", nothing else — no secret access, no instance admin.
resource "google_service_account" "ci_runner" {
  account_id   = "particle-ci-runner"
  display_name = "particle CI runner"
}

resource "google_project_iam_custom_role" "worker_reset" {
  role_id     = "particleWorkerReset"
  title       = "particle worker reset"
  permissions = ["compute.instances.reset", "compute.instances.get"]
}

resource "google_project_iam_member" "runner_resets_worker" {
  project = var.project_id
  role    = google_project_iam_custom_role.worker_reset.id
  member  = "serviceAccount:${google_service_account.ci_runner.email}"

  condition {
    title      = "only-the-worker-vm"
    expression = "resource.name.endsWith(\"/zones/${var.zone}/instances/particle-worker-0\")"
  }
}

data "external" "runner_reg_token" {
  program = ["node", "${path.module}/../../scripts/gh-runner-token.mjs"]
  query = {
    org = var.github_org
  }
}

resource "google_compute_instance" "ci_runner" {
  count                     = var.runner_count
  name                      = "particle-ci-runner-${count.index}"
  machine_type              = var.runner_machine_type
  zone                      = var.zone
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 50
    }
  }

  network_interface {
    network = "default"
    # Egress only — runners long-poll GitHub over HTTPS; nothing listens.
    access_config {}
  }

  service_account {
    email = google_service_account.ci_runner.email
    # compute scope is gated by the narrow IAM role above; IAM is the boundary.
    scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/compute",
    ]
  }

  metadata_startup_script = templatefile("${path.module}/runner-startup.sh.tpl", {
    github_org = var.github_org
    reg_token  = data.external.runner_reg_token.result.token
  })

  depends_on = [google_project_service.apis]

  lifecycle {
    # The registration token in the startup script is consumed at first boot;
    # every plan mints a fresh one, and that churn must not recreate healthy
    # runners. Recreate explicitly with -replace when you actually mean it.
    ignore_changes = [metadata_startup_script]
  }
}

output "ci_runners" {
  value = [for r in google_compute_instance.ci_runner : r.name]
}
