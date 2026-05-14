from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MessageResponse(BaseModel):
    message: str


class ErrorResponse(BaseModel):
    detail: str
    error_code: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LogoutResponse(BaseModel):
    message: str = "Session ended."


class UserRead(BaseModel):
    id: int
    username: str
    role: str
    preferences: dict
    display_name: str = ""
    avatar_url: str = ""
    bio: str = ""
    language: str = "en"
    concurrent_device_limit: int = 2

    model_config = ConfigDict(from_attributes=True)


class MediaRead(BaseModel):
    id: int
    title: str
    relative_path: str
    category: str
    file_size: int
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    thumbnail_path: str | None = None
    stream_mode: str
    hls_status: str
    requires_pin: bool
    adult_only: bool

    model_config = ConfigDict(from_attributes=True)


class MediaGroup(BaseModel):
    label: str
    items: list[MediaRead]


class StreamResponse(BaseModel):
    mode: str
    url: str


class PlayEventCreate(BaseModel):
    position_seconds: float = 0
    completed: bool = False
    event_type: str = "progress"


class FileItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int
    modified_at: datetime
    locked: bool = False
    media: bool = False


class DirectoryListing(BaseModel):
    path: str
    parent: str | None
    items: list[FileItem]


class RenameRequest(BaseModel):
    path: str
    new_name: str


class DeleteRequest(BaseModel):
    path: str


class PinUnlockRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=12)


class AuditLogRead(BaseModel):
    id: int
    action: str
    target_path: str | None = None
    details: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SystemSettingsRead(BaseModel):
    settings: dict


class SystemSettingsUpdate(BaseModel):
    settings: dict


class PreTranscodeRequest(BaseModel):
    path: str


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(default="", max_length=80)
    avatar_url: str = Field(default="", max_length=512)
    bio: str = Field(default="", max_length=280)
    language: str = Field(default="en", max_length=20)
    theme: str = Field(default="retro-classic", max_length=40)


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="family", max_length=20)
    display_name: str = Field(default="", max_length=80)
    avatar_url: str = Field(default="", max_length=512)
    bio: str = Field(default="", max_length=280)
    language: str = Field(default="en", max_length=20)
    concurrent_device_limit: int = Field(default=2, ge=1, le=10)


class UserUpdateRequest(BaseModel):
    role: str | None = Field(default=None, max_length=20)
    display_name: str | None = Field(default=None, max_length=80)
    avatar_url: str | None = Field(default=None, max_length=512)
    bio: str | None = Field(default=None, max_length=280)
    language: str | None = Field(default=None, max_length=20)
    theme: str | None = Field(default=None, max_length=40)
    concurrent_device_limit: int | None = Field(default=None, ge=1, le=10)


class AdminPasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class ActiveSessionRead(BaseModel):
    jti: str
    user_id: int
    username: str
    role: str
    media_id: int
    title: str
    relative_path: str
    stream_mode: str
    position_seconds: float
    event_type: str
    completed: bool
    updated_at: str


class SystemHealthRead(BaseModel):
    cpu_percent: float
    memory_percent: float
    memory_used_gb: float
    memory_total_gb: float
    disk_percent: float
    disk_used_gb: float
    disk_total_gb: float
    redis_connected: bool
    ffmpeg_available: bool


class SystemSummaryRead(BaseModel):
    media_count: int
    user_count: int
    active_sessions: int
    pending_transcodes: int


class TranscodeLogEntry(BaseModel):
    timestamp: str | None = None
    level: str | None = None
    message: str
    media_id: int | None = None
    command: str | None = None
    returncode: int | None = None


class DashboardRead(BaseModel):
    system_health: SystemHealthRead
    system_summary: SystemSummaryRead
    active_sessions: list[ActiveSessionRead]
    recent_audits: list[AuditLogRead]
    transcode_logs: list[TranscodeLogEntry]


class ContinueWatchingItem(BaseModel):
    media: MediaRead
    last_position_seconds: float
    updated_at: datetime
