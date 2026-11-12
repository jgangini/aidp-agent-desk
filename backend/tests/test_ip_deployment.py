import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_deployment import ROOT, module


def test_ip_bootstrap_does_not_expose_backend_before_public_tls(tmp_path: Path):
    prepare = module("prepare_runtime")
    settings = tmp_path / "bootstrap.json"
    settings.write_text(json.dumps({"origin": "", "domain": "https://id.example.com"}))
    ip_file = tmp_path / "public-ip"
    prepare.prepare(tmp_path, "8.8.4.4", ip_file)
    assert json.loads(settings.read_text())["origin"] == "https://8.8.4.4"
    config = (tmp_path / "caddy/Caddyfile").read_text()
    assert "/.well-known/acme-challenge/*" in config
    assert "503" in config and "reverse_proxy" not in config
    (tmp_path / "caddy/Caddyfile").write_text("accepted public TLS configuration")
    prepare.prepare(tmp_path, "8.8.4.4", ip_file)
    assert (tmp_path / "caddy/Caddyfile").read_text() == "accepted public TLS configuration"
    with pytest.raises(ValueError, match="Public IP changed"):
        prepare.prepare(tmp_path, "1.1.1.1", ip_file)
    assert ip_file.read_text().strip() == "8.8.4.4"


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "224.0.0.1", "::1", "8.8.4.4;echo x"])
def test_ip_bootstrap_rejects_nonpublic_and_non_ipv4_before_writes(tmp_path: Path, address: str):
    with pytest.raises(ValueError):
        module("prepare_runtime").prepare(tmp_path, address, tmp_path / "ip")
    assert list(tmp_path.iterdir()) == []


def test_ready_uses_output_ip_and_default_certificate_verification(monkeypatch):
    post = module("post_apply")
    calls = []
    monkeypatch.setattr(post, "deliver", lambda *args: None)

    def ready(origin):
        calls.append(origin)
        return True

    monkeypatch.setattr(post, "ready", ready)
    result = post.run({"inputs": {}, "terraform_outputs": {"public_ip": "8.8.4.4", "application_url": "https://8.8.4.4"}}, "secret")
    assert calls == ["https://8.8.4.4"]
    assert result["outputs"]["application_url"] == "https://8.8.4.4"


@pytest.mark.parametrize("address,origin", [
    ("8.8.4.4", "http://8.8.4.4"), ("127.0.0.1", "https://127.0.0.1"),
    ("8.8.4.4", "https://attacker.example"), ("8.8.4.4", "https://8.8.4.4:443"),
])
def test_post_apply_checks_destination_before_sending_bootstrap(monkeypatch, address, origin):
    post = module("post_apply")
    sent = []
    monkeypatch.setattr(post, "deliver", lambda *args: sent.append(True))
    with pytest.raises(ValueError):
        post.run({"terraform_outputs": {"public_ip": address, "application_url": origin}}, "secret")
    assert sent == []


def test_ip_discovery_uses_the_reference_oci_helper(monkeypatch):
    prepare = module("prepare_runtime")
    calls = []

    def execute(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(stdout="Public IP: 8.8.4.4\n")

    monkeypatch.setattr(prepare.subprocess, "run", execute)
    assert prepare.discover_public_ip() == "8.8.4.4"
    assert calls == [["oci-public-ip", "-g"]]


def test_deploy_studio_ip_recipe_needs_no_dns_or_existing_subnet():
    manifest = json.loads((ROOT / "terraform/deploy-studio.json").read_text())
    fields = {field["name"] for field in manifest["form"]["fields"]}
    assert "public_origin" not in fields and "subnet_ocid" not in fields
    main = (ROOT / "terraform/main.tf").read_text()
    assert "https://${oci_core_instance.desk.public_ip}" in main
    assert 'file("${path.module}/public_ip_tls.sh")' in main
    assert '"agent-desk-tls-renew.timer"' in main
