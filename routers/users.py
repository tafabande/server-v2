from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models import User
from core.schemas import (
    AdminPasswordResetRequest,
    MessageResponse,
    PasswordChangeRequest,
    ProfileUpdateRequest,
    UserCreateRequest,
    UserManageRead,
    UserUpdateRequest,
)
from core.security import get_current_user, get_password_hash, require_roles, verify_password

router = APIRouter()


@router.get("", response_model=list[UserManageRead])
async def list_users(
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> list[UserManageRead]:
    """List all users (admin only)."""
    result = await session.execute(select(User).order_by(User.created_at))
    return [UserManageRead.model_validate(u) for u in result.scalars()]


@router.post("", response_model=UserManageRead)
async def create_user(
    payload: UserCreateRequest,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> UserManageRead:
    """Create a new user (admin only)."""
    existing = await session.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken.")

    user = User(
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        role=payload.role,
        bio=payload.bio or None,
        avatar_url=payload.avatar_url or None,
        preferences={"language": payload.language},
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserManageRead.model_validate(user)


@router.put("/{user_id}", response_model=UserManageRead)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> UserManageRead:
    """Update a user's role or details (admin only)."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if payload.role is not None:
        user.role = payload.role
    if payload.bio is not None:
        user.bio = payload.bio
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.display_name is not None:
        prefs = dict(user.preferences or {})
        prefs["display_name"] = payload.display_name
        user.preferences = prefs

    await session.commit()
    await session.refresh(user)
    return UserManageRead.model_validate(user)


@router.delete("/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a user (admin only, cannot delete self)."""
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account.")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    await session.delete(user)
    await session.commit()
    return MessageResponse(message=f"User '{user.username}' deleted.")


@router.post("/{user_id}/reset-password", response_model=MessageResponse)
async def reset_user_password(
    user_id: int,
    payload: AdminPasswordResetRequest,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Reset another user's password (admin only)."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.password_hash = get_password_hash(payload.new_password)
    await session.commit()
    return MessageResponse(message=f"Password reset for '{user.username}'.")


@router.put("/me/password", response_model=MessageResponse)
async def change_own_password(
    payload: PasswordChangeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Change your own password."""
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    current_user.password_hash = get_password_hash(payload.new_password)
    await session.commit()
    return MessageResponse(message="Password changed successfully.")


@router.put("/me/profile", response_model=MessageResponse)
async def update_own_profile(
    payload: ProfileUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Update your own profile (bio, avatar, theme, PIN)."""
    if payload.bio:
        current_user.bio = payload.bio
    if payload.avatar_url:
        current_user.avatar_url = payload.avatar_url

    prefs = dict(current_user.preferences or {})
    if payload.theme:
        prefs["theme"] = payload.theme
    if payload.language:
        prefs["language"] = payload.language
    current_user.preferences = prefs

    if payload.pin is not None:
        if payload.pin == "":
            current_user.pin = None
        else:
            if len(payload.pin) < 4 or len(payload.pin) > 12:
                raise HTTPException(status_code=400, detail="PIN must be between 4 and 12 characters.")
            current_user.pin = get_password_hash(payload.pin)

    await session.commit()
    return MessageResponse(message="Profile updated.")
