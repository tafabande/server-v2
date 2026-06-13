from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import UploadFile, status, HTTPException

from config import get_settings
from core.exceptions import AccessDeniedError, MediaHubError, ResourceNotFoundError
from core.logging import get_logger
from core.database import AsyncSessionLocal
from core.models import FolderSetting, MediaMetadata, User
from sqlalchemy import select, func
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

import subprocess
import time
from functools import lru_cache

@lru_cache(maxsize=1024)
def resolve_shortcut(lnk_path: Path) -> Path | None:
    try:
        command = f"""
        $sh = New-Object -ComObject WScript.Shell;
        $target = $sh.CreateShortcut('{lnk_path}').TargetPath;
        Write-Output $target
        """
        completed = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, encoding="utf-8", errors="ignore")
        target = completed.stdout.strip()
        if target and Path(target).exists():
            return Path(target).resolve()
    except Exception:
        pass
    return None

import threading

_shortcut_lock = threading.Lock()
_shortcut_cache = None
_shortcut_cache_time = 0.0

def get_shortcut_mappings() -> list[tuple[Path, Path]]:
    global _shortcut_cache, _shortcut_cache_time
    now = time.time()
    if _shortcut_cache is not None and now - _shortcut_cache_time <= 10:
        return _shortcut_cache

    with _shortcut_lock:
        now = time.time()
        if _shortcut_cache is not None and now - _shortcut_cache_time <= 10:
            return _shortcut_cache

        mappings = []
        base = settings.shared_folder.resolve()
        try:
            for lnk in base.rglob("*.lnk"):
                try:
                    if lnk.is_file():
                        target = resolve_shortcut(lnk)
                        if target:
                            mappings.append((lnk, target))
                except Exception:
                    continue
        except Exception:
            pass
        _shortcut_cache = mappings
        _shortcut_cache_time = now
        return _shortcut_cache

def relative_shared_path(path: Path) -> str:
    path_resolved = path.resolve()
    base_resolved = settings.shared_folder.resolve()
    try:
        return path_resolved.relative_to(base_resolved).as_posix()
    except ValueError:
        for lnk, target in get_shortcut_mappings():
            try:
                rel = path_resolved.relative_to(target.resolve())
                lnk_rel = lnk.parent.resolve().relative_to(base_resolved) / lnk.stem
                return (lnk_rel / rel).as_posix()
            except ValueError:
                continue
        # Safe fallback
        return path_resolved.name

def resolve_shared_path(raw_path: str | None = None) -> Path:
    base = settings.shared_folder.resolve()
    if not raw_path:
        return base
        
    parts = Path(raw_path).parts
    current = base
    allowed_roots = [base]
    
    for part in parts:
        if part == "..":
            parent_candidate = current.parent.resolve()
            is_safe = False
            for root in allowed_roots:
                if parent_candidate == root or root in parent_candidate.parents:
                    is_safe = True
                    break
            if not is_safe:
                raise AccessDeniedError("Path traversal attempt blocked.")
            current = parent_candidate
            continue
            
        lnk_candidate = current / f"{part}.lnk"
        if lnk_candidate.is_file():
            candidate = lnk_candidate.resolve()
        else:
            candidate = (current / part).resolve()
        
        if candidate.suffix.lower() == ".lnk" and candidate.is_file():
            target = resolve_shortcut(candidate)
            if target:
                current = target
                allowed_roots.append(current)
                continue
                
        is_safe = False
        for root in allowed_roots:
            if candidate == root or root in candidate.parents:
                is_safe = True
                break
        if not is_safe:
            raise AccessDeniedError("Path traversal attempt blocked.")
            
        current = candidate
        
    return current

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
    
    from sqlalchemy import func
    stmt = select(FolderSetting.is_locked).where(func.lower(FolderSetting.path).in_(search_paths), FolderSetting.is_locked == True)
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

    from sqlalchemy import func
    stmt = select(FolderSetting.is_adult).where(func.lower(FolderSetting.path).in_(search_paths), FolderSetting.is_adult == True)
    return (await session.execute(stmt)).scalar() is not None

async def ensure_pin_for_path(
    session: AsyncSession,
    path: Path,
    pin: str | None,
    current_user: User | None = None,
) -> None:
    if await is_path_locked(session, path):
        # 1. Check folder-level permission overrides
        if current_user:
            from core.models import FolderPermission
            rel_path = (relative_shared_path(path) if path != settings.shared_folder.resolve() else "").lower()
            
            search_paths = [""]
            current = ""
            for part in rel_path.split("/"):
                if not part:
                    continue
                current = f"{current}/{part}" if current else part
                search_paths.append(current)
                
            stmt = select(FolderPermission).where(
                FolderPermission.user_id == current_user.id,
                FolderPermission.folder_path.in_(search_paths),
                FolderPermission.can_view == True
            )
            has_perm = (await session.execute(stmt)).scalar() is not None
            if has_perm:
                return

        # 2. Check global admin PIN
        if pin == settings.admin_pin:
            return

        # 3. Check user-specific PIN (hashed)
        if current_user and current_user.pin:
            from core.security import verify_password
            if verify_password(pin or "", current_user.pin):
                return

        raise AccessDeniedError("Valid PIN required for this resource.")

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
            select(FolderSetting).where(func.lower(FolderSetting.path).in_([p.lower() for p in ancestor_paths + entry_paths]))
        )
        settings_map = {s.path.lower(): s for s in settings_result.scalars() if s.path}
        
        # 2. Fetch media IDs for all media files in the list
        media_result = await sess.execute(
            select(MediaMetadata.id, MediaMetadata.relative_path).where(MediaMetadata.relative_path.in_(entry_paths))
        )
        media_map = {m.relative_path: m.id for m in media_result.all()}

        # 3. Process with cached data
        parent_locked = any(settings_map[p.lower()].is_locked for p in ancestor_paths if p.lower() in settings_map and settings_map[p.lower()].is_locked)
        parent_adult = any(settings_map[p.lower()].is_adult for p in ancestor_paths if p.lower() in settings_map and settings_map[p.lower()].is_adult)

        for entry in entries:
            if entry.name.startswith("."): continue
            
            is_lnk = entry.suffix.lower() == ".lnk"
            resolved_target = None
            if is_lnk:
                resolved_target = resolve_shortcut(entry)
                
            target_path = resolved_target if resolved_target else entry
            is_dir = target_path.is_dir()
            size = 0 if is_dir else target_path.stat().st_size
            
            rel = relative_shared_path(entry)
            
            # Keyword checks on virtual path
            s = settings_map.get(rel.lower())
            k_locked = any(piece in settings.pin_keyword_set for piece in rel.split("/") if piece)
            k_adult = any(piece in settings.adult_keyword_set for piece in rel.split("/") if piece)
            
            is_locked = parent_locked or k_locked or (s.is_locked if s else False)
            is_adult = parent_adult or k_adult or (s.is_adult if s else False)
            
            if is_lnk and resolved_target:
                # Retrieve and propagate target's locks and R18 statuses
                if await is_path_locked(sess, resolved_target):
                    is_locked = True
                if await is_path_adult(sess, resolved_target):
                    is_adult = True

            media_rel = rel
            if is_lnk and resolved_target and not is_dir:
                media_rel = (Path(rel).parent / (Path(rel).stem + resolved_target.suffix)).as_posix()

            items.append({
                "name": entry.name,
                "path": rel,
                "is_dir": is_dir,
                "size": size,
                "modified_at": datetime.fromtimestamp(target_path.stat().st_mtime),
                "locked": is_locked,
                "adult_only": is_adult,
                "media": media_rel in media_map or (is_media_file(target_path) if is_lnk else False),
                "media_id": media_map.get(media_rel),
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
    safe_filename = Path(upload.filename.replace("\\", "/")).name
    destination = (directory / safe_filename).resolve()
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
    safe_new_name = Path(new_name.replace("\\", "/")).name
    if not safe_new_name or safe_new_name in {".", ".."}:
        raise AccessDeniedError("Invalid target name.")
    destination = target.with_name(safe_new_name)
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
