from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    is_adult: bool = False
    avatar_url: str = ""
    bio: str = ""
    language: str = "en"
    last_login: datetime | None = None
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
    video_codec: str | None = None
    audio_codec: str | None = None
    container: str | None = None
    thumbnail_path: str | None = None
    stream_mode: str
    hls_status: str
    requires_pin: bool
    adult_only: bool
    intro_start: float | None = None
    intro_end: float | None = None
    is_favorite: bool = False
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def secure_thumbnail(self) -> "MediaRead":
        if self.thumbnail_path and not self.thumbnail_path.startswith("/api/"):
            self.thumbnail_path = f"/api/media/{self.id}/thumbnail"
        return self


class MediaGroup(BaseModel):
    label: str
    items: list[MediaRead]


class FolderItem(BaseModel):
    name: str
    path: str
    item_count: int = 0
    is_locked: bool = False
    is_adult: bool = False
    cover_media_id: int | None = None

class LibraryFolderResponse(BaseModel):
    folders: list[FolderItem]
    items: list[MediaRead]
    current_path: str


class StreamResponse(BaseModel):
    mode: str
    url: str
    qualities: list[str] | None = None


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
    adult_only: bool = False
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
    theme: str = Field(default="default", max_length=40)
    pin: str | None = Field(default=None, max_length=12)
    preferences: dict | None = None


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


# --- New schemas per rebuild plan §1.2 ---

class UserManageRead(BaseModel):
    """Admin-facing user record with full details."""
    id: int
    username: str
    role: str
    avatar_url: str | None = None
    bio: str | None = None
    last_login: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PlaylistCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=1000)


class PlaylistRead(BaseModel):
    id: int
    title: str
    description: str | None = None
    item_count: int = 0
    owner_username: str = ""
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PlaylistDetailRead(BaseModel):
    id: int
    title: str
    description: str | None = None
    items: list[MediaRead] = []
    owner_username: str = ""
    created_at: datetime


class PlaylistItemAdd(BaseModel):
    media_id: int


class WatchHistoryItem(BaseModel):
    media: MediaRead
    last_position_seconds: float
    completed: bool
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContinueWatchingItem(BaseModel):
    media: MediaRead
    last_position_seconds: float
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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


class FolderSettingUpdate(BaseModel):
    is_locked: bool | None = None
    is_adult: bool | None = None


class FolderSettingRead(BaseModel):
    path: str
    is_locked: bool
    is_adult: bool

    model_config = ConfigDict(from_attributes=True)


class AccessRequestCreate(BaseModel):
    request_type: str  # 'folder_access', 'adult_elevation'
    target_path: str | None = None


class AccessRequestRead(BaseModel):
    id: int
    user_id: int
    username: str = ""
    request_type: str
    target_path: str | None = None
    status: str
    admin_comment: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccessRequestAction(BaseModel):
    status: str  # 'approved', 'denied'
    admin_comment: str | None = None


class WebhookRead(BaseModel):
    id: int
    url: str
    events: str
    is_active: bool
    created_at: datetime
    last_triggered_at: datetime | None = None
    failure_count: int

    model_config = ConfigDict(from_attributes=True)


class WebhookCreate(BaseModel):
    url: str = Field(min_length=5, max_length=512)
    events: str = Field(default="*", max_length=255)
    secret: str | None = Field(default=None, max_length=128)


class WebhookUpdate(BaseModel):
    url: str | None = Field(default=None, min_length=5, max_length=512)
    events: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    secret: str | None = Field(default=None, max_length=128)
class SmartHomeResponse(BaseModel):
    continue_watching: list[ContinueWatchingItem]
    recently_added: list[MediaRead]
    trending: list[MediaRead]
    recommendations: list[MediaRead]


# --- Pagination ---

class PaginatedResponse(BaseModel):
    """Generic paginated response wrapper."""
    items: list = []
    total: int = 0
    page: int = 1
    per_page: int = 50
    pages: int = 1


class PaginatedMediaResponse(BaseModel):
    items: list[MediaRead] = []
    total: int = 0
    page: int = 1
    per_page: int = 50
    pages: int = 1


class PaginatedAuditResponse(BaseModel):
    items: list[AuditLogRead] = []
    total: int = 0
    page: int = 1
    per_page: int = 50
    pages: int = 1


# --- File Operations ---

class MkdirRequest(BaseModel):
    path: str
    name: str = Field(min_length=1, max_length=255)


# --- Playlist Operations ---

class PlaylistReorderRequest(BaseModel):
    """List of item IDs in the desired order."""
    item_ids: list[int]


class PlaylistPlayResponse(BaseModel):
    """Response when starting playlist playback."""
    playlist_id: int
    items: list[MediaRead] = []
    current_index: int = 0


# --- Scan Status ---

class ScanStatusResponse(BaseModel):
    scanning: bool = False
    files_scanned: int = 0
    files_total: int = 0
    progress_percent: float = 0.0
    last_scan_at: str | None = None


# --- Subtitle ---

class SubtitleRead(BaseModel):
    id: int
    media_id: int
    file_path: str
    language: str
    label: str | None = None
    auto_matched: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SubtitleUploadResponse(BaseModel):
    subtitle: SubtitleRead
    message: str


# --- Rating ---

class RatingCreate(BaseModel):
    score: int = Field(ge=1, le=5)


class RatingRead(BaseModel):
    id: int
    user_id: int
    media_id: int
    score: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MediaRatingResponse(BaseModel):
    average_score: float = 0.0
    total_ratings: int = 0
    user_rating: int | None = None


# --- Collection ---

class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=1000)


class CollectionRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    poster_url: str | None = None
    item_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CollectionDetailRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    poster_url: str | None = None
    items: list[MediaRead] = []
    created_at: datetime


class CollectionItemAdd(BaseModel):
    media_id: int
    sort_order: int = 0


class BulkAdultFlagRequest(BaseModel):
    media_ids: list[int]
    adult_only: bool


class HeroResponse(BaseModel):
    id: int
    title: str
    backdrop: str
    synopsis: str
    year: int | None = None
    duration: float | None = None
    resume_position: float = 0.0
    type: str


class HomeItemRead(BaseModel):
    id: int
    title: str
    poster: str
    year: int | None = None
    progress: float | None = None
    duration: float | None = None


class HomeRowResponse(BaseModel):
    title: str
    items: list[HomeItemRead]
    type: str


# --- Series / Classification ---

class SeriesGroupRead(BaseModel):
    id: int
    name: str
    canonical_title: str
    episode_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class SeriesGroupDetailRead(BaseModel):
    id: int
    name: str
    canonical_title: str
    episodes: list[MediaRead] = []

    model_config = ConfigDict(from_attributes=True)

