from __future__ import annotations

from typing import TYPE_CHECKING

from dishka import Provider, Scope, make_async_container, provide

from ursus.setup.settings import AppSettings

if TYPE_CHECKING:
    from dishka import AsyncContainer


class AppProvider(Provider):
    @provide(scope=Scope.APP)
    def provide_settings(self) -> AppSettings:
        return AppSettings.from_env()


def build_container() -> AsyncContainer:
    return make_async_container(AppProvider())
