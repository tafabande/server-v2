from __future__ import annotations

import time
from typing import Any

from config import get_settings


settings = get_settings()

try:
    import redis.asyncio as redis
except ImportError:  # pragma: no cover
    redis = None


class MemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float | None]] = {}

    async def get(self, key: str) -> Any:
        record = self._store.get(key)
        if not record:
            return None
        value, expires_at = record
        if expires_at and expires_at < time.time():
            self._store.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        expires_at = time.time() + ttl_seconds if ttl_seconds else None
        self._store[key] = (value, expires_at)

    async def delete(self, key: str) -> None:
        self._store.pop(key, None)


class CacheBackend:
    def __init__(self) -> None:
        self._fallback = MemoryCache()
        self._client = redis.from_url(settings.redis_url) if redis and settings.redis_url else None

    async def get(self, key: str) -> Any:
        if not self._client:
            return await self._fallback.get(key)
        return await self._client.get(key)

    async def set(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        if not self._client:
            await self._fallback.set(key, value, ttl_seconds)
            return
        await self._client.set(key, value, ex=ttl_seconds)

    async def delete(self, key: str) -> None:
        if not self._client:
            await self._fallback.delete(key)
            return
        await self._client.delete(key)


cache = CacheBackend()
