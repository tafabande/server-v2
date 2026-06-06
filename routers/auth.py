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
    response: Response,
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
    
    response.set_cookie(
        key=settings.session_cookie_name,
        value=access_token,
        httponly=True,
        max_age=settings.access_token_expire_minutes * 60,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
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


# Alias: POST /api/auth/login → same as /token
@router.post("/login")
async def login(
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Login endpoint (alias for /token). Returns JWT + user."""
    return await login_for_access_token(response, form_data, db)


from core.schemas import PinUnlockRequest

@router.post("/unlock")
async def unlock_session(
    response: Response,
    req: PinUnlockRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Unlock a session using a PIN (elevates to an admin session)."""
    # Find an admin with this PIN
    result = await db.execute(select(User).where(User.pin == req.pin, User.role.in_(["admin", "super-admin"])))
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid PIN")
        
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=access_token_expires,
    )
    
    response.set_cookie(
        key=settings.session_cookie_name,
        value=access_token,
        httponly=True,
        max_age=settings.access_token_expire_minutes * 60,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )
    
    return {"access_token": access_token}


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
        "is_adult": current_user.is_adult,
        "has_pin": current_user.pin is not None,
    }


@router.put("/me")
async def update_profile(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    bio: str | None = None,
    avatar_url: str | None = None,
    theme: str | None = None,
    language: str | None = None,
):
    """Update current user's profile (bio, prefs)."""
    if bio is not None:
        current_user.bio = bio
    if avatar_url is not None:
        current_user.avatar_url = avatar_url
    
    prefs = dict(current_user.preferences or {})
    if theme is not None:
        prefs["theme"] = theme
    if language is not None:
        prefs["language"] = language
    current_user.preferences = prefs
    
    await db.commit()
    return {"message": "Profile updated."}


@router.post("/change-password")
async def change_password(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_password: str = "",
    new_password: str = "",
):
    """Change password for the authenticated user."""
    if not verify_password(current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")
    
    from core.security import get_password_hash
    current_user.password_hash = get_password_hash(new_password)
    await db.commit()
    return {"message": "Password changed successfully."}


@router.post("/logout")
async def logout(
    response: Response,
    token: str | None = Depends(oauth2_scheme),
):
    """Logout and blacklist the current JWT token."""
    response.delete_cookie(
        key=settings.session_cookie_name,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )
    if token:
        payload = decode_token(token)
        if payload:
            try:
                from core.runtime_state import revoke_token
                exp = payload.get("exp")
                jti = payload.get("jti") or token[-16:]  # Use last 16 chars as pseudo-JTI if no JTI
                await revoke_token(jti, exp)
            except Exception:
                pass  # Graceful degradation if cache is unavailable
    
    return {"detail": "Successfully logged out"}
