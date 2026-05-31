# URSUS Persistence Kernel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Postgres-backed persistence kernel and the event-contract machinery — async engine/session, declarative base, Alembic migrations, integration-event contract + adaptix serialization, translator registry, transactional outbox, idempotent inbox, and a Unit of Work that ties them together — proven end-to-end against a real Postgres testcontainer.

**Architecture:** Domain aggregates stay pure; repositories (later plans) map domain↔ORM. The `SqlAlchemyUnitOfWork` tracks aggregates and, on commit, runs `collect_events()` → translator registry → adaptix serializer → outbox row **in the same transaction** as the aggregate state. Integration events are flat, versioned DTOs; consumers dedupe via an idempotent inbox. This plan delivers the Postgres path only; DuckDB/Elasticsearch/MinIO are deferred to the slices that first need them (per spec §F).

**Tech Stack:** Python 3.12+, SQLAlchemy 2.0 async + psycopg3, Alembic, adaptix, dishka, pytest + pytest-asyncio + testcontainers[postgres].

---

## Environment notes (read once)

- **Git root is the parent workspace** `C:\Users\ivanz\VSCode`. Run all commands from
  `C:\Users\ivanz\VSCode\backend`; `git add <relative path>` resolves correctly from there.
  Work happens on branch `feat/ursus-module-skeleton`.
- All commands are prefixed with `uv run` so they use the project venv.
- **Docker Desktop must be running** for the integration tests (Tasks 6, 11, 12, 13) —
  testcontainers spins up a real Postgres. Unit tests (Tasks 1–5, 7–10) need no Docker.
- Conventional Commits. End every commit message with the trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- ruff `select = ["ALL"]` (D-rules already ignored — no docstrings required); mypy `strict`.
  Every code block below is written to pass both. Type-only imports go under `if TYPE_CHECKING:`
  (ruff TC001/2/3 is enabled project-wide).
- Authoritative contracts: `docs/superpowers/specs/2026-05-31-ursus-event-and-persistence-contracts.md`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `pyproject.toml` | + `psycopg[binary]` dependency |
| `src/ursus/setup/settings.py` | + `postgres_dsn` field |
| `src/ursus/infrastructure/persistence/base.py` | `Base` declarative base + naming convention |
| `src/ursus/infrastructure/persistence/schemas.py` | Postgres schema-name constants |
| `src/ursus/infrastructure/persistence/models/common/outbox.py` | `OutboxMessage` ORM model |
| `src/ursus/infrastructure/persistence/models/common/inbox.py` | `InboxMessage` ORM model |
| `src/ursus/infrastructure/persistence/engine.py` | async engine + session factory builders |
| `src/ursus/infrastructure/persistence/migrations/` | Alembic env + initial migration |
| `alembic.ini` | Alembic config (url injected from env) |
| `src/ursus/application/common/events/integration_event.py` | `IntegrationEvent` base + `EventEnvelope` |
| `src/ursus/infrastructure/event_bus/serializer.py` | `IntegrationEventSerializer` (adaptix Retort) |
| `src/ursus/infrastructure/mappers/registry.py` | `IntegrationEventTranslator` + `IntegrationEventRegistry` |
| `src/ursus/application/common/ports/unit_of_work.py` | `UnitOfWork` port |
| `src/ursus/application/common/ports/outbox.py` | `OutboxStore` port |
| `src/ursus/application/common/ports/inbox.py` | `InboxStore` port |
| `src/ursus/application/common/ports/integration_event_publisher.py` | `IntegrationEventPublisher` port (contract only) |
| `src/ursus/infrastructure/persistence/outbox_store.py` | `SqlAlchemyOutboxStore` |
| `src/ursus/infrastructure/persistence/inbox_store.py` | `SqlAlchemyInboxStore` |
| `src/ursus/infrastructure/persistence/unit_of_work.py` | `SqlAlchemyUnitOfWork` |
| `src/ursus/setup/ioc.py` | + `PersistenceProvider` (engine/session/stores/uow) |
| `tests/conftest.py` | session-scoped Postgres container + migrated session fixture |
| `ruff.toml`, `mypy.ini`, `.importlinter` | tooling adjustments |

---

## Task 1: Add psycopg driver and the Postgres DSN setting

**Files:**
- Modify: `pyproject.toml:23-34`
- Modify: `src/ursus/setup/settings.py`
- Test: `tests/unit/setup/test_settings.py`

- [ ] **Step 1: Add the driver dependency**

In `pyproject.toml`, add to the `dependencies` list (after `"duckdb==1.5.3",`):

```toml
    "psycopg[binary]==3.2.3",
```

- [ ] **Step 2: Sync the environment**

Run: `uv sync`
Expected: resolves and installs `psycopg`; no error.

- [ ] **Step 3: Write the failing test**

Append to `tests/unit/setup/test_settings.py`:

```python
def test_postgres_dsn_is_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("URSUS_POSTGRES_DSN", "postgresql+psycopg://u:p@db:5432/ursus")
    settings = AppSettings.from_env()
    assert settings.postgres_dsn == "postgresql+psycopg://u:p@db:5432/ursus"
```

If `import pytest` is not already at the top of the file, add it.

- [ ] **Step 4: Run the test to verify it fails**

Run: `uv run pytest tests/unit/setup/test_settings.py::test_postgres_dsn_is_read_from_env -v`
Expected: FAIL — `AppSettings` has no attribute `postgres_dsn`.

- [ ] **Step 5: Add the field**

In `src/ursus/setup/settings.py`, add the field and env read:

```python
@dataclass(frozen=True, slots=True)
class AppSettings:
    environment: str
    debug: bool
    postgres_dsn: str

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            environment=os.environ.get("URSUS_ENV", "local"),
            debug=os.environ.get("URSUS_DEBUG", "false").lower() == "true",
            postgres_dsn=os.environ.get(
                "URSUS_POSTGRES_DSN",
                "postgresql+psycopg://ursus:ursus@localhost:5432/ursus",
            ),
        )
```

- [ ] **Step 6: Run the full settings test file**

Run: `uv run pytest tests/unit/setup/test_settings.py -v`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock src/ursus/setup/settings.py tests/unit/setup/test_settings.py
git commit -m "feat(setup): add psycopg driver and postgres_dsn setting"
```

---

## Task 2: Declarative Base and schema constants

**Files:**
- Create: `src/ursus/infrastructure/persistence/base.py`
- Create: `src/ursus/infrastructure/persistence/schemas.py`
- Test: `tests/unit/infrastructure/persistence/__init__.py`, `tests/unit/infrastructure/__init__.py`, `tests/unit/infrastructure/persistence/test_base.py`

- [ ] **Step 1: Create the test packages and the failing test**

Create empty `tests/unit/infrastructure/__init__.py` and
`tests/unit/infrastructure/persistence/__init__.py`, then create
`tests/unit/infrastructure/persistence/test_base.py`:

```python
from __future__ import annotations

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import (
    INCIDENT_SCHEMA,
    MESSAGING_SCHEMA,
    OBSERVED_ENTITY_SCHEMA,
    OPERATOR_SCHEMA,
)


def test_base_uses_naming_convention() -> None:
    assert "pk" in Base.metadata.naming_convention
    assert Base.metadata.naming_convention["pk"] == "pk_%(table_name)s"


def test_postgres_schema_constants() -> None:
    assert MESSAGING_SCHEMA == "messaging"
    assert OPERATOR_SCHEMA == "operator"
    assert OBSERVED_ENTITY_SCHEMA == "observed_entity"
    assert INCIDENT_SCHEMA == "incident"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/infrastructure/persistence/test_base.py -v`
Expected: FAIL — module `ursus.infrastructure.persistence.base` not found.

- [ ] **Step 3: Create the schema constants**

`src/ursus/infrastructure/persistence/schemas.py`:

```python
from __future__ import annotations

MESSAGING_SCHEMA = "messaging"
OPERATOR_SCHEMA = "operator"
OBSERVED_ENTITY_SCHEMA = "observed_entity"
INCIDENT_SCHEMA = "incident"
```

(Metrics lives in DuckDB, not Postgres — it has no schema constant here, per spec §D.)

- [ ] **Step 4: Create the declarative base**

`src/ursus/infrastructure/persistence/base.py`:

```python
from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
```

- [ ] **Step 5: Run to verify it passes**

Run: `uv run pytest tests/unit/infrastructure/persistence/test_base.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ursus/infrastructure/persistence/base.py src/ursus/infrastructure/persistence/schemas.py tests/unit/infrastructure
git commit -m "feat(persistence): add declarative base and postgres schema constants"
```

---

## Task 3: Outbox and Inbox ORM models

**Files:**
- Create: `src/ursus/infrastructure/persistence/models/common/__init__.py`
- Create: `src/ursus/infrastructure/persistence/models/common/outbox.py`
- Create: `src/ursus/infrastructure/persistence/models/common/inbox.py`
- Modify: `ruff.toml`
- Test: `tests/unit/infrastructure/persistence/test_models.py`

- [ ] **Step 0: Configure ruff for runtime-evaluated annotations**

Three frameworks here resolve annotations at runtime via `get_type_hints`, which clashes with
ruff's `TC001/TC002/TC003` (which want type-only imports under `TYPE_CHECKING`):
- **SQLAlchemy** resolves the types inside `Mapped[...]` (Task 3 models).
- **adaptix** resolves `IntegrationEvent` dataclass field types when dumping/loading (Tasks 7, 8).
- **dishka** resolves provider return annotations at container-build time (Task 13).

Tell ruff these contexts are runtime-evaluated by adding a new section to `ruff.toml` (after the
`[lint.flake8-pytest-style]` block):

```toml
[lint.flake8-type-checking]
runtime-evaluated-base-classes = ["ursus.infrastructure.persistence.base.Base"]
runtime-evaluated-decorators = ["dishka.provide", "dataclasses.dataclass"]
```

Because of this, the model files below — and the `IntegrationEvent`/`EventEnvelope` dataclasses
in Task 7 — import `datetime`, `UUID`, and `Any` at **runtime** (top-level), not under
`TYPE_CHECKING`.

- [ ] **Step 1: Write the failing test**

`tests/unit/infrastructure/persistence/test_models.py`:

```python
from __future__ import annotations

from ursus.infrastructure.persistence.models.common.inbox import InboxMessage
from ursus.infrastructure.persistence.models.common.outbox import OutboxMessage


def test_outbox_table_is_in_messaging_schema() -> None:
    assert OutboxMessage.__tablename__ == "outbox"
    assert OutboxMessage.__table__.schema == "messaging"


def test_outbox_has_envelope_columns() -> None:
    columns = set(OutboxMessage.__table__.columns.keys())
    assert {
        "event_id",
        "event_type",
        "schema_version",
        "occurred_at",
        "payload",
        "created_at",
        "published_at",
    } <= columns


def test_inbox_table_is_in_messaging_schema() -> None:
    assert InboxMessage.__tablename__ == "inbox"
    assert InboxMessage.__table__.schema == "messaging"
    assert "event_id" in InboxMessage.__table__.columns
    assert InboxMessage.__table__.columns["event_id"].primary_key
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/infrastructure/persistence/test_models.py -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the package marker**

Create empty `src/ursus/infrastructure/persistence/models/common/__init__.py`.

- [ ] **Step 4: Create the outbox model**

`src/ursus/infrastructure/persistence/models/common/outbox.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import MESSAGING_SCHEMA


class OutboxMessage(Base):
    __tablename__ = "outbox"
    __table_args__ = {"schema": MESSAGING_SCHEMA}

    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    event_type: Mapped[str]
    schema_version: Mapped[int]
    occurred_at: Mapped[datetime]
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(default=None)
```

- [ ] **Step 5: Create the inbox model**

`src/ursus/infrastructure/persistence/models/common/inbox.py`:

```python
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import MESSAGING_SCHEMA


class InboxMessage(Base):
    __tablename__ = "inbox"
    __table_args__ = {"schema": MESSAGING_SCHEMA}

    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

- [ ] **Step 6: Run to verify it passes**

Run: `uv run pytest tests/unit/infrastructure/persistence/test_models.py -v`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ursus/infrastructure/persistence/models/common ruff.toml tests/unit/infrastructure/persistence/test_models.py
git commit -m "feat(persistence): add outbox and inbox ORM models"
```

---

## Task 4: Async engine and session factory

**Files:**
- Create: `src/ursus/infrastructure/persistence/engine.py`
- Test: `tests/unit/infrastructure/persistence/test_engine.py`

- [ ] **Step 1: Write the failing test**

`tests/unit/infrastructure/persistence/test_engine.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/infrastructure/persistence/test_engine.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the engine builders**

`src/ursus/infrastructure/persistence/engine.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession


def create_engine(dsn: str) -> AsyncEngine:
    return create_async_engine(dsn, pool_pre_ping=True)


def create_session_factory(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/unit/infrastructure/persistence/test_engine.py -v`
Expected: all PASS. (No DB connection is made — the engine is lazy.)

- [ ] **Step 5: Commit**

```bash
git add src/ursus/infrastructure/persistence/engine.py tests/unit/infrastructure/persistence/test_engine.py
git commit -m "feat(persistence): add async engine and session factory builders"
```

---

## Task 5: Alembic scaffold and initial migration

This wires Alembic for the Postgres-backed contexts only (spec §D). The initial migration
creates the `messaging` schema and the `outbox`/`inbox` tables. It is hand-written (not
autogenerated) so the schema is created before its tables.

**Files:**
- Create: `alembic.ini`
- Create: `src/ursus/infrastructure/persistence/migrations/env.py`
- Create: `src/ursus/infrastructure/persistence/migrations/script.py.mako`
- Create: `src/ursus/infrastructure/persistence/migrations/versions/0001_messaging.py`
- Modify: `ruff.toml` (exclude the whole `migrations/` tree)
- Modify: `mypy.ini` (exclude `migrations/`)

- [ ] **Step 1: Exclude migrations from ruff and mypy**

In `ruff.toml`, change the migrations exclude line from
`"src/ursus/infrastructure/persistence/migrations/versions",` to:

```toml
    "src/ursus/infrastructure/persistence/migrations",
```

In `mypy.ini`, add under `[mypy]` (after line `files = src, tests`):

```ini
exclude = (?x)(/migrations/)
```

- [ ] **Step 2: Create `alembic.ini`** (at backend root)

```ini
[alembic]
script_location = src/ursus/infrastructure/persistence/migrations
prepend_sys_path = src

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console
qualname =

[logger_sqlalchemy]
level = WARNING
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 3: Create the migrations package + `env.py`**

Create empty `src/ursus/infrastructure/persistence/migrations/__init__.py` and
`src/ursus/infrastructure/persistence/migrations/versions/__init__.py`.

`src/ursus/infrastructure/persistence/migrations/env.py`:

```python
from __future__ import annotations

import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from ursus.infrastructure.persistence.base import Base

# Importing the models registers their tables on Base.metadata.
from ursus.infrastructure.persistence.models.common import inbox, outbox  # noqa: F401

config = context.config
# Only fall back to env/default when the caller (e.g. tests) has not already injected a URL
# via config.set_main_option — otherwise we would clobber the testcontainer DSN.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option(
        "sqlalchemy.url",
        os.environ.get(
            "URSUS_POSTGRES_DSN",
            "postgresql+psycopg://ursus:ursus@localhost:5432/ursus",
        ),
    )

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        include_schemas=True,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4: Create `script.py.mako`**

`src/ursus/infrastructure/persistence/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 5: Create the initial migration**

`src/ursus/infrastructure/persistence/migrations/versions/0001_messaging.py`:

```python
"""create messaging schema with outbox and inbox

Revision ID: 0001_messaging
Revises:
Create Date: 2026-05-31

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_messaging"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS messaging")
    op.create_table(
        "outbox",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("event_id", name="pk_outbox"),
        schema="messaging",
    )
    op.create_index(
        "ix_outbox_unpublished",
        "outbox",
        ["created_at"],
        schema="messaging",
        postgresql_where=sa.text("published_at IS NULL"),
    )
    op.create_table(
        "inbox",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("event_id", name="pk_inbox"),
        schema="messaging",
    )


def downgrade() -> None:
    op.drop_table("inbox", schema="messaging")
    op.drop_index("ix_outbox_unpublished", table_name="outbox", schema="messaging")
    op.drop_table("outbox", schema="messaging")
    op.execute("DROP SCHEMA IF EXISTS messaging")
```

- [ ] **Step 6: Verify the migration script is well-formed (offline render)**

Run: `uv run alembic upgrade head --sql`
Expected: prints SQL containing `CREATE SCHEMA IF NOT EXISTS messaging` and
`CREATE TABLE messaging.outbox` — no Python error. (This renders SQL without a DB.)

- [ ] **Step 7: Confirm ruff and mypy still pass (migrations excluded)**

Run: `uv run ruff check . && uv run mypy`
Expected: both clean (the `migrations/` tree is excluded).

- [ ] **Step 8: Commit**

```bash
git add alembic.ini src/ursus/infrastructure/persistence/migrations ruff.toml mypy.ini
git commit -m "build(persistence): scaffold alembic and initial messaging migration"
```

---

## Task 6: Postgres testcontainer fixtures and migration smoke test

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/integration/infrastructure/__init__.py`, `tests/integration/infrastructure/persistence/__init__.py`
- Test: `tests/integration/infrastructure/persistence/test_migrations.py`

- [ ] **Step 1: Create the conftest fixtures**

`tests/conftest.py`:

```python
from __future__ import annotations

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
```

- [ ] **Step 2: Create the integration test packages + the smoke test**

Create empty `tests/integration/infrastructure/__init__.py` and
`tests/integration/infrastructure/persistence/__init__.py`, then create
`tests/integration/infrastructure/persistence/test_migrations.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def test_messaging_tables_exist(session: AsyncSession) -> None:
    result = await session.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'messaging'"
        ),
    )
    tables = {row[0] for row in result}
    assert {"outbox", "inbox"} <= tables
```

- [ ] **Step 3: Run the integration test (Docker must be running)**

Run: `uv run pytest tests/integration/infrastructure/persistence/test_migrations.py -v`
Expected: PASS — Postgres container starts, migrations apply, both tables found.

- [ ] **Step 4: Commit**

```bash
git add tests/conftest.py tests/integration/infrastructure
git commit -m "test(persistence): add postgres container fixtures and migration smoke test"
```

---

## Task 7: IntegrationEvent contract and EventEnvelope

**Files:**
- Create: `src/ursus/application/common/events/__init__.py`
- Create: `src/ursus/application/common/events/integration_event.py`
- Test: `tests/unit/application/__init__.py`, `tests/unit/application/common/__init__.py`, `tests/unit/application/common/events/__init__.py`, `tests/unit/application/common/events/test_integration_event.py`

- [ ] **Step 1: Write the failing test**

Create the empty test `__init__.py` files listed above, then create
`tests/unit/application/common/events/test_integration_event.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from ursus.application.common.events.integration_event import (
    EventEnvelope,
    IntegrationEvent,
)


@dataclass(frozen=True, kw_only=True)
class ThingHappened(IntegrationEvent):
    event_type = "test.thing_happened"
    schema_version = 1
    thing_id: str


def test_integration_event_carries_type_and_version_as_class_metadata() -> None:
    assert ThingHappened.event_type == "test.thing_happened"
    assert ThingHappened.schema_version == 1


def test_integration_event_instance_has_id_and_timestamp() -> None:
    event = ThingHappened(
        event_id=uuid4(),
        occurred_at=datetime.now(UTC),
        thing_id="abc",
    )
    assert event.thing_id == "abc"


def test_event_envelope_is_constructible() -> None:
    envelope = EventEnvelope(
        event_id=uuid4(),
        event_type="test.thing_happened",
        schema_version=1,
        occurred_at=datetime.now(UTC),
        payload={"thing_id": "abc"},
    )
    assert envelope.payload == {"thing_id": "abc"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/application/common/events/test_integration_event.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the contract**

Create empty `src/ursus/application/common/events/__init__.py`, then
`src/ursus/application/common/events/integration_event.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, ClassVar
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class IntegrationEvent:
    """Flat, versioned cross-context contract.

    Subclasses set ``event_type`` and ``schema_version`` as class attributes and
    declare their payload as additional frozen-dataclass fields.
    """

    event_type: ClassVar[str]
    schema_version: ClassVar[int]

    event_id: UUID
    occurred_at: datetime


@dataclass(frozen=True, kw_only=True)
class EventEnvelope:
    """Transport/outbox shape: routing metadata + dumped event body."""

    event_id: UUID
    event_type: str
    schema_version: int
    occurred_at: datetime
    payload: dict[str, Any]
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/unit/application/common/events/test_integration_event.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/application/common/events tests/unit/application
git commit -m "feat(application): add IntegrationEvent contract and EventEnvelope"
```

---

## Task 8: Integration-event serializer (adaptix)

The serializer turns an `IntegrationEvent` into an `EventEnvelope` and reconstructs an event
from a stored payload. adaptix `Retort` ignores unknown fields by default — that *is* the
tolerant-reader behaviour (spec §A/E3).

**Files:**
- Create: `src/ursus/infrastructure/event_bus/serializer.py`
- Test: `tests/unit/infrastructure/event_bus/__init__.py`, `tests/unit/infrastructure/event_bus/test_serializer.py`

- [ ] **Step 1: Write the failing test**

Create empty `tests/unit/infrastructure/event_bus/__init__.py`, then
`tests/unit/infrastructure/event_bus/test_serializer.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from ursus.application.common.events.integration_event import IntegrationEvent
from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer


@dataclass(frozen=True, kw_only=True)
class ThingHappened(IntegrationEvent):
    event_type = "test.thing_happened"
    schema_version = 1
    thing_id: str


def test_to_envelope_extracts_routing_metadata() -> None:
    serializer = IntegrationEventSerializer()
    event = ThingHappened(
        event_id=uuid4(), occurred_at=datetime.now(UTC), thing_id="abc"
    )
    envelope = serializer.to_envelope(event)
    assert envelope.event_type == "test.thing_happened"
    assert envelope.schema_version == 1
    assert envelope.event_id == event.event_id
    assert envelope.payload["thing_id"] == "abc"


def test_from_payload_round_trips() -> None:
    serializer = IntegrationEventSerializer()
    event = ThingHappened(
        event_id=uuid4(), occurred_at=datetime.now(UTC), thing_id="abc"
    )
    envelope = serializer.to_envelope(event)
    restored = serializer.from_payload(envelope.payload, ThingHappened)
    assert restored == event


def test_from_payload_is_tolerant_to_unknown_fields() -> None:
    serializer = IntegrationEventSerializer()
    event = ThingHappened(
        event_id=uuid4(), occurred_at=datetime.now(UTC), thing_id="abc"
    )
    payload = {**serializer.to_envelope(event).payload, "added_in_v2": 99}
    restored = serializer.from_payload(payload, ThingHappened)
    assert restored == event
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/infrastructure/event_bus/test_serializer.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the serializer**

`src/ursus/infrastructure/event_bus/serializer.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING, TypeVar

from adaptix import Retort

from ursus.application.common.events.integration_event import EventEnvelope

if TYPE_CHECKING:
    from ursus.application.common.events.integration_event import IntegrationEvent

EventT = TypeVar("EventT", bound="IntegrationEvent")


class IntegrationEventSerializer:
    def __init__(self) -> None:
        self._retort = Retort()

    def to_envelope(self, event: IntegrationEvent) -> EventEnvelope:
        return EventEnvelope(
            event_id=event.event_id,
            event_type=type(event).event_type,
            schema_version=type(event).schema_version,
            occurred_at=event.occurred_at,
            payload=self._retort.dump(event, type(event)),
        )

    def from_payload(
        self, payload: dict[str, object], event_cls: type[EventT]
    ) -> EventT:
        return self._retort.load(payload, event_cls)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/unit/infrastructure/event_bus/test_serializer.py -v`
Expected: all PASS. If adaptix raises on the unknown field, add
`from adaptix import ExtraSkip, name_mapping` and
`self._retort = Retort(recipe=[name_mapping(extra_in=ExtraSkip())])` — but the default
should already skip extras.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/infrastructure/event_bus/serializer.py tests/unit/infrastructure/event_bus
git commit -m "feat(event-bus): add adaptix integration-event serializer"
```

---

## Task 9: Translator protocol and integration-event registry

**Files:**
- Create: `src/ursus/infrastructure/mappers/registry.py`
- Test: `tests/unit/infrastructure/mappers/__init__.py`, `tests/unit/infrastructure/mappers/test_registry.py`

- [ ] **Step 1: Write the failing test**

Create empty `tests/unit/infrastructure/mappers/__init__.py`, then
`tests/unit/infrastructure/mappers/test_registry.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from ursus.application.common.events.integration_event import IntegrationEvent
from ursus.domain.common.domain_event import DomainEvent
from ursus.infrastructure.mappers.registry import IntegrationEventRegistry


@dataclass(frozen=True, kw_only=True)
class ThingDone(DomainEvent):
    thing_id: str


@dataclass(frozen=True, kw_only=True)
class ThingDoneIntegration(IntegrationEvent):
    event_type = "test.thing_done"
    schema_version = 1
    thing_id: str


def _translate(event: DomainEvent) -> IntegrationEvent:
    assert isinstance(event, ThingDone)
    return ThingDoneIntegration(
        event_id=event.event_id,
        occurred_at=event.occurred_at,
        thing_id=event.thing_id,
    )


def test_registered_event_is_translated() -> None:
    registry = IntegrationEventRegistry()
    registry.register(ThingDone, _translate)
    domain_event = ThingDone(thing_id="abc")
    result = registry.translate(domain_event)
    assert isinstance(result, ThingDoneIntegration)
    assert result.event_id == domain_event.event_id
    assert result.thing_id == "abc"


def test_unregistered_event_returns_none() -> None:
    registry = IntegrationEventRegistry()
    assert registry.translate(ThingDone(thing_id="abc")) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/infrastructure/mappers/test_registry.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the registry**

`src/ursus/infrastructure/mappers/registry.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from ursus.application.common.events.integration_event import IntegrationEvent
    from ursus.domain.common.domain_event import DomainEvent


class IntegrationEventTranslator(Protocol):
    def __call__(self, event: DomainEvent) -> IntegrationEvent: ...


class IntegrationEventRegistry:
    def __init__(self) -> None:
        self._translators: dict[type[DomainEvent], IntegrationEventTranslator] = {}

    def register(
        self,
        domain_event_type: type[DomainEvent],
        translator: IntegrationEventTranslator,
    ) -> None:
        self._translators[domain_event_type] = translator

    def translate(self, event: DomainEvent) -> IntegrationEvent | None:
        translator = self._translators.get(type(event))
        if translator is None:
            return None
        return translator(event)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/unit/infrastructure/mappers/test_registry.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/infrastructure/mappers/registry.py tests/unit/infrastructure/mappers
git commit -m "feat(mappers): add integration-event translator registry"
```

---

## Task 10: Application ports (UoW, OutboxStore, InboxStore, Publisher)

**Files:**
- Create: `src/ursus/application/common/ports/unit_of_work.py`
- Create: `src/ursus/application/common/ports/outbox.py`
- Create: `src/ursus/application/common/ports/inbox.py`
- Create: `src/ursus/application/common/ports/integration_event_publisher.py`
- Test: `tests/unit/application/common/ports/__init__.py`, `tests/unit/application/common/ports/test_ports.py`

- [ ] **Step 1: Write the failing test**

Create empty `tests/unit/application/common/ports/__init__.py`, then
`tests/unit/application/common/ports/test_ports.py`:

```python
from __future__ import annotations

import inspect

from ursus.application.common.ports.inbox import InboxStore
from ursus.application.common.ports.integration_event_publisher import (
    IntegrationEventPublisher,
)
from ursus.application.common.ports.outbox import OutboxStore
from ursus.application.common.ports.unit_of_work import UnitOfWork


def test_ports_are_abstract() -> None:
    for port in (UnitOfWork, OutboxStore, InboxStore, IntegrationEventPublisher):
        assert inspect.isabstract(port)


def test_unit_of_work_declares_track_commit_rollback() -> None:
    assert set(UnitOfWork.__abstractmethods__) == {"track", "commit", "rollback"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/unit/application/common/ports/test_ports.py -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the UnitOfWork port**

`src/ursus/application/common/ports/unit_of_work.py`:

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ursus.domain.common.aggregate_root import AggregateRoot


class UnitOfWork(ABC):
    @abstractmethod
    def track(self, aggregate: AggregateRoot) -> None: ...

    @abstractmethod
    async def commit(self) -> None: ...

    @abstractmethod
    async def rollback(self) -> None: ...
```

- [ ] **Step 4: Create the OutboxStore port**

`src/ursus/application/common/ports/outbox.py`:

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ursus.application.common.events.integration_event import EventEnvelope


class OutboxStore(ABC):
    @abstractmethod
    async def add(self, envelope: EventEnvelope) -> None: ...
```

- [ ] **Step 5: Create the InboxStore port**

`src/ursus/application/common/ports/inbox.py`:

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from uuid import UUID


class InboxStore(ABC):
    @abstractmethod
    async def seen(self, event_id: UUID) -> bool: ...

    @abstractmethod
    async def mark_processed(self, event_id: UUID) -> None: ...
```

- [ ] **Step 6: Create the IntegrationEventPublisher port (contract only)**

`src/ursus/application/common/ports/integration_event_publisher.py`:

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ursus.application.common.events.integration_event import EventEnvelope


class IntegrationEventPublisher(ABC):
    @abstractmethod
    async def publish(self, envelope: EventEnvelope) -> None: ...
```

- [ ] **Step 7: Run to verify it passes**

Run: `uv run pytest tests/unit/application/common/ports/test_ports.py -v`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ursus/application/common/ports tests/unit/application/common/ports
git commit -m "feat(application): add persistence and messaging ports"
```

---

## Task 11: SQLAlchemy outbox and inbox stores

**Files:**
- Modify: `.importlinter`
- Create: `src/ursus/infrastructure/persistence/outbox_store.py`
- Create: `src/ursus/infrastructure/persistence/inbox_store.py`
- Test: `tests/integration/infrastructure/persistence/test_stores.py`

- [ ] **Step 0: Allow `infrastructure.persistence` to import application ports**

The stores and the UoW (Task 12) live in `infrastructure.persistence` and implement
application ports. The `protected_application_ports` contract lists specific infrastructure
submodules as allowed importers but not `infrastructure.persistence`. In `.importlinter`, add
this line to the `allowed_importers` of the `protected_application_ports` contract (e.g. after
`ursus.infrastructure.persistence.models`):

```
    ursus.infrastructure.persistence
```

(`ursus.infrastructure.persistence` is a prefix that also covers `.persistence.models`, but
leave the existing `.models` line in place — it is harmless and explicit.) Do **not** loosen
any other contract.

- [ ] **Step 1: Write the failing test**

`tests/integration/infrastructure/persistence/test_stores.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import text

from ursus.application.common.events.integration_event import EventEnvelope
from ursus.infrastructure.persistence.inbox_store import SqlAlchemyInboxStore
from ursus.infrastructure.persistence.outbox_store import SqlAlchemyOutboxStore

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def test_outbox_store_persists_envelope(session: AsyncSession) -> None:
    store = SqlAlchemyOutboxStore(session)
    event_id = uuid4()
    await store.add(
        EventEnvelope(
            event_id=event_id,
            event_type="test.thing",
            schema_version=1,
            occurred_at=datetime.now(UTC),
            payload={"thing_id": "abc"},
        ),
    )
    await session.flush()
    row = await session.execute(
        text("SELECT event_type, payload FROM messaging.outbox WHERE event_id = :id"),
        {"id": event_id},
    )
    event_type, payload = row.one()
    assert event_type == "test.thing"
    assert payload == {"thing_id": "abc"}


async def test_inbox_store_tracks_processed_ids(session: AsyncSession) -> None:
    store = SqlAlchemyInboxStore(session)
    event_id = uuid4()
    assert await store.seen(event_id) is False
    await store.mark_processed(event_id)
    await session.flush()
    assert await store.seen(event_id) is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/integration/infrastructure/persistence/test_stores.py -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the outbox store**

`src/ursus/infrastructure/persistence/outbox_store.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from ursus.application.common.ports.outbox import OutboxStore
from ursus.infrastructure.persistence.models.common.outbox import OutboxMessage

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from ursus.application.common.events.integration_event import EventEnvelope


class SqlAlchemyOutboxStore(OutboxStore):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, envelope: EventEnvelope) -> None:
        self._session.add(
            OutboxMessage(
                event_id=envelope.event_id,
                event_type=envelope.event_type,
                schema_version=envelope.schema_version,
                occurred_at=envelope.occurred_at,
                payload=envelope.payload,
            ),
        )
```

- [ ] **Step 4: Create the inbox store**

`src/ursus/infrastructure/persistence/inbox_store.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from ursus.application.common.ports.inbox import InboxStore
from ursus.infrastructure.persistence.models.common.inbox import InboxMessage

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


class SqlAlchemyInboxStore(InboxStore):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def seen(self, event_id: UUID) -> bool:
        result = await self._session.execute(
            select(InboxMessage.event_id).where(InboxMessage.event_id == event_id),
        )
        return result.first() is not None

    async def mark_processed(self, event_id: UUID) -> None:
        self._session.add(InboxMessage(event_id=event_id))
```

- [ ] **Step 5: Run to verify it passes**

Run: `uv run pytest tests/integration/infrastructure/persistence/test_stores.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add .importlinter src/ursus/infrastructure/persistence/outbox_store.py src/ursus/infrastructure/persistence/inbox_store.py tests/integration/infrastructure/persistence/test_stores.py
git commit -m "feat(persistence): add sqlalchemy outbox and inbox stores"
```

---

## Task 12: SqlAlchemyUnitOfWork (collect → translate → serialize → outbox)

The UoW is the heart of the Postgres path (spec §B.1): it tracks aggregates, and on commit
drains their domain events through the registry + serializer into the outbox, then commits the
SQLAlchemy transaction — aggregate state and outbox rows in one transaction.

**Files:**
- Create: `src/ursus/infrastructure/persistence/unit_of_work.py`
- Test: `tests/integration/infrastructure/persistence/test_unit_of_work.py`

- [ ] **Step 1: Write the failing test**

`tests/integration/infrastructure/persistence/test_unit_of_work.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import text

from ursus.application.common.events.integration_event import IntegrationEvent
from ursus.domain.common.aggregate_root import AggregateRoot
from ursus.domain.common.domain_event import DomainEvent
from ursus.domain.common.entity_id import EntityId
from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer
from ursus.infrastructure.mappers.registry import IntegrationEventRegistry
from ursus.infrastructure.persistence.outbox_store import SqlAlchemyOutboxStore
from ursus.infrastructure.persistence.unit_of_work import SqlAlchemyUnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True, kw_only=True)
class ThingDone(DomainEvent):
    label: str


@dataclass(frozen=True, kw_only=True)
class ThingDoneIntegration(IntegrationEvent):
    event_type = "test.thing_done"
    schema_version = 1
    label: str


def _translate(event: DomainEvent) -> IntegrationEvent:
    assert isinstance(event, ThingDone)
    return ThingDoneIntegration(
        event_id=event.event_id, occurred_at=event.occurred_at, label=event.label
    )


class _Thing(AggregateRoot):
    pass


def _build_uow(session: AsyncSession) -> SqlAlchemyUnitOfWork:
    registry = IntegrationEventRegistry()
    registry.register(ThingDone, _translate)
    return SqlAlchemyUnitOfWork(
        session=session,
        outbox=SqlAlchemyOutboxStore(session),
        registry=registry,
        serializer=IntegrationEventSerializer(),
    )


async def test_commit_drains_domain_events_into_outbox(session: AsyncSession) -> None:
    uow = _build_uow(session)
    thing = _Thing(EntityId.generate())
    event = ThingDone(label="hello")
    thing.record_event(event)

    uow.track(thing)
    await uow.commit()

    row = await session.execute(
        text(
            "SELECT event_type, schema_version, payload "
            "FROM messaging.outbox WHERE event_id = :id"
        ),
        {"id": event.event_id},
    )
    event_type, schema_version, payload = row.one()
    assert event_type == "test.thing_done"
    assert schema_version == 1
    assert payload["label"] == "hello"
    assert thing.collect_events() == []  # events were drained


async def test_commit_skips_unregistered_events(session: AsyncSession) -> None:
    uow = _build_uow(session)
    thing = _Thing(EntityId.generate())
    thing.record_event(DomainEvent())  # not registered → no outbox row

    uow.track(thing)
    await uow.commit()

    count = await session.execute(text("SELECT count(*) FROM messaging.outbox"))
    assert count.scalar_one() == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/integration/infrastructure/persistence/test_unit_of_work.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the Unit of Work**

`src/ursus/infrastructure/persistence/unit_of_work.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from ursus.application.common.ports.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from ursus.application.common.ports.outbox import OutboxStore
    from ursus.domain.common.aggregate_root import AggregateRoot
    from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer
    from ursus.infrastructure.mappers.registry import IntegrationEventRegistry


class SqlAlchemyUnitOfWork(UnitOfWork):
    def __init__(
        self,
        session: AsyncSession,
        outbox: OutboxStore,
        registry: IntegrationEventRegistry,
        serializer: IntegrationEventSerializer,
    ) -> None:
        self._session = session
        self._outbox = outbox
        self._registry = registry
        self._serializer = serializer
        self._tracked: list[AggregateRoot] = []

    def track(self, aggregate: AggregateRoot) -> None:
        self._tracked.append(aggregate)

    async def commit(self) -> None:
        await self._drain_events()
        await self._session.commit()
        self._tracked.clear()

    async def rollback(self) -> None:
        await self._session.rollback()
        self._tracked.clear()

    async def _drain_events(self) -> None:
        for aggregate in self._tracked:
            for domain_event in aggregate.collect_events():
                integration_event = self._registry.translate(domain_event)
                if integration_event is None:
                    continue
                envelope = self._serializer.to_envelope(integration_event)
                await self._outbox.add(envelope)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/integration/infrastructure/persistence/test_unit_of_work.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/infrastructure/persistence/unit_of_work.py tests/integration/infrastructure/persistence/test_unit_of_work.py
git commit -m "feat(persistence): add sqlalchemy unit of work draining events to outbox"
```

---

## Task 13: Wire the persistence providers into dishka

**Files:**
- Modify: `src/ursus/setup/ioc.py`
- Test: `tests/integration/setup/test_persistence_provider.py`

- [ ] **Step 1: Write the failing test**

`tests/integration/setup/test_persistence_provider.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/integration/setup/test_persistence_provider.py -v`
Expected: FAIL — `UnitOfWork` cannot be resolved from the container.

- [ ] **Step 3: Add the PersistenceProvider**

Replace the contents of `src/ursus/setup/ioc.py` with:

```python
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from dishka import Provider, Scope, make_async_container, provide
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from ursus.application.common.ports.inbox import InboxStore
from ursus.application.common.ports.outbox import OutboxStore
from ursus.application.common.ports.unit_of_work import UnitOfWork
from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer
from ursus.infrastructure.mappers.registry import IntegrationEventRegistry
from ursus.infrastructure.persistence.engine import (
    create_engine,
    create_session_factory,
)
from ursus.infrastructure.persistence.inbox_store import SqlAlchemyInboxStore
from ursus.infrastructure.persistence.outbox_store import SqlAlchemyOutboxStore
from ursus.infrastructure.persistence.unit_of_work import SqlAlchemyUnitOfWork
from ursus.setup.settings import AppSettings

if TYPE_CHECKING:
    from dishka import AsyncContainer

# NOTE: the SQLAlchemy async types and the ports are imported at runtime (not under
# TYPE_CHECKING) because dishka resolves provider signatures via `get_type_hints` at
# container-build time. The `runtime-evaluated-decorators = ["dishka.provide"]` ruff setting
# (added in Task 3) keeps ruff's TC rules from moving them under TYPE_CHECKING.


class AppProvider(Provider):
    @provide(scope=Scope.APP)
    def provide_settings(self) -> AppSettings:
        return AppSettings.from_env()


class PersistenceProvider(Provider):
    @provide(scope=Scope.APP)
    def provide_engine(self, settings: AppSettings) -> AsyncEngine:
        return create_engine(settings.postgres_dsn)

    @provide(scope=Scope.APP)
    def provide_session_factory(
        self, engine: AsyncEngine
    ) -> async_sessionmaker[AsyncSession]:
        return create_session_factory(engine)

    @provide(scope=Scope.APP)
    def provide_registry(self) -> IntegrationEventRegistry:
        return IntegrationEventRegistry()

    @provide(scope=Scope.APP)
    def provide_serializer(self) -> IntegrationEventSerializer:
        return IntegrationEventSerializer()

    @provide(scope=Scope.REQUEST)
    async def provide_session(
        self, factory: async_sessionmaker[AsyncSession]
    ) -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    @provide(scope=Scope.REQUEST)
    def provide_outbox(self, session: AsyncSession) -> OutboxStore:
        return SqlAlchemyOutboxStore(session)

    @provide(scope=Scope.REQUEST)
    def provide_inbox(self, session: AsyncSession) -> InboxStore:
        return SqlAlchemyInboxStore(session)

    @provide(scope=Scope.REQUEST)
    def provide_uow(
        self,
        session: AsyncSession,
        outbox: OutboxStore,
        registry: IntegrationEventRegistry,
        serializer: IntegrationEventSerializer,
    ) -> UnitOfWork:
        return SqlAlchemyUnitOfWork(
            session=session,
            outbox=outbox,
            registry=registry,
            serializer=serializer,
        )


def build_container() -> AsyncContainer:
    return make_async_container(AppProvider(), PersistenceProvider())
```

Note: both `provide_uow` and `SqlAlchemyUnitOfWork.__init__` type the dependency as the
`OutboxStore` **port** (not the concrete class), so this is type-correct. dishka provides the
same REQUEST-scoped `SqlAlchemyOutboxStore` instance for both the `OutboxStore` injection and
the session it wraps, so the UoW and outbox share one session/transaction.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/integration/setup/test_persistence_provider.py tests/integration/setup/test_ioc.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/setup/ioc.py tests/integration/setup/test_persistence_provider.py
git commit -m "feat(setup): wire persistence and event providers into dishka"
```

---

## Task 14: Full quality gate

**Files:**
- Modify (if needed): `.importlinter`

- [ ] **Step 1: Run ruff format check**

Run: `uv run ruff format --check .`
Expected: clean. If it reports files, run `uv run ruff format .` and re-commit.

- [ ] **Step 2: Run ruff lint**

Run: `uv run ruff check .`
Expected: clean (project-wide; `migrations/` excluded).

- [ ] **Step 3: Run mypy**

Run: `uv run mypy`
Expected: 0 issues (strict; `migrations/` excluded).

- [ ] **Step 4: Run import-linter**

Run: `uv run lint-imports`
Expected: all contracts kept (the only contract change is the `infrastructure.persistence`
allowance added in Task 11 Step 0). The new modules respect the layered contract:
`application.common.events` is imported by `infrastructure.event_bus`, `infrastructure.mappers`,
and `application.common.ports` — all legal (application→application and infrastructure→application).
If any *other* contract violation appears, STOP and report it rather than relaxing a contract.

- [ ] **Step 5: Run the full test suite**

Run: `uv run pytest`
Expected: all green (unit + integration). Integration tests require Docker.

- [ ] **Step 6: Final commit (only if Steps 1–3 changed files)**

```bash
git add -A
git commit -m "chore(persistence): pass full quality gate (ruff, mypy, import-linter, pytest)"
```

---

## Self-Review notes (already folded into the plan)

- **Spec §A/E1–E2** (domain≠integration + registry in infra): Tasks 7, 9, 12.
- **Spec §A/E3+E5** (schema_version + adaptix tolerant reader): Tasks 7, 8.
- **Spec §B.1** (Postgres transactional outbox via UoW, stable event_id persisted in row):
  Tasks 3, 11, 12. The integration event_id is carried from the domain event and stored as the
  outbox PK — stable across retries.
- **Spec §B.3** (idempotent inbox keyed by event_id): Tasks 3, 11.
- **Spec §C** (ports): Task 10; `IntegrationEventPublisher` is contract-only (no impl — Plan 3).
- **Spec §D** (Alembic = Postgres contexts only; one history, schema-addressed, service schema
  for `alembic_version`): Tasks 5, 6. `include_schemas=True`; `alembic_version` stays in the
  default `public` schema (the service schema) — it must NOT live in `messaging`, because that
  schema is created by the first migration itself (a bootstrap chicken-and-egg).
- **Spec §B.2** (Metrics deterministic-id path): intentionally NOT built here — Metrics is DuckDB
  and belongs to its slice (Plan 5). The inbox PK is a `UUID`, which also accepts a deterministic
  UUID5, so the inbox already serves that future path.
- **Spec §F** (Plan 2 vs Plan 3 boundary): RabbitMQ exchange/routing/publisher impl and the
  outbox relay are NOT in this plan.
- **Deferred (YAGNI):** DuckDB / Elasticsearch / MinIO clients — built when their context needs them.
```
