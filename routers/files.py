from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.logging import get_logger
from core.media import log_audit, scan_media_library
from core.models import FolderSetting, User
from core.schemas import DeleteRequest, DirectoryListing, FolderSettingRead, FolderSettingUpdate, MessageResponse, MkdirRequest, RenameRequest
from core.security import get_current_user, get_optional_user, require_roles
from core.storage import delete_path, ensure_pin_for_path, is_path_adult, list_directory, relative_shared_path, rename_path, resolve_shared_path, save_upload, settings

router = APIRouter()

logger = get_logger("admin.files")

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

@router.post("/upload", response_model=MessageResponse)
async def upload(
    path: str | None = Query(default=None),
    pin: str | None = Query(default=None),
    upload_file: UploadFile = File(...),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    target_dir = resolve_shared_path(path)
    await ensure_pin_for_path(session, target_dir, pin, current_user=current_user)
        
    filename = upload_file.filename or ""
    if filename.lower() in {"thumbs.db", "desktop.ini", ".ds_store"} or filename.startswith("._"):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System files are not allowed.")
        
    destination = await save_upload(path, upload_file)
    from core.media import scan_media_library
    await scan_media_library(session, use_cache=False)
    await broadcast_library_updated(1)
    user_id = current_user.id if current_user else 1
    username = current_user.username if current_user else "lan-user"
    await log_audit(session, user_id, "upload", relative_shared_path(destination), {"filename": upload_file.filename})
    logger.info("User %s uploaded file '%s' to '%s'", username, upload_file.filename, relative_shared_path(destination))
    return MessageResponse(message="Upload completed.")


@router.post("/batch-upload")
async def batch_upload(
    path: str | None = Query(default=None),
    pin: str | None = Query(default=None),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    target_dir = resolve_shared_path(path)
    await ensure_pin_for_path(session, target_dir, pin, current_user=current_user)
        
    uploaded_count = 0
    skipped_count = 0

    for upload_file in files:
        filename = upload_file.filename or ""
        if filename.lower() in {"thumbs.db", "desktop.ini", ".ds_store"} or filename.startswith("._"):
            skipped_count += 1
            continue

        try:
            destination = await save_upload(path, upload_file)
            uploaded_count += 1
            if uploaded_count % 3 == 0:
                await broadcast_library_updated(uploaded_count)
        except Exception as e:
            logger.error("Error saving batch upload file '%s': %s", filename, e)
            skipped_count += 1

    if uploaded_count > 0:
        from core.media import scan_media_library
        await scan_media_library(session, use_cache=False)
        await broadcast_library_updated(uploaded_count)
        user_id = current_user.id if current_user else 1
        username = current_user.username if current_user else "lan-user"
        await log_audit(session, user_id, "batch_upload", relative_shared_path(target_dir), {"count": uploaded_count})
        logger.info("User %s batch uploaded %d files to '%s'", username, uploaded_count, relative_shared_path(target_dir))



    return {
        "status": "success",
        "uploaded": uploaded_count,
        "skipped": skipped_count,
        "total": len(files),
        "message": f"Successfully uploaded {uploaded_count} of {len(files)} files."
    }


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
    logger.info("Admin %s renamed path '%s' to '%s'", current_user.username, payload.path, relative_shared_path(destination))
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
    logger.info("Admin %s deleted path '%s'", current_user.username, payload.path)
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
    logger.info("Admin %s created new directory '%s'", current_user.username, relative_shared_path(new_dir))
    return MessageResponse(message=f"Folder '{payload.name}' created.")

@router.get("/settings", response_model=FolderSettingRead, dependencies=[Depends(get_optional_user)])
async def get_folder_settings(
    path: str = Query(default=""),
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
    payload: FolderSettingUpdate,
    path: str = Query(default=""),
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
        logger.info(
            "Admin %s changed folder lock status for path '%s' to %s",
            current_user.username,
            rel_path,
            payload.is_locked,
        )
    if payload.is_adult is not None:
        setting.is_adult = payload.is_adult
        logger.info(
            "Admin %s changed adult_only status for path '%s' to %s",
            current_user.username, rel_path, payload.is_adult
        )
        
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
