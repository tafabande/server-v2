import asyncio
from sqlalchemy import select

from config import get_settings
from core.database import AsyncSessionLocal
from core.media import scan_media_library
from core.models import User
from core.security import hash_password
from core.system import ensure_system_settings


settings = get_settings()


async def bootstrap_application() -> None:
    """Initialize system settings and trigger an asynchronous media scan."""
    async with AsyncSessionLocal() as session:
        await ensure_system_settings(session)

        result = await session.execute(select(User).where(User.username == settings.default_admin_username))
        admin = result.scalar_one_or_none()
        if not admin:
            session.add(
                User(
                    username=settings.default_admin_username,
                    password_hash=hash_password(settings.default_admin_password),
                    role="admin",
                    preferences={"theme": "retro-classic"},
                )
            )
            await session.commit()

        # Trigger the scan in the background to avoid blocking server startup
        asyncio.create_task(scan_media_library(session))
