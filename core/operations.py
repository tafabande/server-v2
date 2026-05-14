from __future__ import annotations

import json
from pathlib import Path

import psutil
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.cache import cache
from core.media import ffmpeg_available
from core.models import AuditLog, MediaMetadata, User
from core.runtime_state import list_active_sessions


settings = get_settings()


def tail_log_lines(path: Path, limit: int = 100) -> list[str]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    return lines[-limit:]


def read_transcode_log(limit: int = 100) -> list[dict]:
    entries: list[dict] = []
    for line in tail_log_lines(settings.logs_folder / "transcode.log", limit):
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            entries.append({"level": "info", "message": line})
    return entries


async def build_dashboard_snapshot(session: AsyncSession) -> dict:
    disk = psutil.disk_usage(str(settings.shared_folder.resolve()))
    memory = psutil.virtual_memory()
    cpu_percent = psutil.cpu_percent(interval=0.1)
    active_sessions = await list_active_sessions()
    redis_connected = await cache.ping()

    media_count = await session.scalar(select(func.count()).select_from(MediaMetadata)) or 0
    user_count = await session.scalar(select(func.count()).select_from(User)) or 0
    pending_transcodes = await session.scalar(
        select(func.count()).select_from(MediaMetadata).where(MediaMetadata.hls_status == "pending")
    ) or 0
    recent_audits = (
        await session.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(10))
    ).scalars().all()

    return {
        "system_health": {
            "cpu_percent": cpu_percent,
            "memory_percent": memory.percent,
            "memory_used_gb": round(memory.used / (1024 ** 3), 2),
            "memory_total_gb": round(memory.total / (1024 ** 3), 2),
            "disk_percent": disk.percent,
            "disk_used_gb": round(disk.used / (1024 ** 3), 2),
            "disk_total_gb": round(disk.total / (1024 ** 3), 2),
            "redis_connected": redis_connected,
            "ffmpeg_available": ffmpeg_available(),
        },
        "system_summary": {
            "media_count": int(media_count),
            "user_count": int(user_count),
            "active_sessions": len(active_sessions),
            "pending_transcodes": int(pending_transcodes),
        },
        "active_sessions": active_sessions,
        "recent_audits": list(recent_audits),
        "transcode_logs": read_transcode_log(50),
    }
