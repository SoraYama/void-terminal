"""Validated wire models. Field spelling follows the frozen camelCase contract."""
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

ContentType = Literal['quest', 'dialogue', 'book', 'weapon', 'artifact', 'material', 'furniture', 'character', 'voice', 'enemy', 'food', 'achievement', 'tcg', 'other']
Locale = Literal['zh-CN', 'en']

class WireModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class SourceRecord(WireModel):
    repo: str = Field(min_length=1)
    commit: str = Field(min_length=1)
    path: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    url: str = Field(min_length=1)

class Relation(WireModel):
    kind: str = Field(min_length=1)
    targetId: str = Field(min_length=1)
    condition: str | None = None

class Document(WireModel):
    id: str = Field(min_length=1, max_length=1000)
    title: str = Field(min_length=1)
    type: ContentType
    language: str = Field(min_length=1)
    text: str = Field(min_length=1)
    source: SourceRecord
    metadata: dict[str, Any] = Field(default_factory=dict)
    relations: list[Relation] = Field(default_factory=list)

    @field_validator('text')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('text is empty')
        return value

class Snapshot(WireModel):
    id: str = Field(min_length=1, max_length=200)
    sourceRepo: str = Field(min_length=1)
    sourceCommit: str = Field(min_length=1)
    gameVersion: str | None = None
    createdAt: str = Field(min_length=1)
    label: str
    state: Literal['ready', 'building', 'failed']

class CoverageRow(WireModel):
    type: str
    discovered: int = Field(ge=0)
    imported: int = Field(ge=0)
    missingText: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    notes: list[str]

class SearchRequest(WireModel):
    query: str = Field(min_length=1, max_length=2000)
    language: Locale
    types: list[ContentType] = Field(default_factory=list, max_length=20)
    snapshotId: str | None = Field(default=None, max_length=200)
    limit: int = Field(default=10, ge=1, le=50)

    @field_validator('query')
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('query is empty')
        return value

class ReserveRequest(WireModel):
    requestId: str = Field(min_length=1, max_length=200)
    identity: str = Field(min_length=1, max_length=200)
    tokens: int = Field(ge=1, le=3000000, strict=True)

class SettleRequest(WireModel):
    reservationId: str = Field(min_length=1, max_length=200)
    usedTokens: int | None = Field(ge=0, le=10000000, strict=True)
