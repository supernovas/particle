output "instance" {
  value = google_compute_instance.worker.name
}

output "zone" {
  value = var.zone
}

output "service_account" {
  value = google_service_account.worker.email
}

output "logs_hint" {
  value = "gcloud compute ssh ${google_compute_instance.worker.name} --zone ${var.zone} --project ${var.project_id} --command 'sudo journalctl -u particle-worker -f'"
}
