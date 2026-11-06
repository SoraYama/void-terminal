"""Public model budget across days/months, without changing the corpus schema."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest

from knowledge import config
from knowledge.store import CatalogStore


@pytest.fixture
def clock(monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 11, 6, 12, tzinfo=timezone.utc)

        @classmethod
        def now(cls, tz=None):
            return cls.current if tz is None else cls.current.astimezone(tz)

    monkeypatch.setattr('knowledge.store.datetime', Clock)
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '100')
    monkeypatch.setenv('SHARED_MONTHLY_TOKEN_BUDGET', '150')
    return Clock


def test_monthly_cap_counts_prior_days_and_released_holds(store, clock):
    first = store.reserve_budget('first', 'account', 100)
    assert first['allowed']
    store.settle_budget(first['reservationId'], 90)
    clock.current = datetime(2026, 11, 7, tzinfo=timezone.utc)
    second = store.reserve_budget('second', 'account', 60)
    assert second['allowed'] and second['remaining'] == 0
    assert not store.reserve_budget('over-month', 'account', 1)['allowed']
    store.settle_budget(second['reservationId'], 40)
    assert store.reserve_budget('freed-month', 'account', 20)['allowed']
    assert not store.reserve_budget('still-over-month', 'account', 1)['allowed']


def test_month_rollover_and_late_release_remain_in_original_period(store, clock, monkeypatch):
    monkeypatch.setenv('SHARED_MONTHLY_TOKEN_BUDGET', '100')
    clock.current = datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc)
    old = store.reserve_budget('december', 'account', 100)
    assert old['allowed']
    clock.current = datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert store.reserve_budget('january', 'account', 100)['allowed']
    store.settle_budget(old['reservationId'], 0)
    assert not store.reserve_budget('january-extra', 'account', 1)['allowed']
    assert store.reserve_budget('december', 'account', 100) == old


def test_monthly_reservations_are_atomic_across_connections(tmp_path, clock, monkeypatch):
    monkeypatch.setenv('SHARED_MONTHLY_TOKEN_BUDGET', '90')
    url = 'sqlite:///' + str(tmp_path / 'monthly.sqlite')
    first_store = CatalogStore(url)
    prior = first_store.reserve_budget('prior-day', 'account', 30)
    assert prior['allowed']
    clock.current = datetime(2026, 11, 7, tzinfo=timezone.utc)

    def reserve(index):
        return CatalogStore(url).reserve_budget(f'parallel-{index}', 'account', 20)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(reserve, range(12)))
    assert sum(result['allowed'] for result in results) == 3
    assert not CatalogStore(url).reserve_budget('after-restart', 'account', 1)['allowed']


def test_unknown_usage_retains_monthly_reservation(store, clock, monkeypatch):
    monkeypatch.setenv('SHARED_MONTHLY_TOKEN_BUDGET', '40')
    result = store.reserve_budget('unknown-usage', 'account', 40)
    assert result['allowed']
    store.settle_budget(result['reservationId'], None)
    clock.current = datetime(2026, 11, 7, tzinfo=timezone.utc)
    assert not store.reserve_budget('new-day', 'account', 1)['allowed']


def test_monthly_zero_denies_calls_even_when_daily_budget_is_positive(store, clock, monkeypatch):
    monkeypatch.setenv('SHARED_MONTHLY_TOKEN_BUDGET', '0')
    assert not store.reserve_budget('disabled-month', 'account', 1)['allowed']


def test_absent_monthly_setting_derives_a_finite_bound(monkeypatch):
    monkeypatch.delenv('SHARED_MONTHLY_TOKEN_BUDGET', raising=False)
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '100')
    assert config.monthly_budget_cap() == 3100
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '0')
    assert config.monthly_budget_cap() == 0


@pytest.mark.parametrize('value', ['', 'not-a-number', '1.5'])
def test_invalid_monthly_setting_fails_closed(value, monkeypatch):
    monkeypatch.setenv('SHARED_MONTHLY_TOKEN_BUDGET', value)
    with pytest.raises(ValueError):
        config.monthly_budget_cap()
