import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class QuerySuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=80)
    query: str = Field(min_length=1, max_length=500)


class QuerySuggestions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[QuerySuggestion] = Field(max_length=30)


class ClearDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: Literal["agents", "audio"]


class DeliverySection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=500)
    visibility: Literal["always", "when_present"]

    @model_validator(mode="after")
    def nonblank(self) -> "DeliverySection":
        if not self.section_id.strip() or not self.title.strip():
            raise ValueError("La sección necesita identidad y título.")
        return self


class DeliveryTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_id: str = Field(min_length=1, max_length=128)
    version: int = Field(ge=1, le=9007199254740991, strict=True)
    sections: list[DeliverySection] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def distinct(self) -> "DeliveryTemplate":
        if not self.template_id.strip():
            raise ValueError("La plantilla necesita una identidad.")
        if len({section.section_id for section in self.sections}) != len(self.sections):
            raise ValueError("La plantilla tiene secciones repetidas.")
        return self


class ReportDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    mode: Literal["report"]
    task_id: str = Field(min_length=1, max_length=128)
    task_run_id: str = Field(min_length=1, max_length=128)
    template: DeliveryTemplate | None = None

    @model_validator(mode="after")
    def bounded(self) -> "ReportDelivery":
        if len(json.dumps(self.model_dump(exclude_none=True), ensure_ascii=False).encode()) > 64000:
            raise ValueError("La plantilla supera el límite de entrada del agente.")
        return self


class InvokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")
    question: str = Field(min_length=1, max_length=500)
    profile_id: str = Field(default="", pattern=r"^(?:[a-f0-9]{32})?$")
    session_id: str = Field(default="", max_length=128, pattern=r"^[a-zA-Z0-9_-]*$")
    action: Literal["research", "replay", "cancel"] = "research"
    surface: Literal["PROD", "TEST"] = "PROD"
    after_sequence: int = Field(default=0, ge=0, le=1000000)
    delivery: ReportDelivery | None = None


class ConnectionStatus(BaseModel):
    mode: str = "simulation"
    ready: bool = False
    publication_configured: bool
    message: str


class AgentProfile(BaseModel):
    id: str
    name: str
    endpoint_host: str
    flow_id: str
    region: str
    profile: str
    ready: bool = False
    compartment_id: str = ""
    instance_id: str = ""
    workspace_id: str = ""
    transcription_model: str = ""
    speech_model: str = ""
    surface: Literal["PROD", "TEST"] = "PROD"


class DiscoveryProfile(BaseModel):
    name: str
    region: str


class DiscoveryProfiles(BaseModel):
    profiles: list[DiscoveryProfile]


class DiscoveryItem(BaseModel):
    id: str
    name: str


class DiscoveryAgent(DiscoveryItem):
    description: str = ""
    available: bool = False


class DiscoveryOptions(BaseModel):
    compartments: list[DiscoveryItem] = Field(default_factory=list)
    transcription_models: list[DiscoveryItem] = Field(default_factory=list)
    speech_models: list[DiscoveryItem] = Field(default_factory=list)
    instances: list[DiscoveryItem] = Field(default_factory=list)
    workspaces: list[DiscoveryItem] = Field(default_factory=list)
    agents: list[DiscoveryAgent] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DiscoveryDraft(BaseModel):
    connection_managed: bool = False
    profile: str = ""
    region: str = ""
    compartment_id: str = ""
    instance_id: str = ""
    workspace_id: str = ""
    agent_ids: list[str] = Field(default_factory=list)
    transcription_model: str = ""
    speech_model: str = ""
    has_credentials: bool = False
    profiles: list[AgentProfile] = Field(default_factory=list)
