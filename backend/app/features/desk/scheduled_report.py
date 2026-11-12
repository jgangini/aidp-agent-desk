"""Validate the common report capability before persisting an accepted execution."""

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, model_validator

TextId = str


class ReportModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def absent_not_null(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(entry is None for entry in value.values()):
            raise ValueError("Optional report fields must be absent rather than null")
        if isinstance(value, dict) and any(isinstance(entry, str) and not entry.strip() for entry in value.values()):
            raise ValueError("Report text must contain non-whitespace characters")
        return value


class SectionDefinition(ReportModel):
    section_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=500)
    visibility: Literal["always", "when_present"]


class ReportTemplate(ReportModel):
    template_id: str = Field(min_length=1, max_length=128)
    version: int = Field(ge=1, le=9007199254740991, strict=True)
    sections: list[SectionDefinition] = Field(min_length=1, max_length=40)


class ReportSection(ReportModel):
    section_id: str = Field(min_length=1, max_length=128)
    markdown: str = Field(min_length=1, max_length=100000)
    evidence_ids: list[str] = Field(max_length=800)


class ReportPeriod(ReportModel):
    start: str = Field(max_length=64, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
    end: str = Field(max_length=64, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
    time_zone: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z][A-Za-z0-9._+/-]*$")
    bounds: Literal["[start,end)", "[start,end]"] = "[start,end)"

    @model_validator(mode="after")
    def ordered(self) -> "ReportPeriod":
        if datetime.fromisoformat(self.start.replace("Z", "+00:00")) >= datetime.fromisoformat(
            self.end.replace("Z", "+00:00")
        ):
            raise ValueError("Invalid report interval")
        ZoneInfo(self.time_zone)
        return self


class Report(ReportModel):
    schema_version: Literal["1.0"]
    report_id: str = Field(min_length=1, max_length=128)
    task_id: str = Field(min_length=1, max_length=128)
    task_run_id: str = Field(min_length=1, max_length=128)
    source_request_id: str | None = Field(default=None, min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=500)
    template: ReportTemplate
    sections: list[ReportSection] = Field(max_length=40)
    limitations: list[str] = Field(max_length=40)
    period: ReportPeriod | None = None
    extensions: dict[str, dict[str, Any]] | None = None


def validate_response(response: dict[str, Any], task_id: str, run_id: str,
                      template: dict[str, Any] | None) -> dict[str, Any]:
    if response.get("status") not in ("complete", "completed", "partial"):
        raise ValueError("El agente no entregó un informe terminado.")
    if not isinstance(response.get("markdown"), str) or not response["markdown"].strip():
        raise ValueError("El informe requiere una respuesta Markdown.")
    report = Report.model_validate(response.get("report"))
    if report.task_id != task_id or report.task_run_id != run_id:
        raise ValueError("El informe no corresponde a esta ejecución.")
    if template is not None and report.template.model_dump() != template:
        raise ValueError("El agente cambió la plantilla de esta versión.")
    validate_sections(report)
    validate_section_evidence(report, response_evidence(response))
    validate_limits(report)
    return response


def validate_sections(report: Report) -> None:
    declared = [section.section_id for section in report.template.sections]
    actual = [section.section_id for section in report.sections]
    if len(set(declared)) != len(declared) or len(set(actual)) != len(actual):
        raise ValueError("Secciones repetidas.")
    if actual != [section for section in declared if section in actual] or any(
        section.visibility == "always" and section.section_id not in actual for section in report.template.sections
    ):
        raise ValueError("Secciones incompatibles con la plantilla.")


def response_evidence(response: dict[str, Any]) -> set[str]:
    refs = response.get("references")
    if not isinstance(refs, list) or len(refs) > 800 or any(not isinstance(ref, dict) for ref in refs):
        raise ValueError("Referencias no válidas.")
    evidence = [ref.get("evidence_id") for ref in refs]
    if any(not isinstance(value, str) for value in evidence) or len(set(evidence)) != len(evidence):
        raise ValueError("Identidad de evidencia no válida.")
    return set(evidence)


def validate_section_evidence(report: Report, evidence: set[str]) -> None:
    for section in report.sections:
        if len(set(section.evidence_ids)) != len(section.evidence_ids) or any(
            not value.strip() or len(value) > 128 or value not in evidence for value in section.evidence_ids
        ):
            raise ValueError("Evidencia de sección desconocida.")


def validate_limits(report: Report) -> None:
    if any(not value.strip() or len(value) > 2000 for value in report.limitations):
        raise ValueError("Limitaciones no válidas.")
    if report.extensions and (len(report.extensions) > 20 or any(
        not key.strip() or len(key) > 128 for key in report.extensions
    )):
        raise ValueError("Extensiones no válidas.")
