from __future__ import annotations

import pytest

from ursus.application.common.ports.unit_of_work import UnitOfWork
from ursus.setup.ioc import build_container
from ursus.setup.settings import AppSettings


@pytest.fixture
def _env(monkeypatch: pytest.MonkeyPatch, postgres_dsn: str) -> None:
    monkeypatch.setenv("URSUS_POSTGRES_DSN", postgres_dsn)


async def test_container_provides_unit_of_work(_env: None) -> None:
    container = build_container()
    try:
        async with container() as request_container:
            uow = await request_container.get(UnitOfWork)
            assert isinstance(uow, UnitOfWork)
    finally:
        await container.close()


async def test_settings_carry_container_dsn(_env: None, postgres_dsn: str) -> None:
    container = build_container()
    try:
        settings = await container.get(AppSettings)
        assert settings.postgres_dsn == postgres_dsn
    finally:
        await container.close()
