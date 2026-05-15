from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.media import log_audit, scan_media_library
from core.models import FolderSetting, User
from core.schemas import DeleteRequest, DirectoryListing, FolderSettingUpdate, MessageResponse, RenameRequest
from core.security import get_current_user, require_roles
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
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> DirectoryListing:
    target = resolve_shared_path(path)
    await ensure_pin_for_path(session, target, pin)
    
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
    await ensure_pin_for_path(session, target_dir, pin)
    destination = await save_upload(path, upload_file)
    await refresh_library_view(session)
    await log_audit(session, current_user.id, "upload", str(destination), {"filename": upload_file.filename})
    return MessageResponse(message="Upload completed.")


@router.post("/rename", response_model=MessageResponse, dependencies=[Depends(require_roles("admin", "family"))])
async def rename(
    payload: RenameRequest,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    target = resolve_shared_path(payload.path)
    await ensure_pin_for_path(session, target, pin)
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
    await ensure_pin_for_path(session, target, pin)
    deleted = delete_path(payload.path)
    await refresh_library_view(session)
    await log_audit(session, current_user.id, "delete", payload.path, {"deleted_path": str(deleted)})
    return MessageResponse(message="Delete completed.")


@router.post("/settings", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def update_folder_settings(
    path: str,
    payload: FolderSettingUpdate,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageResponse:

    
    # Normalize path
    target = resolve_shared_path(path)
    rel_path = relative_shared_path(target) if target != settings.shared_folder.resolve() else ""

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
    
    return MessageResponse(message="Folder settings updated.")
