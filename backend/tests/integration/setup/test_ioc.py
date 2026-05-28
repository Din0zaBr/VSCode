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
