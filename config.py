import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _env_bool(key: str, default: bool) -> bool:
    value = os.getenv(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(key: str, default: int) -> int:
    value = os.getenv(key)
    return default if value is None else int(value)


def _env_path(key: str, default: Path) -> Path:
    value = os.getenv(key)
    if not value:
        return default
    candidate = Path(value)
    return candidate if candidate.is_absolute() else BASE_DIR / candidate


def _env_list(key: str, default: list[str]) -> list[str]:
    value = os.getenv(key)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(slots=True)
class Settings:
    app_name: str
    secret_key: str
    algorithm: str
    access_token_expire_minutes: int
    database_url: str
    shared_folder: Path
    thumbs_folder: Path
    logs_folder: Path
    temp_folder: Path
    hls_folder: Path
    sprites_folder: Path
    allow_signup: bool
    default_admin_username: str
    default_admin_password: str
    admin_pin: str
    maintenance_mode: bool
    adult_keywords: str
    pin_keywords: str
    stale_hls_days: int
    redis_url: str
    host: str
    port: int
    ffmpeg_path: str
    ffprobe_path: str
    cors_origins: list[str]
    session_cookie_name: str
    session_cookie_secure: bool
    session_cookie_samesite: str
    active_session_ttl_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        _load_env_file(BASE_DIR / ".env")
        
        # Consolidate stateful data into a single directory for easy volume mapping
        data_dir = _env_path("DATA_DIR", BASE_DIR / "data")
        
        return cls(
            app_name=os.getenv("APP_NAME", "MediaHub"),
            secret_key=os.getenv("SECRET_KEY", "insecure-default-key-change-me"),
            algorithm=os.getenv("ALGORITHM", "HS256"),
            access_token_expire_minutes=_env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 720),
            database_url=os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{(data_dir / 'mediahub.db').as_posix()}"),
            shared_folder=_env_path("SHARED_FOLDER", BASE_DIR / "shared_media"),
            thumbs_folder=_env_path("THUMBS_FOLDER", data_dir / "thumbs"),
            logs_folder=_env_path("LOGS_FOLDER", data_dir / "logs"),
            temp_folder=_env_path("TEMP_FOLDER", data_dir / "temp"),
            hls_folder=_env_path("HLS_FOLDER", data_dir / "temp" / "hls"),
            sprites_folder=_env_path("SPRITES_FOLDER", data_dir / "sprites"),
            allow_signup=_env_bool("ALLOW_SIGNUP", False),
            default_admin_username=os.getenv("DEFAULT_ADMIN_USERNAME", "admin"),
            default_admin_password=os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123"),
            admin_pin=os.getenv("ADMIN_PIN", "0000"),
            maintenance_mode=_env_bool("MAINTENANCE_MODE", False),
            adult_keywords=os.getenv("ADULT_KEYWORDS", "18+,adult,xxx,nsfw"),
            pin_keywords=os.getenv("PIN_KEYWORDS", "locked,pin,private"),
            stale_hls_days=_env_int("STALE_HLS_DAYS", 7),
            redis_url=os.getenv("REDIS_URL", ""),
            host=os.getenv("HOST", "0.0.0.0"),
            port=_env_int("PORT", 51733),
            ffmpeg_path=str(BASE_DIR / os.getenv("FFMPEG_PATH", "ffmpeg")) if not Path(os.getenv("FFMPEG_PATH", "ffmpeg")).is_absolute() and (BASE_DIR / os.getenv("FFMPEG_PATH", "ffmpeg")).exists() else os.getenv("FFMPEG_PATH", "ffmpeg"),
            ffprobe_path=str(BASE_DIR / os.getenv("FFPROBE_PATH", "ffprobe")) if not Path(os.getenv("FFPROBE_PATH", "ffprobe")).is_absolute() and (BASE_DIR / os.getenv("FFPROBE_PATH", "ffprobe")).exists() else os.getenv("FFPROBE_PATH", "ffprobe"),
            cors_origins=_env_list("CORS_ORIGINS", ["*"]),
            session_cookie_name=os.getenv("SESSION_COOKIE_NAME", "mediahub_session"),
            session_cookie_secure=_env_bool("SESSION_COOKIE_SECURE", False),
            session_cookie_samesite=os.getenv("SESSION_COOKIE_SAMESITE", "lax"),
            active_session_ttl_seconds=_env_int("ACTIVE_SESSION_TTL_SECONDS", 300),
        )

    def ensure_paths(self) -> None:
        for path in (
            self.shared_folder,
            self.thumbs_folder,
            self.logs_folder,
            self.temp_folder,
            self.hls_folder,
            self.sprites_folder,
        ):
            path.mkdir(parents=True, exist_ok=True)

    @property
    def adult_keyword_set(self) -> set[str]:
        return {item.strip().lower() for item in self.adult_keywords.split(",") if item.strip()}

    @property
    def pin_keyword_set(self) -> set[str]:
        return {item.strip().lower() for item in self.pin_keywords.split(",") if item.strip()}


@lru_cache
def get_settings() -> Settings:
    settings = Settings.from_env()
    settings.ensure_paths()
    return settings
