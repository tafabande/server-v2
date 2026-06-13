import jwt
import uuid
from pydantic import BaseModel
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

class CurrentUserContext(BaseModel):
    """Pydantic model carrying effective permissions for the current request."""
    id: int
    username: str
    role: str
    is_adult: bool
    preferences: dict
    bio: str = ""
    avatar_url: str = ""
    pin: str | None = None
    password_hash: str = ""
    last_login: datetime | None = None

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
    
    to_encode.update({"exp": expire, "jti": str(uuid.uuid4())})
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
) -> CurrentUserContext:
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
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create request-local context for effective permissions
    ctx = CurrentUserContext(
        id=user.id,
        username=user.username,
        role=user.role,
        is_adult=user.is_adult,
        preferences=user.preferences or {},
        bio=user.bio or "",
        avatar_url=user.avatar_url or "",
        pin=user.pin,
        password_hash=user.password_hash or "",
        last_login=user.last_login
    )
    
    if request.headers.get("x-disable-r18") == "true" or request.query_params.get("disable_r18") == "true":
        ctx.is_adult = False
        
    return ctx

def get_guest_user() -> User:
    """Returns a default 'Guest' user object."""
    return User(
        id=0, # A unique ID for guests, not conflicting with real users
        username="guest",
        role="guest",
        is_adult=False,
        preferences={} # Ensure preferences exist for guest too
    )

async def get_optional_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CurrentUserContext:
    """
    Dependency that attempts to authenticate via cookie or token.
    If no valid authentication is present, returns a fallback 'Guest' user
    which allows read-only access to standard (non-adult) media.
    """
    try:
        token = request.query_params.get("token") or request.cookies.get(settings.session_cookie_name)
        if token:
            user = await get_current_user(request, db, token)
            return user
    except Exception:
        pass # Fallback to guest below if get_current_user fails
            
    guest = get_guest_user()
    return CurrentUserContext(
        id=guest.id,
        username=guest.username,
        role=guest.role,
        is_adult=guest.is_adult,
        preferences=guest.preferences,
        bio="",
        avatar_url="",
        pin=None,
        password_hash="",
        last_login=None
    )

def require_roles(*roles: str) -> Callable:
    """Dependency factory to require specific roles."""
    def role_dependency(user: Annotated[CurrentUserContext, Depends(get_current_user)]) -> CurrentUserContext:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of these roles: {', '.join(roles)}",
            )
        return user
    return role_dependency
