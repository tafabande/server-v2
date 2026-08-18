import math
import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request
from fastapi.responses import FileResponse
from sqlalchemy import select, func, and_, or_, delete, exists
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.events import broadcast_library_updated
from core.logging import get_logger
from core.media import (
    apply_media_security_filters,
    build_stream_response, 
    get_media, 
    get_smart_home_data,
    get_scan_status,
    library_groups, 
    log_play_event, 
    media_source_path, 
    scan_media_library,
    build_sprite_sheet_queued,
    get_sprite_info,
    detect_intro_for_media,
)
from core.models import MediaMetadata, PlayEvent, User
from core.schemas import (
    ContinueWatchingItem,
    MediaGroup,
    MediaRead,
    MessageResponse,
    PaginatedMediaResponse,
    PlayEventCreate,
    SeriesGroupDetailRead,
    SmartHomeResponse,
    StreamResponse,
    WatchHistoryItem,
    HeroResponse,
    HomeItemRead,
    HomeRowResponse,
    RatingCreate,
)
from core.security import get_current_user, get_optional_user, require_roles
from core.storage import ensure_pin_for_path

logger = get_logger("media_router")

router = APIRouter()

# ── Paginated Library ─────────────────────────────────────────────────────────

@router.get("/library", response_model=PaginatedMediaResponse)
async def library(
    request: Request,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=1000),
    sort: str = Query(default="title", pattern="^(title|created_at|duration_seconds|file_size)$"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    type: str | None = Query(default=None, description="Filter by container type (mp4, mkv, avi, etc.)"),
    category: str | None = Query(default=None, description="Filter by category/folder name"),
    q: str | None = Query(default=None, description="Search title"),
    adult_only: bool | None = Query(default=None, description="true=NSFW only, false=SFW only, omit=all"),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> PaginatedMediaResponse:
    """Paginated media library with filters and sorting."""
    stmt = select(MediaMetadata).where(MediaMetadata.file_exists == True)
    stmt = await apply_media_security_filters(session, stmt, current_user, request)

    if type:
        t = type.lower()
        if t == "shorties":
            # Vertical (H > W) and <= 3 mins
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds <= 180,
                MediaMetadata.height.isnot(None),
                MediaMetadata.width.isnot(None),
                MediaMetadata.height > MediaMetadata.width
            ))
        elif t == "movies":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds > 2400,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        elif t == "series":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds > 900,
                MediaMetadata.duration_seconds <= 2400,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        elif t == "movies_series":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds > 900,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        elif t == "videos" or t == "normal":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds >= 60,
                MediaMetadata.duration_seconds <= 900,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        else:
            stmt = stmt.where(MediaMetadata.container == t)
    if category:
        cat_clean = category.strip().lower()
        if cat_clean in {"movie", "movies"}:
            stmt = stmt.where(func.lower(MediaMetadata.category).in_(["movie", "movies"]))
        elif cat_clean in {"series", "tv", "tv shows", "show", "shows"}:
            stmt = stmt.where(func.lower(MediaMetadata.category).in_(["series", "tv", "tv shows", "show", "shows"]))
        else:
            stmt = stmt.where(func.lower(MediaMetadata.category) == cat_clean)

    if q:
        stmt = stmt.where(MediaMetadata.title.ilike(f"%{q}%"))
    if adult_only is True:
        stmt = stmt.where(MediaMetadata.adult_only == True)
    elif adult_only is False:
        stmt = stmt.where(MediaMetadata.adult_only == False)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_items = await session.scalar(count_stmt) or 0
    total_pages = math.ceil(total_items / per_page)

    order_col = getattr(MediaMetadata, sort)
    if order == "desc":
        order_col = order_col.desc()
    stmt = stmt.order_by(order_col).offset((page - 1) * per_page).limit(per_page)

    result = await session.execute(stmt)
    items = result.scalars().all()

    return PaginatedMediaResponse(
        items=items,
        total=total_items,
        page=page,
        per_page=per_page,
        pages=max(1, total_pages),
    )

from core.schemas import LibraryFolderResponse, FolderItem
from pydantic import BaseModel

class FolderActionRequest(BaseModel):
    path: str
    value: bool

@router.get("/folders", response_model=LibraryFolderResponse)
async def get_folders(
    request: Request,
    path: str = Query(default=""),
    type: str | None = Query(default=None),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    """Get folders and files at the specified virtual path."""
    stmt = select(MediaMetadata).where(MediaMetadata.file_exists == True)
    
    # 1. R18 / Adult Filter - Adults only!
    from core.models import FolderSetting
    nsfw_enabled = current_user.preferences.get("nsfw") == True if current_user and current_user.preferences else False
    if request.headers.get("X-Disable-R18") == "true":
        nsfw_enabled = False
    elif request.headers.get("X-Enable-R18") == "true":
        nsfw_enabled = True
        
    adult_folder_exists = exists().where(
        and_(
            FolderSetting.is_adult == True,
            or_(
                func.lower(MediaMetadata.relative_path) == func.lower(FolderSetting.path),
                func.lower(MediaMetadata.relative_path).like(func.lower(FolderSetting.path) + "/%")
            )
        )
    )
    if not current_user or not current_user.is_adult:
        stmt = stmt.where(and_(MediaMetadata.adult_only == False, ~adult_folder_exists))
    else:
        if not nsfw_enabled:
            stmt = stmt.where(and_(MediaMetadata.adult_only == False, ~adult_folder_exists))
        else:
            # Show all content
            pass
        
    if path:
        stmt = stmt.where(MediaMetadata.relative_path.like(f"{path}/%"))
        
    if type:
        t = type.lower()
        if t == "shorties":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds <= 180,
                MediaMetadata.height.isnot(None),
                MediaMetadata.width.isnot(None),
                MediaMetadata.height > MediaMetadata.width
            ))
        elif t == "movies":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds > 2400,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        elif t == "series":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds > 900,
                MediaMetadata.duration_seconds <= 2400,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        elif t == "videos" or t == "normal":
            stmt = stmt.where(and_(
                MediaMetadata.duration_seconds >= 60,
                MediaMetadata.duration_seconds <= 900,
                or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
            ))
        else:
            stmt = stmt.where(MediaMetadata.container == t)
        
    result = await session.execute(stmt)
    all_media = result.scalars().all()
    
    folders_dict = {}
    raw_items = []
    
    for media in all_media:
        rel_path = media.relative_path
        if path == "":
            parts = rel_path.split("/")
        else:
            if not rel_path.startswith(path + "/"):
                continue
            remainder = rel_path[len(path)+1:]
            parts = remainder.split("/")
            
        if len(parts) == 1:
            raw_items.append(media)
        else:
            folder_name = parts[0]
            folder_full_path = f"{path}/{folder_name}" if path else folder_name
            if folder_name not in folders_dict:
                folders_dict[folder_name] = {
                    "path": folder_full_path,
                    "count": 0,
                    "cover_media_id": media.id
                }
            folders_dict[folder_name]["count"] += 1
            
    folder_items = []
    locked_paths = set()
    
    if folders_dict:
        paths = [info["path"] for info in folders_dict.values()]
        fs_stmt = select(FolderSetting).where(FolderSetting.path.in_(paths))
        fs_result = await session.execute(fs_stmt)
        folder_settings = {fs.path: fs for fs in fs_result.scalars().all()}
        
        for name, info in folders_dict.items():
            f_path = info["path"]
            f_set = folder_settings.get(f_path)
            
            is_locked = f_set.is_locked if f_set else False
            is_adult = f_set.is_adult if f_set else False
            
            if is_locked:
                locked_paths.add(f_path)
            
            folder_items.append(FolderItem(
                name=name,
                path=f_path,
                item_count=info["count"],
                is_locked=is_locked,
                is_adult=is_adult,
                cover_media_id=info["cover_media_id"]
            ))
            
    folder_items.sort(key=lambda x: x.name.lower())
    
    # Filter raw_items for locks if not admin
    items = []
    is_admin = current_user and current_user.role in ("admin", "super-admin")
    
    current_path_locked = False
    if path and not is_admin:
        path_parts = path.split("/")
        check_paths = []
        for i in range(len(path_parts)):
            check_paths.append("/".join(path_parts[:i+1]))
        if check_paths:
            fs_stmt = select(FolderSetting).where(FolderSetting.path.in_(check_paths))
            fs_result = await session.execute(fs_stmt)
            for fs in fs_result.scalars().all():
                if fs.is_locked:
                    current_path_locked = True
                    break

    for item in raw_items:
        if not is_admin and (current_path_locked or item.requires_pin):
            continue
        items.append(MediaRead.model_validate(item))
        
    items.sort(key=lambda x: x.title.lower() if x.title else x.filename.lower())
            
    return LibraryFolderResponse(
        folders=folder_items,
        items=items,
        current_path=path
    )

@router.post("/folders/lock", dependencies=[Depends(require_roles("admin", "super-admin"))])
async def toggle_folder_lock(
    req: FolderActionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db)
):
    from core.models import FolderSetting
    stmt = select(FolderSetting).where(FolderSetting.path == req.path)
    result = await session.execute(stmt)
    setting = result.scalar_one_or_none()
    
    if not setting:
        setting = FolderSetting(path=req.path, is_locked=req.value)
        session.add(setting)
    else:
        setting.is_locked = req.value
        
    await session.commit()
    return {"message": "Success"}

@router.post("/folders/r18", dependencies=[Depends(require_roles("admin", "super-admin"))])
async def toggle_folder_r18(
    req: FolderActionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db)
):
    from core.models import FolderSetting
    stmt = select(FolderSetting).where(FolderSetting.path == req.path)
    result = await session.execute(stmt)
    setting = result.scalar_one_or_none()
    
    if not setting:
        setting = FolderSetting(path=req.path, is_adult=req.value)
        session.add(setting)
    else:
        setting.is_adult = req.value
        
    await session.commit()
    return {"message": "Success"}

# ── Library Groups (legacy) ───────────────────────────────────────────────────

@router.get("/groups", response_model=list[MediaGroup])
async def library_grouped(
    request: Request,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaGroup]:
    groups = await library_groups(session, current_user=current_user, request=request)
    return [MediaGroup(label=group["label"], items=group["items"]) for group in groups]

# ── Smart Home Feed ───────────────────────────────────────────────────────────

@router.get("/smart/home", response_model=SmartHomeResponse)
async def smart_home(
    request: Request,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> SmartHomeResponse:
    """Get personalized home feed data."""
    data = await get_smart_home_data(session, current_user, request)
    return SmartHomeResponse(**data)

# ── Recently Added ────────────────────────────────────────────────────────────

@router.get("/recent", response_model=list[MediaRead])
async def recent_media(
    request: Request,
    limit: int = Query(default=30, ge=1, le=100),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaRead]:
    """Get recently added media (last 30 days by default)."""
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    
    stmt = select(MediaMetadata).where(
        MediaMetadata.created_at >= cutoff
    ).order_by(MediaMetadata.created_at.desc()).limit(limit)
    
    stmt = await apply_media_security_filters(session, stmt, current_user, request)
    
    result = await session.execute(stmt)
    return [MediaRead.model_validate(m) for m in result.scalars()]

# ── Scan Status ───────────────────────────────────────────────────────────────

@router.get("/scan-status")
async def scan_status(
    current_user: User = Depends(get_optional_user),
) -> dict:
    """Get current media scan progress."""
    return get_scan_status()

# ── Rescan ───────────────────────────────────────────────────────────────────────

@router.post("/rescan", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def rescan(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    total = await scan_media_library(session, use_cache=False)
    await broadcast_library_updated(total)
    return MessageResponse(message=f"Indexed {total} media item(s).")

# ── Continue Watching ─────────────────────────────────────────────────────────

@router.get("/continue", response_model=list[ContinueWatchingItem])
async def get_continue_watching(
    request: Request,
    current_user: Annotated[User, Depends(get_optional_user)],
    session: AsyncSession = Depends(get_db),
) -> list[ContinueWatchingItem]:
    """Get media the user started but didn't finish."""
    if current_user.role == "guest":
        return []

    result = await session.execute(
        select(PlayEvent)
        .where(
            PlayEvent.user_id == current_user.id,
            PlayEvent.position_seconds > 10,
        )
        .order_by(PlayEvent.created_at.desc())
        .limit(200)
    )

    items = []
    seen_media = set()
    from core.media import is_media_accessible
    
    for event in result.scalars():
        if event.media_id in seen_media:
            continue
        seen_media.add(event.media_id)
        if event.completed:
            continue
            
        media = await session.get(MediaMetadata, event.media_id)
        if media and await is_media_accessible(session, media, current_user, request):
            items.append(ContinueWatchingItem(
                media=MediaRead.model_validate(media),
                last_position_seconds=event.position_seconds,
                updated_at=event.created_at,
            ))
            if len(items) >= 20:
                break
    return items

# ── Watch History ─────────────────────────────────────────────────────────────

@router.get("/history", response_model=list[WatchHistoryItem])
async def get_watch_history(
    request: Request,
    current_user: Annotated[User, Depends(get_optional_user)],
    session: AsyncSession = Depends(get_db),
) -> list[WatchHistoryItem]:
    """Get user's watch history, most recent first."""
    if current_user.role == "guest":
        return []

    result = await session.execute(
        select(PlayEvent)
        .where(PlayEvent.user_id == current_user.id)
        .order_by(PlayEvent.created_at.desc())
        .limit(300)
    )

    items = []
    seen_media = set()
    from core.media import is_media_accessible
    
    for event in result.scalars():
        if event.media_id in seen_media:
            continue
        seen_media.add(event.media_id)
            
        media = await session.get(MediaMetadata, event.media_id)
        if media and await is_media_accessible(session, media, current_user, request):
            items.append(WatchHistoryItem(
                media=MediaRead.model_validate(media),
                last_position_seconds=event.position_seconds,
                completed=event.completed,
                updated_at=event.created_at,
            ))
            if len(items) >= 50:
                break
    return items

class PlayProgressRequest(BaseModel):
    position_seconds: float
    completed: bool = False

@router.post("/{media_id}/progress", response_model=MessageResponse)
async def update_play_progress(
    media_id: int,
    payload: PlayProgressRequest,
    current_user: Annotated[User, Depends(get_optional_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Record or update user watch progress."""
    user_id = current_user.id if current_user and current_user.role != "guest" else 1
    media = await session.get(MediaMetadata, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media item not found.")

    result = await session.execute(
        select(PlayEvent).where(
            PlayEvent.user_id == user_id,
            PlayEvent.media_id == media_id
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        event = PlayEvent(
            user_id=user_id,
            media_id=media_id,
            position_seconds=payload.position_seconds,
            completed=payload.completed,
            created_at=datetime.now(UTC),
        )
        session.add(event)
    else:
        event.position_seconds = payload.position_seconds
        event.completed = payload.completed
        event.created_at = datetime.now(UTC)

    await session.commit()
    return MessageResponse(message="Progress updated.")


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

@router.delete("/history/{event_id}", response_model=MessageResponse)
async def delete_history_item(
    event_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Remove a single item from watch history."""
    event = await session.get(PlayEvent, event_id)
    if not event or event.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="History item not found.")
    await session.delete(event)
    await session.commit()
    return MessageResponse(message="History item removed.")

# ── Search ────────────────────────────────────────────────────────────────────

@router.get("/search", response_model=list[MediaRead])
async def search_media(
    request: Request,
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaRead]:
    """Search for media items, respecting security filters."""
    from sqlalchemy import or_
    
    stmt = select(MediaMetadata).where(
        or_(
            MediaMetadata.title.ilike(f"%{q}%"),
            MediaMetadata.relative_path.ilike(f"%{q}%")
        )
    )
    
    stmt = await apply_media_security_filters(session, stmt, current_user, request)
    
    result = await session.execute(stmt.limit(50))
    return [MediaRead.model_validate(m) for m in result.scalars()]

# ── Favorites List (MUST be registered before /{media_id} catch-all) ─────────

@router.get("/favorites", response_model=list[MediaRead])
async def get_favorites(
    request: Request,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaRead]:
    """Get all favorite media for the current user."""
    from core.models import Favorite

    stmt = (
        select(MediaMetadata)
        .join(Favorite, MediaMetadata.id == Favorite.media_id)
        .where(Favorite.user_id == current_user.id)
        .order_by(Favorite.created_at.desc())
    )
    stmt = await apply_media_security_filters(session, stmt, current_user, request)
    result = await session.execute(stmt)
    items = []
    for m in result.scalars():
        mr = MediaRead.model_validate(m)
        mr.is_favorite = True
        items.append(mr)
    return items

# ── Home Feed — Hero & Rows (MUST be before /{media_id} catch-all) ────────────

@router.get("/home/hero", response_model=HeroResponse | None)
async def home_hero(
    request: Request,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> HeroResponse | None:
    """Return a single featured item for the hero banner."""
    # Featured: most recently added
    fb_stmt = select(MediaMetadata)
    fb_stmt = await apply_media_security_filters(session, fb_stmt, current_user, request)
    fb_stmt = fb_stmt.order_by(MediaMetadata.created_at.desc()).limit(1)
    result = await session.execute(fb_stmt)
    media = result.scalar_one_or_none()
    if not media:
        return None

    return HeroResponse(
        id=media.id,
        title=media.title,
        backdrop=f"/api/media/{media.id}/backdrop",
        synopsis=extract_synopsis_from_nfo(Path(media.path)) or f"Featured in your library: {media.title}.",
        year=extract_year_from_metadata(media),
        duration=media.duration_seconds,
        resume_position=0.0,
        type="featured",
    )

@router.get("/home/rows", response_model=list[HomeRowResponse])
async def home_rows(
    request: Request,
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> list[HomeRowResponse]:
    """Return paginated home feed rows for infinite scroll."""
    data = await get_smart_home_data(session, current_user, request)

    def _item(m: MediaMetadata, progress: float | None = None) -> HomeItemRead:
        return HomeItemRead(
            id=m.id,
            title=m.title,
            poster=f"/api/media/{m.id}/thumbnail",
            duration=m.duration_seconds,
            progress=progress,
        )

    all_rows: list[HomeRowResponse] = []

    if data["recently_added"]:
        all_rows.append(HomeRowResponse(
            title="Recently Added",
            type="new",
            items=[_item(m) for m in data["recently_added"]],
        ))

    return all_rows[offset: offset + 10]

@router.get("/most-liked", response_model=list[MediaRead])
async def get_most_liked(
    request: Request,
    limit: int = Query(default=24, ge=1, le=100),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> list[MediaRead]:
    """Get the most liked (most favorited) media items in the system."""
    from core.models import Favorite
    
    stmt = (
        select(MediaMetadata)
        .join(Favorite, MediaMetadata.id == Favorite.media_id)
        .group_by(MediaMetadata.id)
        .order_by(func.count(Favorite.id).desc(), MediaMetadata.title.asc())
        .limit(limit)
    )
    
    stmt = await apply_media_security_filters(session, stmt, current_user, request)
    result = await session.execute(stmt)
    
    items = []
    for m in result.scalars().all():
        mr = MediaRead.model_validate(m)
        fav_stmt = select(Favorite).where(
            Favorite.user_id == current_user.id,
            Favorite.media_id == m.id
        )
        fav_res = await session.execute(fav_stmt)
        mr.is_favorite = fav_res.scalar_one_or_none() is not None
        items.append(mr)
        
    return items

# ── Series Groups & Curator Index ─────────────────────────────────────────────

@router.get("/series-groups", response_model=list[SeriesGroupDetailRead])
async def get_series_groups(
    request: Request,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    from core.models import SeriesGroup, SeriesMember
    
    # We load the SeriesGroup and their associated MediaMetadata via SeriesMember
    stmt = select(SeriesGroup).order_by(SeriesGroup.name)
    result = await session.execute(stmt)
    groups = result.scalars().all()
    
    # Now we need to populate episodes manually to apply security filters
    out = []
    for g in groups:
        # Get members
        m_stmt = select(MediaMetadata).join(SeriesMember).where(SeriesMember.series_id == g.id).order_by(MediaMetadata.title)
        m_stmt = await apply_media_security_filters(session, m_stmt, current_user, request)
        m_res = await session.execute(m_stmt)
        episodes = m_res.scalars().all()
        if episodes:
            out.append({
                "id": g.id,
                "name": g.name,
                "canonical_title": g.canonical_title,
                "episodes": episodes
            })
    return out

@router.get("/curator-index")
async def curator_index(
    request: Request,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Returns the indexed JSON schema required by the Lexical Clustering architecture.
    """
    from core.models import SeriesMember, SeriesGroup, Tag

    # Fetch all media with their tags and series membership
    query = select(MediaMetadata, Tag.tag, SeriesGroup.name).outerjoin(
        Tag, MediaMetadata.id == Tag.video_id
    ).outerjoin(
        SeriesMember, MediaMetadata.id == SeriesMember.video_id
    ).outerjoin(
        SeriesGroup, SeriesMember.series_id == SeriesGroup.id
    ).where(MediaMetadata.file_exists == True)
    
    query = await apply_media_security_filters(session, query, current_user, request)
    result = await session.execute(query)

    schema = {
        "short_form": {},
        "standard_video": {},
        "long_form_episodes": {},
        "feature_length": {},
        "failed": []
    }

    for row in result:
        media, tag, series_name = row
        if not tag or tag not in schema:
            continue
            
        group_name = series_name if series_name else media.category
        
        if group_name not in schema[tag]:
            schema[tag][group_name] = []
            
        res_str = f"{media.width}x{media.height}" if media.width and media.height else "Unknown"
            
        schema[tag][group_name].append({
            "path": media.relative_path,
            "resolution": res_str,
            "duration": media.duration_seconds or 0
        })

    # Format the dictionaries into arrays of {group_name, files}
    final_schema = {
        "short_form": [],
        "standard_video": [],
        "long_form_episodes": [],
        "feature_length": [],
        "failed": []
    }

    for tag in ["short_form", "standard_video", "long_form_episodes", "feature_length"]:
        for group_name, files in schema[tag].items():
            final_schema[tag].append({
                "group_name": group_name,
                "files": files
            })

    return final_schema

# ── Single Media Detail ───────────────────────────────────────────────────────

@router.get("/{media_id}", response_model=MediaRead)
async def get_media_detail(
    request: Request,
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> MediaRead:
    """Get single media item metadata."""
    media = await get_media(session, media_id)
    
    if media.adult_only and not current_user.is_adult:
        from core.exceptions import AccessDeniedError
        raise AccessDeniedError("Access to 18+ content denied for this account.")
    
    from core.media import is_media_accessible
    from core.exceptions import AccessDeniedError
    if not await is_media_accessible(session, media, current_user, request):
        raise AccessDeniedError("Access to this content is denied.")
    media_read = MediaRead.model_validate(media)
    
    # Check favorite status
    from core.models import Favorite
    fav = await session.execute(
        select(Favorite).where(
            Favorite.user_id == current_user.id,
            Favorite.media_id == media_id
        )
    )
    media_read.is_favorite = fav.scalar_one_or_none() is not None
    
    return media_read

# ── Streaming ─────────────────────────────────────────────────────────────────

@router.get("/{media_id}/stream", response_model=StreamResponse)
async def stream(
    request: Request,
    media_id: int,
    pin: str | None = Query(default=None),
    priority: bool = Query(default=True),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> StreamResponse:
    from pathlib import Path
    media = await get_media(session, media_id)
        
    source = media_source_path(media)
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")

    await ensure_pin_for_path(session, Path(media.path), pin, current_user=current_user)
        
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")

    return StreamResponse(**await build_stream_response(session, media, priority=priority))

@router.get("/{media_id}/file")
async def stream_file(
    request: Request,
    media_id: int,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    media = await get_media(session, media_id)
    source = media_source_path(media)
        
    from pathlib import Path
    await ensure_pin_for_path(session, Path(media.path), pin, current_user=current_user)

        
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")

    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store, no-cache, must-revalidate"
    }
    return FileResponse(source, headers=headers)

# ── Thumbnail ─────────────────────────────────────────────────────────────────

@router.get("/{media_id}/thumbnail")
async def get_thumbnail(
    request: Request,
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Get the poster/thumbnail image for a media item."""
    media = await get_media(session, media_id)
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request, strict=False):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")
        
    from pathlib import Path
    from config import get_settings
    
    settings = get_settings()
    thumb_file = None
    
    if media.thumbnail_path:
        thumb_file = settings.thumbs_folder / Path(media.thumbnail_path.replace(chr(92), "/")).name
    if not thumb_file or not thumb_file.is_file():
        from core.media import build_thumbnail, clean_title
        source = media_source_path(media)
        if source.is_file():
            new_thumb_path, was_repaired = await asyncio.to_thread(
                build_thumbnail, source, media.relative_path, clean_title(source), media.duration_seconds
            )
            media.thumbnail_path = new_thumb_path
            if was_repaired:
                from core.media import probe_media
                probe = await asyncio.to_thread(probe_media, source)
                if probe:
                    media.width = probe.get("width")
                    media.height = probe.get("height")
                    media.bitrate = probe.get("bitrate")
                    media.video_codec = probe.get("video_codec")
                    media.audio_codec = probe.get("audio_codec")
                    media.duration_seconds = probe.get("duration_seconds")
                    try:
                        media.file_size = source.stat().st_size
                    except OSError:
                        pass
            await session.commit()
            
            thumb_file = settings.thumbs_folder / Path(new_thumb_path.replace(chr(92), "/")).name
            
    if not thumb_file or not thumb_file.is_file():
        import hashlib
        from fastapi import Response
        title = media.title or "Media"
        color_hue = int(hashlib.md5(title.encode()).hexdigest()[:6], 16) % 360
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <rect width="300" height="450" fill="hsl({color_hue}, 35%, 12%)"/>
  <rect width="300" height="450" fill="url(#g)" opacity="0.4"/>
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl({color_hue}, 70%, 50%)" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#0b0b0e" stop-opacity="0.8"/>
    </linearGradient>
  </defs>
  <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="36" font-weight="bold">▶</text>
  <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="#e0e0ea" font-family="sans-serif" font-size="14" font-weight="500">{title[:25]}</text>
</svg>"""
        return Response(content=svg.encode("utf-8"), media_type="image/svg+xml")

    return FileResponse(thumb_file)


# ── Preview (Hover Video) ─────────────────────────────────────────────────────

@router.get("/{media_id}/preview")
async def get_media_preview(
    request: Request,
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    """
    Serve the raw file as a preview for hover-video playback.
    Only works for direct-stream formats (mp4, webm, m4v).
    Returns 404 for HLS-only formats — the browser silently skips the preview.
    """
    media = await get_media(session, media_id)
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request, strict=False):
        raise HTTPException(status_code=403, detail="Access denied.")

    if media.stream_mode != "direct":
        # Return 204 No Content instead of 404 to prevent noisy browser console errors
        from fastapi import Response
        return Response(status_code=204)

    source = media_source_path(media)
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store, no-cache, must-revalidate"
    }
    return FileResponse(source, media_type="video/mp4", headers=headers)

# ── Playback Events ──────────────────────────────────────────────────────────

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

# ── Rescan ────────────────────────────────────────────────────────────────────

@router.post("/rescan", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def rescan(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    total = await scan_media_library(session, use_cache=False)
    await broadcast_library_updated(total)
    return MessageResponse(message=f"Indexed {total} media item(s).")

# ── Favorites ─────────────────────────────────────────────────────────────────

@router.post("/{media_id}/favorite", response_model=MessageResponse)
async def toggle_favorite(
    media_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Toggle favorite status for a media item."""
    from core.models import Favorite
    
    stmt = select(Favorite).where(
        Favorite.user_id == current_user.id,
        Favorite.media_id == media_id
    )
    result = await session.execute(stmt)
    fav = result.scalar_one_or_none()
    
    if fav:
        await session.delete(fav)
        message = "Removed from favorites."
    else:
        session.add(Favorite(user_id=current_user.id, media_id=media_id))
        message = "Added to favorites."
        
    await session.commit()
    return MessageResponse(message=message)

@router.post("/{media_id}/like", response_model=MessageResponse)
async def add_like(
    media_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Increment a media item's like count and ensure it is favorited."""
    await get_media(session, media_id)
    
    from sqlalchemy import text
    try:
        await session.execute(text(f"UPDATE media_metadata SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = {media_id}"))
    except Exception:
        pass
        
    if current_user and current_user.role != "guest":
        from core.models import Favorite
        stmt = select(Favorite).where(
            Favorite.user_id == current_user.id,
            Favorite.media_id == media_id
        )
        fav = (await session.execute(stmt)).scalar_one_or_none()
        if not fav:
            session.add(Favorite(user_id=current_user.id, media_id=media_id))
            
    await session.commit()
    return MessageResponse(message="Like added.")

# (GET /favorites moved above /{media_id} to fix FastAPI route-order matching)

@router.post("/{media_id}/lock", response_model=MessageResponse, dependencies=[Depends(require_roles("admin", "family"))])
async def toggle_pg_lock(
    media_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Toggle PG Lock (is_locked) status for a media item."""
    media = await get_media(session, media_id)
    media.is_locked = not media.is_locked
    media.requires_pin = media.is_locked
    await session.commit()
    
    status_str = "locked" if media.is_locked else "unlocked"
    return MessageResponse(message=f"Media {status_str} successfully.")

# ── Rename / Delete Media ────────────────────────────────────────────────────

from pydantic import BaseModel

class MediaRenameRequest(BaseModel):
    title: str

@router.post("/{media_id}/rename", response_model=MessageResponse, dependencies=[Depends(require_roles("admin", "family"))])
async def rename_media(
    media_id: int,
    payload: MediaRenameRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Rename a media metadata title and physical file (ACID-compliant)."""
    media = await get_media(session, media_id)
    old_source = media_source_path(media)
    
    if not payload.title:
        raise HTTPException(status_code=400, detail="New title cannot be empty.")
        
    import os
    from pathlib import Path
    
    # Track filesystem changes for rollback
    fs_changes = []  # list of (old_path, new_path) tuples
    
    if payload.title != media.title:
        safe_name = Path(payload.title.replace("\\", "/").replace("..", "")).name
        if old_source.exists() and safe_name:
            new_source = old_source.with_name(f"{safe_name}{old_source.suffix}")
            if new_source != old_source:
                if new_source.exists():
                    raise HTTPException(status_code=409, detail="A file with the new name already exists.")
                
                # Step 1: Physical rename (file-first)
                try:
                    os.rename(old_source, new_source)
                    fs_changes.append((new_source, old_source))  # rollback: new -> old
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"Failed to physically rename file: {e}")
                
                # Step 2: Update DB paths
                media.path = str(new_source.resolve())
                old_rel = media.relative_path
                if "/" in old_rel:
                    media.relative_path = f"{old_rel.rsplit('/', 1)[0]}/{new_source.name}"
                else:
                    media.relative_path = new_source.name
                    
                # Step 3: Rename thumbnail if it exists
                from config import get_settings
                settings = get_settings()
                if media.thumbnail_path and not media.thumbnail_path.endswith(".svg"):
                    old_thumb = settings.thumbs_folder / Path(media.thumbnail_path.replace(chr(92), "/")).name
                    if old_thumb.exists():
                        import hashlib
                        new_thumb_name = hashlib.md5(media.relative_path.encode()).hexdigest() + ".jpg"
                        new_thumb = settings.thumbs_folder / new_thumb_name
                        try:
                            os.rename(old_thumb, new_thumb)
                            fs_changes.append((new_thumb, old_thumb))  # rollback
                            media.thumbnail_path = f"/thumbs/{new_thumb_name}"
                        except Exception as e:
                            logger.error(f"Failed to rename thumbnail: {e}")

    media.title = payload.title
    
    # Step 4: Commit DB — if this fails, roll back ALL filesystem changes
    try:
        await session.commit()
    except Exception as e:
        logger.error(f"DB commit failed during rename, rolling back filesystem: {e}")
        for current_path, original_path in reversed(fs_changes):
            try:
                os.rename(current_path, original_path)
            except Exception as rollback_err:
                logger.critical(f"FILESYSTEM ROLLBACK FAILED: {current_path} -> {original_path}: {rollback_err}")
        raise HTTPException(status_code=500, detail="Database update failed. File changes have been rolled back.")
    
    await broadcast_library_updated(0)
    return MessageResponse(message="Media renamed successfully.")

@router.delete("/{media_id}", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def delete_media(
    media_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Permanently delete a media item (ACID-compliant: DB first, then disk)."""
    media = await get_media(session, media_id, allow_missing=True)
    
    import os
    source = media_source_path(media)
    resolved_path = str(source.resolve())
    
    # Step 1: Create tombstone + delete DB record atomically
    from core.models import DeletedMediaTombstone
    from datetime import datetime, timedelta, UTC
    
    try:
        tombstone = DeletedMediaTombstone(
            path=resolved_path,
            expires_at=datetime.now(UTC) + timedelta(hours=24)
        )
        session.add(tombstone)
        await session.execute(delete(MediaMetadata).where(MediaMetadata.id == media_id))
        await session.commit()
    except Exception as e:
        logger.error(f"DB transaction failed during delete: {e}")
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Database deletion failed: {e}")
    
    # Step 2: Physical file deletion (post-commit — safe because tombstone prevents resurrection)
    if source.exists():
        try:
            os.remove(source)
        except Exception as e:
            # Non-fatal: tombstone prevents scanner from re-indexing this file
            logger.warning(f"Physical file deletion failed (tombstoned): {source} — {e}")
    
    # Step 3: Clean up thumbnail
    from config import get_settings
    settings = get_settings()
    if media.thumbnail_path and not media.thumbnail_path.endswith(".svg"):
        from pathlib import Path
        thumb_file = settings.thumbs_folder / Path(media.thumbnail_path.replace(chr(92), "/")).name
        if thumb_file.exists():
            try:
                os.remove(thumb_file)
            except Exception:
                pass  # Non-critical
    
    await broadcast_library_updated(0)
    return MessageResponse(message="Media deleted successfully.")

# ── Sprites ───────────────────────────────────────────────────────────────────

@router.get("/{media_id}/sprites")
async def get_sprites(
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Returns sprite sheet metadata for hover-preview thumbnails.
    If the sheet doesn't exist yet, triggers background generation
    and returns 202 so the client knows to poll/retry.
    """
    import asyncio
    media = await get_media(session, media_id)
    info = get_sprite_info(media_id)
    if info:
        return info

    # Kick off sprite generation without blocking the request
    source = media_source_path(media)
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")
        
    asyncio.create_task(
        build_sprite_sheet_queued(source, media_id, media.duration_seconds)
    )
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=202, content={"status": "generating"})

# ── Ratings ───────────────────────────────────────────────────────────────────

@router.post("/{media_id}/rate", response_model=MessageResponse)
async def rate_media(
    media_id: int,
    payload: RatingCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Rate a media item (1-5 stars). Updates existing rating if one exists."""
    from core.models import Rating
    
    await get_media(session, media_id)
    
    existing = await session.execute(
        select(Rating).where(
            Rating.user_id == current_user.id,
            Rating.media_id == media_id
        )
    )
    rating = existing.scalar_one_or_none()
    
    if rating:
        rating.score = payload.score
        message = f"Rating updated to {payload.score} stars."
    else:
        session.add(Rating(user_id=current_user.id, media_id=media_id, score=payload.score))
        message = f"Rated {payload.score} stars."
    
    await session.commit()
    return MessageResponse(message=message)

@router.get("/{media_id}/rating")
async def get_media_rating(
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    """Get average rating and user's personal rating for a media item."""
    from core.models import Rating
    from core.schemas import MediaRatingResponse
    
    await get_media(session, media_id)
    
    # Average
    avg_result = await session.execute(
        select(func.avg(Rating.score), func.count(Rating.id)).where(Rating.media_id == media_id)
    )
    avg_row = avg_result.one()
    avg_score = round(float(avg_row[0]), 1) if avg_row[0] else 0.0
    total = avg_row[1] or 0
    
    # User's rating
    user_result = await session.execute(
        select(Rating.score).where(Rating.user_id == current_user.id, Rating.media_id == media_id)
    )
    user_score = user_result.scalar_one_or_none()
    
    return MediaRatingResponse(
        average_score=avg_score,
        total_ratings=total,
        user_rating=user_score,
    )

# ── Subtitles ─────────────────────────────────────────────────────────────────

@router.get("/{media_id}/subtitles")
async def list_subtitles(
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    """List all subtitles for a media item."""
    from core.models import Subtitle
    from core.schemas import SubtitleRead
    
    await get_media(session, media_id)
    result = await session.execute(
        select(Subtitle).where(Subtitle.media_id == media_id).order_by(Subtitle.language)
    )
    return [SubtitleRead.model_validate(s) for s in result.scalars()]

@router.post("/{media_id}/subtitles", response_model=MessageResponse)
async def upload_subtitle(
    media_id: int,
    language: str = Query(default="en", max_length=10),
    label: str | None = Query(default=None, max_length=100),
    file: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Upload a .srt subtitle file or trigger auto-match if no file is provided."""
    from core.models import Subtitle
    
    media = await get_media(session, media_id)
    source_path = media_source_path(media)
    
    if file is not None:
        if not file.filename.lower().endswith(".srt"):
            raise HTTPException(status_code=400, detail="Only .srt subtitle files are supported.")
        
        import re
        safe_lang = re.sub(r'[^a-zA-Z0-9_-]', '', language) or "en"
        
        dest_filename = f"{source_path.stem}.{safe_lang}.srt"
        if label:
            safe_label = re.sub(r'[^a-zA-Z0-9_-]', '', label)
            if safe_label:
                dest_filename = f"{source_path.stem}.{safe_lang}.{safe_label}.srt"
                
        from config import get_settings
        settings = get_settings()
        subs_dir = settings.data_folder / "subtitles"
        subs_dir.mkdir(parents=True, exist_ok=True)
        dest_path = subs_dir / f"{media_id}_{dest_filename}"
        
        try:
            content = await file.read()
            with open(dest_path, "wb") as f:
                f.write(content)
        except Exception as e:
            logger.error(f"Failed to save subtitle file: {e}")
            raise HTTPException(status_code=500, detail="Failed to write subtitle file to disk.")
        finally:
            await file.close()
            
        existing = await session.execute(
            select(Subtitle).where(Subtitle.file_path == str(dest_path))
        )
        sub = existing.scalar_one_or_none()
        if not sub:
            sub = Subtitle(
                media_id=media_id,
                file_path=str(dest_path),
                language=language,
                label=label or language,
                auto_matched=False,
            )
            session.add(sub)
            await session.commit()
            return MessageResponse(message="Subtitle file uploaded and registered successfully.")
        else:
            sub.language = language
            sub.label = label or language
            await session.commit()
            return MessageResponse(message="Subtitle file uploaded and database record updated.")
    
    else:
        srt_candidates = list(source_path.parent.glob(f"{source_path.stem}*.srt"))
        
        added = 0
        for srt in srt_candidates:
            existing = await session.execute(
                select(Subtitle).where(Subtitle.file_path == str(srt))
            )
            if existing.scalar_one_or_none():
                continue
            
            parts = srt.stem.split(".")
            detected_lang = parts[-1] if len(parts) > 1 and len(parts[-1]) <= 3 else "en"
            
            session.add(Subtitle(
                media_id=media_id,
                file_path=str(srt),
                language=detected_lang,
                label=srt.stem,
                auto_matched=True,
            ))
            added += 1
        
        await session.commit()
        return MessageResponse(message=f"Found and registered {added} subtitle(s).")

@router.delete("/{media_id}/subtitles/{subtitle_id}", response_model=MessageResponse)
async def delete_subtitle(
    media_id: int,
    subtitle_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Remove a subtitle entry."""
    from core.models import Subtitle
    
    sub = await session.get(Subtitle, subtitle_id)
    if not sub or sub.media_id != media_id:
        raise HTTPException(status_code=404, detail="Subtitle not found.")
    
    await session.delete(sub)
    await session.commit()
    return MessageResponse(message="Subtitle removed.")

@router.get("/{media_id}/download")
async def download_media(
    request: Request,
    media_id: int,
    pin: str | None = Query(default=None),
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Download the raw media file for offline viewing."""
    media = await get_media(session, media_id)
    
    from pathlib import Path
    await ensure_pin_for_path(session, Path(media.path), pin, current_user=current_user)
        
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")
        
    source = media_source_path(media)
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")
        
    return FileResponse(
        path=source,
        media_type="application/octet-stream",
        filename=source.name
    )

@router.post("/{media_id}/detect-intro", response_model=MessageResponse)
async def detect_intro(
    media_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Run scene change detection on the media file to find the intro start and end."""
    media = await get_media(session, media_id)
    source_path = media_source_path(media)
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")
        
    intro_start, intro_end = await detect_intro_for_media(source_path)
    media.intro_start = intro_start
    media.intro_end = intro_end
    await session.commit()
    
    return MessageResponse(message=f"Intro detected: {intro_start}s to {intro_end}s.")

import re
from pathlib import Path
import asyncio

def extract_year_from_metadata(media: MediaMetadata) -> int | None:
    match = re.search(r'\b(19\d{2}|20\d{2})\b', media.title)
    if match:
        return int(match.group(1))
    match = re.search(r'\b(19\d{2}|20\d{2})\b', media.relative_path)
    if match:
        return int(match.group(1))
    return None

def extract_synopsis_from_nfo(media_path: Path) -> str | None:
    nfo_path = media_path.with_suffix(".nfo")
    if nfo_path.exists():
        try:
            import xml.etree.ElementTree as ET
            tree = ET.parse(nfo_path)
            plot_node = tree.find(".//plot")
            if plot_node is not None and plot_node.text:
                return plot_node.text.strip()
        except Exception:
            pass
    return None
# ── Home rows and hero moved before /{media_id} catch-all. See above. ─────────

@router.get("/{media_id}/backdrop")
async def get_media_backdrop(
    request: Request,
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Get or extract a cinematic backdrop image for a media item."""
    from config import get_settings
    settings = get_settings()
    
    media = await get_media(session, media_id)
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request, strict=False):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")

    backdrop_path = settings.temp_folder / "backdrops" / f"{media_id}.jpg"
    if not backdrop_path.exists():
        from core.media import ffmpeg_available
        if not ffmpeg_available():
            logger.warning(f"FFmpeg not available. Skipping backdrop generation for media ID {media_id}.")
            return await get_thumbnail(request, media_id, current_user, session)

        settings.temp_folder.mkdir(parents=True, exist_ok=True)
        (settings.temp_folder / "backdrops").mkdir(parents=True, exist_ok=True)
        
        source = media_source_path(media)
        if not source.exists() or not source.is_file():
            raise HTTPException(status_code=404, detail="Media file not found on disk.")
            
        ss_time = 120.0
        if media.duration_seconds:
            if media.duration_seconds > 200:
                ss_time = media.duration_seconds * 0.1
            elif media.duration_seconds > 0:
                ss_time = media.duration_seconds / 2.0
            else:
                ss_time = 0.0
            
        cmd = [
            settings.ffmpeg_path,
            "-y",
            "-ss", f"{ss_time:.3f}",
            "-i", str(media_source_path(media)),
            "-strict", "unofficial",
            "-vframes", "1",
            "-q:v", "4",
            str(backdrop_path)
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await proc.wait()
        except Exception as e:
            logger.error(f"Failed to generate backdrop for {media_source_path(media)}: {e}")
            
    if not backdrop_path.exists():
        return await get_thumbnail(request, media_id, current_user, session)
        
    return FileResponse(backdrop_path)

# (/{media_id}/preview is handled above, before the /{media_id} catch-all.)

@router.get("/hls-secure/{media_id}/{filename:path}")
async def serve_hls_file(
    request: Request,
    media_id: int,
    filename: str,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    media = await get_media(session, media_id)
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")
        
    from core.media import hls_output_dir
    output_dir = hls_output_dir(media_id)
    file_path = (output_dir / filename).resolve()
    
    if output_dir.resolve() not in file_path.parents:
        raise HTTPException(status_code=400, detail="Invalid file path.")
        
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
        
    if filename.endswith(".m3u8"):
        headers = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    else:
        headers = {"Cache-Control": "public, max-age=3600"}
        
    return FileResponse(file_path, headers=headers)

@router.get("/sprites-secure/{media_id}")
async def serve_sprites_file(
    request: Request,
    media_id: int,
    current_user: User = Depends(get_optional_user),
    session: AsyncSession = Depends(get_db),
):
    media = await get_media(session, media_id)
    from core.media import is_media_accessible
    if not await is_media_accessible(session, media, current_user, request):
        raise HTTPException(status_code=403, detail="Access denied for this resource.")
        
    from core.media import sprite_path_for
    file_path = sprite_path_for(media_id)
    
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Sprite sheet not found.")
        
    headers = {"Cache-Control": "public, max-age=3600"}
    return FileResponse(file_path, headers=headers)

# ── Playlists ─────────────────────────────────────────────────────────────────

from core.models import Playlist, PlaylistItem
from core.schemas import PlaylistRead, PlaylistCreate, PlaylistItemAdd

@router.get("/playlists", response_model=list[PlaylistRead])
async def get_playlists(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get all playlists owned by the current user."""
    stmt = select(Playlist).where(Playlist.owner_user_id == current_user.id).order_by(Playlist.title)
    result = await session.execute(stmt)
    playlists = result.scalars().all()
    
    for pl in playlists:
        count_stmt = select(func.count()).select_from(PlaylistItem).where(PlaylistItem.playlist_id == pl.id)
        pl.item_count = (await session.execute(count_stmt)).scalar() or 0
        pl.owner_username = current_user.username
        
    return playlists

@router.post("/playlists", response_model=PlaylistRead)
async def create_playlist(
    payload: PlaylistCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Create a new personal playlist."""
    pl = Playlist(owner_user_id=current_user.id, title=payload.title, description=payload.description)
    session.add(pl)
    await session.commit()
    await session.refresh(pl)
    pl.item_count = 0
    pl.owner_username = current_user.username
    return pl

@router.post("/playlists/{playlist_id}/items", response_model=MessageResponse)
async def add_playlist_item(
    playlist_id: int,
    payload: PlaylistItemAdd,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Add a media item to an existing playlist."""
    pl = await session.get(Playlist, playlist_id)
    if not pl or pl.owner_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Playlist not found.")
        
    await get_media(session, payload.media_id)
    
    stmt = select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id, PlaylistItem.media_id == payload.media_id)
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing:
        return MessageResponse(message="Item is already in this playlist.")
        
    pos_stmt = select(func.max(PlaylistItem.position)).where(PlaylistItem.playlist_id == playlist_id)
    max_pos = (await session.execute(pos_stmt)).scalar() or 0
    
    item = PlaylistItem(playlist_id=playlist_id, media_id=payload.media_id, position=max_pos + 1)
    session.add(item)
    await session.commit()
    
    return MessageResponse(message="Media added to playlist.")
