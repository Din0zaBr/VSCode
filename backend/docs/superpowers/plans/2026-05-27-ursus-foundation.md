# URSUS Foundation & Architecture Guardrails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable, fully-typed URSUS skeleton whose architecture boundaries are enforced by import-linter and whose toolchain (ruff, mypy, pytest) runs green — the foundation every later plan builds on.

**Architecture:** Layer-first Clean Architecture (`domain → application → infrastructure → presentation`) with bounded-context subpackages (`operator`, `observed_entity`, `incident`, `metrics`) inside each layer, three runnable apps (`http_app`, `consumer_app`, `scheduler_app`), and a `setup` composition root using dishka. This plan delivers the package tree, the `domain/common` base classes (TDD), env-based settings, a dishka container, a `/health` endpoint, and import-linter contracts (existing + new context-independence).

**Tech Stack:** Python 3.13, FastAPI, dishka, structlog, pytest + pytest-asyncio + httpx + asgi-lifespan, ruff, mypy, import-linter, uv.

---

## Environment notes (read once)

- **Git root is the parent workspace** `C:\Users\ivanz\VSCode` (not `backend/`). Run all
  commands from `C:\Users\ivanz\VSCode\backend`; `git add <relative path>` resolves correctly
  from there. Work happens on branch `feat/ursus-module-skeleton`.
- All commands are prefixed with `uv run` so they use the project venv.
- Conventional Commits. End every commit message with the trailer
  `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- ruff is configured with `select = ["ALL"]`; all code below is written to pass it. mypy is
  `strict = true`; everything is fully annotated.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/ursus/__init__.py` | Package marker; exposes `__version__` |
| `src/ursus/domain/common/entity_id.py` | `EntityId` value object (UUID identity base) |
| `src/ursus/domain/common/value_object.py` | `ValueObject` marker base |
| `src/ursus/domain/common/entity.py` | `Entity` base (identity equality) |
| `src/ursus/domain/common/domain_event.py` | `DomainEvent` base (id + timestamp) |
| `src/ursus/domain/common/aggregate_root.py` | `AggregateRoot` base (records domain events) |
| `src/ursus/setup/settings.py` | `AppSettings` loaded from env |
| `src/ursus/setup/ioc.py` | dishka `AppProvider` + `build_container()` |
| `src/ursus/presentation/common/healthcheck.py` | `/health` router |
| `src/ursus/http_app.py` | FastAPI app factory `create_app()` |
| `src/ursus/consumer_app.py`, `src/ursus/scheduler_app.py` | entrypoint stubs (filled in later plans) |
| `.importlinter` | + six context-independence contracts |
| `ruff.toml` | package name fixed `analysis_runner_service` → `ursus`; `A003` ignored |

---

## Task 1: Make `ursus` importable and sync the environment

**Files:**
- Create: `src/ursus/__init__.py`

- [ ] **Step 1: Create the package marker**

```python
# src/ursus/__init__.py
from ursus._version import __version__

__all__ = ["__version__"]
```

- [ ] **Step 2: Sync the environment (installs deps + the project editable)**

Run: `uv sync`
Expected: completes without error; `ursus` installed into `.venv`.

- [ ] **Step 3: Verify the package imports**

Run: `uv run python -c "import ursus; print(ursus.__version__)"`
Expected: prints a version string (e.g. `0.1.dev...`), no traceback.

- [ ] **Step 4: Commit**

```bash
git add src/ursus/__init__.py
git commit -m "build(ursus): add package __init__ exposing version"
```

---

## Task 2: Scaffold the full package tree + entrypoint stubs + tests skeleton

This creates every package referenced by `.importlinter` and the spec so the tree is
importable and contracts have real targets. All `__init__.py` files are empty.

**Files:** many `__init__.py` (see script); `src/ursus/http_app.py`, `src/ursus/consumer_app.py`, `src/ursus/scheduler_app.py` (stubs).

- [ ] **Step 1: Create packages and stubs (PowerShell)**

```powershell
$pkgs = @(
  "domain","domain\common","domain\operator","domain\observed_entity","domain\incident","domain\metrics",
  "application","application\common","application\common\ports",
  "application\commands","application\commands\operator","application\commands\observed_entity","application\commands\incident","application\commands\metrics",
  "application\queries","application\queries\operator","application\queries\observed_entity","application\queries\incident","application\queries\metrics",
  "infrastructure","infrastructure\adapters","infrastructure\adapters\operator","infrastructure\adapters\observed_entity","infrastructure\adapters\incident","infrastructure\adapters\metrics",
  "infrastructure\event_bus","infrastructure\mappers",
  "infrastructure\persistence","infrastructure\persistence\models","infrastructure\persistence\models\operator","infrastructure\persistence\models\observed_entity","infrastructure\persistence\models\incident","infrastructure\persistence\models\metrics",
  "infrastructure\run_lifecycle",
  "presentation","presentation\common","presentation\operator","presentation\observed_entity","presentation\incident","presentation\metrics",
  "setup"
)
foreach ($p in $pkgs) {
  $dir = "src\ursus\$p"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $init = Join-Path $dir "__init__.py"
  if (-not (Test-Path $init)) { New-Item -ItemType File -Path $init | Out-Null }
}
# Entrypoint stubs (http_app is replaced in Task 12)
foreach ($m in @("http_app","consumer_app","scheduler_app")) {
  $f = "src\ursus\$m.py"
  if (-not (Test-Path $f)) { Set-Content -Path $f -Value "# entrypoint placeholder; implemented in a later plan" -Encoding utf8 }
}
# Tests skeleton
$testdirs = @("tests","tests\unit","tests\unit\domain","tests\unit\domain\common","tests\unit\setup","tests\integration","tests\integration\setup","tests\integration\presentation")
foreach ($t in $testdirs) {
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  $init = Join-Path $t "__init__.py"
  if (-not (Test-Path $init)) { New-Item -ItemType File -Path $init | Out-Null }
}
```

- [ ] **Step 2: Verify the whole tree imports**

Run:
```bash
uv run python -c "import ursus.application.commands, ursus.application.queries, ursus.application.common.ports, ursus.infrastructure.adapters, ursus.infrastructure.persistence.models, ursus.infrastructure.run_lifecycle, ursus.infrastructure.event_bus, ursus.http_app, ursus.consumer_app, ursus.scheduler_app, ursus.presentation.common"
```
Expected: no output, no traceback.

- [ ] **Step 3: Commit**

```bash
git add src/ursus tests
git commit -m "build(ursus): scaffold layer/context package tree and entrypoint stubs"
```

---

## Task 3: Fix `ruff.toml` to target `ursus`

**Files:**
- Modify: `ruff.toml`

- [ ] **Step 1: Replace the stale `include`/`exclude` paths**

In `ruff.toml`, replace the `include` and `exclude` blocks with:

```toml
include = [
    "src/ursus/**/*.py",
    "tests/**/*.py",
    "pyproject.toml",
]

exclude = [
    "src/ursus/_version.py",
    "src/ursus/infrastructure/persistence/migrations/versions",
    "scripts",
]
```

- [ ] **Step 2: Add `A003` to the global `ignore` list**

In the `[lint]` `ignore = [...]` array, add the line `"A003",` (allows domain entities to
expose an `id` attribute that shadows the builtin). Keep all existing entries.

- [ ] **Step 3: Verify ruff runs and is clean on the current tree**

Run: `uv run ruff check .`
Expected: `All checks passed!` (the empty `__init__.py` and comment-only stubs are clean).

- [ ] **Step 4: Commit**

```bash
git add ruff.toml
git commit -m "build(ruff): target ursus package and allow id attribute (A003)"
```

---

## Task 4: Add bounded-context independence contracts

**Files:**
- Modify: `.importlinter`

- [ ] **Step 1: Append six independence contracts**

Append the following to the end of `.importlinter` (existing contracts are unchanged):

```ini
[importlinter:contract:independence_domain_contexts]
name = Domain contexts are mutually independent
type = independence
modules =
    ursus.domain.operator
    ursus.domain.observed_entity
    ursus.domain.incident
    ursus.domain.metrics


[importlinter:contract:independence_command_contexts]
name = Command contexts are mutually independent
type = independence
modules =
    ursus.application.commands.operator
    ursus.application.commands.observed_entity
    ursus.application.commands.incident
    ursus.application.commands.metrics


[importlinter:contract:independence_query_contexts]
name = Query contexts are mutually independent
type = independence
modules =
    ursus.application.queries.operator
    ursus.application.queries.observed_entity
    ursus.application.queries.incident
    ursus.application.queries.metrics


[importlinter:contract:independence_adapter_contexts]
name = Infrastructure adapter contexts are mutually independent
type = independence
modules =
    ursus.infrastructure.adapters.operator
    ursus.infrastructure.adapters.observed_entity
    ursus.infrastructure.adapters.incident
    ursus.infrastructure.adapters.metrics


[importlinter:contract:independence_persistence_model_contexts]
name = Persistence model contexts are mutually independent
type = independence
modules =
    ursus.infrastructure.persistence.models.operator
    ursus.infrastructure.persistence.models.observed_entity
    ursus.infrastructure.persistence.models.incident
    ursus.infrastructure.persistence.models.metrics


[importlinter:contract:independence_presentation_contexts]
name = Presentation contexts are mutually independent
type = independence
modules =
    ursus.presentation.operator
    ursus.presentation.observed_entity
    ursus.presentation.incident
    ursus.presentation.metrics
```

- [ ] **Step 2: Verify all contracts pass**

Run: `uv run lint-imports`
Expected: `Contracts: N kept, 0 broken.` (all existing + the six new contracts kept).

- [ ] **Step 3: Commit**

```bash
git add .importlinter
git commit -m "build(import-linter): enforce bounded-context independence per layer"
```

---

## Task 5: `EntityId` value object (TDD)

**Files:**
- Test: `tests/unit/domain/common/test_entity_id.py`
- Create: `src/ursus/domain/common/entity_id.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/common/test_entity_id.py
from __future__ import annotations

from uuid import UUID, uuid4

from ursus.domain.common.entity_id import EntityId


def test_entity_ids_with_same_value_are_equal() -> None:
    # Arrange
    value = uuid4()
    # Act / Assert
    assert EntityId(value) == EntityId(value)


def test_entity_ids_with_different_values_are_not_equal() -> None:
    assert EntityId(uuid4()) != EntityId(uuid4())


def test_generate_produces_unique_ids() -> None:
    assert EntityId.generate() != EntityId.generate()


def test_str_returns_the_uuid_string() -> None:
    value = uuid4()
    assert str(EntityId(value)) == str(value)


def test_value_is_a_uuid() -> None:
    assert isinstance(EntityId.generate().value, UUID)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/common/test_entity_id.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.domain.common.entity_id'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/ursus/domain/common/entity_id.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Self
from uuid import UUID, uuid4


@dataclass(frozen=True, slots=True)
class EntityId:
    value: UUID

    @classmethod
    def generate(cls) -> Self:
        return cls(uuid4())

    def __str__(self) -> str:
        return str(self.value)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/common/test_entity_id.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/domain/common/entity_id.py tests/unit/domain/common/test_entity_id.py
git commit -m "feat(domain): add EntityId value object"
```

---

## Task 6: `ValueObject` base (TDD)

**Files:**
- Test: `tests/unit/domain/common/test_value_object.py`
- Create: `src/ursus/domain/common/value_object.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/common/test_value_object.py
from __future__ import annotations

from dataclasses import FrozenInstanceError, dataclass

import pytest

from ursus.domain.common.value_object import ValueObject


@dataclass(frozen=True)
class _Money(ValueObject):
    amount: int
    currency: str


def test_value_objects_are_equal_by_value() -> None:
    assert _Money(100, "USD") == _Money(100, "USD")


def test_value_objects_differ_when_fields_differ() -> None:
    assert _Money(100, "USD") != _Money(100, "EUR")


def test_value_objects_are_immutable() -> None:
    money = _Money(100, "USD")
    with pytest.raises(FrozenInstanceError):
        money.amount = 200  # type: ignore[misc]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/common/test_value_object.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.domain.common.value_object'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/ursus/domain/common/value_object.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ValueObject:
    """Marker base for value objects. Subclasses must be frozen dataclasses."""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/common/test_value_object.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/domain/common/value_object.py tests/unit/domain/common/test_value_object.py
git commit -m "feat(domain): add ValueObject base"
```

---

## Task 7: `Entity` base (TDD)

**Files:**
- Test: `tests/unit/domain/common/test_entity.py`
- Create: `src/ursus/domain/common/entity.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/common/test_entity.py
from __future__ import annotations

from ursus.domain.common.entity import Entity
from ursus.domain.common.entity_id import EntityId


class _Operator(Entity):
    pass


class _Incident(Entity):
    pass


def test_entities_with_same_id_and_type_are_equal() -> None:
    entity_id = EntityId.generate()
    assert _Operator(entity_id) == _Operator(entity_id)


def test_entities_with_different_ids_are_not_equal() -> None:
    assert _Operator(EntityId.generate()) != _Operator(EntityId.generate())


def test_entities_of_different_types_with_same_id_are_not_equal() -> None:
    entity_id = EntityId.generate()
    assert _Operator(entity_id) != _Incident(entity_id)


def test_entity_is_hashable_by_id_and_type() -> None:
    entity_id = EntityId.generate()
    assert hash(_Operator(entity_id)) == hash(_Operator(entity_id))


def test_id_property_returns_the_identity() -> None:
    entity_id = EntityId.generate()
    assert _Operator(entity_id).id == entity_id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/common/test_entity.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.domain.common.entity'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/ursus/domain/common/entity.py
from __future__ import annotations

from ursus.domain.common.entity_id import EntityId


class Entity:
    def __init__(self, entity_id: EntityId) -> None:
        self._id = entity_id

    @property
    def id(self) -> EntityId:
        return self._id

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Entity):
            return NotImplemented
        return type(self) is type(other) and self._id == other._id

    def __hash__(self) -> int:
        return hash((type(self), self._id))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/common/test_entity.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/domain/common/entity.py tests/unit/domain/common/test_entity.py
git commit -m "feat(domain): add Entity base with identity equality"
```

---

## Task 8: `DomainEvent` base (TDD)

**Files:**
- Test: `tests/unit/domain/common/test_domain_event.py`
- Create: `src/ursus/domain/common/domain_event.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/common/test_domain_event.py
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from ursus.domain.common.domain_event import DomainEvent


def test_event_has_a_uuid_and_aware_timestamp() -> None:
    event = DomainEvent()
    assert isinstance(event.event_id, UUID)
    assert event.occurred_at.tzinfo is not None


def test_distinct_events_have_distinct_ids() -> None:
    assert DomainEvent().event_id != DomainEvent().event_id


def test_subclasses_can_add_payload_fields() -> None:
    @dataclass(frozen=True)
    class _ThingHappened(DomainEvent):
        thing_id: str

    event = _ThingHappened(thing_id="abc")
    assert event.thing_id == "abc"
    assert isinstance(event.event_id, UUID)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/common/test_domain_event.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.domain.common.domain_event'`.

- [ ] **Step 3: Write minimal implementation**

`kw_only=True` makes the base fields keyword-only so subclasses can add their own
positional payload fields without the dataclass default-ordering error.

```python
# src/ursus/domain/common/domain_event.py
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID, uuid4


@dataclass(frozen=True, kw_only=True)
class DomainEvent:
    event_id: UUID = field(default_factory=uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/common/test_domain_event.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/domain/common/domain_event.py tests/unit/domain/common/test_domain_event.py
git commit -m "feat(domain): add DomainEvent base"
```

---

## Task 9: `AggregateRoot` base (TDD)

**Files:**
- Test: `tests/unit/domain/common/test_aggregate_root.py`
- Create: `src/ursus/domain/common/aggregate_root.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/common/test_aggregate_root.py
from __future__ import annotations

from ursus.domain.common.aggregate_root import AggregateRoot
from ursus.domain.common.domain_event import DomainEvent
from ursus.domain.common.entity_id import EntityId


def test_records_and_collects_events_in_order() -> None:
    aggregate = AggregateRoot(EntityId.generate())
    first = DomainEvent()
    second = DomainEvent()
    aggregate.record_event(first)
    aggregate.record_event(second)
    assert aggregate.collect_events() == [first, second]


def test_collect_clears_recorded_events() -> None:
    aggregate = AggregateRoot(EntityId.generate())
    aggregate.record_event(DomainEvent())
    aggregate.collect_events()
    assert aggregate.collect_events() == []


def test_aggregate_root_is_an_entity() -> None:
    entity_id = EntityId.generate()
    assert AggregateRoot(entity_id).id == entity_id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/common/test_aggregate_root.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.domain.common.aggregate_root'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/ursus/domain/common/aggregate_root.py
from __future__ import annotations

from ursus.domain.common.domain_event import DomainEvent
from ursus.domain.common.entity import Entity
from ursus.domain.common.entity_id import EntityId


class AggregateRoot(Entity):
    def __init__(self, entity_id: EntityId) -> None:
        super().__init__(entity_id)
        self._domain_events: list[DomainEvent] = []

    def record_event(self, event: DomainEvent) -> None:
        self._domain_events.append(event)

    def collect_events(self) -> list[DomainEvent]:
        events = list(self._domain_events)
        self._domain_events.clear()
        return events
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/common/test_aggregate_root.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/domain/common/aggregate_root.py tests/unit/domain/common/test_aggregate_root.py
git commit -m "feat(domain): add AggregateRoot base that records domain events"
```

---

## Task 10: `AppSettings` from environment (TDD)

**Files:**
- Test: `tests/unit/setup/test_settings.py`
- Create: `src/ursus/setup/settings.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/setup/test_settings.py
from __future__ import annotations

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/setup/test_settings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.setup.settings'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/ursus/setup/settings.py
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Self


@dataclass(frozen=True, slots=True)
class AppSettings:
    environment: str
    debug: bool

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            environment=os.environ.get("URSUS_ENV", "local"),
            debug=os.environ.get("URSUS_DEBUG", "false").lower() == "true",
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/setup/test_settings.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/setup/settings.py tests/unit/setup/test_settings.py
git commit -m "feat(setup): add env-based AppSettings"
```

---

## Task 11: dishka container (TDD)

**Files:**
- Test: `tests/integration/setup/test_ioc.py`
- Create: `src/ursus/setup/ioc.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/setup/test_ioc.py
from __future__ import annotations

from ursus.setup.ioc import build_container
from ursus.setup.settings import AppSettings


async def test_container_provides_settings() -> None:
    container = build_container()
    try:
        settings = await container.get(AppSettings)
        assert isinstance(settings, AppSettings)
    finally:
        await container.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/integration/setup/test_ioc.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ursus.setup.ioc'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/ursus/setup/ioc.py
from __future__ import annotations

from dishka import AsyncContainer, Provider, Scope, make_async_container, provide

from ursus.setup.settings import AppSettings


class AppProvider(Provider):
    @provide(scope=Scope.APP)
    def provide_settings(self) -> AppSettings:
        return AppSettings.from_env()


def build_container() -> AsyncContainer:
    return make_async_container(AppProvider())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/integration/setup/test_ioc.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ursus/setup/ioc.py tests/integration/setup/test_ioc.py
git commit -m "feat(setup): add dishka container with settings provider"
```

---

## Task 12: `/health` endpoint and FastAPI app factory (TDD)

**Files:**
- Test: `tests/integration/presentation/test_healthcheck.py`
- Create: `src/ursus/presentation/common/healthcheck.py`
- Modify: `src/ursus/http_app.py` (replace the Task 2 stub)

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/presentation/test_healthcheck.py
from __future__ import annotations

import httpx
from asgi_lifespan import LifespanManager

from ursus.http_app import create_app


async def test_health_returns_ok() -> None:
    app = create_app()
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/integration/presentation/test_healthcheck.py -v`
Expected: FAIL — `ImportError`/`AttributeError`: `create_app` not defined in `ursus.http_app`
(the Task 2 stub has no `create_app`).

- [ ] **Step 3: Write the health router**

```python
# src/ursus/presentation/common/healthcheck.py
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Replace the `http_app.py` stub with the app factory**

```python
# src/ursus/http_app.py
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI

from ursus.presentation.common.healthcheck import router as health_router
from ursus.setup.ioc import build_container


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await app.state.dishka_container.close()


def create_app() -> FastAPI:
    app = FastAPI(title="URSUS", lifespan=_lifespan)
    app.include_router(health_router)
    setup_dishka(build_container(), app)
    return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/integration/presentation/test_healthcheck.py -v`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add src/ursus/http_app.py src/ursus/presentation/common/healthcheck.py tests/integration/presentation/test_healthcheck.py
git commit -m "feat(presentation): add /health endpoint and FastAPI app factory"
```

---

## Task 13: Full quality gate green

Confirms the whole foundation passes every tool together. No new code unless a check fails.

- [ ] **Step 1: Format check**

Run: `uv run ruff format --check .`
Expected: all files already formatted. If it reports changes, run `uv run ruff format .`,
review, and include in the final commit.

- [ ] **Step 2: Lint**

Run: `uv run ruff check .`
Expected: `All checks passed!`

- [ ] **Step 3: Type check**

Run: `uv run mypy`
Expected: `Success: no issues found`. (If `app.state.dishka_container` raises
`attr-defined`, append `# type: ignore[attr-defined]` on that line in `http_app.py` only.)

- [ ] **Step 4: Architecture contracts**

Run: `uv run lint-imports`
Expected: all contracts kept, 0 broken.

- [ ] **Step 5: Full test suite**

Run: `uv run pytest`
Expected: all tests pass (domain unit tests + settings + ioc + health).

- [ ] **Step 6: Commit any formatting/type-ignore fixups**

```bash
git add -A
git commit -m "chore(ursus): pass full quality gate (ruff, mypy, import-linter, pytest)"
```
(If steps 1–5 required no changes, skip this commit.)

---

## Self-Review (completed during authoring)

- **Spec coverage:** Implements spec §B structure (tree, three apps), §B import-linter
  (existing layered/protected contracts now runnable + new independence contracts), and the
  §E `domain/common` base classes. Persistence kernel (§C), messaging (§C), auth (§D), and the
  walking skeleton (§F) are explicitly out of scope — they are Plans 2–5.
- **Placeholder scan:** No TBD/TODO; `consumer_app`/`scheduler_app` are intentional, named
  stubs filled by later plans (called out in the File Structure table), not placeholders.
- **Type consistency:** `EntityId.generate`, `Entity.id`, `AggregateRoot.record_event` /
  `collect_events`, `AppSettings.from_env`, `build_container`, `create_app` are referenced with
  identical signatures across tasks.
