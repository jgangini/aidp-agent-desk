"""AIDP TEST contracts verified by Agent Flow LangGraph 0.4.42 (native-cli.md).

This adapter invokes an existing TEST; source sync, refresh and publication remain
owned by the agent project. It never borrows that project's research session.
"""

import hashlib
import json
import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from .credentials import ProfileStore, segment
from .schemas import AgentProfile


class DevelopmentError(ValueError):
    pass


def key(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,200}", value) or value in {".", ".."}:
        raise DevelopmentError("AIDP devolvió un identificador TEST incompatible.")
    return value


class Development:
    def __init__(self, metadata: AgentProfile, session: Any, signer: Any) -> None:
        if not metadata.instance_id or not metadata.workspace_id:
            raise DevelopmentError("Vuelve a importar el agente desde su workspace para usar Desarrollo (TEST).")
        self.metadata, self.session, self.signer = metadata, session, signer
        self.base = f"https://datalake.{metadata.region}.oci.oraclecloud.com"
        self.ws = f"/aiDataPlatforms/{segment(metadata.instance_id)}/workspaces/{segment(metadata.workspace_id)}"
        self.agent = key(metadata.flow_id)

    def request(self, method: str, path: str, *, legacy: bool = False, **kwargs: Any) -> dict[str, Any]:
        version = "20240831" if legacy else "20260430"
        workspace = self.ws.replace("/aiDataPlatforms/", "/dataLakes/", 1) if legacy else self.ws
        with self.session.request(method, f"{self.base}/{version}{workspace}{path}", auth=self.signer,
                                  timeout=(5, 20), allow_redirects=False, **kwargs) as response:
            if not 200 <= response.status_code < 300 or len(response.content) > 2 * 1024 * 1024:
                raise DevelopmentError("No se pudo consultar TEST en AIDP. Revisa permisos y disponibilidad.")
            data = response.json()
            self.next_page = response.headers.get("opc-next-page")
            if not isinstance(data, dict):
                raise DevelopmentError("AIDP devolvió una respuesta TEST incompatible.")
            return data

    def _test_deployments(self, compute: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page = None
        for _ in range(50):
            data = self.request("GET", "/agentFlowDeployments", legacy=True, params={
                "agentFlowKey": self.agent, "deploymentType": "TEST", "limit": 100,
                **({"page": page} if page else {}),
            })
            batch = data.get("items")
            if not isinstance(batch, list) or len(batch) > 100:
                raise DevelopmentError("El catálogo TEST no es compatible.")
            for row in batch:
                if (not isinstance(row, dict) or row.get("deploymentType") != "TEST"
                        or row.get("agentFlowKey") != self.agent or row.get("agentKey", self.agent) != self.agent
                        or (row.get("agentFlowComputeKey") or row.get("agentComputeKey")) != compute):
                    raise DevelopmentError("El catálogo TEST no corresponde al agente y compute seleccionados.")
                if row.get("lifecycleState") not in {"CREATING", "ACTIVE", "INACTIVE", "FAILED", "DELETED"}:
                    raise DevelopmentError("AIDP devolvió un estado TEST incompatible.")
                if row.get("lifecycleState") == "ACTIVE":
                    rows.append(row)
            # AIDP's collection uses the response header, not a body cursor.
            page = getattr(self, "next_page", None)
            if not page:
                break
        else:
            raise DevelopmentError("El catálogo TEST supera el límite de consulta.")
        return rows

    @staticmethod
    def _latest_deployment(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if len(rows) > 1:
            try:
                dates = [datetime.fromisoformat(row["timeCreated"].replace("Z", "+00:00")) for row in rows]
                if any(date.tzinfo is None for date in dates) or dates.count(max(dates)) != 1:
                    raise ValueError()
                selected = rows[dates.index(max(dates))]
            except (AttributeError, KeyError, TypeError, ValueError):
                raise DevelopmentError("No se puede identificar la revisión TEST más reciente.") from None
        else:
            selected = rows[0]
        return selected

    def target(self) -> dict[str, Any]:
        agent = self.request("GET", f"/agents/{self.agent}")
        if agent.get("key") != self.agent or agent.get("type") != "CODE":
            raise DevelopmentError("Desarrollo (TEST) requiere el agente CODE seleccionado.")
        compute = key(agent.get("computeKey"))
        rows = self._test_deployments(compute)
        if not rows:
            raise DevelopmentError("TEST no está activo. Actualízalo desde el proyecto del agente antes de probar.")
        endpoint = f"https://gateway.aidp.{self.metadata.region}.oci.oraclecloud.com/agentendpoint/{self.agent}_TEST/chat"
        if any((row.get("endpointUrl") or row.get("uri")) != endpoint for row in rows):
            raise DevelopmentError("El destino TEST no coincide con el gateway autorizado.")
        selected = self._latest_deployment(rows)
        return {"endpoint": endpoint, "compute": compute, "deployment": key(selected.get("key")),
                "version": selected.get("deploymentVersion")}

    def verify_session(self, identity: str, target: dict[str, Any]) -> None:
        value = self.request("GET", f"/agents/{self.agent}/sessions/{key(identity)}")
        if (value.get("key") != identity or value.get("agentKey") != self.agent
                or value.get("agentComputeKey") != target["compute"] or value.get("endpointUrl") != target["endpoint"]
                or "lifecycleState" not in value or value["lifecycleState"] not in (None, "ACTIVE")):
            raise DevelopmentError("La sesión TEST no está disponible o cambió de destino. Inicia una conversación nueva.")

    def conversation(self, store: ProfileStore, client_id: str, target: dict[str, Any], create: bool) -> str:
        identity = hashlib.sha256(client_id.encode()).hexdigest()
        directory = store.root / self.metadata.id / "test-sessions"
        path = directory / f"{identity}.json"
        with store.lock:
            directory.mkdir(mode=0o700, exist_ok=True)
            if directory.is_symlink() or path.is_symlink():
                raise DevelopmentError("El almacén de sesiones TEST no es válido.")
            if path.exists():
                record = json.loads(path.read_text(encoding="utf-8"))
                previous = record.get("target")
                if previous != target and (create or not isinstance(previous, dict)
                        or previous.get("compute") != target["compute"]
                        or previous.get("endpoint") != target["endpoint"]):
                    raise DevelopmentError("TEST cambió de revisión o destino. Inicia una conversación nueva para probarla.")
                # Replay/cancel retain the original session; only revision metadata may differ.
                # verify_session below still checks its live agent, compute, endpoint and lifecycle.
                if not record.get("session"):
                    raise DevelopmentError("La creación de sesión TEST quedó pendiente; reconcilia antes de reintentar.")
                session_id = key(record["session"])
            else:
                if not create:
                    raise DevelopmentError("No existe una sesión TEST para recuperar o cancelar esta conversación.")
                # Claim before the only POST. An uncertain response must never create a second session.
                record = {"target": target, "session": None, "retry_token": uuid4().hex}
                with path.open("x", encoding="utf-8") as output:
                    json.dump(record, output)
                path.chmod(0o600)
                created = self.request("POST", "/agentFlowSessions", legacy=True,
                                       headers={"opc-retry-token": record["retry_token"]}, json={
                    "agentFlowKey": self.agent, "agentFlowComputeKey": target["compute"],
                    "displayName": "Agent Desk TEST", "deploymentType": "TEST",
                })
                session_id = key(created.get("key"))
                record["session"] = session_id
                temporary = path.with_suffix(".tmp")
                temporary.write_text(json.dumps(record), encoding="utf-8")
                temporary.chmod(0o600)
                temporary.replace(path)
        self.verify_session(session_id, target)
        return session_id
