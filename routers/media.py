from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.media import build_stream_response, get_media, library_groups, log_play_event, media_source_path, scan_media_library
from core.models import User
from core.schemas import MediaGroup, MessageResponse, PlayEventCreate, StreamResponse
from core.security import get_current_user, require_roles
from core.storage import ensure_pin_for_path


router = APIRouter()


@router.get("/library", response_model=list[MediaGroup])
async def library(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaGroup]:
    groups = await library_groups(session)
    return [MediaGroup(label=group["label"], items=group["items"]) for group in groups]


@router.get("/{media_id}/stream", response_model=StreamResponse)
async def stream(
    media_id: int,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StreamResponse:
    media = await get_media(session, media_id)
    ensure_pin_for_path(media_source_path(media), pin)
    return StreamResponse(**await build_stream_response(session, media))


@router.get("/{media_id}/file")
async def stream_file(
    media_id: int,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    media = await get_media(session, media_id)
    source = media_source_path(media)
    if media.stream_mode != "direct":
        raise HTTPException(status_code=400, detail="This media must be played through HLS.")
    ensure_pin_for_path(source, pin)
    return FileResponse(source)


@router.post("/{media_id}/events", response_model=MessageResponse)
async def play_event(
    media_id: int,
    payload: PlayEventCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    await get_media(session, media_id)
    await log_play_event(
        session,
        user_id=current_user.id,
        media_id=media_id,
        position_seconds=payload.position_seconds,
        completed=payload.completed,
        event_type=payload.event_type,
    )
    return MessageResponse(message="Playback event recorded.")


@router.post("/rescan", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def rescan(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    total = await scan_media_library(session)
    await broadcast_library_updated(total)
    return MessageResponse(message=f"Indexed {total} media item(s).")
