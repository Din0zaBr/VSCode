from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.src.config import settings
from server.src.routers import agents, alerts, auth_router, ingest, logs, metrics, search, stats, users_router
from server.src.services.alerting import alert_loop
from server.src.services.postgres import PGService
from server.src.services.pipeline import IngestPipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_service = PGService()
    app.state.db_service = db_service
    app.state.pipeline = IngestPipeline(db_service)

    db_service.create_default_admin()

    alert_thread = threading.Thread(
        target=alert_loop, args=(db_service,), daemon=True
    )
    alert_thread.start()
    logger.info("Server started, PG at %s", settings.DATABASE_URL.split("@")[-1])

    yield

    logger.info("Server shutting down")


app = FastAPI(
    title="LogVault Server",
    description="Centralized log collection and search API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(ingest.router)
app.include_router(search.router)
app.include_router(logs.router)
app.include_router(stats.router)
app.include_router(metrics.router)
app.include_router(agents.router)
app.include_router(alerts.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
