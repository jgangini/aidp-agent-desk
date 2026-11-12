"""Resolve the chosen administrator in the selected domain, never by email alone."""

import json
import re
from urllib.parse import urlsplit

import oci


def domain_origin(config: dict, domain_id: str) -> str:
    domain = oci.identity.IdentityClient(config).get_domain(domain_id).data
    url = urlsplit(str(domain.url))
    if (
        domain.id != domain_id
        or domain.lifecycle_state != "ACTIVE"
        or url.scheme != "https"
        or not (url.hostname or "").endswith(".identity.oraclecloud.com")
        or url.port not in (None, 443)
        or url.path not in ("", "/")
        or any((url.username, url.password, url.query, url.fragment))
    ):
        raise ValueError("Selected Oracle identity domain is not available")
    return str(domain.url).rstrip("/")


def selected_identity(config: dict, inputs: dict) -> dict[str, str]:
    domain_id, user_ocid = inputs["identity_domain_id"], inputs["admin_user_ocid"]
    for value, kind in ((domain_id, "domain"), (user_ocid, "user")):
        if not re.fullmatch(rf"ocid1\.{kind}\.[A-Za-z0-9._-]+", value):
            raise ValueError("Select a valid identity domain and administrator")
    origin = domain_origin(config, domain_id)
    if inputs["oidc_domain"].rstrip("/") != origin:
        raise ValueError("OIDC issuer must match the selected identity domain")
    directory = oci.identity_domains.IdentityDomainsClient(config, service_endpoint=origin, timeout=(10, 15))
    result = directory.list_users(
        filter="ocid eq " + json.dumps(user_ocid), count=2, attributes="id,ocid,userName,active"
    ).data
    users = result.resources or []
    if (
        result.total_results != 1
        or len(users) != 1
        or users[0].ocid != user_ocid
        or users[0].active is not True
        or not users[0].id
        or not users[0].user_name
    ):
        raise ValueError("Select an active administrator belonging to this identity domain")
    return {"admin_directory_id": str(users[0].id)}
