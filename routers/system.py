import math
import os
import signal
import asyncio

import psutil
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_settings_updated, socket_manager
from core.models import AuditLog, SystemSetting, User
from core.schemas import AuditLogRead, MessageResponse, PaginatedAuditResponse, SystemSettingsRead, SystemSettingsUpdate
from core.security import get_current_user, require_roles
from core.system import get_settings_map


router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "mediahub"}


@router.get("/metrics", dependencies=[Depends(get_current_user)])
async def get_metrics(current_user: User = Depends(require_roles("admin", "super-admin"))) -> dict:
    """Get system health metrics (CPU, RAM, Disk)."""
    import datetime
    from core.discovery import discovery
    
    # Try to check if time is synchronized (Windows specific)
    time_sync_status = "unknown"
    try:
        import subprocess
        res = subprocess.run(["w32tm", "/query", "/status"], capture_output=True, encoding="utf-8", errors="ignore")
        if "Source:" in res.stdout:
            time_sync_status = "synchronized" if "Local CMOS Clock" not in res.stdout else "using local clock"
    except Exception:
        pass

    # Try to check for ECC RAM (Windows specific)
    ecc_status = "unsupported/unknown"
    try:
        import subprocess
        res = subprocess.run(["wmic", "memphysical", "get", "memoryerrorcorrection"], capture_output=True, encoding="utf-8", errors="ignore")
        # 3 = None, 5 = Single-bit ECC, 6 = Multi-bit ECC
        if "3" in res.stdout: ecc_status = "none"
        elif "5" in res.stdout: ecc_status = "single-bit ecc"
        elif "6" in res.stdout: ecc_status = "multi-bit ecc"
    except Exception:
        pass

    from core.media import ffmpeg_available

    cpu_val = psutil.cpu_percent(interval=None)
    vm = psutil.virtual_memory()
    du = psutil.disk_usage("/")

    return {
        "cpu_percent": cpu_val,
        "memory_used_gb": vm.used / (1024**3),
        "memory_total_gb": vm.total / (1024**3),
        "memory_percent": vm.percent,
        "disk_used_gb": du.used / (1024**3),
        "disk_total_gb": du.total / (1024**3),
        "disk_percent": du.percent,
        "ffmpeg_available": ffmpeg_available(),
        "platform": psutil.os.name,
        "server_time": datetime.datetime.now().isoformat(),
        "time_sync": time_sync_status,
        "mdns_active": discovery.service_info is not None,
        "ecc_ram": ecc_status,
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


@router.get("/audit", response_model=PaginatedAuditResponse)
async def audit_log(
    page: int = 1,
    per_page: int = 50,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> PaginatedAuditResponse:
    """Get paginated audit logs."""
    from sqlalchemy import func as sqlfunc
    
    # Total count
    count_result = await session.execute(select(sqlfunc.count()).select_from(AuditLog))
    total = count_result.scalar() or 0
    
    # Paginated results
    offset = (page - 1) * per_page
    result = await session.execute(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(per_page)
    )
    items = [AuditLogRead.model_validate(entry) for entry in result.scalars()]
    
    return PaginatedAuditResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=max(1, math.ceil(total / per_page)),
    )


@router.post("/shutdown", response_model=MessageResponse)
async def shutdown_server(
    current_user: User = Depends(require_roles("admin", "super-admin")),
) -> MessageResponse:
    """Initiate graceful server shutdown (admin only)."""
    import asyncio
    from core.logging import get_logger
    logger = get_logger("system")
    
    logger.warning(f"Shutdown initiated by admin: {current_user.username}")
    
    # Schedule shutdown after response is sent
    async def delayed_shutdown():
        await asyncio.sleep(1)  # Give time for the response to be sent
        os.kill(os.getpid(), signal.SIGTERM)
    
    asyncio.create_task(delayed_shutdown())
    return MessageResponse(message="Server shutdown initiated. Goodbye.")


@router.post("/optimize", response_model=MessageResponse)
async def optimize_system(
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Run SQLite database optimization (VACUUM & ANALYZE)."""
    try:
        from sqlalchemy import text
        await session.execute(text("VACUUM"))
        await session.execute(text("ANALYZE"))
        return MessageResponse(message="Database optimized successfully. Unused disk space reclaimed.")
    except Exception as e:
        return MessageResponse(message=f"Optimization completed with warnings: {str(e)}")


@router.post("/clear-hls", response_model=MessageResponse)
async def clear_hls_cache(
    current_user: User = Depends(require_roles("admin", "super-admin")),
) -> MessageResponse:
    """Clear all HLS transcoded segments in the temp folder."""
    from config import get_settings
    import shutil
    settings = get_settings()
    hls_dir = settings.hls_folder
    count = 0
    if hls_dir.exists() and hls_dir.is_dir():
        for item in hls_dir.iterdir():
            try:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                count += 1
            except Exception:
                pass
    return MessageResponse(message=f"HLS Transcoding cache cleared successfully. Purged {count} HLS stream elements.")


@router.post("/clear-thumbs", response_model=MessageResponse)
async def clear_thumbs_cache(
    current_user: User = Depends(require_roles("admin", "super-admin")),
) -> MessageResponse:
    """Clear thumbnail generation caches."""
    from config import get_settings
    settings = get_settings()
    thumbs_dir = settings.thumbs_folder
    count = 0
    if thumbs_dir.exists() and thumbs_dir.is_dir():
        for item in thumbs_dir.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                    count += 1
            except Exception:
                pass
    return MessageResponse(message=f"Thumbnail generation cache cleared successfully. Purged {count} cached files.")


@router.get("/recent-errors")
async def get_recent_errors(
    current_user: User = Depends(require_roles("admin", "super-admin")),
) -> list[str]:
    """Retrieve the 50 most recent ERROR or CRITICAL log lines from server log."""
    from config import get_settings
    settings = get_settings()
    log_file = settings.logs_folder / "mediahub.log"
    recent_errors = []
    if log_file.exists() and log_file.is_file():
        try:
            with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
                for line in reversed(lines):
                    # Filter for lines containing error or critical or warning tags
                    line_upper = line.upper()
                    if any(tag in line_upper for tag in ["ERROR", "CRITICAL", "EXCEPTION", "WARNING"]):
                        recent_errors.append(line.strip())
                    if len(recent_errors) >= 50:
                        break
        except Exception as e:
            recent_errors.append(f"Error loading logs: {str(e)}")
    else:
        recent_errors.append("No active logs file discovered yet.")
    return recent_errors


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await socket_manager.connect(websocket)
    try:
        while True:
            try:
                # Wait for any text from client, with a 30s timeout
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send ping message to client to keep connection alive
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        socket_manager.disconnect(websocket)
    except Exception:
        socket_manager.disconnect(websocket)
