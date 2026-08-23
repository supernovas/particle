terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_project_service" "apis" {
  for_each           = toset(["compute.googleapis.com", "secretmanager.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "worker" {
  account_id   = "particle-worker"
  display_name = "particle worker"
}

# The GitHub App credentials are uploaded out-of-band by
# scripts/gcp-upload-secrets.sh so key material never enters Terraform state;
# here we only grant the worker's service account access to them.
resource "google_secret_manager_secret_iam_member" "app_secrets" {
  for_each  = toset(["particle-github-app-json", "particle-github-app-pem"])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"

  depends_on = [google_project_service.apis]
}

resource "google_compute_instance" "worker" {
  name                      = "particle-worker-0"
  machine_type              = var.machine_type
  zone                      = var.zone
  allow_stopping_for_update = true
  tags                      = ["particle-web"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
    }
  }

  network_interface {
    network = "default"
    access_config {
      # Static: particle.supernova.ai points here (Cloudflare A record).
      nat_ip = google_compute_address.web.address
    }
  }

  service_account {
    email  = google_service_account.worker.email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tpl", {
    project_id = var.project_id
    repo_url   = var.repo_url
    branch     = var.branch
    web_domain = var.web_domain
  })

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.app_secrets,
  ]
}
