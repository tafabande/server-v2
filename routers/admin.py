from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models import MediaMetadata
from core.schemas import BulkAdultFlagRequest, MessageResponse
from core.security import require_roles

router = APIRouter()

@router.post("/pin/{media_id}", response_model=MessageResponse)
async def toggle_media_pin(
    media_id: int,
    current_user = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Toggle PIN requirement on a specific media item."""
    media = await session.get(MediaMetadata, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media item not found.")
        
    media.requires_pin = not media.requires_pin
    await session.commit()
    
    status_str = "required" if media.requires_pin else "not required"
    return MessageResponse(message=f"Media PIN lock is now {status_str}.")

@router.post("/adult-flag", response_model=MessageResponse)
async def bulk_adult_flag(
    payload: BulkAdultFlagRequest,
    current_user = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Bulk set or unset the adult_only flag on a list of media IDs."""
    if not payload.media_ids:
        return MessageResponse(message="No media IDs provided.")
        
    stmt = (
        update(MediaMetadata)
        .where(MediaMetadata.id.in_(payload.media_ids))
        .values(adult_only=payload.adult_only)
    )
    await session.execute(stmt)
    await session.commit()
    
    action = "flagged as adult content" if payload.adult_only else "unflagged as adult content"
    return MessageResponse(message=f"Successfully {action} for {len(payload.media_ids)} item(s).")
