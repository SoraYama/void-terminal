"""Strict immutable character wire records and bounded HTTP queries."""
from typing import Annotated, Any, Literal
from pydantic import Field, model_validator
from .models import ItemWire, WireModel, Locale, SourceRecord, CoverageState

Number = Annotated[float, Field(allow_inf_nan=False)]


class ArchiveEntry(ItemWire):
    name: str = Field(min_length=1, max_length=1000, pattern=r'^[A-Za-z0-9_./-]+$')
    offset: int = Field(ge=0)
    method: Literal[0, 8]
    crc32: int = Field(ge=0, le=4294967295)
    compressedSize: int = Field(ge=1, le=32000000)
    size: int = Field(ge=1, le=32000000)


class VoiceArchive(ItemWire):
    url: str = Field(min_length=1, max_length=2000)
    entry: ArchiveEntry


class CharacterMedia(ItemWire):
    identifier: str = Field(max_length=1000)
    url: str | None
    provider: str | None
    status: Literal['verified', 'unverified', 'missing', 'unreachable']
    sha256: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$')
    verification: Literal['image-header', 'archive-index'] | None = None
    archive: VoiceArchive | None = None
    resource: str | None = Field(default=None, max_length=2000)
    checkedAt: Number | None = None
    contentType: str | None = None
    width: int | None = Field(default=None, ge=1, le=16384)
    height: int | None = Field(default=None, ge=1, le=16384)
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode='after')
    def verified_identity(self):
        import re
        if self.status != 'verified':
            if self.url is not None:
                from .items.images import image_candidates, image_provider
                if self.url not in image_candidates({'identifier': self.identifier}) or self.provider != image_provider(self.url):
                    raise ValueError('Unverified candidate must retain a constrained image identity')
            return self
        if self.provider == 'genshin-voice':
            from .characters.voice_archive import allowed_archive_url
            if (self.verification != 'archive-index' or self.archive is None
                    or not self.url or not re.fullmatch(r'/api/characters/avatar:[0-9]+/voices/[A-Za-z0-9_-]+\?audioLanguage=(zh-CN|en|ja|ko)', self.url)
                    or not re.fullmatch(r'[0-9a-f]{16}', self.identifier)
                    or not allowed_archive_url(self.archive.url)
                    or self.archive.entry.name.removeprefix('./') != self.identifier+'.wav'):
                raise ValueError('Voice media requires exact archive evidence and a controlled URL')
        else:
            from .items.images import image_candidates, image_provider
            if (self.provider not in ('yatta', 'mihoyo') or self.archive
                    or self.verification != 'image-header' or self.url not in image_candidates({'identifier': self.identifier})
                    or self.provider != image_provider(self.url) or not self.width or not self.height
                    or self.contentType not in ('image/png', 'image/webp', 'image/jpeg')):
                raise ValueError('Character image must match verified identifier and header evidence')
        return self


class MaterialCost(ItemWire):
    id: str = Field(pattern=r'^[0-9]+$')
    itemId: str = Field(pattern=r'^material:[0-9]+$')
    count: Number = Field(ge=0)

    @model_validator(mode='after')
    def identity(self):
        if self.itemId != 'material:' + self.id:
            raise ValueError('Material identity mismatch')
        return self


class CharacterLevel(ItemWire):
    level: int = Field(ge=1, le=100)
    ascension: int = Field(ge=0, le=20)
    stats: dict[str, Number] = Field(max_length=100)


class CharacterAttribute(ItemWire):
    template: str
    text: str | None
    status: Literal['complete', 'unresolved']


class TalentLevel(ItemWire):
    level: int = Field(ge=1, le=100)
    requiredAscension: int | None
    parameters: list[Number | None] = Field(max_length=1000)
    attributes: list[CharacterAttribute] = Field(max_length=1000)
    unresolvedAttributeHashes: list[str] = Field(default_factory=list, max_length=1000)
    materials: list[MaterialCost] = Field(max_length=100)
    mora: Number | None
    upgradeable: bool
    sources: list[SourceRecord]


class CharacterTalent(ItemWire):
    id: str
    kind: Literal['normal', 'skill', 'burst', 'passive']
    name: str
    description: str
    icon: CharacterMedia
    cooldown: Number | None
    energyCost: Number | None
    unlockAscension: int | None
    levels: list[TalentLevel] = Field(max_length=100)
    sources: list[SourceRecord]
    coverage: dict[str, CoverageState]


class CharacterConstellation(ItemWire):
    id: str
    order: int = Field(ge=1)
    name: str
    description: str
    icon: CharacterMedia
    sources: list[SourceRecord]


class CharacterForm(ItemWire):
    id: str = Field(pattern=r'^[0-9]+$')
    name: str
    element: str | None
    elementName: str
    levels: list[CharacterLevel] = Field(max_length=3000)
    talents: list[CharacterTalent] = Field(max_length=100)
    constellations: list[CharacterConstellation] = Field(max_length=100)
    sources: list[SourceRecord]
    coverage: dict[str, CoverageState]


class NarrativeBranch(ItemWire):
    id: str
    title: str
    text: str
    conditions: dict[str, Any]
    rawTitle: str
    rawText: str
    displayStatus: Literal['complete', 'upstream-missing', 'unresolved']


class CharacterStory(NarrativeBranch):
    order: int = Field(ge=1)
    branches: list[NarrativeBranch]
    sources: list[SourceRecord]


class CharacterVoice(NarrativeBranch):
    category: str
    resource: str
    audio: dict[Literal['zh-CN', 'en', 'ja', 'ko'], CharacterMedia]
    sources: list[SourceRecord]
    branches: list[NarrativeBranch]


class CharacterAscension(ItemWire):
    ascension: int = Field(ge=0, le=20)
    maxLevel: int = Field(ge=1, le=100)
    materials: list[MaterialCost]
    mora: Number | None
    sources: list[SourceRecord]


class Birthday(ItemWire):
    month: int | None = Field(ge=1, le=12)
    day: int | None = Field(ge=1, le=31)


class Character(ItemWire):
    id: str = Field(pattern=r'^avatar:[0-9]+$', max_length=100)
    avatarId: int = Field(gt=0)
    language: Locale
    name: str = Field(max_length=2000)
    title: str
    description: str
    rarity: int | None = Field(ge=1, le=5)
    element: str | None
    elementName: str
    weaponType: str
    weaponName: str
    region: str
    state: Literal['source-record', 'internal', 'unclassified']
    icon: CharacterMedia
    portrait: CharacterMedia
    birthday: Birthday
    affiliation: str
    constellationName: str
    cv: dict[Literal['zh-CN', 'en', 'ja', 'ko'], str]
    sources: list[SourceRecord]
    documentIds: list[str] = Field(max_length=10000)
    forms: list[CharacterForm] = Field(max_length=100)
    stories: list[CharacterStory] = Field(max_length=10000)
    voices: list[CharacterVoice] = Field(max_length=10000)
    ascensions: list[CharacterAscension] = Field(max_length=100)
    coverage: dict[str, CoverageState]

    @model_validator(mode='after')
    def identity(self):
        from urllib.parse import unquote
        from .characters.voice_archive import BASE, LANGUAGES, voice_hash
        if self.id != f'avatar:{self.avatarId}':
            raise ValueError('Avatar identity mismatch')
        for voice in self.voices:
            for language, media in voice.audio.items():
                if media.status == 'verified':
                    if media.url != f'/api/characters/{self.id}/voices/{voice.id}?audioLanguage={language}':
                        raise ValueError('Voice URL identity mismatch')
                    if not media.resource or media.archive is None:
                        raise ValueError('Verified voice requires an original resource path')
                    archive_language = unquote(media.archive.url.removeprefix(BASE)).split('/')[0]
                    if (archive_language != LANGUAGES[language]
                            or media.identifier != voice_hash(LANGUAGES[language], media.resource)):
                        raise ValueError('Voice archive language or resource hash mismatch')
        return self


class CharacterDetailQuery(WireModel):
    language: Locale = 'zh-CN'
    snapshotId: str | None = Field(default=None, min_length=1, max_length=200, pattern=r'^[A-Za-z0-9_-]+$')


class CharacterListQuery(CharacterDetailQuery):
    q: str = Field(default='', max_length=2000)
    element: str | None = Field(default=None, min_length=1, max_length=100)
    weaponType: str | None = Field(default=None, min_length=1, max_length=100)
    rarity: int | None = Field(default=None, ge=1, le=5)
    region: str | None = Field(default=None, min_length=1, max_length=100)
    includeInternal: bool = False
    sort: Literal['rarity', 'name'] = 'rarity'
    page: int = Field(default=1, ge=1, le=100000)
    pageSize: int = Field(default=48, ge=1, le=100)


class CharacterVoiceQuery(CharacterDetailQuery):
    audioLanguage: Literal['zh-CN', 'en', 'ja', 'ko'] = 'zh-CN'
