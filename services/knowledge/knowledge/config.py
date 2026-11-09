"""Environment configuration; local database paths are repository-relative."""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def database_url():
    return os.getenv('DATABASE_URL', 'sqlite:///' + str(REPO_ROOT / 'data/catalog.sqlite'))


def budget_cap():
    return max(0, int(os.getenv('SHARED_DAILY_TOKEN_BUDGET', '0')))


def monthly_budget_cap():
    # Keep older finite daily configurations bounded without making upgrades unlimited.
    raw = os.getenv('SHARED_MONTHLY_TOKEN_BUDGET')
    return budget_cap() * 31 if raw is None else max(0, int(raw))


def require_production_token(token):
    if os.getenv('ENVIRONMENT', '').lower() == 'production' and not token:
        raise RuntimeError('KNOWLEDGE_API_TOKEN is required in production')
