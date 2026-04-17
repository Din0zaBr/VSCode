from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from server.src.auth import verify_token
from server.src.config import settings
from server.src.routers import (
    agent_deploy, agents, alerts, assets, auth_router, correlation,
    ingest, integrations, logs, metrics, ml, search, stats, users_router,
)
from server.src.routers import api_keys as api_keys_router
from server.src.routers import sigma_rules as sigma_rules_router
from server.src.services.alerting import alert_loop
from server.src.services import sigma_rules as sigma_rules_svc
from server.src.services.correlator import correlation_loop
from server.src.services.ml_engine import MLEngine
from server.src.services.pipeline import IngestPipeline
from server.src.services.postgres import PGService
from server.src.services.system_health import SystemHealth, health_loop
from server.src.integrations.active_directory import ADConnector
from server.src.integrations import IntegrationRegistry
from server.src.integrations.kaspersky_edr import KasperskyEDR
from server.src.integrations.positive_technologies import PTSandbox, PTNAD
from server.src.integrations.generic_syslog import SyslogReceiver
from server.src.integrations.generic_cef import CEFReceiver
from server.src.integrations.suricata import SuricataIDS
from server.src.integrations.elastic import ElasticIntegration
from server.src.integrations.splunk import SplunkIntegration
from server.src.integrations.ml_anomaly import MLAnomalyDetector
from server.src.integrations.webhook_receiver import WebhookReceiver
from server.src.integrations.rest_generic import GenericRESTConnector

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
    app.state.start_time = time.time()

    db_service.create_default_admin()
    db_service.seed_default_correlation_rules()

    # ML Engine (stub)
    app.state.ml_engine = MLEngine()

    # AD Connector (stub)
    ad = ADConnector()
    if settings.AD_SERVER:
        ad.configure(
            server=settings.AD_SERVER, domain=settings.AD_DOMAIN,
            username=settings.AD_USERNAME, password=settings.AD_PASSWORD,
            base_dn=settings.AD_BASE_DN, use_ssl=settings.AD_USE_SSL,
        )
    app.state.ad_connector = ad

    # Integration registry - register all available connectors
    registry = IntegrationRegistry()
    for cls in (
        KasperskyEDR, PTSandbox, PTNAD, SyslogReceiver, CEFReceiver,
        SuricataIDS, ElasticIntegration, SplunkIntegration,
        MLAnomalyDetector, WebhookReceiver, GenericRESTConnector,
    ):
        registry.register(cls())
    app.state.integration_registry = registry

    # SIGMA Rules - load from disk on startup
    loaded = sigma_rules_svc.load_rules_from_disk()
    logger.info("SIGMA rules loaded: %d", loaded)

    # System Health
    system_health = SystemHealth(db_service)
    app.state.system_health = system_health

    # Background threads
    threading.Thread(target=alert_loop, args=(db_service,), daemon=True).start()
    threading.Thread(target=correlation_loop, args=(db_service,), daemon=True).start()
    threading.Thread(target=health_loop, args=(system_health,), daemon=True).start()

    logger.info("URSUS SIEM started, PG at %s", settings.DATABASE_URL.split("@")[-1])
    yield
    logger.info("Server shutting down")


app = FastAPI(
    title="URSUS SIEM",
    description="Centralized log collection, correlation, PDQL search and analysis",
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

# Routers
app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(ingest.router)
app.include_router(search.router)
app.include_router(logs.router)
app.include_router(stats.router)
app.include_router(metrics.router)
app.include_router(agents.router)
app.include_router(alerts.router)
app.include_router(correlation.router)
app.include_router(assets.router)
app.include_router(ml.router)
app.include_router(integrations.router)
app.include_router(agent_deploy.router)
app.include_router(api_keys_router.router)
app.include_router(sigma_rules_router.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "uptime_seconds": time.time() - app.state.start_time,
    }


@app.get("/health/detailed")
async def health_detailed(request: Request, user: dict = Depends(verify_token)):
    return request.app.state.system_health._metrics
