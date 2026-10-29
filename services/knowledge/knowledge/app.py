"""HTTP boundary for server-to-server catalog access."""
from contextlib import asynccontextmanager
import hmac
import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from .config import require_production_token
from .models import ContentType, Locale, ReserveRequest, SearchRequest, SettleRequest
from .store import CatalogStore, StoreError

logger = logging.getLogger('knowledge')


def create_app(store=None, api_token=None):
    token = os.getenv('KNOWLEDGE_API_TOKEN', '') if api_token is None else api_token
    require_production_token(token)

    @asynccontextmanager
    async def lifespan(application):
        if application.state.store is None:
            application.state.store = CatalogStore()
        yield

    api = FastAPI(title='Void Knowledge', lifespan=lifespan)
    api.state.store = store

    def catalog():
        # Also supports ASGI callers that don't drive lifespan themselves.
        if api.state.store is None:
            api.state.store = CatalogStore()
        return api.state.store

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
        return JSONResponse(status_code=503, content={'error': {'code': 'KNOWLEDGE_UNAVAILABLE', 'message': 'Knowledge service is unavailable'}})

    guards = [Depends(authenticate)]

    @api.get('/v1/status', dependencies=guards)
    def status(db=Depends(catalog)):
        return db.status()

    @api.post('/v1/search', dependencies=guards)
    def search(body: SearchRequest, db=Depends(catalog)):
        return db.search(body.query, body.language, body.types, body.snapshotId, body.limit)

    @api.get('/v1/quest-outline', dependencies=guards)
    def quest_outline(region: str = Query(min_length=1, max_length=80), language: Locale = 'zh-CN',
                      snapshotId: str | None = Query(None, max_length=200), includeChapters: bool = True, db=Depends(catalog)):
        return db.quest_outline(region, language, snapshotId, includeChapters)

    @api.get('/v1/documents', dependencies=guards)
    def documents(q: str = Query('', max_length=2000), type: ContentType | None = None,
                  language: Locale | None = None, page: int = Query(1, ge=1, le=1000000),
                  pageSize: int = Query(24, ge=1, le=100), snapshotId: str | None = Query(None, max_length=200), db=Depends(catalog)):
        return db.list_documents(q, type, language, page, pageSize, snapshotId)

    @api.get('/v1/documents/{id:path}', dependencies=guards)
    def document(id: str, snapshotId: str | None = Query(None, max_length=200), db=Depends(catalog)):
        return db.get_document(id, snapshotId)

    @api.get('/v1/sources/{id:path}', dependencies=guards)
    def source(id: str, snapshotId: str | None = Query(None, max_length=200), db=Depends(catalog)):
        return db.read_source(id, snapshotId)

    @api.post('/v1/budget/reserve', dependencies=guards)
    def reserve(body: ReserveRequest, db=Depends(catalog)):
        return db.reserve_budget(body.requestId, body.identity, body.tokens)

    @api.post('/v1/budget/settle', dependencies=guards)
    def settle(body: SettleRequest, db=Depends(catalog)):
        return db.settle_budget(body.reservationId, body.usedTokens)

    return api


app = create_app()
