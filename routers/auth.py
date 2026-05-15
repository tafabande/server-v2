from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.database import get_db
from core.models import User
from core.security import (
    create_access_token,
    decode_token,
    get_current_user,
    oauth2_scheme,
    verify_password,
)

settings = get_settings()
router = APIRouter()


@router.post("/token")
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Login to obtain a JWT access token."""
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Update last_login
    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=access_token_expires,
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "avatar_url": user.avatar_url,
        }
    }


@router.get("/me")
async def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    """Get the current authenticated user's profile."""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "bio": current_user.bio,
        "avatar_url": current_user.avatar_url,
        "preferences": current_user.preferences,
        "last_login": current_user.last_login,
        "created_at": current_user.created_at,
    }


@router.post("/logout")
async def logout():
    """Client-side handles token removal, server can blacklist if using Redis."""
    return {"detail": "Successfully logged out"}
