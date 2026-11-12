"""Task APIs authorize both the task owner and the selected agent on every read."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.core.local_config import local_configuration

from .scheduled_runtime import ScheduledRuntime
from .scheduled_schemas import (
    ReportCapability,
    RunRequest,
    ScheduledRun,
    ScheduledRuns,
    ScheduledTask,
    ScheduledTasks,
    ScheduledTaskView,
    TemplateChange,
    TemplateView,
)


def owner(request: Request) -> str:
    user = getattr(request.state, "principal", None)
    if getattr(request.app.state, "identity", None) is not None:
        if user is None:
            raise HTTPException(401, "Inicia sesión con Oracle.")
        return str(user["id"])
    return "local"


def scheduled_router(runtime: ScheduledRuntime) -> APIRouter:
    def no_store(response: Response) -> None:
        response.headers["Cache-Control"] = "no-store"

    router = APIRouter(prefix="/scheduled-tasks", tags=["scheduled-tasks"], dependencies=[Depends(no_store)])

    def task_for(request: Request, task_id: str) -> tuple[str, ScheduledTaskView]:
        user = owner(request)
        try:
            task = runtime.store.get(user, task_id)
        except KeyError as error:
            raise HTTPException(404, "Tarea no encontrada.") from error
        if not runtime.permitted(user, task.agentId):
            raise HTTPException(403, "No tienes permiso para usar este agente.")
        return user, task

    @router.get("", response_model=ScheduledTasks, operation_id="desk_scheduled_tasks")
    def tasks(request: Request) -> ScheduledTasks:
        user = owner(request)
        candidates = runtime.candidates()
        return ScheduledTasks(tasks=[task for task in runtime.store.tasks(user)
                                     if runtime.permitted(user, task.agentId)],
                              capabilities=[ReportCapability(agentId=profile) for profile in candidates
                                            if runtime.permitted(user, profile)])

    @router.put("/{task_id}", response_model=ScheduledTaskView, operation_id="desk_scheduled_task_save",
                dependencies=[Depends(local_configuration)])
    def save(task_id: str, value: ScheduledTask, request: Request) -> ScheduledTaskView:
        user = owner(request)
        if task_id != value.id:
            raise HTTPException(422, "La identidad de la tarea no coincide.")
        if not runtime.permitted(user, value.agentId):
            raise HTTPException(403, "El agente no está autorizado o no admite informes programados.")
        if value.notify:
            raise HTTPException(422, "Las notificaciones externas todavía no están disponibles.")
        return runtime.store.save(user, value)

    @router.post("/{task_id}/run", response_model=ScheduledRun, status_code=202,
                 operation_id="desk_scheduled_task_run", dependencies=[Depends(local_configuration)])
    def run(task_id: str, value: RunRequest, request: Request) -> ScheduledRun:
        user, _ = task_for(request, task_id)
        try:
            return runtime.store.manual(user, task_id, value.idempotencyKey)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @router.put("/{task_id}/template", response_model=ScheduledTaskView,
                operation_id="desk_scheduled_task_template", dependencies=[Depends(local_configuration)])
    def template(task_id: str, value: TemplateChange, request: Request) -> ScheduledTaskView:
        user, _ = task_for(request, task_id)
        try:
            return runtime.store.change_template(user, task_id, value.template.model_dump(), value.expectedVersion,
                                                 value.presentation.model_dump() if value.presentation else None)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @router.get("/{task_id}/template", response_model=TemplateView, operation_id="desk_scheduled_task_template_get")
    def current_template(task_id: str, request: Request, version: int | None = Query(default=None, ge=1)) -> TemplateView:
        user, _ = task_for(request, task_id)
        try:
            selected, layout = runtime.store.template(user, task_id, version)
            historical = runtime.store.definitions(user, task_id)[selected]
            if not runtime.permitted(user, historical.agentId):
                raise HTTPException(403, "No tienes permiso para consultar este formato.")
            return TemplateView.model_validate({"version": selected, "template": layout,
                                                "presentation": runtime.store.presentation(user, task_id, selected)})
        except KeyError as error:
            raise HTTPException(404, "Versión de plantilla no encontrada.") from error

    @router.get("/{task_id}/runs", response_model=ScheduledRuns, operation_id="desk_scheduled_task_runs")
    def runs(task_id: str, request: Request) -> ScheduledRuns:
        user, _ = task_for(request, task_id)
        definitions = runtime.store.definitions(user, task_id)
        permitted = {version for version, definition in definitions.items()
                     if runtime.permitted(user, definition.agentId)}
        return ScheduledRuns(runs=[run for run in runtime.store.runs(user, task_id)
                                   if run.taskVersion in permitted])

    @router.get("/{task_id}/runs/{run_id}", response_model=ScheduledRun,
                operation_id="desk_scheduled_task_run_detail")
    def detail(task_id: str, run_id: str, request: Request) -> ScheduledRun:
        user, _ = task_for(request, task_id)
        try:
            result = runtime.store.run(user, task_id, run_id)
            # The historical definition can select another agent than the current task.
            old = runtime.store.definitions(user, task_id)[result.taskVersion]
            if not runtime.permitted(user, old.agentId):
                raise HTTPException(403, "No tienes permiso para consultar este informe.")
            return result
        except KeyError as error:
            raise HTTPException(404, "Ejecución no encontrada.") from error

    @router.post("/{task_id}/runs/{run_id}/recover", response_model=ScheduledRun, status_code=202,
                 operation_id="desk_scheduled_task_run_recover", dependencies=[Depends(local_configuration)])
    def recover(task_id: str, run_id: str, request: Request) -> ScheduledRun:
        user = owner(request)
        try:
            result = runtime.store.run(user, task_id, run_id)
            historical = runtime.store.definitions(user, task_id)[result.taskVersion]
            if not runtime.permitted(user, historical.agentId):
                raise HTTPException(403, "No tienes permiso para recuperar esta ejecución.")
            return runtime.store.recover_run(user, task_id, run_id)
        except KeyError as error:
            raise HTTPException(404, "Ejecución no encontrada.") from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    def report_visibility(task_id: str, run_id: str, request: Request, hidden: bool) -> None:
        user, _ = task_for(request, task_id)
        try:
            version = runtime.store.run_version(user, task_id, run_id)
            historical = runtime.store.definitions(user, task_id)[version]
            if not runtime.permitted(user, historical.agentId):
                raise HTTPException(403, "No tienes permiso para modificar este informe.")
            runtime.store.set_report_hidden(user, task_id, run_id, hidden)
        except KeyError as error:
            raise HTTPException(404, "Informe no encontrado.") from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @router.delete("/{task_id}/runs/{run_id}/report", status_code=204,
                   operation_id="desk_scheduled_report_delete", dependencies=[Depends(local_configuration)])
    def delete_report(task_id: str, run_id: str, request: Request) -> None:
        report_visibility(task_id, run_id, request, True)

    @router.post("/{task_id}/runs/{run_id}/report/restore", status_code=204,
                 operation_id="desk_scheduled_report_restore", dependencies=[Depends(local_configuration)])
    def restore_report(task_id: str, run_id: str, request: Request) -> None:
        report_visibility(task_id, run_id, request, False)

    @router.delete("/{task_id}", status_code=204, operation_id="desk_scheduled_task_delete",
                   dependencies=[Depends(local_configuration)])
    def delete(task_id: str, request: Request) -> None:
        user, _ = task_for(request, task_id)
        try:
            runtime.store.delete(user, task_id)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    return router
