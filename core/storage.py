from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import UploadFile, status

from config import get_settings
from core.exceptions import AccessDeniedError, MediaHubError, ResourceNotFoundError
from core.logging import get_logger
from core.database import AsyncSessionLocal
from core.models import FolderSetting, MediaMetadata
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


settings = get_settings()
logger = get_logger("storage")
MEDIA_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v", ".webm", ".flv",
    ".mpg", ".mpeg", ".m2ts", ".ts", ".vob", ".ogv", ".divx", ".xvid",
    ".asf", ".3gp", ".3g2"
}


def is_media_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS


def relative_shared_path(path: Path) -> str:
    return path.resolve().relative_to(settings.shared_folder.resolve()).as_posix()


def resolve_shared_path(raw_path: str | None = None) -> Path:
    base = settings.shared_folder.resolve()
    candidate = (base / (raw_path or "")).resolve()
    if candidate != base and base not in candidate.parents:
        raise AccessDeniedError("Path traversal attempt blocked.")
    return candidate


def _relative_text_for_path(path: Path) -> str:
    candidate = path if path.exists() else path.parent / path.name
    return relative_shared_path(candidate).lower()


async def is_path_locked(session: AsyncSession, path: Path) -> bool:
    rel_path = _relative_text_for_path(path)
    if any(piece in settings.pin_keyword_set for piece in rel_path.split("/") if piece):
        return True
    
    # Efficiently check DB for any parent or self being locked
    search_paths = [""]
    current = ""
    for part in rel_path.split("/"):
        if not part: continue
        current = f"{current}/{part}" if current else part
        search_paths.append(current)
    
    stmt = select(FolderSetting.is_locked).where(FolderSetting.path.in_(search_paths), FolderSetting.is_locked == True)
    return (await session.execute(stmt)).scalar() is not None


async def is_path_adult(session: AsyncSession, path: Path) -> bool:
    rel_path = _relative_text_for_path(path)
    if any(piece in settings.adult_keyword_set for piece in rel_path.split("/") if piece):
        return True

    search_paths = [""]
    current = ""
    for part in rel_path.split("/"):
        if not part: continue
        current = f"{current}/{part}" if current else part
        search_paths.append(current)

    stmt = select(FolderSetting.is_adult).where(FolderSetting.path.in_(search_paths), FolderSetting.is_adult == True)
    return (await session.execute(stmt)).scalar() is not None


async def ensure_pin_for_path(session: AsyncSession, path: Path, pin: str | None) -> None:
    if await is_path_locked(session, path) and pin != settings.admin_pin:
        raise AccessDeniedError("Valid admin PIN required for this resource.")


async def list_directory(raw_path: str | None = None, session: AsyncSession | None = None) -> tuple[str, str | None, list[dict]]:
    directory = resolve_shared_path(raw_path)
    if not directory.exists():
        raise ResourceNotFoundError(f"Directory not found: {raw_path}")
    if not directory.is_dir():
        raise MediaHubError("The specified path is not a directory.", status_code=status.HTTP_400_BAD_REQUEST)

    relative_path = "" if directory == settings.shared_folder.resolve() else relative_shared_path(directory)
    parent = None if directory == settings.shared_folder.resolve() else (
        relative_shared_path(directory.parent) if directory.parent != settings.shared_folder.resolve() else ""
    )

    items = []

    
    async def process_entries(sess: AsyncSession):
        entries = sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        if not entries: return

        # Pre-fetch ALL relevant settings and media IDs in two queries total
        entry_paths = [relative_shared_path(e) for e in entries]
        
        # 1. Fetch settings for self, parents, and all direct children
        # Collect all unique path segments for parents
        ancestor_paths = [""]
        curr = ""
        for p in relative_path.split("/"):
            if not p: continue
            curr = f"{curr}/{p}" if curr else p
            ancestor_paths.append(curr)
        
        settings_result = await sess.execute(
            select(FolderSetting).where(FolderSetting.path.in_(ancestor_paths + entry_paths))
        )
        settings_map = {s.path: s for s in settings_result.scalars()}
        
        # 2. Fetch media IDs for all media files in the list
        media_result = await sess.execute(
            select(MediaMetadata.id, MediaMetadata.relative_path).where(MediaMetadata.relative_path.in_(entry_paths))
        )
        media_map = {m.relative_path: m.id for m in media_result.all()}

        # 3. Process with cached data
        parent_locked = any(settings_map[p].is_locked for p in ancestor_paths if p in settings_map and settings_map[p].is_locked)
        parent_adult = any(settings_map[p].is_adult for p in ancestor_paths if p in settings_map and settings_map[p].is_adult)

        for entry in entries:
            if entry.name.startswith("."): continue
            rel = relative_shared_path(entry)
            s = settings_map.get(rel)
            
            # Keyword checks
            k_locked = any(piece in settings.pin_keyword_set for piece in rel.split("/") if piece)
            k_adult = any(piece in settings.adult_keyword_set for piece in rel.split("/") if piece)
            
            is_locked = parent_locked or k_locked or (s.is_locked if s else False)
            is_adult = parent_adult or k_adult or (s.is_adult if s else False)

            items.append({
                "name": entry.name,
                "path": rel,
                "is_dir": entry.is_dir(),
                "size": 0 if entry.is_dir() else entry.stat().st_size,
                "modified_at": datetime.fromtimestamp(entry.stat().st_mtime),
                "locked": is_locked,
                "adult_only": is_adult,
                "media": rel in media_map,
                "media_id": media_map.get(rel),
            })

    if session:
        await process_entries(session)
    else:
        async with AsyncSessionLocal() as session_local:
            await process_entries(session_local)

    return relative_path, parent, items


async def save_upload(raw_path: str | None, upload: UploadFile) -> Path:
    directory = resolve_shared_path(raw_path)
    directory.mkdir(parents=True, exist_ok=True)
    if not upload.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload filename is required.")
    destination = (directory / upload.filename).resolve()
    if directory.resolve() not in destination.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsafe upload path.")

    with destination.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            handle.write(chunk)
    await upload.close()
    return destination


def rename_path(raw_path: str, new_name: str) -> Path:
    target = resolve_shared_path(raw_path)
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target not found.")
    destination = target.with_name(new_name)
    if target.parent.resolve() not in destination.resolve().parents:
        logger.error(f"Unsafe rename attempt from {raw_path} to {new_name}")
        raise AccessDeniedError("Unsafe rename target.")
    
    logger.info(f"Renaming {raw_path} -> {new_name}")
    target.rename(destination)
    return destination


def delete_path(raw_path: str) -> Path:
    target = resolve_shared_path(raw_path)
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target not found.")
    if target.is_dir():
        for child in sorted(target.rglob("*"), reverse=True):
            if child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
        target.rmdir()
    else:
        target.unlink()
    return target
