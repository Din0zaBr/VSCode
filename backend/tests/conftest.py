from __future__ import annotations

import asyncio
import sys
from typing import TYPE_CHECKING

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from testcontainers.postgres import PostgresContainer

from ursus.infrastructure.persistence.engine import (
    create_engine,
    create_session_factory,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from sqlalchemy.ext.asyncio import AsyncSession


# psycopg3 does not support ProactorEventLoop (Windows default); switch to
# SelectorEventLoop so async DB connections work on Windows dev machines.
if sys.platform == "win32":

    @pytest.fixture(scope="session")
    def event_loop_policy() -> asyncio.AbstractEventLoopPolicy:
        return asyncio.WindowsSelectorEventLoopPolicy()


@pytest.fixture(scope="session")
def postgres_dsn() -> Iterator[str]:
    with PostgresContainer("postgres:16", driver="psycopg") as container:
        yield container.get_connection_url()


@pytest.fixture(scope="session")
def _migrated(postgres_dsn: str) -> str:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", postgres_dsn)
    command.upgrade(config, "head")
    return postgres_dsn


@pytest_asyncio.fixture
async def session(_migrated: str) -> AsyncIterator[AsyncSession]:
    engine = create_engine(_migrated)
    factory = create_session_factory(engine)
    async with factory() as db_session:
        # Each test starts with empty messaging tables (shared container).
        await db_session.execute(text("TRUNCATE messaging.outbox, messaging.inbox"))
        await db_session.commit()
        yield db_session
    await engine.dispose()
