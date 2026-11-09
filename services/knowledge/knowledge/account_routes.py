"""Authenticated internal account endpoints and fail-closed ledger configuration."""
import os
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .account_risk import RiskCheck, RiskContext
from .account_store import AccountStore
from .config import database_url
from .store import StoreError


class AccountRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    accountId: str = Field(min_length=1, max_length=36)

    @field_validator('accountId')
    @classmethod
    def account_uuid(cls, value):
        return str(UUID(value))


class AccountSummaryRequest(AccountRequest):
    riskContext: RiskContext | None = None


class AccountReserveRequest(AccountSummaryRequest):
    requestId: str = Field(min_length=1, max_length=36)
    depth: Literal['standard', 'deep']
    model: str = Field(min_length=1, max_length=200)

    @field_validator('requestId')
    @classmethod
    def request_uuid(cls, value):
        return str(UUID(value))

    @field_validator('model')
    @classmethod
    def nonempty_model(cls, value):
        if not value.strip():
            raise ValueError('model must not be empty')
        return value


class AccountSettleRequest(AccountRequest):
    reservationId: str = Field(min_length=1, max_length=36)
    outcome: Literal['completed', 'released']
    usedTokens: int | None = Field(ge=0, le=10000000)

    @field_validator('reservationId')
    @classmethod
    def reservation_uuid(cls, value):
        return str(UUID(value))


def configured_account_store(token, catalog_store=None):
    if os.getenv('ACCOUNT_TRIAL_ENABLED', '').strip().lower() not in ('1', 'true'):
        return None
    if not token or not token.strip():
        raise RuntimeError('KNOWLEDGE_API_TOKEN is required for ACCOUNT_TRIAL_ENABLED')
    raw = os.getenv('ACCOUNT_DATABASE_PATH', '')
    if not raw or not Path(raw).is_absolute():
        raise RuntimeError('ACCOUNT_DATABASE_PATH must be an explicit absolute persistent file')
    path = Path(raw).resolve()
    protected = []
    url = database_url()
    if url.startswith('sqlite:///') and url[len('sqlite:///'):] != ':memory:':
        protected.append(Path(url[len('sqlite:///'):]).resolve())
    if catalog_store is not None and getattr(catalog_store, 'path', None):
        protected.append(Path(catalog_store.path).resolve())
    if os.getenv('CATALOG_REGISTRY'):
        protected.append(Path(os.environ['CATALOG_REGISTRY']).resolve())
    for other in protected:
        if path == other or (path.exists() and other.exists() and path.samefile(other)):
            raise RuntimeError('ACCOUNT_DATABASE_PATH must be separate from catalog storage')
    if os.getenv('CATALOG_ARCHIVES'):
        archive = Path(os.environ['CATALOG_ARCHIVES']).resolve()
        if path == archive or path.is_relative_to(archive):
            raise RuntimeError('ACCOUNT_DATABASE_PATH must be outside catalog archives')
    raw_credits = os.getenv('ACCOUNT_TRIAL_CREDITS', '20')
    if not raw_credits.isascii() or not raw_credits.isdigit():
        raise RuntimeError('ACCOUNT_TRIAL_CREDITS must be an integer between 0 and 1000000')
    return AccountStore(path, trial_credits=int(raw_credits))


def register_account_routes(api, authenticate):
    def ledger():
        if api.state.account_store is None:
            raise StoreError('ACCOUNT_TRIAL_DISABLED', 'Account trial is disabled', 503)
        return api.state.account_store

    @api.middleware('http')
    async def account_no_store(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/v1/accounts/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    guards = [Depends(authenticate)]

    @api.post('/v1/accounts/summary', dependencies=guards)
    def account_summary(body: AccountSummaryRequest, db=Depends(ledger)):
        return db.summary(body.accountId, risk_context=body.riskContext)

    @api.post('/v1/accounts/reserve', dependencies=guards)
    def account_reserve(body: AccountReserveRequest, db=Depends(ledger)):
        return db.reserve(body.accountId, body.requestId, body.depth, body.model, risk_context=body.riskContext)

    @api.post('/v1/accounts/settle', dependencies=guards)
    def account_settle(body: AccountSettleRequest, db=Depends(ledger)):
        return db.settle(body.accountId, body.reservationId, body.outcome, body.usedTokens)

    @api.post('/v1/accounts/risk/check', dependencies=guards)
    def account_risk_check(body: RiskCheck, db=Depends(ledger)):
        return db.check_risk(body)
