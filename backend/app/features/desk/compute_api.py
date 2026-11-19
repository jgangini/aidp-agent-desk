import logging

import oci  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from oci._vendor import requests  # type: ignore[import-untyped]

from app.core.local_config import local_configuration

from .aidp_control import ControlError
from .compute import ComputeService
from .compute_journal import ComputeConflict
from .compute_schemas import ComputeInventory, ComputeSelection, ComputeStart
from .credentials import ProfileStore
from .discovery import DiscoveryQueryError

LOGGER = logging.getLogger(__name__)


def compute_admin(request: Request) -> None:
    local_configuration(request)
    principal = getattr(request.state, 'principal', None)
    if (getattr(request.app.state, 'identity', None) is not None
            and (not isinstance(principal, dict) or principal.get('role') != 'admin')):
        raise HTTPException(403, 'Se requiere permiso de administrador.')


def compute_router(store: ProfileStore) -> APIRouter:
    router = APIRouter(prefix='/discovery/compute', dependencies=[Depends(compute_admin)])

    def execute(value: ComputeSelection, response: Response, start: bool = False) -> ComputeInventory:
        response.headers['Cache-Control'] = 'no-store'
        try:
            with ComputeService(store, value) as service:
                return service.start(value) if isinstance(value, ComputeStart) and start else service.status()
        except ComputeConflict as error:
            raise HTTPException(409, str(error)) from error
        except (ControlError, DiscoveryQueryError) as error:
            raise HTTPException(502, str(error)) from error
        except (oci.exceptions.ServiceError, oci.exceptions.RequestException) as error:
            raise HTTPException(502, str(DiscoveryQueryError('consultar el compute en AIDP', error))) from error
        except requests.RequestException as error:
            LOGGER.warning('AIDP compute transport failure exception=%s', type(error).__name__)
            raise HTTPException(502, 'No se pudo consultar AIDP. El resultado del inicio puede ser incierto.') from None
        except OSError as error:
            LOGGER.warning('AIDP compute journal failure exception=%s', type(error).__name__)
            raise HTTPException(503, 'No se pudo comprobar el registro del inicio. No repitas la solicitud.') from None
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @router.post('/status', response_model=ComputeInventory, operation_id='desk_compute_status')
    def status(value: ComputeSelection, response: Response) -> ComputeInventory:
        return execute(value, response)

    @router.post('/start', response_model=ComputeInventory, operation_id='desk_compute_start')
    def start(value: ComputeStart, response: Response) -> ComputeInventory:
        return execute(value, response, True)

    return router
