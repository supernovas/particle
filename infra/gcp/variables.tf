variable "project_id" {
  description = "GCP project that hosts the particle worker"
  type        = string
  default     = "particle-production-506421"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "machine_type" {
  description = "e2-small builds the worker in a few minutes and runs it comfortably"
  type        = string
  default     = "e2-small"
}

variable "repo_url" {
  description = "Host repo the worker builds from and watches"
  type        = string
  default     = "https://github.com/supernovas/particle.git"
}

variable "branch" {
  type    = string
  default = "main"
}
