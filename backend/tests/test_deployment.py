import importlib.util
import json
import sys
from pathlib import Path

import pytest
from test_profiles import credentials as credentials

from app.features.desk.credentials import ProfileStore

ROOT = Path(__file__).resolve().parents[2]


def module(name):
    if str(ROOT / "terraform") not in sys.path:
        sys.path.insert(0, str(ROOT / "terraform"))
    spec = importlib.util.spec_from_file_location(name, ROOT / "terraform" / f"{name}.py")
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_base_credentials_are_default_without_upload_and_do_not_leak(tmp_path, monkeypatch, credentials):
    config, key = credentials
    config_path, key_path = tmp_path / "base-config", tmp_path / "base-key"
    config_path.write_bytes(config)
    key_path.write_bytes(key)
    monkeypatch.setenv("AGENT_DESK_BASE_CONFIG", str(config_path))
    monkeypatch.setenv("AGENT_DESK_BASE_KEY", str(key_path))
    store = ProfileStore(tmp_path / "profiles")
    state, restored_config, restored_key, revision = store.draft()
    assert state.has_credentials and state.profile == "DEFAULT"
    assert restored_config == config and restored_key == key and revision == ""
    assert "PRIVATE" not in state.model_dump_json()
    store.clear_draft()
    assert store.draft()[0].has_credentials  # clearing an override preserves the operator base


def test_bootstrap_validates_before_writing_and_keeps_secrets_out_of_public_config(
    tmp_path, monkeypatch, credentials
):
    bootstrap = module("bootstrap")
    monkeypatch.setattr(bootstrap.os, "chown", lambda *args: None, raising=False)
    config, key = credentials
    runtime = dict(
        oidc_client_id="client",
        oidc_client_secret="private",
        session_secret="s" * 40,
        admin_subject="admin",
    )
    secret = dict(config_text=config.decode(), key_text=key.decode(), runtime_config=runtime)
    import configparser

    parser = configparser.ConfigParser()
    parser.read_string(config.decode())
    settings = dict(
        origin="https://desk.example.com",
        compartment="ocid1.compartment.oc1..deployment",
        domain="https://id.example.com",
        operator_user=parser["DEFAULT"]["user"],
        operator_fingerprint=parser["DEFAULT"]["fingerprint"],
    )
    with pytest.raises(ValueError):
        bootstrap.configure(tmp_path, settings, {**secret, "key_text": "invalid"})
    assert not (tmp_path / "private").exists()
    bootstrap.configure(tmp_path, settings, secret)
    assert (tmp_path / "private/oci/key.pem").read_bytes() == key
    env = (tmp_path / "private/runtime.env").read_text()
    assert "AGENT_DESK_AUTH_MODE=oracle" in env and "PRIVATE KEY" not in env
    assert "AGENT_DESK_MANAGED_CONNECTION=1" in env
    assert "AGENT_DESK_COMPARTMENT_ID=ocid1.compartment.oc1..deployment" in env
    assert (tmp_path / "data").is_dir()


def test_release_preflight_rejects_wrong_source_and_image(tmp_path):
    preflight = module("preflight")
    metadata = dict(
        schema_version=1,
        platform="linux/amd64",
        source_commit_sha="a" * 40,
        image="ghcr.io/example/desk@sha256:" + "b" * 64,
    )
    descriptor = tmp_path / "image.json"
    descriptor.write_text(json.dumps(metadata))
    context = {
        "release_assets": {"assets": {"agent-desk-image.json": {"path": str(descriptor)}}},
        "source": {"commit_sha": "a" * 40},
        "inputs": {"app_image": metadata["image"]},
    }
    preflight.validate(context)
    context["source"]["commit_sha"] = "c" * 40
    with pytest.raises(ValueError):
        preflight.validate(context)
    context["source"]["commit_sha"] = "a" * 40
    context["inputs"]["app_image"] = "ghcr.io/example/desk:latest"
    with pytest.raises(ValueError):
        preflight.validate(context)


def test_preflight_main_writes_the_deploy_studio_result_contract(tmp_path, monkeypatch):
    import runpy
    from types import ModuleType

    metadata = dict(schema_version=1, platform="linux/amd64", source_commit_sha="a" * 40,
                    image="ghcr.io/example/desk@sha256:" + "b" * 64)
    descriptor = tmp_path / "image.json"
    descriptor.write_text(json.dumps(metadata))
    context = {
        "release_assets": {"assets": {"agent-desk-image.json": {"path": str(descriptor)}}},
        "source": {"commit_sha": metadata["source_commit_sha"]},
        "inputs": {"app_image": metadata["image"]},
    }
    context_path, result_path = tmp_path / "context.json", tmp_path / "result.json"
    context_path.write_text(json.dumps(context))
    monkeypatch.setenv("DEPLOY_STUDIO_CONTEXT", str(context_path))
    monkeypatch.setenv("DEPLOY_STUDIO_RESULT", str(result_path))
    monkeypatch.delenv("DEPLOY_STUDIO_OUTPUT", raising=False)
    config = {"user": "ocid1.user.oc1..synthetic", "fingerprint": "synthetic-public-fingerprint"}
    credentials_stub = ModuleType("operator_credentials")
    credentials_stub.operator_credentials = lambda: (config, object())
    identity_stub = ModuleType("identity_setup")

    def selected_identity(observed_config, inputs):
        assert observed_config is config and inputs == context["inputs"]
        return {"admin_directory_id": "synthetic-directory-id"}

    identity_stub.selected_identity = selected_identity
    monkeypatch.setitem(sys.modules, "operator_credentials", credentials_stub)
    monkeypatch.setitem(sys.modules, "identity_setup", identity_stub)
    runpy.run_path(str(ROOT / "terraform/preflight.py"), run_name="__main__")
    result = json.loads(result_path.read_text())
    assert result["inputs"] == {"operator_user_ocid": config["user"],
                                "operator_fingerprint": config["fingerprint"],
                                "admin_directory_id": "synthetic-directory-id"}
    assert result["events"] == [{"name": "image", "status": "passed",
                                  "message": "Image descriptor matches pinned release source."}]


@pytest.fixture
def deployment(tmp_path, monkeypatch, credentials):
    import configparser

    bootstrap = module("bootstrap")
    monkeypatch.setattr(bootstrap.os, "chown", lambda *args: None, raising=False)
    config, key = credentials
    parsed = configparser.ConfigParser()
    parsed.read_string(config.decode())
    settings = dict(
        origin="https://desk.example.com",
        compartment="ocid1.compartment.oc1..deployment",
        domain="https://id.example.com",
        operator_user=parsed["DEFAULT"]["user"],
        operator_fingerprint=parsed["DEFAULT"]["fingerprint"],
        namespace="namespace",
        bucket="bootstrap",
    )
    value = dict(
        config_text=config.decode(),
        key_text=key.decode(),
        runtime_config=dict(
            oidc_client_id="client",
            oidc_client_secret="private-client-secret",
            session_secret="s" * 40,
            admin_subject="admin",
        ),
    )
    return bootstrap, settings, value


@pytest.mark.parametrize("failure", ["tag", "nonce", "version", "extra", "duplicate", "wrong-key"])
def test_encrypted_delivery_rejects_tampering(deployment, tmp_path, failure):
    import base64

    from cryptography.exceptions import InvalidTag

    bootstrap, _, value = deployment
    envelope = module("envelope")
    private = bootstrap.prepare_key(tmp_path / "private")
    raw = envelope.encrypt((tmp_path / "private/bootstrap-public.pem").read_bytes(), value)
    assert b"private-client-secret" not in raw and b"PRIVATE KEY" not in raw
    assert envelope.decrypt(private.read_bytes(), raw) == value
    encoded = json.loads(raw)
    if failure == "tag":
        data = bytearray(base64.b64decode(encoded["ciphertext_b64"]))
        data[-1] ^= 1
        encoded["ciphertext_b64"] = base64.b64encode(data).decode()
    elif failure == "nonce":
        encoded["nonce_b64"] = base64.b64encode(b"short").decode()
    elif failure == "version":
        encoded["schema_version"] = True
    elif failure == "extra":
        encoded["unexpected"] = "value"
    elif failure == "wrong-key":
        private = bootstrap.prepare_key(tmp_path / "other")
    raw = json.dumps(encoded).encode()
    if failure == "duplicate":
        raw = raw.replace(b'"schema_version": 1', b'"schema_version": 1, "schema_version": 1')
    with pytest.raises((ValueError, InvalidTag)):
        envelope.decrypt(private.read_bytes(), raw)


@pytest.mark.parametrize("field", ["operator_user", "operator_fingerprint"])
def test_bootstrap_rejects_another_operator_before_installing(deployment, tmp_path, field):
    bootstrap, settings, value = deployment
    with pytest.raises(ValueError, match="Unexpected operator"):
        bootstrap.configure(tmp_path, {**settings, field: "different"}, value)
    assert not (tmp_path / "private/oci").exists()


def test_consumed_envelope_can_finish_after_interruption_without_reupload(deployment, tmp_path):
    import io
    from types import SimpleNamespace

    import oci

    bootstrap, settings, value = deployment
    envelope = module("envelope")
    bootstrap.prepare_key(tmp_path / "private")
    encrypted = envelope.encrypt((tmp_path / "private/bootstrap-public.pem").read_bytes(), value)

    class Storage:
        exists = True
        deletes = 0

        def get_object(self, *args):
            if not self.exists:
                raise oci.exceptions.ServiceError(404, "NotFound", {}, "missing")
            return SimpleNamespace(
                data=SimpleNamespace(raw=io.BytesIO(encrypted)), headers={"etag": "own-object"}
            )

        def delete_object(self, *args, if_match):
            assert if_match == "own-object"
            self.exists = False
            self.deletes += 1

        def head_object(self, *args):
            raise oci.exceptions.ServiceError(500, "Unavailable", {}, "interrupted")

    storage = Storage()
    with pytest.raises(oci.exceptions.ServiceError):
        bootstrap.consume(tmp_path, settings, storage)
    assert (tmp_path / "private/bootstrap.installed").exists()
    assert not (tmp_path / "private/bootstrap.ready").exists()
    bootstrap.consume(tmp_path, settings, storage)
    assert (tmp_path / "private/bootstrap.ready").exists()
    assert not (tmp_path / "private/bootstrap-key.pem").exists()
    assert storage.deletes == 1
    assert (tmp_path / "private/oci/key.pem").read_text() == value["key_text"]


def test_deployment_uses_encrypted_handoff_and_never_packages_credentials():
    manifest = json.loads((ROOT / "terraform/deploy-studio.json").read_text())
    assert manifest["terraform"]["package_oci_credentials"] is False
    assert manifest["post_apply"]["secret_inputs"] == ["oidc_client_secret"]
    secret = next(f for f in manifest["form"]["fields"] if f["name"] == "oidc_client_secret")
    assert secret["secret"] and secret["transform"] == "none"
    terraform = (ROOT / "terraform/main.tf").read_text()
    assert "secret-bundles" not in terraform and "runtime_secret_ocid" not in terraform
    assert "Compute Instance Run Command" in terraform


def test_ready_bootstrap_reconciles_temporary_keys_without_network(deployment, tmp_path):
    bootstrap, settings, _ = deployment
    private = tmp_path / "private"
    bootstrap.prepare_key(private)
    (private / "bootstrap.ready").write_text("ready")
    (private / "bootstrap.installed").write_text("interrupted cleanup")
    bootstrap.consume(tmp_path, settings, object())
    assert not (private / "bootstrap-key.pem").exists()
    assert not (private / "bootstrap-public.pem").exists()
    assert not (private / "bootstrap.installed").exists()


def test_run_command_transports_only_public_key_request(deployment, tmp_path):
    import time
    from types import SimpleNamespace

    bootstrap, _, _ = deployment
    bootstrap.prepare_key(tmp_path / "private")
    public = (tmp_path / "private/bootstrap-public.pem").read_text()
    post = module("post_apply")
    captured = []

    class Agent:
        def create_instance_agent_command(self, details):
            captured.append(details)
            return SimpleNamespace(data=SimpleNamespace(id="command"))

        def get_instance_agent_command_execution(self, command, instance):
            assert command == "command" and instance == "instance"
            return SimpleNamespace(
                data=SimpleNamespace(lifecycle_state="SUCCEEDED", content=SimpleNamespace(text=public))
            )

    assert (
        post.public_key(
            Agent(), {"compartment_ocid": "compartment", "instance_id": "instance"}, time.monotonic() + 10
        )
        == public.strip().encode()
    )
    assert len(captured[0].content.source.text.encode()) < 4096
    assert "sudo /usr/local/sbin/agent-desk-bootstrap-public-key" in captured[0].content.source.text
    assert "PRIVATE" not in captured[0].content.source.text


def test_hook_delivers_only_ciphertext_and_scopes_cleanup_to_its_etag(deployment, tmp_path, monkeypatch):
    import configparser
    import time
    from types import SimpleNamespace

    import oci

    bootstrap, settings, value = deployment
    key = bootstrap.prepare_key(tmp_path / "private")
    envelope = module("envelope")
    post = module("post_apply")
    config = configparser.ConfigParser()
    config.read_string(value["config_text"])
    config = dict(config["DEFAULT"])
    key_file = tmp_path / "operator-key.pem"
    key_file.write_text(value["key_text"])
    config["key_file"] = str(key_file)
    monkeypatch.setattr(post, "operator_credentials", lambda: (config, object()))
    monkeypatch.setattr(
        post, "public_key", lambda *args: (tmp_path / "private/bootstrap-public.pem").read_bytes()
    )
    monkeypatch.setattr(
        oci.compute_instance_agent, "ComputeInstanceAgentClient", lambda *args, **kwargs: object()
    )
    saved = []
    cleaned = []

    class Storage:
        def put_object(self, namespace, bucket, name, raw, if_none_match):
            assert (namespace, bucket, name, if_none_match) == ("ns", "bucket", envelope.OBJECT, "*")
            saved.append(raw)
            return SimpleNamespace(headers={"etag": "our-etag"})

        def head_object(self, *args):
            raise RuntimeError("delivery interrupted")

        def delete_object(self, *args, if_match):
            cleaned.append(if_match)

    monkeypatch.setattr(oci.object_storage, "ObjectStorageClient", lambda *args, **kwargs: Storage())
    context = dict(
        region="us-chicago-1",
        inputs=dict(
            operator_user_ocid=settings["operator_user"],
            operator_fingerprint=settings["operator_fingerprint"],
            oidc_client_id="client",
            admin_subject="admin",
        ),
        terraform_outputs=dict(bootstrap_namespace="ns", bootstrap_bucket="bucket"),
    )
    with pytest.raises(RuntimeError, match="delivery interrupted"):
        post.deliver(context, "oidc-secret", time.monotonic() + 10)
    assert cleaned == ["our-etag"]
    assert b"oidc-secret" not in saved[0] and b"PRIVATE KEY" not in saved[0]
    restored = envelope.decrypt(key.read_bytes(), saved[0])
    assert restored["runtime_config"]["oidc_client_secret"] == "oidc-secret"
    assert restored["key_text"] == value["key_text"]
