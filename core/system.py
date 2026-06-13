from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.models import SystemSetting

from core.logging import get_logger
logger = get_logger("system_config")

settings = get_settings()

DEFAULT_SYSTEM_SETTINGS: dict[str, Any] = {
    "branding_title": settings.app_name,
    "maintenance_mode": settings.maintenance_mode,
    "admin_pin": settings.admin_pin,
    "adult_keywords": sorted(settings.adult_keyword_set),
    "pin_keywords": sorted(settings.pin_keyword_set),
    "pretranscode_paths": [],
    "transcode_profiles": [
        {"name": "1080p", "width": 1920, "height": 1080, "bitrate": "6000k", "maxrate": "9000k", "bufsize": "12000k"},
        {"name": "720p", "width": 1280, "height": 720, "bitrate": "2500k", "maxrate": "3500k", "bufsize": "5000k"},
        {"name": "480p", "width": 854, "height": 480, "bitrate": "800k", "maxrate": "1200k", "bufsize": "2000k"},
        {"name": "240p", "width": 426, "height": 240, "bitrate": "300k", "maxrate": "450k", "bufsize": "1000k"},
    ],
}

async def ensure_system_settings(session: AsyncSession) -> None:
    result = await session.execute(select(SystemSetting))
    existing = {setting.key: setting for setting in result.scalars()}
    for key, value in DEFAULT_SYSTEM_SETTINGS.items():
        if key not in existing:
            session.add(SystemSetting(key=key, value=value))
        elif key == "transcode_profiles":
            current_profiles = existing[key].value or []
            if not any(p.get("name") == "240p" for p in current_profiles):
                logger.info("Self-healing: Updating system setting 'transcode_profiles' with mobile-friendly defaults")
                existing[key].value = value
    await session.commit()

async def get_settings_map(session: AsyncSession) -> dict[str, Any]:
    result = await session.execute(select(SystemSetting))
    return {setting.key: setting.value for setting in result.scalars()}

async def get_setting(session: AsyncSession, key: str, default: Any = None) -> Any:
    result = await session.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()
    return default if setting is None else setting.value
