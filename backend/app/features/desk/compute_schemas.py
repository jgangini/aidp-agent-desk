from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

ComputeOperation = Literal['idle', 'starting', 'uncertain']

class ComputeSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    compartment_id: str = Field(min_length=1, max_length=256, pattern=r"^[a-zA-Z0-9_.-]+$")
    instance_id: str = Field(min_length=1, max_length=256, pattern=r"^[a-zA-Z0-9_.-]+$")
    workspace_id: str = Field(min_length=1, max_length=256, pattern=r"^[a-zA-Z0-9_.-]+$")
    agent_id: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_.-]+$")


class ComputeStart(ComputeSelection):
    compute_id: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_.-]+$")
    compute_name: str = Field(min_length=1, max_length=1000)
    request_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    confirmation: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirmed: StrictBool

    @model_validator(mode="after")
    def require_confirmation(self) -> "ComputeStart":
        if not self.confirmed:
            raise ValueError("Confirma el inicio y su posible coste OCI.")
        return self


class ComputeTarget(BaseModel):
    agent_id: str
    name: str
    surface: Literal["PROD", "TEST"]


class ComputeStatus(BaseModel):
    id: str
    name: str
    state: str
    targets: list[ComputeTarget]
    can_start: bool = False
    operation: ComputeOperation = "idle"
    message: str = ""
    confirmation: str = ""


class ComputeInventory(BaseModel):
    computes: list[ComputeStatus]
    warning: str = ""
