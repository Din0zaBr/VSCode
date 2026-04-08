"""URSUS SIEM - ML Engine REST API (stubs)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from server.src.auth import verify_token

router = APIRouter(prefix="/ml", tags=["ml"])


class EventsBody(BaseModel):
    events: list[dict]


@router.get("/status")
async def ml_status(request: Request, user: dict = Depends(verify_token)):
    return request.app.state.ml_engine.get_model_status()


@router.post("/anomaly")
async def detect_anomaly(body: EventsBody, request: Request, user: dict = Depends(verify_token)):
    return request.app.state.ml_engine.detect_anomaly_batch(body.events)


@router.post("/classify")
async def classify_event(body: dict, request: Request, user: dict = Depends(verify_token)):
    return request.app.state.ml_engine.classify_event(body)


@router.get("/ueba/{username}")
async def ueba_user(username: str, request: Request, user: dict = Depends(verify_token)):
    return request.app.state.ml_engine.analyze_user_behavior(username, [])


@router.get("/ueba/host/{host}")
async def ueba_host(host: str, request: Request, user: dict = Depends(verify_token)):
    return request.app.state.ml_engine.analyze_host_behavior(host, [])
