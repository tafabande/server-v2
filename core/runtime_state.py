from __future__ import annotations

import json
from datetime import UTC, datetime

from config import get_settings
from core.cache import cache
from core.models import MediaMetadata, User

settings = get_settings()

def _token_key(jti: str) -> str:
    return f"token:blacklist:{jti}"

def _session_key(jti: str) -> str:
    return f"session:active:{jti}"

def _decode_cache_payload(value):
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        return json.loads(value)
    return value

async def revoke_token(jti: str, expires_at: int | float | None) -> None:
    ttl = None
    if expires_at:
        ttl = max(1, int(expires_at - datetime.now(UTC).timestamp()))
    await cache.set(_token_key(jti), "revoked", ttl_seconds=ttl)

async def is_token_revoked(jti: str) -> bool:
    return await cache.get(_token_key(jti)) is not None

async def touch_active_session(
    *,
    jti: str,
    user: User,
    media: MediaMetadata,
    position_seconds: float = 0,
    event_type: str = "start",
    completed: bool = False,
) -> None:
    payload = {
        "jti": jti,
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "media_id": media.id,
        "title": media.title,
        "relative_path": media.relative_path,
        "stream_mode": media.stream_mode,
        "position_seconds": position_seconds,
        "event_type": event_type,
        "completed": completed,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    await cache.set(
        _session_key(jti),
        json.dumps(payload),
        ttl_seconds=settings.active_session_ttl_seconds,
    )

async def clear_active_session(jti: str) -> None:
    await cache.delete(_session_key(jti))

async def list_active_sessions() -> list[dict]:
    payloads: list[dict] = []
    for key in await cache.keys("session:active:"):
        cached = await cache.get(key)
        decoded = _decode_cache_payload(cached)
        if decoded:
            payloads.append(decoded)
    payloads.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    return payloads

async def count_active_sessions_for_user(user_id: int, *, exclude_jti: str | None = None) -> int:
    sessions = await list_active_sessions()
    return sum(
        1
        for entry in sessions
        if entry.get("user_id") == user_id and entry.get("jti") != exclude_jti
    )
