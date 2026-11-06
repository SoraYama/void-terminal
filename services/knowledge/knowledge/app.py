"""HTTP boundary for server-to-server catalog access."""
from contextlib import asynccontextmanager
import hmac
import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException
from pydantic import ValidationError
from .account_routes import configured_account_store, register_account_routes
from .catalog_router import CatalogRouter
from .config import require_production_token
from .models import ContentType, ItemDetailQuery, ItemListQuery, Locale, ReserveRequest, SearchRequest, SettleRequest
from .store import CatalogStore, StoreError
from .character_models import CharacterDetailQuery, CharacterListQuery, CharacterVoiceQuery

logger = logging.getLogger('knowledge')


def create_app(store=None, api_token=None):
    token = os.getenv('KNOWLEDGE_API_TOKEN', '') if api_token is None else api_token
    require_production_token(token)
    registry_path = os.getenv('CATALOG_REGISTRY')
    archives_path = os.getenv('CATALOG_ARCHIVES')

    @asynccontextmanager
    async def lifespan(application):
        if application.state.store is None:
            application.state.store = CatalogStore()
        yield

    api = FastAPI(title='Void Knowledge', lifespan=lifespan)
    api.state.store = store
    api.state.account_store = configured_account_store(token, store)

    def legacy_catalog():
        # Also supports ASGI callers that don't drive lifespan themselves.
        if api.state.store is None:
            api.state.store = CatalogStore()
        return api.state.store

    def catalog(db=Depends(legacy_catalog)):
        return CatalogRouter(db, registry_path, archives_path)

    def authenticate(x_knowledge_token: Annotated[str | None, Header()] = None):
        if token and not hmac.compare_digest(x_knowledge_token or '', token):
            raise StoreError('UNAUTHORIZED', 'Internal authorization required', 401)

    @api.exception_handler(StoreError)
    async def store_error(request, exc):
        return JSONResponse(status_code=exc.status, content={'error': {'code': exc.code, 'message': exc.message}})

    @api.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=400, content={'error': {'code': 'INVALID_REQUEST', 'message': 'Request fields or bounds are invalid'}})

    @api.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(status_code=exc.status_code, content={'error': {'code': 'NOT_FOUND' if exc.status_code == 404 else 'HTTP_ERROR', 'message': 'Resource not found' if exc.status_code == 404 else 'Request failed'}})

    @api.exception_handler(Exception)
    async def unexpected_error(request, exc):
        # Do not log exception text: connection errors can contain connection strings.
        logger.error('Knowledge request failed (%s)', type(exc).__name__)
        headers = {'Cache-Control': 'no-store'} if request.url.path.startswith('/v1/accounts/') else None
        return JSONResponse(status_code=503, content={'error': {'code': 'KNOWLEDGE_UNAVAILABLE', 'message': 'Knowledge service is unavailable'}}, headers=headers)

    guards = [Depends(authenticate)]

    def item_query(request, model, allowed=None):
        query = request.query_params
        if any(len(query.getlist(key)) != 1 for key in query):
            raise StoreError('INVALID_REQUEST', 'Duplicate query fields are invalid')
        values = dict(query)
        if allowed is not None and set(values) - set(allowed):
            raise StoreError('INVALID_REQUEST', 'Unknown query field')
        values = {key: value for key, value in values.items()
                  if value.strip() or key not in ('q', 'category', 'rarity', 'weaponType', 'snapshotId')}
        try:
            return model.model_validate(values)
        except ValidationError as exc:
            raise StoreError('INVALID_REQUEST', 'Request fields or bounds are invalid') from exc

    @api.get('/v1/items', dependencies=guards)
    def items(request: Request, router=Depends(catalog)):
        query = item_query(request, ItemListQuery)
        db, sid = router.select(query.snapshotId)
        return db.list_items(query.q, query.category, query.language, query.rarity, query.weaponType,
                             query.includeInternal, query.sort, query.page, query.pageSize, sid)

    @api.get('/v1/items/coverage', dependencies=guards)
    def item_coverage(request: Request, router=Depends(catalog)):
        query = item_query(request, ItemDetailQuery, ['snapshotId'])
        db, sid = router.select(query.snapshotId)
        return db.item_coverage(sid)

    @api.get('/v1/items/{id:path}', dependencies=guards)
    def item(id: str, request: Request, router=Depends(catalog)):
        query = item_query(request, ItemDetailQuery)
        db, sid = router.select(query.snapshotId)
        return db.get_item(id, query.language, sid)

    @api.get('/v1/characters', dependencies=guards)
    def characters(request: Request, router=Depends(catalog)):
        query = item_query(request, CharacterListQuery)
        db, sid = router.select(query.snapshotId)
        return db.list_characters(q=query.q, language=query.language, element=query.element,
            weapon_type=query.weaponType, rarity=query.rarity, region=query.region,
            include_internal=query.includeInternal, sort=query.sort, page=query.page,
            page_size=query.pageSize, snapshot_id=sid)

    @api.get('/v1/characters/coverage', dependencies=guards)
    def character_coverage(request: Request, router=Depends(catalog)):
        query = item_query(request, CharacterDetailQuery, ['snapshotId'])
        db, sid = router.select(query.snapshotId)
        return db.character_coverage(sid)

    @api.get('/v1/characters/{id}/voices/{voice_id}', dependencies=guards)
    def character_voice(id: str, voice_id: str, request: Request, router=Depends(catalog)):
        import re
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', voice_id):
            raise StoreError('INVALID_REQUEST', 'Invalid voice identity')
        query = item_query(request, CharacterVoiceQuery)
        db, sid = router.select(query.snapshotId)
        character = db.get_character(id, query.language, sid)['character']
        voice = next((row for row in character['voices'] if row['id'] == voice_id), None)
        media = voice.get('audio', {}).get(query.audioLanguage) if voice else None
        if not media or media.get('status') != 'verified' or media.get('provider') != 'genshin-voice':
            raise StoreError('VOICE_NOT_FOUND', 'Audio is missing for this voice and language', 404)
        try:
            from .characters.media import load_voice
            audio = load_voice(media)
        except Exception as exc:
            raise StoreError('VOICE_UNAVAILABLE', 'Audio is temporarily unavailable', 503) from exc
        return Response(audio, media_type='audio/wav', headers={
            'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'})

    @api.get('/v1/characters/{id:path}', dependencies=guards)
    def character(id: str, request: Request, router=Depends(catalog)):
        query = item_query(request, CharacterDetailQuery)
        db, sid = router.select(query.snapshotId)
        return db.get_character(id, query.language, sid)

    @api.get('/v1/status', dependencies=guards)
    def status(router=Depends(catalog)):
        return router.status()

    @api.post('/v1/search', dependencies=guards)
    def search(body: SearchRequest, router=Depends(catalog)):
        db, sid = router.select(body.snapshotId)
        return db.search(body.query, body.language, body.types, sid, body.limit)

    @api.get('/v1/quest-outline', dependencies=guards)
    def quest_outline(region: str = Query(min_length=1, max_length=80), language: Locale = 'zh-CN',
                      snapshotId: str | None = Query(None, max_length=200), includeChapters: bool = True, router=Depends(catalog)):
        db, sid = router.select(snapshotId)
        return db.quest_outline(region, language, sid, includeChapters)

    @api.get('/v1/documents', dependencies=guards)
    def documents(q: str = Query('', max_length=2000), type: ContentType | None = None,
                  language: Locale | None = None, page: int = Query(1, ge=1, le=1000000),
                  pageSize: int = Query(24, ge=1, le=100), snapshotId: str | None = Query(None, max_length=200), router=Depends(catalog)):
        db, sid = router.select(snapshotId)
        return db.list_documents(q, type, language, page, pageSize, sid)

    @api.get('/v1/documents/{id:path}', dependencies=guards)
    def document(id: str, snapshotId: str | None = Query(None, max_length=200), router=Depends(catalog)):
        db, sid = router.select(snapshotId)
        return db.get_document(id, sid)

    @api.get('/v1/sources/{id:path}', dependencies=guards)
    def source(id: str, snapshotId: str | None = Query(None, max_length=200), router=Depends(catalog)):
        return router.read_source(id, snapshotId)

    @api.post('/v1/budget/reserve', dependencies=guards)
    def reserve(body: ReserveRequest, db=Depends(legacy_catalog)):
        return db.reserve_budget(body.requestId, body.identity, body.tokens)

    @api.post('/v1/budget/settle', dependencies=guards)
    def settle(body: SettleRequest, db=Depends(legacy_catalog)):
        return db.settle_budget(body.reservationId, body.usedTokens)

    register_account_routes(api, authenticate)
    return api


app = create_app()
