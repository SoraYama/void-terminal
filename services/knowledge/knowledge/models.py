"""Validated wire models. Field spelling follows the frozen camelCase contract."""
from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ContentType = Literal['quest', 'dialogue', 'book', 'weapon', 'artifact', 'material', 'furniture', 'character', 'voice', 'enemy', 'food', 'achievement', 'tcg', 'other']
Locale = Literal['zh-CN', 'en']
ItemCategory = Literal['weapon', 'artifact', 'material', 'food', 'quest', 'gadget', 'other']
CoverageState = Literal['complete', 'not-applicable', 'upstream-missing', 'unresolved', 'unreachable']

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


class ItemWire(WireModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


Rarity = Annotated[int, Field(ge=1, le=5)]
FiniteValue = Annotated[float, Field(allow_inf_nan=False)]


class ImageEvidence(ItemWire):
    repo: Literal['PathOfGenshin/resources']
    commit: str = Field(pattern=r'^[0-9a-f]{40}$')
    path: str = Field(pattern=r'^resources/gi/Sprite/UI_[A-Za-z0-9_]+\.png$')
    gitBlobSha1: str = Field(pattern=r'^[0-9a-f]{40}$')


class ItemIcon(ItemWire):
    identifier: str
    url: str | None
    provider: str | None
    status: Literal['verified', 'unverified', 'missing', 'unreachable']
    checkedAt: float | None = Field(default=None, ge=0)
    contentType: Literal['image/png', 'image/webp', 'image/jpeg'] | None = None
    width: int | None = Field(default=None, ge=1, le=16384)
    height: int | None = Field(default=None, ge=1, le=16384)
    temporary: bool | None = None
    reason: str | None = Field(default=None, max_length=1000)
    sha256: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$')
    evidence: ImageEvidence | None = None

    @model_validator(mode='after')
    def verify_fallback_identity(self):
        if self.provider == 'pathofgenshin':
            proof = self.evidence
            if (self.status != 'verified' or not proof or not self.sha256
                    or proof.path != f'resources/gi/Sprite/{self.identifier}.png'
                    or self.url != f'https://raw.githubusercontent.com/{proof.repo}/{proof.commit}/{proof.path}'):
                raise ValueError('Fallback image must match its verified immutable evidence')
        elif self.evidence or self.sha256:
            raise ValueError('Unexpected fallback image evidence')
        return self

    @field_validator('url')
    @classmethod
    def safe_url(cls, value):
        if value is not None:
            from urllib.parse import urlsplit
            parsed = urlsplit(value)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Image URLs must be public HTTPS URLs')
        return value


class ItemAttribute(ItemWire):
    label: str
    value: str


class ItemStat(ItemWire):
    key: str = Field(min_length=1)
    label: str
    value: FiniteValue
    unit: Literal['', '%']


class WeaponLevel(ItemWire):
    level: int = Field(ge=1, le=100)
    ascension: int = Field(ge=0, le=10)
    stats: list[ItemStat] = Field(max_length=32)


class Refinement(ItemWire):
    rank: Rarity
    name: str
    description: str


class AscensionMaterial(ItemWire):
    id: str = Field(min_length=1)
    name: str
    count: int = Field(ge=0)


class WeaponAscension(ItemWire):
    phase: int = Field(ge=0, le=10)
    levelCap: int = Field(ge=1, le=100)
    coin: int = Field(ge=0)
    items: list[AscensionMaterial] = Field(max_length=100)


class ItemWeapon(ItemWire):
    type: str = Field(min_length=1, max_length=100)
    levels: list[WeaponLevel] = Field(max_length=1000)
    refinements: list[Refinement] = Field(max_length=20)
    ascensions: list[WeaponAscension] = Field(max_length=20)


class ArtifactEffect(ItemWire):
    pieces: int = Field(ge=1, le=5)
    text: str


class ArtifactLevelValue(ItemWire):
    level: int = Field(ge=0, le=100)
    value: FiniteValue


class ArtifactMainStat(ItemWire):
    key: str = Field(min_length=1)
    label: str
    unit: Literal['', '%']
    values: list[ArtifactLevelValue] = Field(max_length=101)


class ArtifactSubstat(ItemWire):
    key: str = Field(min_length=1)
    label: str
    unit: Literal['', '%']
    values: list[FiniteValue] = Field(max_length=100)


class ArtifactRule(ItemWire):
    rarity: Rarity
    maxLevel: int = Field(ge=0, le=100)
    mainStats: list[ArtifactMainStat] = Field(max_length=32)
    substats: list[ArtifactSubstat] = Field(max_length=32)


class ItemArtifact(ItemWire):
    setId: int = Field(ge=0)
    setName: str
    slot: str = Field(min_length=1)
    setEffects: list[ArtifactEffect] = Field(max_length=10)
    rarities: list[Rarity] = Field(max_length=5)
    rules: list[ArtifactRule] = Field(max_length=5)


class TCGCost(ItemWire):
    type: str = Field(min_length=1, max_length=100)
    count: int = Field(ge=0, le=100)


class TCGSkill(ItemWire):
    id: int = Field(gt=0)
    name: str | None = None
    effect: str | None = None
    costs: list[TCGCost] | None = Field(default=None, max_length=32)
    sources: dict[Literal['id', 'name', 'effect', 'costs'], SourceRecord]


class ItemTCG(ItemWire):
    cardId: int = Field(gt=0)
    face: Literal['standard', 'gold', 'platinum']
    cardType: Literal['GCG_CARD_CHARACTER', 'GCG_CARD_ASSIST', 'GCG_CARD_EVENT', 'GCG_CARD_MODIFY']
    name: str | None = None
    effect: str | None = None
    storyTitle: str | None = None
    story: str | None = None
    acquisition: str | None = None
    costs: list[TCGCost] | None = Field(default=None, max_length=32)
    hp: int | None = Field(default=None, gt=0)
    skills: list[TCGSkill] = Field(default_factory=list, max_length=32)
    sources: dict[Literal['cardId', 'face', 'cardType', 'name', 'effect', 'storyTitle', 'story',
                          'acquisition', 'costs', 'hp', 'skills'], SourceRecord]


class Item(ItemWire):
    id: str = Field(min_length=1, max_length=512)
    language: Locale
    name: str = Field(min_length=1, max_length=2000)
    category: ItemCategory
    subtype: str
    rarity: Rarity | None
    description: str
    story: str
    state: Literal['source-record', 'internal']
    rawIds: list[str] = Field(max_length=1000)
    documentIds: list[str] = Field(max_length=1000)
    sources: list[SourceRecord] = Field(max_length=1000)
    icon: ItemIcon
    attributes: list[ItemAttribute] = Field(max_length=1000)
    acquisition: list[str] = Field(max_length=1000)
    coverage: dict[str, CoverageState] = Field(max_length=100)
    weapon: ItemWeapon | None = None
    artifact: ItemArtifact | None = None
    tcg: ItemTCG | None = None

    @model_validator(mode='after')
    def category_payload(self):
        if self.weapon is not None and self.category != 'weapon' or self.artifact is not None and self.category != 'artifact':
            raise ValueError('Equipment payload disagrees with category')
        return self


class ItemDetailQuery(WireModel):
    language: Locale = 'zh-CN'
    snapshotId: str | None = Field(default=None, min_length=1, max_length=200)


class ItemListQuery(ItemDetailQuery):
    q: str = Field(default='', max_length=2000)
    category: ItemCategory | None = None
    rarity: int | None = Field(default=None, ge=1, le=5)
    weaponType: str | None = Field(default=None, max_length=100)
    includeInternal: bool = False
    sort: Literal['rarity', 'name'] = 'rarity'
    page: int = Field(default=1, ge=1, le=100000)
    pageSize: int = Field(default=48, ge=1, le=100)
