"""Administrative compute control bound to live workspace deployments."""

import hashlib
import json
import re
from contextlib import AbstractContextManager
from typing import Any, Literal

from oci._vendor import requests  # type: ignore[import-untyped]

from .aidp_control import AidpControl, ControlError, collection_page, safe_header
from .compute_journal import ComputeConflict, ComputeJournal
from .compute_schemas import ComputeInventory, ComputeSelection, ComputeStart, ComputeStatus, ComputeTarget
from .credentials import ProfileStore, segment
from .discovery import Discovery
from .schemas import AgentProfile


def catalog_name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1000:
        raise ControlError("comprobar la identidad del compute")
    return value.strip()


def catalog_key(value: Any) -> str:
    if not isinstance(value, str):
        raise ControlError('comprobar la identidad del compute')
    return segment(value)


def stopped_chat_compute(metadata: AgentProfile, endpoint: str, session: Any, signer: Any,
                         test_compute: str | None) -> bool:
    """Corroborate a gateway rejection using the saved invocation's live binding."""
    if not metadata.instance_id or not metadata.workspace_id:
        return False
    control = AidpControl(metadata.region, metadata.instance_id, metadata.workspace_id, session, signer)
    compute = test_compute if test_compute else published_chat_compute(control, metadata.flow_id, endpoint)
    if not compute:
        return False
    value = control.request('GET', f'/clusters/{catalog_key(compute)}',
                            operation='confirmar el estado del compute', timeout=(2, 3))
    return value.get('key') == compute and value.get('state') == 'STOPPED'


def published_chat_compute(control: AidpControl, agent: str, endpoint: str) -> str | None:
    path = f'/agents/{catalog_key(agent)}/deployments'
    operation = 'comprobar el destino publicado del chat'
    data = control.request('GET', path, operation=operation, params={'limit': 100}, timeout=(2, 3))
    rows, next_page = collection_page(data, control.headers)
    if next_page:
        return None
    active = [row for row in rows if row.get('deploymentType') == 'PROD' and row.get('lifecycleState') == 'ACTIVE']
    candidates = [row for row in active if row.get('endpointUrl') in (None, '', endpoint)]
    if len(candidates) != 1:
        return None
    row = candidates[0]
    if not all(row.get(field) for field in ('endpointUrl', 'agentKey', 'agentComputeKey')):
        row = control.request('GET', f"{path}/{catalog_key(row.get('key'))}", operation=operation, timeout=(2, 3))
    if Discovery.production_deployment(row, agent) and row.get('endpointUrl') == endpoint:
        return catalog_key(row.get('agentComputeKey'))
    return None


class ComputeService(AbstractContextManager["ComputeService"]):
    def __init__(self, store: ProfileStore, selection: ComputeSelection) -> None:
        self.store = store
        self.selection = ComputeSelection.model_validate(
            {name: getattr(selection, name) for name in ComputeSelection.model_fields})
        self.draft = store.draft()
        state, config, key, _ = self.draft
        if not state.has_credentials or selection.compartment_id != state.compartment_id:
            raise ValueError("Selecciona el compartimento de la conexión guardada.")
        self.discovery = Discovery(config, key, state.profile)
        self.session = requests.Session()
        self.session.trust_env = False
        self.control = AidpControl(self.discovery.values['region'], selection.instance_id,
                                   selection.workspace_id, self.session, self.discovery.signer)
        self.bindings: dict[str, list[ComputeTarget]] = {}

    def __exit__(self, *_: Any) -> None:
        self.session.close()

    def verify_context(self) -> list[dict[str, Any]]:
        value = self.selection
        self.discovery.check_compartment(value.compartment_id)
        if value.instance_id not in {item.id for item in self.discovery.instances(value.compartment_id)}:
            raise ValueError("La plataforma no pertenece al compartimento seleccionado.")
        if value.workspace_id not in {item.id for item in self.discovery.workspaces(value.instance_id)}:
            raise ValueError("El workspace no pertenece a la plataforma seleccionada.")
        agents = self.control.pages('/agents')
        if not any(agent.get('key') == value.agent_id and agent.get('type') == 'CODE' for agent in agents):
            raise ValueError("El Agent Flow CODE no pertenece al workspace seleccionado.")
        return agents

    def discover(self) -> list[str]:
        for agent in self.verify_context():
            if agent.get('type') == 'CODE':
                self.agent_bindings(agent)
        return [identity for identity, targets in self.bindings.items()
                if any(target.agent_id == self.selection.agent_id for target in targets)]

    def agent_bindings(self, agent: dict[str, Any]) -> None:
        identity = catalog_key(agent.get('key'))
        name = catalog_name(agent.get('displayName'))
        detail = self.control.request('GET', f'/agents/{identity}', operation='comprobar el Agent Flow')
        if detail.get('key') != identity or detail.get('type') != 'CODE':
            raise ControlError('comprobar el Agent Flow')
        compute = catalog_key(detail.get('computeKey'))
        production = self.control.pages(f'/agents/{identity}/deployments')
        for row in production:
            if row.get('deploymentType') == 'PROD' and row.get('lifecycleState') == 'ACTIVE':
                if not row.get('agentKey') or not row.get('agentComputeKey'):
                    row = self.control.request('GET', f"/agents/{identity}/deployments/{catalog_key(row.get('key'))}",
                                               operation='comprobar la publicación del Agent Flow')
                self.bind(row, identity, name, 'PROD')
        tests = self.control.pages('/agentFlowDeployments', legacy=True, agentFlowKey=identity,
                                   deploymentType='TEST')
        for row in tests:
            if row.get('deploymentType') == 'TEST' and row.get('lifecycleState') == 'ACTIVE':
                self.bind(row, identity, name, 'TEST', compute)

    def bind(self, row: dict[str, Any], agent: str, name: str,
             surface: Literal['PROD', 'TEST'], expected: str = '') -> None:
        if row.get('deploymentType') != surface or row.get('lifecycleState') != 'ACTIVE':
            raise ControlError('comprobar los destinos activos del compute')
        identity = row.get('agentFlowKey') if surface == 'TEST' else row.get('agentKey')
        compute = row.get('agentFlowComputeKey') if surface == 'TEST' else row.get('agentComputeKey')
        if identity != agent or (expected and compute != expected):
            raise ControlError('comprobar los destinos compartidos del compute')
        compute = catalog_key(compute)
        target = ComputeTarget(agent_id=agent, name=name, surface=surface)
        targets = self.bindings.setdefault(compute, [])
        if target not in targets:
            targets.append(target)

    def journal(self, compute: str) -> ComputeJournal:
        return ComputeJournal(self.store.root, (self.discovery.values['region'], self.selection.instance_id,
                                                self.selection.workspace_id, compute))

    def cluster(self, compute: str) -> tuple[str, str, str]:
        value = self.control.request('GET', f'/clusters/{segment(compute)}', operation='consultar el compute en AIDP')
        if value.get('key') != compute:
            raise ControlError('comprobar la identidad del compute')
        state = value.get('state')
        if not isinstance(state, str) or not re.fullmatch(r'[A-Z_]{1,64}', state):
            raise ControlError('consultar el estado del compute')
        return catalog_name(value.get('displayName')), state, self.control.headers.get('etag', '')

    def describe(self, compute: str, journal: ComputeJournal) -> ComputeStatus:
        name, state, _ = self.cluster(compute)
        operation = journal.reconcile(state)
        message = {'idle': '', 'starting': 'AIDP aceptó el inicio. Esperando el estado ACTIVE.',
                   'uncertain': 'Hay un inicio de resultado incierto. Consulta el estado; no se enviará otro inicio.'}
        return ComputeStatus(id=compute, name=name, state=state, targets=self.bindings[compute],
                             can_start=state == 'STOPPED' and operation == 'idle',
                             operation=operation, message=message[operation],
                             confirmation=self.confirmation(compute, name))

    def confirmation(self, compute: str, name: str) -> str:
        targets = sorted((target.agent_id, target.name, target.surface) for target in self.bindings[compute])
        material = [self.selection.model_dump(), self.discovery.values['region'], compute, name, targets]
        return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def status(self) -> ComputeInventory:
        computes = []
        for compute in self.discover():
            with self.journal(compute) as journal:
                computes.append(self.describe(compute, journal))
        return ComputeInventory(computes=computes, warning='' if computes else
                                'El Agent Flow no tiene destinos TEST o PROD activos asociados a un compute.')

    def start(self, request: ComputeStart) -> ComputeInventory:
        if request.compute_id not in self.discover():
            raise ComputeConflict('El compute ya no corresponde al Agent Flow. Actualiza su estado.')
        with self.journal(request.compute_id) as journal:
            current = self.describe(request.compute_id, journal)
            if current.name != request.compute_name:
                raise ComputeConflict('El nombre del compute cambió. Revisa y confirma de nuevo.')
            if current.confirmation != request.confirmation:
                raise ComputeConflict('Los destinos del compute cambiaron. Revisa y confirma de nuevo.')
            if not current.can_start:
                raise ComputeConflict('El compute no está detenido o ya tiene un inicio pendiente. Consulta su estado.')
            with self.store.lock:
                if self.store._draft()[1:] != self.draft[1:]:
                    raise ComputeConflict('La conexión cambió. Actualiza la configuración antes de iniciar.')
                record = journal.claim(request.request_id, current.name, self.selection.agent_id)
                self.submit(request.compute_id, journal, record)
            current.operation, current.can_start = 'starting', False
            current.message = 'AIDP aceptó el inicio. Esperando el estado ACTIVE.'
            return ComputeInventory(computes=[current])

    def submit(self, compute: str, journal: ComputeJournal, record: dict[str, Any]) -> None:
        headers = {'opc-retry-token': record['request_id']}
        etag = self.control.headers.get('etag')
        if isinstance(etag, str) and etag and '\r' not in etag and '\n' not in etag:
            headers['if-match'] = etag
        try:
            self.control.request('POST', f'/clusters/{segment(compute)}/actions/start',
                                 operation='iniciar el compute en AIDP', empty=True, json={}, headers=headers)
            if self.control.status != 202:
                raise ControlError('confirmar la aceptación del inicio', self.control.status)
        except Exception as error:
            rejected = error if isinstance(error, ControlError) and error.status in {400, 401, 403, 404, 412} else None
            record['state'] = 'rejected' if rejected else 'uncertain'
            journal.save(record)
            if rejected:
                message = ('AIDP alcanzó un límite de servicio y rechazó el inicio (LimitExceeded).'
                           if rejected.code == 'LimitExceeded' else str(rejected))
                raise ComputeConflict(message) from error
            raise
        record.update(state='accepted', opc_request_id=safe_header(self.control.headers.get('opc-request-id')))
        record['async_operation_key'] = safe_header(self.control.headers.get('aidp-async-operation-key'))
        journal.save(record)
