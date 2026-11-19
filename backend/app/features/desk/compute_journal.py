"""A durable per-compute claim survives concurrent requests and lost replies."""

import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .compute_schemas import ComputeOperation
from .scheduled_lock import SchedulerLock


class ComputeConflict(ValueError):
    pass


def sync_directory(path: Path) -> None:
    if sys.platform == 'win32':
        return
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix('.tmp')
    if path.is_symlink() or temporary.is_symlink():
        raise ComputeConflict("El registro de inicio requiere revisión del operador.")
    with temporary.open('w', encoding='utf-8') as stream:
        temporary.chmod(0o600)
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


class ComputeJournal:
    def __init__(self, root: Path, resource: tuple[str, str, str, str]) -> None:
        parent = root / 'compute-starts'
        self.path = parent / hashlib.sha256('\0'.join(resource).encode()).hexdigest()
        if parent.is_symlink() or self.path.is_symlink():
            raise ComputeConflict("El registro de inicio requiere revisión del operador.")
        parent.mkdir(exist_ok=True, mode=0o700)
        sync_directory(root)
        self.path.mkdir(exist_ok=True, mode=0o700)
        sync_directory(parent)
        self.lock = SchedulerLock(self.path / 'claim.lock')

    def __enter__(self) -> "ComputeJournal":
        if (self.path / 'claim.lock').is_symlink():
            raise ComputeConflict("El registro de inicio requiere revisión del operador.")
        try:
            self.lock.acquire()
        except RuntimeError:
            raise ComputeConflict("Ya hay una comprobación o inicio en curso. Consulta su estado.") from None
        return self

    def __exit__(self, *_: Any) -> None:
        self.lock.release()

    def read(self) -> dict[str, Any] | None:
        pointer = self.path / 'current.json'
        if not pointer.exists():
            return None
        identity = self._read(pointer).get('request_id')
        if not isinstance(identity, str) or len(identity) != 32 or any(c not in '0123456789abcdef' for c in identity):
            raise ComputeConflict("El registro de inicio requiere revisión del operador.")
        value = self._read(self.path / f'{identity}.json')
        if (value.get('request_id') != identity
                or value.get('state') not in {'submitting', 'accepted', 'uncertain', 'completed', 'rejected'}):
            raise ComputeConflict("El registro de inicio requiere revisión del operador.")
        return value

    @staticmethod
    def _read(path: Path) -> dict[str, Any]:
        if path.is_symlink() or path.stat().st_size > 16384:
            raise ComputeConflict("El registro de inicio requiere revisión del operador.")
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, dict):
            raise ComputeConflict("El registro de inicio requiere revisión del operador.")
        return value

    def claim(self, identity: str, name: str, agent: str) -> dict[str, Any]:
        destination = self.path / f'{identity}.json'
        if destination.exists():
            raise ComputeConflict("Esta confirmación ya fue utilizada. Consulta el estado del compute.")
        previous = self.read()
        if previous and previous['state'] not in {'completed', 'rejected'}:
            raise ComputeConflict("El inicio anterior sigue pendiente. Consulta su estado antes de continuar.")
        record = {'request_id': identity, 'name': name, 'agent': agent, 'state': 'submitting',
                  'created_at': datetime.now(UTC).isoformat()}
        self.save(record)
        atomic_json(self.path / 'current.json', {'request_id': identity})
        return record

    def save(self, record: dict[str, Any]) -> None:
        atomic_json(self.path / f"{record['request_id']}.json", record)

    def reconcile(self, state: str) -> ComputeOperation:
        record = self.read()
        if not record or record['state'] in {'completed', 'rejected'}:
            return 'idle'
        if state in {'ACTIVE', 'FAILED', 'DELETED'}:
            record['state'] = 'completed'
            self.save(record)
            return 'idle'
        if state == 'STARTING' and record['state'] != 'accepted':
            record['state'] = 'accepted'
            self.save(record)
        return 'starting' if record['state'] == 'accepted' else 'uncertain'
