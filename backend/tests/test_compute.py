import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from oci._vendor import requests
from test_identity import hosted as hosted
from test_identity import sign_in
from test_profiles import HEADERS

from app.features.desk import compute, compute_journal
from app.features.desk.compute_api import compute_router
from app.features.desk.compute_journal import ComputeConflict, ComputeJournal
from app.features.desk.compute_schemas import ComputeSelection, ComputeStart
from app.features.desk.schemas import DiscoveryDraft

CONTEXT = {'compartment_id': 'comp', 'instance_id': 'platform', 'workspace_id': 'workspace', 'agent_id': 'flow'}
GA = '/20260430/aiDataPlatforms/platform/workspaces/workspace'
LEGACY = '/20240831/dataLakes/platform/workspaces/workspace'


class Store:
    def __init__(self, root):
        self.root, self.lock = root, Lock()

    def _draft(self):
        return DiscoveryDraft(has_credentials=True, compartment_id='comp'), b'config', b'key', 'revision'

    def draft(self):
        return self._draft()


class Discovery:
    def __init__(self, *_):
        self.values, self.signer = {'region': 'us-chicago-1'}, object()

    def check_compartment(self, identity):
        assert identity == 'comp'

    def instances(self, *_):
        return [SimpleNamespace(id='platform')]

    def workspaces(self, *_):
        return [SimpleNamespace(id='workspace')]


class Response:
    def __init__(self, body=None, status=200, headers=None):
        self.body, self.status_code, self.headers = body, status, headers or {}
        self.content = json.dumps(body).encode() if body is not None else b''

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def json(self):
        return self.body


class Session:
    def __init__(self):
        self.calls, self.posts = [], 0
        self.agents = ['flow', 'shared']
        self.state, self.name = 'STOPPED', 'Research compute'
        self.fail_get, self.fail_post = False, False
        self.post_error = None
        self.wrong_binding = False
        self.incomplete_summary = False
        self.detail_state, self.detail_kind = 'ACTIVE', 'PROD'
        self.started, self.release = Event(), Event()
        self.hold = False

    def close(self):
        pass

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        assert kwargs['allow_redirects'] is False and kwargs['timeout'] == (5, 20)
        assert url.startswith('https://datalake.us-chicago-1.oci.oraclecloud.com/')
        path = urlsplit(url).path
        if method == 'POST':
            return self.post(path, kwargs)
        return self.get(path, kwargs)

    def post(self, path, kwargs):
        assert path == GA + '/clusters/compute/actions/start' and kwargs['json'] == {}
        assert kwargs['headers']['if-match'] == '"revision-1"'
        assert len(kwargs['headers']['opc-retry-token']) == 32
        self.posts += 1
        self.started.set()
        if self.hold:
            assert self.release.wait(10)
        if self.fail_post:
            raise requests.Timeout('secret response body')
        if self.post_error:
            status, code = self.post_error
            return Response({'code': code, 'message': 'secret response body'}, status)
        return Response(status=202, headers={'opc-request-id': 'receipt-1'})

    def get(self, path, kwargs):
        if self.fail_get:
            return Response({'code': 'NotAuthorizedOrNotFound', 'message': 'secret response body'}, 404,
                            {'opc-request-id': 'safe-request-id'})
        if path == GA + '/agents':
            return Response({'items': [{'key': key, 'displayName': key, 'type': 'CODE'} for key in self.agents]})
        if path == GA + '/clusters/compute':
            return Response({'key': 'compute', 'displayName': self.name, 'state': self.state},
                            headers={'etag': '"revision-1"'})
        if path.endswith('/deployments'):
            agent = path.split('/')[-2]
            return Response({'items': [{'key': 'prod', 'deploymentType': 'PROD', 'lifecycleState': 'ACTIVE',
                                        'agentKey': '' if self.incomplete_summary else
                                        ('wrong' if self.wrong_binding else agent),
                                        'agentComputeKey': 'compute'}]})
        if path.endswith('/deployments/prod'):
            return Response({'key': 'prod', 'deploymentType': self.detail_kind, 'lifecycleState': self.detail_state,
                             'agentKey': path.split('/')[-3], 'agentComputeKey': 'compute'})
        if path == LEGACY + '/agentFlowDeployments':
            return Response({'items': [{'key': 'test', 'deploymentType': 'TEST', 'lifecycleState': 'ACTIVE',
                                        'agentFlowKey': kwargs['params']['agentFlowKey'],
                                        'agentFlowComputeKey': 'compute'}]})
        if '/agents/' in path:
            return Response({'key': path.rsplit('/', 1)[-1], 'type': 'CODE', 'computeKey': 'compute'})
        raise AssertionError(path)


@pytest.fixture
def environment(tmp_path, monkeypatch):
    store, session = Store(tmp_path), Session()
    monkeypatch.setattr(compute, 'Discovery', Discovery)
    monkeypatch.setattr(compute.requests, 'Session', lambda: session)
    app = FastAPI()
    app.include_router(compute_router(store), prefix='/api/desk')
    with TestClient(app) as client:
        yield client, store, session


def status(client, **changes):
    return client.post('/api/desk/discovery/compute/status', headers=HEADERS, json={**CONTEXT, **changes})


def start_body(client, **changes):
    value = status(client).json()['computes'][0]
    return {**CONTEXT, 'compute_id': value['id'], 'compute_name': value['name'],
            'request_id': 'a' * 32, 'confirmation': value['confirmation'], 'confirmed': True, **changes}


def start(client, body):
    return client.post('/api/desk/discovery/compute/start', headers=HEADERS, json=body)


def test_status_reports_actual_state_and_shared_destinations_without_start(environment):
    client, _, session = environment
    response = status(client)
    value = response.json()['computes'][0]
    assert value['state'] == 'STOPPED' and value['can_start'] and value['operation'] == 'idle'
    assert {(target['agent_id'], target['surface']) for target in value['targets']} == {
        ('flow', 'PROD'), ('flow', 'TEST'), ('shared', 'PROD'), ('shared', 'TEST')}
    assert response.headers['cache-control'] == 'no-store' and session.posts == 0
    assert not session.trust_env


@pytest.mark.parametrize('state', ['ACTIVE', 'STARTING', 'STOPPING', 'FAILED', 'UNKNOWN'])
def test_only_stopped_is_startable(environment, state):
    client, _, session = environment
    session.state = state
    assert not status(client).json()['computes'][0]['can_start']
    assert session.posts == 0


def test_one_confirmed_start_survives_reload_and_waits_for_real_active(environment):
    client, store, session = environment
    body = start_body(client)
    response = start(client, body)
    assert response.status_code == 200 and response.json()['computes'][0]['operation'] == 'starting'
    assert start(client, body).status_code == 409
    with compute.ComputeService(Store(store.root), ComputeSelection(**CONTEXT)) as service:
        assert not service.status().computes[0].can_start
    session.state = 'STARTING'
    assert status(client).json()['computes'][0]['operation'] == 'starting'
    session.state = 'ACTIVE'
    assert status(client).json()['computes'][0]['operation'] == 'idle'
    session.state = 'STOPPED'
    assert start(client, body).status_code == 409  # old confirmation ID cannot be reused after another stop
    assert start(client, start_body(client, request_id='b' * 32)).status_code == 200
    assert session.posts == 2


@pytest.mark.parametrize('status_code,code', [(400, 'LimitExceeded'), (404, 'NotAuthorizedOrNotFound')])
def test_explicit_start_rejection_allows_fresh_confirmation(environment, status_code, code):
    client, _, session = environment
    body = start_body(client)
    session.post_error = (status_code, code)
    failure = start(client, body)
    assert failure.status_code == 409 and code in failure.text and 'secret' not in failure.text
    if code == 'LimitExceeded':
        assert 'límite de servicio' in failure.json()['detail']
    current = status(client).json()['computes'][0]
    assert current['state'] == 'STOPPED' and current['operation'] == 'idle' and current['can_start']
    assert start(client, body).status_code == 409 and session.posts == 1
    session.post_error = None
    assert start(client, start_body(client, request_id='b' * 32)).status_code == 200
    assert session.posts == 2


def test_uncertain_start_never_retries_on_stopped_and_reconciles_by_reading(environment):
    client, _, session = environment
    body = start_body(client)
    session.fail_post = True
    response = start(client, body)
    assert response.status_code == 502 and 'secret' not in response.text
    current = status(client).json()['computes'][0]
    assert current['state'] == 'STOPPED' and current['operation'] == 'uncertain' and not current['can_start']
    assert start(client, {**body, 'request_id': 'b' * 32}).status_code == 409
    session.state = 'ACTIVE'
    assert status(client).json()['computes'][0]['operation'] == 'idle'
    assert session.posts == 1


@pytest.mark.parametrize('field,value', [('confirmed', False), ('confirmed', 'true'), ('confirmed', 1),
                                         ('request_id', '../x'), ('endpoint', 'https://evil.example')])
def test_invalid_confirmation_rejected_before_any_start(environment, field, value):
    client, _, session = environment
    assert start(client, start_body(client, **{field: value})).status_code == 422
    assert session.posts == 0


def test_confirmation_revision_is_required(environment):
    client, _, session = environment
    body = start_body(client)
    del body['confirmation']
    assert start(client, body).status_code == 422 and session.posts == 0


@pytest.mark.parametrize('field,value', [('compartment_id', 'other'), ('instance_id', 'other'),
                                         ('workspace_id', 'other'), ('agent_id', 'other')])
def test_context_mismatch_does_not_start(environment, field, value):
    client, _, session = environment
    assert status(client, **{field: value}).status_code == 422
    assert session.posts == 0


def test_forged_cluster_rename_and_changed_sharing_rejected(environment):
    client, _, session = environment
    body = start_body(client)
    assert start(client, {**body, 'compute_id': 'other'}).status_code == 409
    session.name = 'Renamed'
    assert start(client, body).status_code == 409
    session.name = body['compute_name']
    session.agents.append('new-shared-target')
    assert start(client, body).status_code == 409
    assert session.posts == 0


def test_unavailable_status_is_not_stopped_and_safe_diagnostics_are_logged(environment, caplog):
    client, _, session = environment
    session.fail_get = True
    result = status(client)
    assert result.status_code == 502 and '404' in result.text and 'NotAuthorizedOrNotFound' in result.text
    assert 'secret response body' not in result.text + caplog.text
    assert 'safe-request-id' in caplog.text and 'method=GET' in caplog.text and 'path=/agents' in caplog.text
    assert session.posts == 0


def test_foreign_deployment_is_not_accepted_as_a_compute_binding(environment):
    client, _, session = environment
    session.wrong_binding = True
    assert status(client).status_code == 502 and session.posts == 0


@pytest.mark.parametrize('changes', [{'detail_state': 'INACTIVE'}, {'detail_kind': 'TEST'}])
def test_deployment_detail_must_still_be_active_prod(environment, changes):
    client, _, session = environment
    session.incomplete_summary = True
    for name, value in changes.items():
        setattr(session, name, value)
    assert status(client).status_code == 502 and session.posts == 0


def test_concurrent_shared_agents_claim_same_compute_once(environment):
    client, store, session = environment
    first = ComputeStart(**start_body(client))
    second = ComputeStart(**{**first.model_dump(), 'agent_id': 'shared', 'request_id': 'b' * 32})
    with compute.ComputeService(store, ComputeSelection(**{**CONTEXT, 'agent_id': 'shared'})) as service:
        second.confirmation = service.status().computes[0].confirmation
    session.hold = True

    def submit(value):
        with compute.ComputeService(store, value) as service:
            return service.start(value)

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(submit, first)
        assert session.started.wait(5)
        try:
            with pytest.raises(ComputeConflict):
                submit(second)
        finally:
            session.release.set()
        assert pending.result().computes[0].operation == 'starting'
    assert session.posts == 1


def test_corrupt_journal_fails_closed_without_start(environment):
    client, store, session = environment
    journal = ComputeJournal(store.root, ('us-chicago-1', 'platform', 'workspace', 'compute'))
    (journal.path / 'current.json').write_text(json.dumps({'request_id': '../unsafe'}))
    assert status(client).status_code == 409 and session.posts == 0


def test_claim_renames_are_synced_before_post(environment, monkeypatch):
    client, _, session = environment
    body = start_body(client)
    events = []
    original_request, original_replace = session.request, compute_journal.Path.replace
    original_fsync = compute_journal.os.fsync
    monkeypatch.setattr(compute_journal, 'sync_directory', lambda path: events.append(('dir-sync', path)))

    def replace(path, target):
        events.append(('replace', target))
        return original_replace(path, target)

    def request(method, url, **kwargs):
        if method == 'POST':
            events.append(('post', None))
        return original_request(method, url, **kwargs)

    def fsync(descriptor):
        events.append(('file-sync', None))
        return original_fsync(descriptor)

    monkeypatch.setattr(compute_journal.Path, 'replace', replace)
    monkeypatch.setattr(session, 'request', request)
    monkeypatch.setattr(compute_journal.os, 'fsync', fsync)
    assert start(client, body).status_code == 200
    post = next(index for index, (kind, _) in enumerate(events) if kind == 'post')
    pointer = next(index for index, (kind, path) in enumerate(events)
                   if kind == 'replace' and path.name == 'current.json')
    assert pointer < post and events[pointer + 1][0] == 'dir-sync'
    assert any(kind == 'replace' and path.name == 'a' * 32 + '.json' for kind, path in events[:pointer])
    assert any(kind == 'file-sync' for kind, _ in events[:pointer])


@pytest.mark.parametrize('route', ['status', 'start'])
def test_compute_routes_require_admin_origin_and_identity(hosted, monkeypatch, route):
    app, client = hosted
    monkeypatch.setattr(compute, 'Discovery', lambda *_: pytest.fail('Unauthorized OCI access'))
    url = '/api/desk/discovery/compute/' + route
    assert client.post(url, json=CONTEXT).status_code == 401
    app.state.identity.store.save_user('member', 'member@example.com', True, [])
    sign_in(app, client, 'member')
    headers = {'Origin': 'https://desk.example', 'X-Agent-Desk': 'configure'}
    assert client.post(url, json=CONTEXT, headers=headers).status_code == 403
    sign_in(app, client)
    assert client.post(url, json=CONTEXT, headers={**headers, 'Origin': 'https://evil.example'}).status_code == 403
