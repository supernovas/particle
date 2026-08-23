# Public web endpoint for the workspace UI (#25): a static IP and 80/443
# firewall access to the worker VM, where Caddy terminates TLS for
# particle.supernova.ai and proxies to the TS worker's loopback UI server.
#
# DNS lives on Cloudflare: particle.supernova.ai must be an A record to
# `web_ip` with proxying OFF (grey cloud) so Let's Encrypt issuance works
# without putting Cloudflare credentials anywhere.

variable "web_domain" {
  type    = string
  default = "particle.supernova.ai"
}

resource "google_compute_address" "web" {
  name   = "particle-web"
  region = var.region
}

resource "google_compute_firewall" "web" {
  name    = "particle-allow-web"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["particle-web"]
}

output "web_ip" {
  value = google_compute_address.web.address
}
