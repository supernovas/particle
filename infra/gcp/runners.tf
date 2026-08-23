# Self-hosted GitHub Actions runners (#20). Org-level runners that register
# themselves at boot using the workspace GitHub App credentials from Secret
# Manager — no long-lived runner tokens on disk or in Terraform state.
#
# Prerequisites beyond the worker's (one-time, org admin):
#   - the app has the org permission "Self-hosted runners: write"
#   - the Default runner group allows public repositories

variable "runner_count" {
  description = "Number of CI runner VMs"
  type        = number
  default     = 1
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

resource "google_service_account" "ci_runner" {
  account_id   = "particle-ci-runner"
  display_name = "particle CI runner"
}

resource "google_secret_manager_secret_iam_member" "runner_secrets" {
  for_each  = toset(["particle-github-app-json", "particle-github-app-pem"])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ci_runner.email}"

  depends_on = [google_project_service.apis]
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
    email  = google_service_account.ci_runner.email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = templatefile("${path.module}/runner-startup.sh.tpl", {
    project_id = var.project_id
    github_org = var.github_org
  })

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runner_secrets,
  ]
}

output "ci_runners" {
  value = [for r in google_compute_instance.ci_runner : r.name]
}
