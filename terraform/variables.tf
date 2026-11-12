variable "tenancy_ocid" { type = string }
variable "compartment_ocid" { type = string }
variable "region" { type = string }
variable "deployment_suffix" { type = string }
variable "source_commit_sha" { type = string }
variable "availability_domain" { type = string }
variable "oracle_linux_image_ocid" { type = string }
variable "identity_domain_id" { type = string }
variable "oidc_domain" {
  type = string
  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:443)?$", var.oidc_domain))
    error_message = "Use the Oracle identity domain HTTPS origin, optionally with port 443, without a trailing slash."
  }
}
variable "app_image" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$", var.app_image))
    error_message = "Use a public linux/amd64 container image pinned by SHA-256 digest."
  }
}

variable "operator_user_ocid" { type = string }
variable "operator_fingerprint" { type = string }
variable "admin_user_ocid" { type = string }
variable "admin_directory_id" { type = string }
variable "create_users" {
  type    = string
  default = "disabled"
  validation {
    condition     = contains(["disabled", "enabled"], var.create_users)
    error_message = "Create users must be disabled or enabled."
  }
}
