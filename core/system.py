from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.models import SystemSetting


settings = get_settings()

DEFAULT_SYSTEM_SETTINGS: dict[str, Any] = {
    "branding_title": settings.app_name,
    "maintenance_mode": settings.maintenance_mode,
    "admin_pin": settings.admin_pin,
    "adult_keywords": sorted(settings.adult_keyword_set),
    "pin_keywords": sorted(settings.pin_keyword_set),
    "pretranscode_paths": [],
}


async def ensure_system_settings(session: AsyncSession) -> None:
    result = await session.execute(select(SystemSetting))
    existing = {setting.key for setting in result.scalars()}
    for key, value in DEFAULT_SYSTEM_SETTINGS.items():
        if key not in existing:
            session.add(SystemSetting(key=key, value=value))
    await session.commit()


async def get_settings_map(session: AsyncSession) -> dict[str, Any]:
    result = await session.execute(select(SystemSetting))
    return {setting.key: setting.value for setting in result.scalars()}


async def get_setting(session: AsyncSession, key: str, default: Any = None) -> Any:
    result = await session.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()
    return default if setting is None else setting.value
