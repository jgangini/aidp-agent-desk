resource "oci_core_vcn" "desk" {
  compartment_id = var.compartment_ocid
  display_name   = local.name
  cidr_blocks    = ["10.74.0.0/24"]
  dns_label      = "desk${substr(sha256(var.deployment_suffix), 0, 8)}"
}

resource "oci_core_internet_gateway" "desk" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.desk.id
  display_name   = "${local.name}-internet"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.desk.id
  display_name   = "${local.name}-public"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.desk.id
  }
}

resource "oci_core_security_list" "web" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.desk.id
  display_name   = "${local.name}-web"

  dynamic "ingress_security_rules" {
    for_each = toset(["80", "443"])
    content {
      protocol    = "6"
      source      = "0.0.0.0/0"
      source_type = "CIDR_BLOCK"
      stateless   = false
      tcp_options {
        min = tonumber(ingress_security_rules.value)
        max = tonumber(ingress_security_rules.value)
      }
    }
  }

  ingress_security_rules {
    description = "Path MTU discovery fragmentation messages only"
    protocol    = "1"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false
    icmp_options {
      type = 3
      code = 4
    }
  }

  dynamic "egress_security_rules" {
    for_each = toset(["80", "443"])
    content {
      protocol         = "6"
      destination      = "0.0.0.0/0"
      destination_type = "CIDR_BLOCK"
      stateless        = false
      tcp_options {
        min = tonumber(egress_security_rules.value)
        max = tonumber(egress_security_rules.value)
      }
    }
  }

  egress_security_rules {
    description      = "oci-public-ip STUN fallback for bootstrap IP discovery"
    protocol         = "17"
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    stateless        = false
    udp_options {
      min = 3478
      max = 3478
    }
  }

  egress_security_rules {
    description      = "OCI Internet and VCN DNS resolver"
    protocol         = "17"
    destination      = "169.254.169.254/32"
    destination_type = "CIDR_BLOCK"
    stateless        = false
    udp_options {
      min = 53
      max = 53
    }
  }

  egress_security_rules {
    description      = "OCI DNS resolver TCP fallback"
    protocol         = "6"
    destination      = "169.254.169.254/32"
    destination_type = "CIDR_BLOCK"
    stateless        = false
    tcp_options {
      min = 53
      max = 53
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.desk.id
  display_name               = "${local.name}-public"
  cidr_block                 = "10.74.0.0/24"
  dns_label                  = "public"
  prohibit_public_ip_on_vnic = false
  prohibit_internet_ingress  = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.web.id]
}
