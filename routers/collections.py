from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
import re

from core.database import get_db
from core.models import Collection, CollectionItem, MediaMetadata, User
from core.schemas import (
    CollectionCreate,
    CollectionDetailRead,
    CollectionItemAdd,
    CollectionRead,
    MediaRead,
    MessageResponse,
)
from core.security import get_current_user, require_roles
from core.media import apply_media_security_filters

router = APIRouter()


@router.get("", response_model=list[CollectionRead])
async def list_collections(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[CollectionRead]:
    """List all collections with their item counts."""
    stmt = select(Collection).order_by(Collection.name)
    result = await session.execute(stmt)
    collections = result.scalars().all()
    
    output = []
    for col in collections:
        count_stmt = (
            select(func.count(CollectionItem.id))
            .join(MediaMetadata, CollectionItem.media_id == MediaMetadata.id)
            .where(CollectionItem.collection_id == col.id)
        )
        count_stmt = await apply_media_security_filters(session, count_stmt, current_user)
        item_count = (await session.execute(count_stmt)).scalar() or 0
        
        output.append(CollectionRead(
            id=col.id,
            name=col.name,
            description=col.description,
            poster_url=col.poster_url,
            item_count=item_count,
            created_at=col.created_at
        ))
    return output


@router.post("", response_model=CollectionRead)
async def create_collection(
    payload: CollectionCreate,
    current_user: User = Depends(require_roles("admin", "family")),
    session: AsyncSession = Depends(get_db),
) -> CollectionRead:
    """Create a new collection."""
    existing = await session.execute(select(Collection).where(Collection.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Collection name already exists.")
        
    col = Collection(name=payload.name, description=payload.description)
    session.add(col)
    await session.commit()
    await session.refresh(col)
    
    return CollectionRead(
        id=col.id,
        name=col.name,
        description=col.description,
        poster_url=col.poster_url,
        item_count=0,
        created_at=col.created_at
    )


@router.get("/{id}", response_model=CollectionDetailRead)
async def get_collection_detail(
    id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> CollectionDetailRead:
    """Get collection details including its media items."""
    col = await session.get(Collection, id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found.")
        
    stmt = (
        select(MediaMetadata)
        .join(CollectionItem, MediaMetadata.id == CollectionItem.media_id)
        .where(CollectionItem.collection_id == id)
        .order_by(CollectionItem.sort_order, MediaMetadata.title)
    )
    
    stmt = await apply_media_security_filters(session, stmt, current_user)
        
    result = await session.execute(stmt)
    items = [MediaRead.model_validate(m) for m in result.scalars()]
    
    return CollectionDetailRead(
        id=col.id,
        name=col.name,
        description=col.description,
        poster_url=col.poster_url,
        items=items,
        created_at=col.created_at
    )


@router.put("/{id}", response_model=CollectionRead)
async def update_collection(
    id: int,
    payload: CollectionCreate,
    current_user: User = Depends(require_roles("admin", "family")),
    session: AsyncSession = Depends(get_db),
) -> CollectionRead:
    """Update collection details."""
    col = await session.get(Collection, id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found.")
        
    if payload.name != col.name:
        existing = await session.execute(select(Collection).where(Collection.name == payload.name))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Collection name already exists.")
            
    col.name = payload.name
    col.description = payload.description
    await session.commit()
    await session.refresh(col)
    
    count_stmt = (
        select(func.count(CollectionItem.id))
        .join(MediaMetadata, CollectionItem.media_id == MediaMetadata.id)
        .where(CollectionItem.collection_id == col.id)
    )
    count_stmt = await apply_media_security_filters(session, count_stmt, current_user)
    item_count = (await session.execute(count_stmt)).scalar() or 0
    
    return CollectionRead(
        id=col.id,
        name=col.name,
        description=col.description,
        poster_url=col.poster_url,
        item_count=item_count,
        created_at=col.created_at
    )


@router.delete("/{id}", response_model=MessageResponse)
async def delete_collection(
    id: int,
    current_user: User = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a collection."""
    col = await session.get(Collection, id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found.")
        
    await session.delete(col)
    await session.commit()
    return MessageResponse(message="Collection deleted successfully.")


@router.post("/{id}/items", response_model=MessageResponse)
async def add_collection_item(
    id: int,
    payload: CollectionItemAdd,
    current_user: User = Depends(require_roles("admin", "family")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Add a media item to a collection."""
    col = await session.get(Collection, id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found.")
        
    media = await session.get(MediaMetadata, payload.media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media item not found.")
        
    existing = await session.execute(
        select(CollectionItem).where(
            CollectionItem.collection_id == id,
            CollectionItem.media_id == payload.media_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Media already in collection.")
        
    item = CollectionItem(
        collection_id=id,
        media_id=payload.media_id,
        sort_order=payload.sort_order
    )
    session.add(item)
    await session.commit()
    return MessageResponse(message="Media added to collection.")


@router.delete("/{id}/items/{media_id}", response_model=MessageResponse)
async def remove_collection_item(
    id: int,
    media_id: int,
    current_user: User = Depends(require_roles("admin", "family")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Remove a media item from a collection."""
    stmt = select(CollectionItem).where(
        CollectionItem.collection_id == id,
        CollectionItem.media_id == media_id
    )
    result = await session.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in collection.")
        
    await session.delete(item)
    await session.commit()
    return MessageResponse(message="Item removed from collection.")


@router.post("/auto-group", response_model=MessageResponse)
async def auto_group_endpoint(
    current_user: User = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Auto-group all media in the database into collections by their series name."""
    result = await session.execute(select(MediaMetadata))
    media_list = result.scalars().all()
    
    grouped_count = 0
    series_groups = {}
    
    pattern_s_e = re.compile(r'^(.*?)\s*[-_.]?\s*[sS](\d+)[eE](\d+)', re.IGNORECASE)
    pattern_x = re.compile(r'^(.*?)\s*[-_.]?\s*(\d+)x(\d+)', re.IGNORECASE)
    
    for media in media_list:
        title = media.title
        series_name = None
        sort_order = 0
        
        match = pattern_s_e.match(title)
        if match:
            series_name = match.group(1).strip()
            season = int(match.group(2))
            episode = int(match.group(3))
            sort_order = season * 1000 + episode
        else:
            match = pattern_x.match(title)
            if match:
                series_name = match.group(1).strip()
                season = int(match.group(2))
                episode = int(match.group(3))
                sort_order = season * 1000 + episode
        
        if not series_name and "/" in media.relative_path:
            parts = media.relative_path.split("/")
            if len(parts) >= 3:
                series_name = parts[-3]
            elif len(parts) == 2:
                series_name = parts[-2]
                
        if series_name:
            series_name = series_name.strip().strip("-").strip("_").strip()
            if len(series_name) > 2:
                series_groups.setdefault(series_name, []).append((media.id, sort_order))
                
    for name, items in series_groups.items():
        if not items:
            continue
        res = await session.execute(select(Collection).where(Collection.name == name))
        collection = res.scalar_one_or_none()
        if not collection:
            collection = Collection(name=name, description=f"Automatically grouped series: {name}")
            session.add(collection)
            await session.commit()
            await session.refresh(collection)
            
        existing_res = await session.execute(
            select(CollectionItem.media_id).where(CollectionItem.collection_id == collection.id)
        )
        existing_ids = {r[0] for r in existing_res.all()}
        
        for media_id, sort_order in items:
            if media_id not in existing_ids:
                session.add(CollectionItem(
                    collection_id=collection.id,
                    media_id=media_id,
                    sort_order=sort_order
                ))
                grouped_count += 1
                
    await session.commit()
    return MessageResponse(message=f"Auto-grouped {grouped_count} media item(s) into collections.")
