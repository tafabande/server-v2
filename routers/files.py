from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.media import log_audit, scan_media_library
from core.models import User
from core.schemas import DeleteRequest, DirectoryListing, MessageResponse, RenameRequest
from core.security import get_current_user, require_roles
from core.storage import delete_path, ensure_pin_for_path, list_directory, rename_path, resolve_shared_path, save_upload


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
) -> DirectoryListing:
    target = resolve_shared_path(path)
    ensure_pin_for_path(target, pin)
    relative_path, parent, items = await list_directory(path)
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
    ensure_pin_for_path(target_dir, pin)
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
    ensure_pin_for_path(target, pin)
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
    ensure_pin_for_path(target, pin)
    deleted = delete_path(payload.path)
    await refresh_library_view(session)
    await log_audit(session, current_user.id, "delete", payload.path, {"deleted_path": str(deleted)})
    return MessageResponse(message="Delete completed.")
