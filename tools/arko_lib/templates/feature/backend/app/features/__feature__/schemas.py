from pydantic import BaseModel, ConfigDict, Field


class CreateItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)


class Item(CreateItem):
    id: str
