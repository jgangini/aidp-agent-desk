"""Public scheduled task definitions; browser identifiers never select an owner."""

from datetime import date, datetime, time
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .schemas import DeliveryTemplate


class ScheduledTask(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    instructions: str = Field(min_length=1, max_length=500)
    agentId: str = Field(min_length=1, max_length=256)
    agentName: str = Field(min_length=1, max_length=256)
    notify: bool = False
    repeat: Literal["once", "hourly", "daily", "weekdays", "weekly", "monthly", "custom"] = "once"
    startDate: str
    time: str
    timeZone: str = Field(min_length=1, max_length=100)
    days: list[int] = Field(default_factory=list, max_length=7)
    monthDay: int = Field(default=1, ge=1, le=31)
    interval: int = Field(default=1, ge=1, le=365)
    unit: Literal["minutes", "hours", "days", "weeks", "months"] = "days"
    endDate: str = ""
    status: Literal["active", "paused", "completed"] = "active"
    createdAt: str

    @model_validator(mode="after")
    def calendar(self) -> "ScheduledTask":
        try:
            start = date.fromisoformat(self.startDate)
            if start.isoformat() != self.startDate or len(self.time) != 5:
                raise ValueError
            time.fromisoformat(self.time)
            if self.endDate:
                end = date.fromisoformat(self.endDate)
                if end < start or end.isoformat() != self.endDate:
                    raise ValueError
            ZoneInfo(self.timeZone)
            created = datetime.fromisoformat(self.createdAt.replace("Z", "+00:00"))
            if created.tzinfo is None:
                raise ValueError
        except (ValueError, ZoneInfoNotFoundError) as error:
            raise ValueError("Fecha, hora o zona horaria de la tarea no válida.") from error
        if len(set(self.days)) != len(self.days) or any(day not in range(7) for day in self.days):
            raise ValueError("Días de repetición no válidos.")
        if self.repeat == "weekdays" and not self.days:
            raise ValueError("Selecciona al menos un día.")
        if self.repeat == "weekly" and len(self.days) != 1:
            raise ValueError("Selecciona un único día para la repetición semanal.")
        return self


class ScheduledTaskView(ScheduledTask):
    version: int
    nextRunAt: str | None = None


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")


class PresentationRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_ids: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(min_length=1, max_length=2)


class ReportPresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"]
    rows: list[PresentationRow] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def distinct_sections(self) -> "ReportPresentation":
        ids = [identity for row in self.rows for identity in row.section_ids]
        if len(ids) != len(set(ids)):
            raise ValueError("La distribución tiene secciones repetidas.")
        return self


class TemplateChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template: DeliveryTemplate
    expectedVersion: int = Field(ge=1, strict=True)
    presentation: ReportPresentation | None = None

    @model_validator(mode="after")
    def presentation_sections(self) -> "TemplateChange":
        if self.presentation is not None:
            ids = {identity for row in self.presentation.rows for identity in row.section_ids}
            if ids != {section.section_id for section in self.template.sections}:
                raise ValueError("La distribución debe incluir exactamente las secciones de la plantilla.")
        return self


class TemplateView(BaseModel):
    template: DeliveryTemplate | None
    version: int
    presentation: ReportPresentation | None = None


class RunActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=2000)
    state: Literal["running", "pending", "completed", "failed"]
    source: str | None = Field(default=None, min_length=1, max_length=128)


class ScheduledRun(BaseModel):
    id: str
    taskId: str
    taskVersion: int
    status: Literal["queued", "running", "completed", "partial", "failed", "interrupted"]
    trigger: Literal["initial", "manual", "scheduled"]
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    error: str | None = None
    response: dict[str, Any] | None = None
    recoverable: bool = False
    presentation: ReportPresentation | None = None
    activity: list[RunActivity] = Field(default_factory=list, max_length=200)


class ReportCapability(BaseModel):
    agentId: str
    reportSchemaVersion: Literal["1.0"] = "1.0"


class ScheduledTasks(BaseModel):
    tasks: list[ScheduledTaskView]
    capabilities: list[ReportCapability]


class ScheduledRuns(BaseModel):
    runs: list[ScheduledRun]
