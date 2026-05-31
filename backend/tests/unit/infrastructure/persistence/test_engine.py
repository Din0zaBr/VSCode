from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from ursus.infrastructure.persistence.engine import (
    create_engine,
    create_session_factory,
)

DSN = "postgresql+psycopg://ursus:ursus@localhost:5432/ursus"


def test_create_engine_returns_async_engine() -> None:
    engine = create_engine(DSN)
    assert isinstance(engine, AsyncEngine)
    assert engine.url.drivername == "postgresql+psycopg"


def test_create_session_factory_returns_sessionmaker() -> None:
    factory = create_session_factory(create_engine(DSN))
    assert isinstance(factory, async_sessionmaker)
