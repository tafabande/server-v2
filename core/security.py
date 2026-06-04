import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Any, Callable, Annotated
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# --- Compatibility Patch for passlib/bcrypt on modern Python ---
import bcrypt
if not hasattr(bcrypt, "__about__"):
    class About:
        __version__ = getattr(bcrypt, "__version__", "4.0.0")
    bcrypt.__about__ = About
# ------------------------------------------------------------

from passlib.context import CryptContext

from config import get_settings
from core.database import get_db
from core.models import User

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt", "pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)

hash_password = get_password_hash


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a new JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def decode_token(token: str) -> Optional[dict[str, Any]]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload
    except jwt.PyJWTError:
        return None


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: str | None = Depends(oauth2_scheme),
) -> User:
    """Dependency to get the current authenticated user."""
    if not token:
        token = request.query_params.get("token")
        
    if not token:
        token = request.cookies.get(settings.session_cookie_name)
        
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check token blacklist (enforces logout)
    try:
        from core.runtime_state import is_token_revoked
        jti = payload.get("jti") or token[-16:]
        if await is_token_revoked(jti):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except ImportError:
        pass  # Graceful degradation if runtime_state is unavailable
    except HTTPException:
        raise  # Re-raise the 401
    except Exception:
        pass  # Cache unavailable — allow through
    
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )
    
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    
    if request.headers.get("x-disable-r18") == "true" or request.query_params.get("disable_r18") == "true":
        user.is_adult = False
        
    return user


async def get_optional_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    Dependency that attempts to authenticate via cookie or token.
    If no valid authentication is present, returns a fallback 'Guest' user
    which allows read-only access to standard (non-adult) media.
    """
    try:
        token = request.query_params.get("token") or request.cookies.get(settings.session_cookie_name)
        user = await get_current_user(request, db, token)
        return user
    except HTTPException:
        # Fallback to Guest
        guest = User(
            id=0,
            username="guest",
            role="guest",
            is_adult=False
        )
        return guest


def require_roles(*roles: str) -> Callable:
    """Dependency factory to require specific roles."""
    def role_dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of these roles: {', '.join(roles)}",
            )
        return user
    return role_dependency
