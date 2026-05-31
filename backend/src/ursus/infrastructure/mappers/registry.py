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
