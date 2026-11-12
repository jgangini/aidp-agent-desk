terraform {
  required_version = ">= 1.5, < 2.0"
  required_providers {
    oci = { source = "oracle/oci", version = ">= 7.0, < 8.0" }
  }
}
provider "oci" {
  region = var.region
}

data "oci_identity_region_subscriptions" "target" {
  provider   = oci
  tenancy_id = var.tenancy_ocid

  lifecycle {
    postcondition {
      condition     = length([for subscription in self.region_subscriptions : subscription.region_name if subscription.is_home_region]) == 1
      error_message = "The tenancy must expose exactly one home-region subscription."
    }
  }
}

provider "oci" {
  alias  = "home"
  region = one([for subscription in data.oci_identity_region_subscriptions.target.region_subscriptions : subscription.region_name if subscription.is_home_region])
}
