"""Tenant directory operations, independent of application agent permissions."""

import configparser
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

import oci  # type: ignore[import-untyped]

DIRECTORY_FAILURES = (
    oci.exceptions.ServiceError,
    oci.exceptions.ClientError,
    OSError,
    KeyError,
    configparser.Error,
)


class DirectoryError(ValueError):
    pass


def directory_client(domain: str) -> Any:
    parser = configparser.ConfigParser(interpolation=None)
    with Path(os.environ["AGENT_DESK_BASE_CONFIG"]).open(encoding="utf-8-sig") as source:
        parser.read_string(source.read(65537))
    section = parser[os.getenv("AGENT_DESK_BASE_PROFILE", "DEFAULT")]
    config = {name: section[name].strip() for name in ("user", "tenancy", "region", "fingerprint")}
    config["key_file"] = os.environ["AGENT_DESK_BASE_KEY"]
    return oci.identity_domains.IdentityDomainsClient(config, service_endpoint=domain, timeout=(10, 15))


class OracleDirectory:
    def __init__(self, domain: str, client_id: str, allow_create: bool = False) -> None:
        self.domain, self.allow_create = domain, allow_create
        self.marker = "agent-desk:" + hashlib.sha256((domain + "\0" + client_id).encode()).hexdigest()

    def search(self, query: str) -> list[dict[str, str]]:
        query = query.strip()
        if len(query) < 2:
            return []
        literal = json.dumps(query, ensure_ascii=True)
        result = (
            directory_client(self.domain)
            .list_users(
                filter=f"active eq true and (userName co {literal} or emails.value co {literal})",
                count=20,
                attributes="id,userName,emails,active",
                sort_by="userName",
                sort_order="ASCENDING",
            )
            .data
        )
        return matching_emails(result.resources or [], query)

    def find(self, attribute: str, value: str) -> dict[str, Any] | None:
        if attribute not in ("userName", "email"):
            raise DirectoryError("Atributo de búsqueda no permitido.")
        literal = json.dumps(value, ensure_ascii=True)
        expression = f"userName eq {literal}"
        if attribute == "email":
            expression = f"({expression} or emails.value eq {literal})"
        result = (
            directory_client(self.domain)
            .list_users(filter=expression, count=2, attributes="id,userName,emails,active,externalId")
            .data
        )
        users = result.resources or []
        if (result.total_results or 0) > 1 or len(users) > 1:
            raise DirectoryError(
                "El correo identifica varias cuentas. Consulta al administrador del dominio."
            )
        if not users:
            return None
        return self.resolved_user(users[0], attribute, value)

    def resolved_user(self, user: Any, attribute: str, value: str) -> dict[str, Any]:
        emails = [item.value for item in user.emails or [] if item.value]
        matches = [user.user_name] if attribute == "userName" else [user.user_name, *emails]
        if not any(isinstance(item, str) and item.casefold() == value.casefold() for item in matches):
            raise DirectoryError("Oracle devolvió una identidad diferente de la solicitada.")
        if user.active is not True or not user.id or not user.user_name:
            raise DirectoryError("La cuenta Oracle no está activa.")
        return {
            "id": user.id,
            "username": user.user_name,
            "email": emails[0] if emails else value if attribute == "email" else "",
            "owned": user.external_id == self.marker,
        }

    def resolve(self, email: str, create: bool = False) -> dict[str, Any]:
        if create and not self.allow_create:
            raise DirectoryError("Crear usuarios está deshabilitado en esta instalación.")
        user = self.find("email", email)
        if user is None:
            if not create:
                raise DirectoryError("No existe una cuenta activa con ese correo en el dominio Oracle.")
            try:
                directory_client(self.domain).create_user(
                    oci.identity_domains.models.User(
                        schemas=["urn:ietf:params:scim:schemas:core:2.0:User"],
                        user_name=email,
                        display_name=email,
                        active=True,
                        external_id=self.marker,
                        name=oci.identity_domains.models.UserName(
                            given_name=email.split("@", 1)[0], family_name=email.split("@", 1)[0]
                        ),
                        emails=[
                            oci.identity_domains.models.UserEmails(value=email, primary=True, type="work")
                        ],
                    )
                )
            except oci.exceptions.ServiceError as error:
                if error.status != 409:
                    raise
            user = self.find("email", email)
            if user is None:
                raise DirectoryError("Oracle está preparando la cuenta. Vuelve a intentarlo.")
        return user

    def activate(self, user: dict[str, Any]) -> None:
        if not self.allow_create or not user["owned"]:
            raise DirectoryError("La cuenta no fue creada por esta instalación.")
        identifier = str(user["id"])
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,256}", identifier):
            raise DirectoryError("Oracle devolvió un identificador no válido.")
        directory_client(self.domain).base_client.call_api(
            "/admin/v1/UserActivationInitiator/" + identifier,
            "PUT",
            header_params={"Content-Type": "application/scim+json"},
            body={"schemas": ["urn:ietf:params:scim:schemas:oracle:idcs:UserActivationInitiator"]},
            response_type="dict",
        )

    def login_identity(self, subject: str) -> tuple[str, str]:
        # This integration requires the Oracle application to emit sub=userName.
        # Resolve it again at login so a recycled username cannot inherit grants.
        user = self.find("userName", subject)
        if user is None:
            raise DirectoryError("La identidad Oracle ya no existe en el dominio.")
        return "directory:" + str(user["id"]), str(user["email"])


def matching_emails(users: list[Any], query: str) -> list[dict[str, str]]:
    emails: dict[str, str] = {}
    for user in users:
        if user.active is not True or not user.id or not user.user_name:
            continue
        for email in [user.user_name, *(item.value for item in user.emails or [])]:
            if (
                isinstance(email, str)
                and query.casefold() in email.casefold()
                and re.fullmatch(r"[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+", email)
            ):
                emails.setdefault(email.casefold(), email)
    return [{"email": value} for value in list(emails.values())[:20]]
