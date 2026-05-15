from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.media import build_stream_response, get_media, library_groups, log_play_event, media_source_path, scan_media_library
from core.models import MediaMetadata, PlayEvent, User
from core.schemas import (
    ContinueWatchingItem,
    MediaGroup,
    MediaRead,
    MessageResponse,
    PlayEventCreate,
    StreamResponse,
    WatchHistoryItem,
)
from core.security import get_current_user, require_roles
from core.storage import ensure_pin_for_path


router = APIRouter()


@router.get("/library", response_model=list[MediaGroup])
async def library(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaGroup]:
    groups = await library_groups(session, is_adult=current_user.is_adult)
    return [MediaGroup(label=group["label"], items=group["items"]) for group in groups]


@router.get("/{media_id}/stream", response_model=StreamResponse)
async def stream(
    media_id: int,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StreamResponse:
    from config import get_settings
    settings = get_settings()
    media = await get_media(session, media_id)
    if media.requires_pin and pin != settings.admin_pin:
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Valid admin PIN required for this resource.")
        
    if media.adult_only and not current_user.is_adult:
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")

    return StreamResponse(**await build_stream_response(session, media))


@router.get("/{media_id}/file")
async def stream_file(
    media_id: int,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    from config import get_settings
    settings = get_settings()
    media = await get_media(session, media_id)
    source = media_source_path(media)
    if media.stream_mode != "direct":
        raise HTTPException(status_code=400, detail="This media must be played through HLS.")
        
    if media.requires_pin and pin != settings.admin_pin:
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Valid admin PIN required for this resource.")
        
    if media.adult_only and not current_user.is_adult:
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")

    return FileResponse(source)


@router.post("/{media_id}/events", response_model=MessageResponse)
async def play_event(
    media_id: int,
    payload: PlayEventCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    # Skip logging for guest users
    if current_user.role == "guest":
        return MessageResponse(message="Guest session — event not recorded.")

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


# --- New endpoints per rebuild plan §1.3 ---

@router.get("/history", response_model=list[WatchHistoryItem])
async def get_watch_history(
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> list[WatchHistoryItem]:
    """Get user's watch history, most recent first."""
    if current_user.role == "guest":
        return []

    # Get the latest play event per media for this user
    subq = (
        select(
            PlayEvent.media_id,
            func.max(PlayEvent.created_at).label("latest"),
        )
        .where(PlayEvent.user_id == current_user.id)
        .group_by(PlayEvent.media_id)
        .subquery()
    )

    result = await session.execute(
        select(PlayEvent)
        .join(subq, and_(
            PlayEvent.media_id == subq.c.media_id,
            PlayEvent.created_at == subq.c.latest,
        ))
        .where(PlayEvent.user_id == current_user.id)
        .order_by(PlayEvent.created_at.desc())
        .limit(50)
    )

    items = []
    for event in result.scalars():
        media = await session.get(MediaMetadata, event.media_id)
        if media:
            items.append(WatchHistoryItem(
                media=MediaRead.model_validate(media),
                last_position_seconds=event.position_seconds,
                completed=event.completed,
                updated_at=event.created_at,
            ))
    return items


@router.delete("/history", response_model=MessageResponse)
async def clear_watch_history(
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Clear the current user's watch history."""
    result = await session.execute(
        select(PlayEvent).where(PlayEvent.user_id == current_user.id)
    )
    for event in result.scalars():
        await session.delete(event)
    await session.commit()
    return MessageResponse(message="Watch history cleared.")


@router.get("/continue", response_model=list[ContinueWatchingItem])
async def get_continue_watching(
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> list[ContinueWatchingItem]:
    """Get media the user started but didn't finish."""
    if current_user.role == "guest":
        return []

    subq = (
        select(
            PlayEvent.media_id,
            func.max(PlayEvent.created_at).label("latest"),
        )
        .where(PlayEvent.user_id == current_user.id)
        .group_by(PlayEvent.media_id)
        .subquery()
    )

    result = await session.execute(
        select(PlayEvent)
        .join(subq, and_(
            PlayEvent.media_id == subq.c.media_id,
            PlayEvent.created_at == subq.c.latest,
        ))
        .where(
            PlayEvent.user_id == current_user.id,
            PlayEvent.completed == False,
            PlayEvent.position_seconds > 10,
        )
        .order_by(PlayEvent.created_at.desc())
        .limit(20)
    )

    items = []
    for event in result.scalars():
        media = await session.get(MediaMetadata, event.media_id)
        if media:
            items.append(ContinueWatchingItem(
                media=MediaRead.model_validate(media),
                last_position_seconds=event.position_seconds,
                updated_at=event.created_at,
            ))
    return items
