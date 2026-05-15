from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models import AccessRequest, User
from core.schemas import AccessRequestAction, AccessRequestCreate, AccessRequestRead, MessageResponse
from core.security import get_current_user, require_roles


router = APIRouter()


@router.get("", response_model=list[AccessRequestRead], dependencies=[Depends(require_roles("admin"))])
async def list_requests(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AccessRequestRead]:
    """Admin endpoint to list all access requests."""
    result = await session.execute(
        select(AccessRequest, User.username)
        .join(User, AccessRequest.user_id == User.id)
        .order_by(AccessRequest.created_at.desc())
    )
    
    requests = []
    for row in result:
        req, username = row
        data = AccessRequestRead.model_validate(req)
        data.username = username
        requests.append(data)
    
    return requests


@router.post("", response_model=MessageResponse)
async def create_request(
    payload: AccessRequestCreate,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageResponse:
    """User endpoint to request folder access or 18+ elevation."""
    # Check if a pending request already exists
    existing = await session.execute(
        select(AccessRequest).where(
            AccessRequest.user_id == current_user.id,
            AccessRequest.request_type == payload.request_type,
            AccessRequest.target_path == payload.target_path,
            AccessRequest.status == "pending"
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A pending request already exists for this.")

    new_request = AccessRequest(
        user_id=current_user.id,
        request_type=payload.request_type,
        target_path=payload.target_path,
        status="pending"
    )
    session.add(new_request)
    await session.commit()
    
    return MessageResponse(message="Request submitted successfully.")


@router.post("/{request_id}/action", response_model=MessageResponse, dependencies=[Depends(require_roles("admin"))])
async def take_action(
    request_id: int,
    payload: AccessRequestAction,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageResponse:
    """Admin endpoint to approve or deny a request."""
    request = await session.get(AccessRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Request not found.")
    
    if request.status != "pending":
        raise HTTPException(status_code=400, detail="Request is already processed.")

    request.status = payload.status
    request.admin_comment = payload.admin_comment
    
    if payload.status == "approved":
        if request.request_type == "adult_elevation":
            user = await session.get(User, request.user_id)
            if user:
                user.is_adult = True
        elif request.request_type == "folder_access":
            # For folder access, we could add a Permission entry here if needed.
            # Currently, the Permission model is media-specific.
            pass
            
    await session.commit()
    return MessageResponse(message=f"Request {payload.status}.")
