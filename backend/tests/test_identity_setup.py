from types import SimpleNamespace as NS

import pytest
from test_deployment import module

from app.core.identity import IdentitySettings


@pytest.fixture
def selection(monkeypatch):
    setup = module("identity_setup")
    domain = NS(
        id="ocid1.domain.oc1..selected",
        lifecycle_state="ACTIVE",
        url="https://tenant.identity.oraclecloud.com",
    )
    user = NS(id="immutable-scim-id", ocid="ocid1.user.oc1..selected", user_name="login-name", active=True)
    calls = []

    class Client:
        def get_domain(self, value):
            calls.append(value)
            return NS(data=domain)

        def list_users(self, **kwargs):
            calls.append(kwargs)
            return NS(data=NS(resources=[user], total_results=1))

    monkeypatch.setattr(setup.oci.identity, "IdentityClient", lambda config: Client())
    monkeypatch.setattr(setup.oci.identity_domains, "IdentityDomainsClient", lambda config, **kw: Client())
    inputs = dict(identity_domain_id=domain.id, admin_user_ocid=user.ocid, oidc_domain=domain.url)
    return setup, inputs, domain, user, calls


def test_selected_existing_user_resolves_immutable_id_without_equating_username_or_ocid(selection):
    setup, inputs, _, user, calls = selection
    assert setup.selected_identity({}, inputs) == {"admin_directory_id": "immutable-scim-id"}
    assert user.id != user.ocid != user.user_name
    assert calls[1]["filter"] == 'ocid eq "ocid1.user.oc1..selected"'


@pytest.mark.parametrize("change", ["domain", "url", "inactive", "other-user", "other-issuer"])
def test_selected_identity_rejects_stale_or_cross_domain_inputs(selection, change):
    setup, inputs, domain, user, _ = selection
    if change == "domain":
        domain.id = "ocid1.domain.oc1..other"
    elif change == "url":
        domain.url = "https://attacker.example"
    elif change == "inactive":
        user.active = False
    elif change == "other-user":
        user.ocid = "ocid1.user.oc1..other"
    else:
        inputs["oidc_domain"] = "https://other.identity.oraclecloud.com"
    with pytest.raises(ValueError):
        setup.selected_identity({}, inputs)


def test_manifest_creation_is_an_explicit_disabled_by_default_combobox():
    import json

    from test_deployment import ROOT

    manifest = json.loads((ROOT / "terraform/deploy-studio.json").read_text(encoding="utf-8"))
    fields = {f["name"]: f for f in manifest["form"]["fields"]}
    assert fields["create_users"]["type"] == "select"
    assert fields["create_users"]["default"] == "disabled"
    assert fields["create_users"]["options"] == [
        {"value": "disabled", "label": "Deshabilitado"},
        {"value": "enabled", "label": "Habilitado"},
    ]
    assert fields["admin_user_ocid"]["options_source"] == "oci_identity_domain_users"
    assert "admin_subject" not in fields
    derived = manifest["preflight"]
    assert "admin_directory_id" in derived["output_inputs"]
    runtime = {field["name"]: field for field in derived["runtime_fields"]}
    assert runtime["admin_directory_id"]["required"] is True
    assert runtime["admin_directory_id"]["secret"] is False


def test_directory_configuration_cannot_enable_creation_without_directory_login(monkeypatch):
    values = dict(
        AUTH_MODE="oracle",
        PUBLIC_ORIGIN="https://desk.example",
        OIDC_DOMAIN="https://id.example",
        OIDC_CLIENT_ID="client",
        OIDC_CLIENT_SECRET="secret",
        SESSION_SECRET="x" * 40,
        ADMIN_SUBJECT="directory:stable",
        DIRECTORY_LOGIN="0",
        CREATE_USERS="enabled",
    )
    for key, value in values.items():
        monkeypatch.setenv("AGENT_DESK_" + key, value)
    with pytest.raises(RuntimeError):
        IdentitySettings.load()
    monkeypatch.setenv("AGENT_DESK_DIRECTORY_LOGIN", "1")
    assert IdentitySettings.load().create_users
    monkeypatch.setenv("AGENT_DESK_CREATE_USERS", "true")
    with pytest.raises(RuntimeError):
        IdentitySettings.load()
