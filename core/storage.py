from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import UploadFile, status

from config import get_settings
from core.exceptions import AccessDeniedError, MediaHubError, ResourceNotFoundError
from core.logging import get_logger


settings = get_settings()
logger = get_logger("storage")
MEDIA_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".wmv",
    ".m4v",
    ".webm",
    ".flv",
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


def is_path_locked(path: Path) -> bool:
    parts = {piece for piece in _relative_text_for_path(path).split("/") if piece}
    return bool(parts & settings.pin_keyword_set)


def is_path_adult(path: Path) -> bool:
    parts = {piece for piece in _relative_text_for_path(path).split("/") if piece}
    return bool(parts & settings.adult_keyword_set)


def ensure_pin_for_path(path: Path, pin: str | None) -> None:
    if is_path_locked(path) and pin != settings.admin_pin:
        raise AccessDeniedError("Valid admin PIN required for this resource.")


def list_directory(raw_path: str | None = None) -> tuple[str, str | None, list[dict]]:
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
    for entry in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        stat = entry.stat()
        items.append(
            {
                "name": entry.name,
                "path": relative_shared_path(entry),
                "is_dir": entry.is_dir(),
                "size": 0 if entry.is_dir() else stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime),
                "locked": is_path_locked(entry),
                "media": is_media_file(entry),
            }
        )
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
