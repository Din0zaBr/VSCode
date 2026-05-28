from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI

from ursus.presentation.common.healthcheck import router as health_router
from ursus.setup.ioc import build_container

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await app.state.dishka_container.close()


def create_app() -> FastAPI:
    app = FastAPI(title="URSUS", lifespan=_lifespan)
    app.include_router(health_router)
    setup_dishka(build_container(), app)
    return app
