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
    parts = {piece for piece in rel_path.split("/") if piece}
    if bool(parts & settings.pin_keyword_set):
        return True
    

    
    # Check if this path or any parent is locked in DB
    search_paths = [""]
    current = ""
    for part in rel_path.split("/"):
        if not part: continue
        current = f"{current}/{part}" if current else part
        search_paths.append(current)
    
    result = await session.execute(
        select(FolderSetting.is_locked).where(
            FolderSetting.path.in_(search_paths),
            FolderSetting.is_locked == True
        )
    )
    return result.scalar() is not None


async def is_path_adult(session: AsyncSession, path: Path) -> bool:
    rel_path = _relative_text_for_path(path)
    parts = {piece for piece in rel_path.split("/") if piece}
    if bool(parts & settings.adult_keyword_set):
        return True
        


    # Check if this path or any parent is adult-only in DB
    search_paths = [""]
    current = ""
    for part in rel_path.split("/"):
        if not part: continue
        current = f"{current}/{part}" if current else part
        search_paths.append(current)

    result = await session.execute(
        select(FolderSetting.is_adult).where(
            FolderSetting.path.in_(search_paths),
            FolderSetting.is_adult == True
        )
    )
    return result.scalar() is not None


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

    
    async def process_entries(sess):
        for entry in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
            if entry.name.startswith("."): continue
            stat = entry.stat()
            rel = relative_shared_path(entry)
            is_media = is_media_file(entry)
            media_id = None
            if is_media:
                res = await sess.execute(select(MediaMetadata.id).where(MediaMetadata.relative_path == rel))
                media_id = res.scalar()
            
            items.append(
                {
                    "name": entry.name,
                    "path": rel,
                    "is_dir": entry.is_dir(),
                    "size": 0 if entry.is_dir() else stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime),
                    "locked": await is_path_locked(sess, entry),
                    "adult_only": await is_path_adult(sess, entry),
                    "media": is_media,
                    "media_id": media_id,
                }
            )

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
