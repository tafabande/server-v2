import asyncio
from sqlalchemy import select

from config import get_settings
from core.database import AsyncSessionLocal
from core.media import scan_media_library
from core.models import User
from core.security import hash_password
from core.system import ensure_system_settings
from core.logging import get_logger

logger = get_logger("bootstrap")


settings = get_settings()


async def self_heal_database() -> None:
    """Proactively fix common database schema issues without requiring manual migrations."""
    from sqlalchemy import text
    async with AsyncSessionLocal() as session:
        try:
            # Check users table info
            result = await session.execute(text("PRAGMA table_info(users)"))
            columns = {row[1] for row in result.fetchall()}
            
            corrections = [
                ("pin", "TEXT"),
                ("avatar_url", "TEXT"),
                ("bio", "TEXT"),
                ("preferences", "JSON")
            ]
            
            for col_name, col_type in corrections:
                if col_name not in columns:
                    logger.info(f"Self-healing: Adding missing column '{col_name}' to 'users' table.")
                    await session.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
            
            await session.commit()
        except Exception as e:
            logger.error(f"Self-healing failed: {e}")
            await session.rollback()


async def bootstrap_application() -> None:
    """Initialize system settings, self-heal schema, and trigger an asynchronous media scan."""
    logger.info("Initializing system bootstrap...")
    
    # 1. Patch database schema if needed
    await self_heal_database()

    async with AsyncSessionLocal() as session:
        # 2. Ensure system settings
        await ensure_system_settings(session)

        # 3. Ensure default admin user
        result = await session.execute(select(User).where(User.username == settings.default_admin_username))
        admin = result.scalar_one_or_none()
        if not admin:
            logger.info(f"Creating default admin account: {settings.default_admin_username}")
            session.add(
                User(
                    username=settings.default_admin_username,
                    password_hash=hash_password(settings.default_admin_password),
                    role="admin",
                    pin=settings.admin_pin,
                    preferences={"theme": "retro-classic"},
                )
            )
            await session.commit()
            logger.info("Admin account provisioned.")

        # 4. Trigger the scan in the background with its own session lifecycle
        async def run_background_scan():
            async with AsyncSessionLocal() as scan_session:
                await scan_media_library(scan_session)
        
        asyncio.create_task(run_background_scan())
    
    logger.info("System bootstrap completed.")
