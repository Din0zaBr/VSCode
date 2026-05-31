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
# container-build time. The `runtime-evaluated-decorators = ["dishka.provide"]` ruff
# setting (added in Task 3) keeps ruff's TC rules from moving them under TYPE_CHECKING.


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
