import asyncio
import shutil
from pathlib import Path
from sqlalchemy import inspect, select, text, func

from config import get_settings
from core.database import AsyncSessionLocal, Base, engine
from core.media import scan_media_library
from core.models import (
    AccessRequest, AuditLog, Collection, CollectionItem, Favorite, FolderPermission,
    FolderSetting, IdempotentRequest, MediaMetadata, Permission, PlayEvent, Playlist,
    PlaylistItem, Rating, ServerStatus, Subtitle, SystemSetting, User, Webhook,
)
from core.security import hash_password
from core.system import ensure_system_settings
from core.logging import get_logger

logger = get_logger("bootstrap")

settings = get_settings()


# ── Column definitions per ORM model (name → SQLite type) ─────────────────────
# Used by self_heal_columns to add any missing columns automatically.
_TABLE_COLUMNS: dict[str, dict[str, str]] = {
    "users": {
        "pin": "TEXT",
        "avatar_url": "TEXT",
        "bio": "TEXT",
        "preferences": "JSON",
        "is_adult": "BOOLEAN DEFAULT 0",
        "last_login": "DATETIME",
    },
    "media_metadata": {
        "bitrate": "INTEGER",
        "video_codec": "VARCHAR(50)",
        "audio_codec": "VARCHAR(50)",
        "container": "VARCHAR(20)",
        "stream_mode": "VARCHAR(20) DEFAULT 'direct'",
        "hls_status": "VARCHAR(30) DEFAULT 'pending'",
        "requires_pin": "BOOLEAN DEFAULT 0",
        "adult_only": "BOOLEAN DEFAULT 0",
        "intro_start": "FLOAT",
        "intro_end": "FLOAT",
        "updated_at": "DATETIME",
        "file_exists": "BOOLEAN DEFAULT 1",
        "last_verified_at": "DATETIME",
    },
    "play_events": {
        "event_type": "VARCHAR(20) DEFAULT 'progress'",
    },
}

# ── Critical indexes that must exist ──────────────────────────────────────────
_REQUIRED_INDEXES: list[tuple[str, str, str]] = [
    # (index_name, table, column)
    ("ix_users_username", "users", "username"),
    ("ix_users_role", "users", "role"),
    ("ix_media_metadata_title", "media_metadata", "title"),
    ("ix_media_metadata_category", "media_metadata", "category"),
    ("ix_play_events_user_id", "play_events", "user_id"),
    ("ix_play_events_media_id", "play_events", "media_id"),
    ("ix_favorites_user_id", "favorites", "user_id"),
    ("ix_favorites_media_id", "favorites", "media_id"),
    ("ix_ratings_user_id", "ratings", "user_id"),
    ("ix_ratings_media_id", "ratings", "media_id"),
    ("ix_subtitles_media_id", "subtitles", "media_id"),
    ("ix_folder_permissions_user_id", "folder_permissions", "user_id"),
]


async def self_heal_tables() -> None:
    """Create any ORM tables that don't exist yet (non-destructive)."""
    logger.info("Self-healing: Checking for missing tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Self-healing: All tables verified/created.")


async def self_heal_columns() -> None:
    """Add any missing columns to existing tables without dropping data."""
    logger.info("Self-healing: Checking for missing columns...")
    async with AsyncSessionLocal() as session:
        for table_name, columns in _TABLE_COLUMNS.items():
            try:
                result = await session.execute(text(f"PRAGMA table_info({table_name})"))
                existing = {row[1] for row in result.fetchall()}

                for col_name, col_type in columns.items():
                    if col_name not in existing:
                        logger.info(f"Self-healing: Adding column '{col_name}' to '{table_name}'")
                        await session.execute(
                            text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}")
                        )
            except Exception as e:
                logger.error(f"Self-healing columns for '{table_name}' failed: {e}")

        await session.commit()


async def self_heal_indexes() -> None:
    """Ensure critical indexes exist on key columns."""
    logger.info("Self-healing: Checking indexes...")
    async with AsyncSessionLocal() as session:
        for idx_name, table, column in _REQUIRED_INDEXES:
            try:
                await session.execute(
                    text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({column})")
                )
            except Exception as e:
                # Index may already exist or table might be missing — both are fine
                logger.debug(f"Index '{idx_name}' check: {e}")
        await session.commit()


async def self_heal_data_integrity() -> None:
    """Clean up orphaned records and stale files."""
    logger.info("Self-healing: Running data integrity checks...")
    async with AsyncSessionLocal() as session:
        try:
            # 1. Orphaned play_events (media deleted)
            orphan_events = await session.execute(text("""
                DELETE FROM play_events
                WHERE media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_events.rowcount:
                logger.info(f"Self-healing: Removed {orphan_events.rowcount} orphaned play events.")

            # 2. Orphaned playlist_items (media deleted)
            orphan_items = await session.execute(text("""
                DELETE FROM playlist_items
                WHERE media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_items.rowcount:
                logger.info(f"Self-healing: Removed {orphan_items.rowcount} orphaned playlist items.")

            # 3. Orphaned favorites (media deleted)
            orphan_favs = await session.execute(text("""
                DELETE FROM favorites
                WHERE media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_favs.rowcount:
                logger.info(f"Self-healing: Removed {orphan_favs.rowcount} orphaned favorites.")

            # 4. Orphaned ratings (media deleted)
            orphan_ratings = await session.execute(text("""
                DELETE FROM ratings
                WHERE media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_ratings.rowcount:
                logger.info(f"Self-healing: Removed {orphan_ratings.rowcount} orphaned ratings.")

            # 5. Orphaned subtitles (media deleted)
            orphan_subs = await session.execute(text("""
                DELETE FROM subtitles
                WHERE media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_subs.rowcount:
                logger.info(f"Self-healing: Removed {orphan_subs.rowcount} orphaned subtitles.")

            # 6. Orphaned collection_items (media deleted)
            orphan_col = await session.execute(text("""
                DELETE FROM collection_items
                WHERE media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_col.rowcount:
                logger.info(f"Self-healing: Removed {orphan_col.rowcount} orphaned collection items.")

            # 7. Orphaned permissions (user or media deleted)
            orphan_perms = await session.execute(text("""
                DELETE FROM permissions
                WHERE user_id NOT IN (SELECT id FROM users)
                   OR media_id NOT IN (SELECT id FROM media_metadata)
            """))
            if orphan_perms.rowcount:
                logger.info(f"Self-healing: Removed {orphan_perms.rowcount} orphaned permissions.")

            # 7.5. Orphaned folder_permissions (user deleted)
            orphan_folder_perms = await session.execute(text("""
                DELETE FROM folder_permissions
                WHERE user_id NOT IN (SELECT id FROM users)
            """))
            if orphan_folder_perms.rowcount:
                logger.info(f"Self-healing: Removed {orphan_folder_perms.rowcount} orphaned folder permissions.")

            await session.commit()
        except Exception as e:
            logger.error(f"Self-healing data integrity failed: {e}")
            await session.rollback()

    # 8. Stale HLS directories with no matching media
    try:
        hls_root = settings.hls_folder
        if hls_root.exists():
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(MediaMetadata.id))
                valid_ids = {str(row[0]) for row in result.fetchall()}

            for child in hls_root.iterdir():
                if child.is_dir() and child.name not in valid_ids:
                    logger.info(f"Self-healing: Removing stale HLS directory: {child.name}")
                    shutil.rmtree(child, ignore_errors=True)
    except Exception as e:
        logger.error(f"Self-healing HLS cleanup failed: {e}")


async def bootstrap_application() -> None:
    """Initialize system settings, self-heal schema, and trigger an asynchronous media scan."""
    logger.info("Initializing system bootstrap...")

    # 1. Create any missing tables
    await self_heal_tables()

    # 2. Patch columns on existing tables
    await self_heal_columns()

    # 3. Ensure critical indexes
    await self_heal_indexes()

    # 4. Data integrity cleanup
    await self_heal_data_integrity()

    async with AsyncSessionLocal() as session:
        # 5. Ensure system settings
        await ensure_system_settings(session)

        # 6. Ensure default admin user
        result = await session.execute(select(User).where(User.username == settings.default_admin_username))
        admin = result.scalar_one_or_none()
        if not admin:
            logger.info(f"Creating default admin account: {settings.default_admin_username}")
            session.add(
                User(
                    username=settings.default_admin_username,
                    password_hash=hash_password(settings.default_admin_password),
                    role="admin",
                    pin=hash_password(settings.admin_pin),
                    is_adult=True,
                    preferences={"theme": "default"},
                )
            )
            await session.commit()
            logger.info("Admin account provisioned.")

        # 7. Ensure default guest user
        result = await session.execute(select(User).where(User.username == "guest"))
        guest = result.scalar_one_or_none()
        if not guest:
            logger.info("Creating default guest account.")
            session.add(
                User(
                    username="guest",
                    password_hash=hash_password("guest"),
                    role="guest",
                    preferences={"theme": "default"},
                )
            )
            await session.commit()
            logger.info("Guest account provisioned.")

        # 8. Trigger the scan (synchronously if empty to avoid blank startup page)
        count_res = await session.execute(select(func.count(MediaMetadata.id)))
        media_count = count_res.scalar() or 0
        if media_count == 0:
            logger.info("Database is empty. Running initial synchronous library scan...")
            try:
                await scan_media_library(session, use_cache=True)
            except Exception:
                logger.exception("Initial synchronous scan failed")
        else:
            async def run_background_scan():
                async with AsyncSessionLocal() as scan_session:
                    try:
                        await scan_media_library(scan_session)
                    except Exception:
                        logger.exception("Background scan failed")
            asyncio.create_task(run_background_scan())

    # NOTE: File watcher is started in main.py lifespan — NOT here to avoid duplicates.

    logger.info("System bootstrap completed.")
