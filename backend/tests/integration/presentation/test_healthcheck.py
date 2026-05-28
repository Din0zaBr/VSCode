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
