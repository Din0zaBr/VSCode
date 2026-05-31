from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

from ursus.setup.settings import AppSettings


def test_from_env_reads_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("URSUS_ENV", "production")
    monkeypatch.setenv("URSUS_DEBUG", "true")
    settings = AppSettings.from_env()
    assert settings.environment == "production"
    assert settings.debug is True


def test_from_env_uses_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("URSUS_ENV", raising=False)
    monkeypatch.delenv("URSUS_DEBUG", raising=False)
    settings = AppSettings.from_env()
    assert settings.environment == "local"
    assert settings.debug is False


def test_postgres_dsn_is_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("URSUS_POSTGRES_DSN", "postgresql+psycopg://u:p@db:5432/ursus")
    settings = AppSettings.from_env()
    assert settings.postgres_dsn == "postgresql+psycopg://u:p@db:5432/ursus"
