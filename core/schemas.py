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


class UserRead(BaseModel):
    id: int
    username: str
    role: str
    preferences: dict

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
