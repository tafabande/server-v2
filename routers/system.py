import psutil
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_settings_updated, socket_manager
from core.models import AuditLog, SystemSetting, User
from core.schemas import AuditLogRead, MessageResponse, SystemSettingsRead, SystemSettingsUpdate
from core.security import get_current_user, require_roles
from core.system import get_settings_map


router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "mediahub"}


@router.get("/metrics", dependencies=[Depends(get_current_user)])
async def get_metrics(current_user: User = Depends(require_roles("admin", "super-admin"))) -> dict:
    """Get system health metrics (CPU, RAM, Disk)."""
    return {
        "cpu": psutil.cpu_percent(interval=None),
        "memory": psutil.virtual_memory()._asdict(),
        "disk": psutil.disk_usage("/")._asdict(),
        "platform": psutil.os.name,
    }


@router.get("/sessions", dependencies=[Depends(get_current_user)])
async def get_active_sessions(current_user: User = Depends(require_roles("admin", "super-admin"))) -> list:
    """Get list of active streaming sessions."""
    # This would typically come from Redis or an in-memory session manager
    return socket_manager.get_active_sessions()


@router.get("/settings", response_model=SystemSettingsRead)
async def settings(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SystemSettingsRead:
    return SystemSettingsRead(settings=await get_settings_map(session))


@router.put("/settings", response_model=MessageResponse)
async def update_settings(
    payload: SystemSettingsUpdate,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    for key, value in payload.settings.items():
        setting = await session.get(SystemSetting, key)
        if setting:
            setting.value = value
        else:
            session.add(SystemSetting(key=key, value=value))

    await session.commit()
    await broadcast_settings_updated()
    return MessageResponse(message="Settings updated.")


@router.get("/audit", response_model=list[AuditLogRead])
async def audit_log(
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> list[AuditLogRead]:
    result = await session.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(50))
    return [AuditLogRead.model_validate(entry) for entry in result.scalars()]


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await socket_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        socket_manager.disconnect(websocket)
