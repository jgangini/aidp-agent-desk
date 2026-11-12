locals {
  name = "agent-desk-${var.deployment_suffix}"
  bootstrap = {
    region               = var.region
    namespace            = data.oci_objectstorage_namespace.target.namespace
    bucket               = oci_objectstorage_bucket.bootstrap.name
    origin               = ""
    domain               = var.oidc_domain
    compartment          = var.compartment_ocid
    operator_user        = var.operator_user_ocid
    operator_fingerprint = var.operator_fingerprint
    create_users         = var.create_users
  }
  proxy_image       = "docker.io/library/caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83"
  start             = <<-SCRIPT
    #!/bin/bash
    set -eu
    umask 077
    podman pull '${var.app_image}'
    podman run --rm --replace --name agent-desk-bootstrap --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --tmpfs /tmp:rw,nosuid,noexec,size=32m --security-opt no-new-privileges --user 0:0 --network host --security-opt label=disable --entrypoint python \
      -v /opt/agent-desk:/install '${var.app_image}' /install/bootstrap.py
    podman rm -f agent-desk 2>/dev/null || true
    exec podman run --name agent-desk --read-only --cap-drop ALL \
      --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,noexec,size=64m \
      --env-file /opt/agent-desk/private/runtime.env -e AGENT_DESK_AUTH_MODE=oracle \
      -v /opt/agent-desk/data:/data:Z \
      -v /opt/agent-desk/private/oci:/run/oci:ro,Z \
      -p 127.0.0.1:8000:8000 '${var.app_image}'
  SCRIPT
  service           = <<-SERVICE
    [Unit]
    Description=Agent Desk
    After=network-online.target agent-desk-network.service
    Wants=network-online.target
    Requires=agent-desk-network.service
    [Service]
    Type=simple
    ExecStart=/bin/bash /opt/agent-desk/start.sh
    ExecStop=/usr/bin/podman stop agent-desk
    ExecStopPost=-/usr/bin/podman rm -f agent-desk-bootstrap
    TimeoutStartSec=3600
    Restart=on-failure
    RestartSec=30
    [Install]
    WantedBy=multi-user.target
  SERVICE
  proxy             = <<-SERVICE
    [Unit]
    Description=Agent Desk TLS proxy
    After=network-online.target agent-desk-network.service
    Wants=network-online.target
    Requires=agent-desk-network.service
    [Service]
    ExecStartPre=-/usr/bin/podman rm -f agent-desk-proxy
    ExecStart=/usr/bin/podman run --name agent-desk-proxy --network host --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,noexec,size=32m -e XDG_CONFIG_HOME=/tmp/caddy-config -e XDG_DATA_HOME=/tmp/caddy-data -v /opt/agent-desk/caddy:/etc/caddy:ro,Z -v /opt/agent-desk/acme:/srv/acme:ro,z -v /opt/agent-desk/tls:/certs:ro,z ${local.proxy_image}
    ExecStop=/usr/bin/podman stop agent-desk-proxy
    Restart=on-failure
    RestartSec=30
    [Install]
    WantedBy=multi-user.target
  SERVICE
  network_service   = <<-SERVICE
    [Unit]
    Description=Agent Desk public IP origin
    After=network-online.target
    Wants=network-online.target
    [Service]
    Type=oneshot
    ExecStart=/usr/bin/python3 /opt/agent-desk/prepare_runtime.py
    RemainAfterExit=yes
    TimeoutStartSec=600
    [Install]
    WantedBy=multi-user.target
  SERVICE
  tls_issue_service = <<-SERVICE
    [Unit]
    Description=Agent Desk public IP certificate
    After=network-online.target agent-desk-proxy.service
    Wants=network-online.target
    Requires=agent-desk-proxy.service
    [Service]
    Type=oneshot
    ExecStart=/bin/bash /opt/agent-desk/public_ip_tls.sh issue
    Restart=on-failure
    RestartSec=120
    TimeoutStartSec=900
    [Install]
    WantedBy=multi-user.target
  SERVICE
  tls_renew_service = <<-SERVICE
    [Unit]
    Description=Renew Agent Desk public IP certificate
    After=network-online.target agent-desk-proxy.service
    Wants=network-online.target
    Requires=agent-desk-proxy.service
    [Service]
    Type=oneshot
    ExecStart=/bin/bash /opt/agent-desk/public_ip_tls.sh renew
    TimeoutStartSec=900
  SERVICE
  tls_timer         = <<-SERVICE
    [Unit]
    Description=Renew Agent Desk IP TLS twice daily
    [Timer]
    OnCalendar=*-*-* 00,12:00:00
    RandomizedDelaySec=3600
    Persistent=true
    [Install]
    WantedBy=timers.target
  SERVICE
  public_key_helper = <<-SCRIPT
    #!/bin/bash
    set -eu
    for attempt in {1..100}; do
      if test -f /opt/agent-desk/private/bootstrap.ready; then
        echo AGENT_DESK_BOOTSTRAP_READY
        exit 0
      fi
      if test -f /opt/agent-desk/private/bootstrap-public.pem; then
        exec cat /opt/agent-desk/private/bootstrap-public.pem
      fi
      sleep 5
    done
    exit 1
  SCRIPT
  cloud_config = {
    package_update = true
    packages       = ["podman", "firewalld", "oci-utils", "python3", "openssl", "util-linux"]
    write_files = [
      { path = "/opt/agent-desk/bootstrap.py", permissions = "0600", content = file("${path.module}/bootstrap.py") },
      { path = "/opt/agent-desk/envelope.py", permissions = "0600", content = file("${path.module}/envelope.py") },
      { path = "/opt/agent-desk/bootstrap.json", permissions = "0600", content = jsonencode(local.bootstrap) },
      { path = "/opt/agent-desk/start.sh", permissions = "0700", content = local.start },
      { path = "/usr/local/sbin/agent-desk-bootstrap-public-key", permissions = "0755", content = local.public_key_helper },
      { path = "/etc/sudoers.d/101-agent-desk-bootstrap", permissions = "0440", content = "ocarun ALL=(root) NOPASSWD: /usr/local/sbin/agent-desk-bootstrap-public-key \"\"\n" },
      { path = "/etc/systemd/system/agent-desk.service", permissions = "0644", content = local.service },
      { path = "/etc/systemd/system/agent-desk-proxy.service", permissions = "0644", content = local.proxy },
      { path = "/opt/agent-desk/prepare_runtime.py", permissions = "0700", content = file("${path.module}/prepare_runtime.py") },
      { path = "/opt/agent-desk/public_ip_tls.sh", permissions = "0700", content = file("${path.module}/public_ip_tls.sh") },
      { path = "/etc/systemd/system/agent-desk-network.service", permissions = "0644", content = local.network_service },
      { path = "/etc/systemd/system/agent-desk-tls-issue.service", permissions = "0644", content = local.tls_issue_service },
      { path = "/etc/systemd/system/agent-desk-tls-renew.service", permissions = "0644", content = local.tls_renew_service },
      { path = "/etc/systemd/system/agent-desk-tls-renew.timer", permissions = "0644", content = local.tls_timer },
    ]
    runcmd = [
      ["install", "-d", "-m", "0700", "/opt/agent-desk/private", "/opt/agent-desk/tls", "/opt/agent-desk/caddy"],
      ["visudo", "-cf", "/etc/sudoers.d/101-agent-desk-bootstrap"],
      ["systemctl", "enable", "--now", "firewalld"],
      ["firewall-cmd", "--permanent", "--add-service=http"],
      ["firewall-cmd", "--permanent", "--add-service=https"],
      ["firewall-cmd", "--reload"],
      ["systemctl", "daemon-reload"],
      ["systemctl", "enable", "--now", "agent-desk", "agent-desk-proxy", "agent-desk-tls-issue", "agent-desk-tls-renew.timer"],
    ]
  }
}
resource "oci_core_network_security_group" "web" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.desk.id
  display_name   = local.name
}
resource "oci_core_network_security_group_security_rule" "https" {
  for_each                  = toset(["80", "443"])
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  tcp_options {
    destination_port_range {
      min = tonumber(each.value)
      max = tonumber(each.value)
    }
  }
}
resource "oci_core_network_security_group_security_rule" "egress" {
  for_each                  = toset(["80", "443"])
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = "0.0.0.0/0"
  tcp_options {
    destination_port_range {
      min = tonumber(each.value)
      max = tonumber(each.value)
    }
  }
}
resource "oci_core_instance" "desk" {
  compartment_id      = var.compartment_ocid
  availability_domain = var.availability_domain
  display_name        = local.name
  freeform_tags       = { source_commit_sha = var.source_commit_sha, identity_domain_id = var.identity_domain_id }
  shape               = "VM.Standard.E4.Flex"
  shape_config {
    ocpus         = 1
    memory_in_gbs = 8
  }
  source_details {
    source_type             = "image"
    source_id               = var.oracle_linux_image_ocid
    boot_volume_size_in_gbs = 50
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    nsg_ids          = [oci_core_network_security_group.web.id]
  }
  metadata = { user_data = base64encode("#cloud-config\n${yamlencode(local.cloud_config)}") }
  agent_config {
    are_all_plugins_disabled = false
    plugins_config {
      name          = "Compute Instance Run Command"
      desired_state = "ENABLED"
    }
  }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.oci_core_image.target.operating_system == "Oracle Linux" && startswith(data.oci_core_image.target.operating_system_version, "9")
      error_message = "Use an Oracle Linux platform image with Run Command support."
    }
  }
  instance_options { are_legacy_imds_endpoints_disabled = true }
}
resource "oci_identity_dynamic_group" "desk" {
  provider       = oci.home
  compartment_id = var.tenancy_ocid
  name           = local.name
  description    = "Agent Desk one-use encrypted bootstrap access"
  matching_rule  = "instance.id = '${oci_core_instance.desk.id}'"
}
data "oci_core_image" "target" { image_id = var.oracle_linux_image_ocid }
data "oci_objectstorage_namespace" "target" { compartment_id = var.tenancy_ocid }
resource "oci_objectstorage_bucket" "bootstrap" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.target.namespace
  name           = "${local.name}-bootstrap"
  access_type    = "NoPublicAccess"
  versioning     = "Disabled"
}
resource "oci_identity_policy" "bootstrap" {
  provider       = oci.home
  compartment_id = var.tenancy_ocid
  name           = local.name
  description    = "One-use encrypted bootstrap and own Run Command execution"
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.desk.name} to manage objects in compartment id ${var.compartment_ocid} where all {target.bucket.name='${oci_objectstorage_bucket.bootstrap.name}', target.object.name='.bootstrap/runtime.json'}",
    "Allow dynamic-group ${oci_identity_dynamic_group.desk.name} to use instance-agent-command-execution-family in compartment id ${var.compartment_ocid} where request.instance.id=target.instance.id"
  ]
}
output "public_ip" { value = oci_core_instance.desk.public_ip }
output "application_url" { value = "https://${oci_core_instance.desk.public_ip}" }
output "oidc_callback_url" { value = "https://${oci_core_instance.desk.public_ip}/api/auth/callback" }
output "instance_id" { value = oci_core_instance.desk.id }
output "compartment_ocid" { value = var.compartment_ocid }
output "bootstrap_namespace" { value = data.oci_objectstorage_namespace.target.namespace }
output "bootstrap_bucket" { value = oci_objectstorage_bucket.bootstrap.name }
