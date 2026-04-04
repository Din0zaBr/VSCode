from __future__ import annotations

import jwt
from fastapi import Depends, Header, HTTPException

from server.src.config import settings


async def verify_api_key(x_api_key: str = Header(..., alias="X-Api-Key")) -> str:
    if x_api_key not in settings.API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key


async def verify_token(authorization: str = Header(..., alias="Authorization")) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


async def require_admin(user: dict = Depends(verify_token)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Доступ только для администраторов")
    return user


def get_allowed_agents(user: dict, db=None) -> list[str] | None:
    """Return list of allowed agent_ids for operator, or None for admin (no restrictions).
    When db is provided, reads fresh assignments from the database instead of JWT cache."""
    if user.get("role") == "admin":
        return None
    if db is not None:
        user_id = user.get("user_id", 0)
        agents = db.get_user_agents(user_id)
        if agents:
            return agents
    return user.get("agents", [])
