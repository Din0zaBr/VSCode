from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.src.auth import require_admin

router = APIRouter(prefix="/users")


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "operator"


class UpdateRoleRequest(BaseModel):
    role: str


class SetAgentsRequest(BaseModel):
    agents: list[str]


@router.get("/")
async def list_users(request: Request, _admin: dict = Depends(require_admin)):
    db = request.app.state.db_service
    return db.list_users()


@router.post("/")
async def create_user(body: CreateUserRequest, request: Request, _admin: dict = Depends(require_admin)):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="Роль должна быть admin или operator")
    if len(body.username) < 2:
        raise HTTPException(status_code=400, detail="Логин слишком короткий")
    if len(body.password) < 3:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий")
    db = request.app.state.db_service
    try:
        user = db.create_user(body.username, body.password, body.role)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True, **user}


@router.delete("/{user_id}")
async def delete_user(user_id: int, request: Request, admin: dict = Depends(require_admin)):
    if admin["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    db = request.app.state.db_service
    if not db.delete_user(user_id):
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"ok": True}


@router.put("/{user_id}/role")
async def update_role(user_id: int, body: UpdateRoleRequest, request: Request, admin: dict = Depends(require_admin)):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="Роль должна быть admin или operator")
    if admin["user_id"] == user_id and body.role != "admin":
        raise HTTPException(status_code=400, detail="Нельзя снять роль admin с самого себя")
    db = request.app.state.db_service
    if not db.update_user_role(user_id, body.role):
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"ok": True}


@router.get("/{user_id}/agents")
async def get_agents(user_id: int, request: Request, _admin: dict = Depends(require_admin)):
    db = request.app.state.db_service
    return db.get_user_agents(user_id)


@router.put("/{user_id}/agents")
async def set_agents(user_id: int, body: SetAgentsRequest, request: Request, _admin: dict = Depends(require_admin)):
    db = request.app.state.db_service
    db.set_user_agents(user_id, body.agents)
    return {"ok": True, "agents": body.agents}
