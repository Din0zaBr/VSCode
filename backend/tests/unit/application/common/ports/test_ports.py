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
