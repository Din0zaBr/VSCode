from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.src.auth import verify_token
from server.src.config import settings

router = APIRouter(prefix="/auth")


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    db = request.app.state.db_service
    user = db.get_user_by_username(body.username)
    if not user:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    if not bcrypt.checkpw(body.password.encode(), user["password"].encode()):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    allowed_agents = db.get_user_agents(user["id"]) if user["role"] == "operator" else []

    payload = {
        "sub": user["username"],
        "user_id": user["id"],
        "role": user["role"],
        "agents": allowed_agents,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return {"token": token, "username": user["username"], "role": user["role"], "agents": allowed_agents}


@router.get("/me")
async def me(user: dict = Depends(verify_token)):
    return {
        "username": user["sub"],
        "user_id": user["user_id"],
        "role": user.get("role", "operator"),
        "agents": user.get("agents", []),
    }
