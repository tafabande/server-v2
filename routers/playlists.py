from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models import MediaMetadata, Playlist, PlaylistItem, User
from core.schemas import (
    MediaRead,
    MessageResponse,
    PlaylistCreate,
    PlaylistUpdate,
    PlaylistDetailRead,
    PlaylistItemAdd,
    PlaylistPlayResponse,
    PlaylistRead,
    PlaylistReorderRequest,
)
from core.security import get_current_user
from core.media import is_media_accessible

router = APIRouter()


@router.get("", response_model=list[PlaylistRead])
async def list_playlists(
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> list[PlaylistRead]:
    """List playlists owned by the current user. Favorites is always first."""
    result = await session.execute(
        select(Playlist).where(Playlist.owner_user_id == current_user.id).order_by(Playlist.created_at.asc())
    )
    playlists = list(result.scalars().all())

    # Ensure Favorites exists
    fav_pl = next((p for p in playlists if p.title == "Favorites"), None)
    if not fav_pl:
        fav_pl = Playlist(owner_user_id=current_user.id, title="Favorites", description=None)
        session.add(fav_pl)
        await session.commit()
        await session.refresh(fav_pl)
        playlists.insert(0, fav_pl)
    else:
        # Move favorites to front
        playlists = [fav_pl] + [p for p in playlists if p.id != fav_pl.id]

    out = []
    from core.media import apply_media_security_filters
    for pl in playlists:
        count_stmt = (
            select(func.count())
            .select_from(PlaylistItem)
            .join(MediaMetadata, PlaylistItem.media_id == MediaMetadata.id)
            .where(PlaylistItem.playlist_id == pl.id)
        )
        count_stmt = await apply_media_security_filters(session, count_stmt, current_user)
        count_result = await session.execute(count_stmt)
        count = count_result.scalar() or 0
        out.append(PlaylistRead(
            id=pl.id,
            title=pl.title,
            description=pl.description,
            item_count=count,
            owner_username=current_user.username,
            created_at=pl.created_at,
        ))
    return out


@router.post("", response_model=PlaylistRead)
async def create_playlist(
    payload: PlaylistCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    """Create a new playlist."""
    playlist = Playlist(
        owner_user_id=current_user.id,
        title=payload.title,
        description=payload.description or None,
    )
    session.add(playlist)
    await session.commit()
    await session.refresh(playlist)
    return PlaylistRead(
        id=playlist.id,
        title=playlist.title,
        description=playlist.description,
        item_count=0,
        owner_username=current_user.username,
        created_at=playlist.created_at,
    )


@router.get("/{playlist_id}", response_model=PlaylistDetailRead)
async def get_playlist(
    request: Request,
    playlist_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> PlaylistDetailRead:
    """Get a playlist with its media items."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id and current_user.role not in ("admin", "super-admin"):
        raise HTTPException(status_code=403, detail="Not your playlist.")

    result = await session.execute(
        select(PlaylistItem)
        .where(PlaylistItem.playlist_id == playlist_id)
        .order_by(PlaylistItem.position)
    )
    items = result.scalars().all()

    media_items = []
    for item in items:
        media = await session.get(MediaMetadata, item.media_id)
        if media and await is_media_accessible(session, media, current_user, request):
            media_items.append(MediaRead.model_validate(media))

    owner = await session.get(User, playlist.owner_user_id)
    return PlaylistDetailRead(
        id=playlist.id,
        title=playlist.title,
        description=playlist.description,
        items=media_items,
        owner_username=owner.username if owner else "unknown",
        created_at=playlist.created_at,
    )


@router.delete("/{playlist_id}", response_model=MessageResponse)
async def delete_playlist(
    playlist_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a playlist (owner or admin only). The Favorites playlist cannot be deleted."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id and current_user.role not in ("admin", "super-admin"):
        raise HTTPException(status_code=403, detail="Not authorized.")
    if playlist.title == "Favorites":
        raise HTTPException(status_code=400, detail="The Favorites playlist cannot be deleted.")

    await session.delete(playlist)
    await session.commit()
    return MessageResponse(message="Playlist deleted.")


@router.put("/{playlist_id}", response_model=PlaylistRead)
async def update_playlist(
    playlist_id: int,
    payload: PlaylistUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    """Update a playlist's details."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id and current_user.role not in ("admin", "super-admin"):
        raise HTTPException(status_code=403, detail="Not authorized.")

    if payload.title is not None:
        playlist.title = payload.title
    if payload.description is not None:
        playlist.description = payload.description or None

    await session.commit()
    await session.refresh(playlist)

    from core.media import apply_media_security_filters
    count_stmt = (
        select(func.count())
        .select_from(PlaylistItem)
        .join(MediaMetadata, PlaylistItem.media_id == MediaMetadata.id)
        .where(PlaylistItem.playlist_id == playlist.id)
    )
    count_stmt = await apply_media_security_filters(session, count_stmt, current_user)
    count_result = await session.execute(count_stmt)
    count = count_result.scalar() or 0

    return PlaylistRead(
        id=playlist.id,
        title=playlist.title,
        description=playlist.description,
        item_count=count,
        owner_username=current_user.username,
        created_at=playlist.created_at,
    )



@router.post("/{playlist_id}/items", response_model=MessageResponse)
async def add_item_to_playlist(
    playlist_id: int,
    payload: PlaylistItemAdd,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Add a media item to a playlist."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your playlist.")

    media = await session.get(MediaMetadata, payload.media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found.")

    # Get next position
    count_result = await session.execute(
        select(func.count()).select_from(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id)
    )
    next_pos = (count_result.scalar() or 0)

    item = PlaylistItem(playlist_id=playlist_id, media_id=payload.media_id, position=next_pos)
    session.add(item)
    await session.commit()
    return MessageResponse(message=f"Added '{media.title}' to playlist.")


@router.delete("/{playlist_id}/items/{media_id}", response_model=MessageResponse)
async def remove_item_from_playlist(
    playlist_id: int,
    media_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Remove a media item from a playlist."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your playlist.")

    stmt = select(PlaylistItem).where(
        PlaylistItem.playlist_id == playlist_id,
        PlaylistItem.media_id == media_id
    )
    result = await session.execute(stmt)
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this playlist.")

    await session.delete(item)
    await session.commit()
    return MessageResponse(message="Item removed from playlist.")



@router.put("/{playlist_id}/reorder", response_model=MessageResponse)
async def reorder_playlist(
    playlist_id: int,
    payload: PlaylistReorderRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Reorder items in a playlist by providing the item IDs in desired order."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id and current_user.role not in ("admin", "super-admin"):
        raise HTTPException(status_code=403, detail="Not your playlist.")

    for position, item_id in enumerate(payload.item_ids):
        item = await session.get(PlaylistItem, item_id)
        if item and item.playlist_id == playlist_id:
            item.position = position

    await session.commit()
    return MessageResponse(message="Playlist reordered.")


@router.post("/{playlist_id}/play", response_model=PlaylistPlayResponse)
async def play_playlist(
    request: Request,
    playlist_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
    start_index: int = 0,
) -> PlaylistPlayResponse:
    """Get all media items in order for sequential playback."""
    playlist = await session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if playlist.owner_user_id != current_user.id and current_user.role not in ("admin", "super-admin"):
        raise HTTPException(status_code=403, detail="Not your playlist.")

    result = await session.execute(
        select(PlaylistItem)
        .where(PlaylistItem.playlist_id == playlist_id)
        .order_by(PlaylistItem.position)
    )
    items = result.scalars().all()

    media_items = []
    for item in items:
        media = await session.get(MediaMetadata, item.media_id)
        if media and await is_media_accessible(session, media, current_user, request):
            media_items.append(MediaRead.model_validate(media))

    return PlaylistPlayResponse(
        playlist_id=playlist_id,
        items=media_items,
        current_index=min(start_index, max(0, len(media_items) - 1)),
    )
