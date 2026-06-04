from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.media import log_audit, scan_media_library
from core.models import FolderSetting, User
from core.schemas import DeleteRequest, DirectoryListing, FolderSettingRead, FolderSettingUpdate, MessageResponse, MkdirRequest, RenameRequest
from core.security import get_current_user, get_optional_user, require_roles
from core.storage import delete_path, ensure_pin_for_path, is_path_adult, list_directory, relative_shared_path, rename_path, resolve_shared_path, save_upload, settings


router = APIRouter()


async def refresh_library_view(session: AsyncSession) -> int:
    total = await scan_media_library(session)
    await broadcast_library_updated(total)
    return total


@router.get("", response_model=DirectoryListing)
async def browse(
    path: str | None = Query(default=None),
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> DirectoryListing:
    target = resolve_shared_path(path)
    await ensure_pin_for_path(session, target, pin, current_user=current_user)
    
    # Check if user is trying to access an adult folder but is not adult
    if not current_user.is_adult and await is_path_adult(session, target):
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")

    relative_path, parent, items = await list_directory(path, session=session)
    
    # Filter out adult items for non-adult users
    if not current_user.is_adult:
        items = [item for item in items if not item.get("adult_only")]

    return DirectoryListing(path=relative_path, parent=parent, items=items)


@router.post("/upload", response_model=MessageResponse, dependencies=[Depends(require_roles("admin", "family"))])
async def upload(
    path: str | None = Query(default=None),
    pin: str | None = Query(default=None),
    upload_file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    target_dir = resolve_shared_path(path)
    await ensure_pin_for_path(session, target_dir, pin, current_user=current_user)
    
    if not current_user.is_adult and await is_path_adult(session, target_dir):
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")
        
    filename = upload_file.filename or ""
    if filename.lower() in {"thumbs.db", "desktop.ini", ".ds_store"} or filename.startswith("._"):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System files are not allowed.")
        
    destination = await save_upload(path, upload_file)
    await refresh_library_view(session)
    await log_audit(session, current_user.id, "upload", relative_shared_path(destination), {"filename": upload_file.filename})
    return MessageResponse(message="Upload completed.")


@router.post("/rename", response_model=MessageResponse, dependencies=[Depends(require_roles("admin", "family"))])
async def rename(
    payload: RenameRequest,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    target = resolve_shared_path(payload.path)
    await ensure_pin_for_path(session, target, pin, current_user=current_user)
    
    if not current_user.is_adult and await is_path_adult(session, target):
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")
        
    destination = rename_path(payload.path, payload.new_name)
    await refresh_library_view(session)
    await log_audit(session, current_user.id, "rename", payload.path, {"new_name": destination.name})
    return MessageResponse(message="Rename completed.")


@router.post("/delete", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def remove(
    payload: DeleteRequest,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    target = resolve_shared_path(payload.path)
    await ensure_pin_for_path(session, target, pin, current_user=current_user)
    
    if not current_user.is_adult and await is_path_adult(session, target):
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")
        
    deleted = delete_path(payload.path)
    await refresh_library_view(session)
    await log_audit(session, current_user.id, "delete", payload.path, {"deleted_path": relative_shared_path(deleted)})
    return MessageResponse(message="Delete completed.")


@router.post("/mkdir", response_model=MessageResponse, dependencies=[Depends(require_roles("admin", "family"))])
async def mkdir(
    payload: MkdirRequest,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Create a new folder."""
    target_dir = resolve_shared_path(payload.path)
    await ensure_pin_for_path(session, target_dir, pin, current_user=current_user)
    
    if not current_user.is_adult and await is_path_adult(session, target_dir):
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")
        
    from pathlib import Path
    safe_name = Path(payload.name.replace("\\", "/")).name
    if not safe_name or safe_name in {".", ".."}:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid folder name.")
        
    new_dir = (target_dir / safe_name).resolve()
    
    # Safety check: ensure it's within the resolved target parent directory
    if target_dir.resolve() not in new_dir.parents:
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Cannot create folder outside parent directory.")
    
    if new_dir.exists():
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Folder already exists.")
    
    new_dir.mkdir(parents=True, exist_ok=True)
    await log_audit(session, current_user.id, "mkdir", relative_shared_path(new_dir), {"name": payload.name})
    return MessageResponse(message=f"Folder '{payload.name}' created.")


@router.get("/settings", response_model=FolderSettingRead, dependencies=[Depends(get_optional_user)])
async def get_folder_settings(
    path: str,
    session: AsyncSession = Depends(get_db),
) -> FolderSettingRead:
    # Normalize path
    target = resolve_shared_path(path)
    rel_path = (relative_shared_path(target) if target != settings.shared_folder.resolve() else "").lower()

    result = await session.execute(select(FolderSetting).where(FolderSetting.path == rel_path))
    setting = result.scalar_one_or_none()
    
    if not setting:
        return FolderSettingRead(path=rel_path, is_locked=False, is_adult=False)
        
    return FolderSettingRead.model_validate(setting)


@router.post("/settings", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def update_folder_settings(
    path: str,
    payload: FolderSettingUpdate,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageResponse:

    
    # Normalize path
    target = resolve_shared_path(path)
    rel_path = (relative_shared_path(target) if target != settings.shared_folder.resolve() else "").lower()

    result = await session.execute(select(FolderSetting).where(FolderSetting.path == rel_path))
    setting = result.scalar_one_or_none()
    
    if not setting:
        setting = FolderSetting(path=rel_path)
        session.add(setting)
    
    if payload.is_locked is not None:
        setting.is_locked = payload.is_locked
    if payload.is_adult is not None:
        setting.is_adult = payload.is_adult
        
    await session.commit()
    await log_audit(session, current_user.id, "folder_settings", rel_path, payload.model_dump())
    
    # Trigger rescan to update media flags
    await refresh_library_view(session)
    
    from core.webhooks import trigger_webhook
    await trigger_webhook("security.settings_updated", {
        "path": rel_path,
        "settings": payload.model_dump()
    })
    
    return MessageResponse(message="Folder settings updated.")
