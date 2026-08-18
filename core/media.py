from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import asyncio
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from config import BASE_DIR, get_settings
from core.exceptions import FileOperationError, ResourceNotFoundError
from core.logging import get_logger
from core.models import AuditLog, FolderSetting, MediaMetadata, PlayEvent, SeriesGroup, SeriesMember, Tag, User
from core.storage import is_media_file, relative_shared_path

settings = get_settings()
logger = get_logger("media")
DIRECT_STREAM_EXTENSIONS = {".mp4", ".m4v", ".webm"}
# Global locks to prevent redundant FFmpeg processes
_active_transcodes: set[int] = set()
_transcode_events: dict[int, asyncio.Event] = {}
# Active FFmpeg processes registry for leak safeguards
_active_processes: dict[int, asyncio.subprocess.Process] = {}

# Concurrency limit for heavy FFmpeg sprite sheet generation
_sprite_semaphore = asyncio.Semaphore(2)

# Scan progress tracking
_scan_state = {
    "scanning": False,
    "files_scanned": 0,
    "files_total": 0,
    "current_folder": "",
    "last_scan_at": None,
}

def get_scan_status() -> dict:
    """Return current scan progress."""
    total = _scan_state.get("files_total", 0)
    scanned = _scan_state.get("files_scanned", 0)
    progress = (scanned / total * 100) if total > 0 else 0.0
    return {
        "scanning": _scan_state.get("scanning", False),
        "files_scanned": scanned,
        "files_total": total,
        "progress_percent": round(progress, 1),
        "current_folder": _scan_state.get("current_folder", ""),
        "last_scan_at": _scan_state.get("last_scan_at", None),
    }

def parse_nfo_file(path: Path) -> dict:
    """Parse local sidecar .nfo file (Kodi/Jellyfin/Plex XML standard) for rich metadata."""
    nfo_candidates = [
        path.with_suffix(".nfo"),
        path.parent / "movie.nfo",
        path.parent / f"{path.stem}.nfo"
    ]
    
    nfo_path = None
    for cand in nfo_candidates:
        if cand.exists() and cand.is_file():
            nfo_path = cand
            break

    if not nfo_path:
        return {}

    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(nfo_path)
        root = tree.getroot()
        
        meta = {}
        title_node = root.find(".//title")
        if title_node is not None and title_node.text:
            meta["title"] = title_node.text.strip()
            
        year_node = root.find(".//year")
        if year_node is not None and year_node.text:
            try:
                meta["year"] = int(year_node.text.strip())
            except ValueError:
                pass
                
        plot_node = root.find(".//plot") or root.find(".//outline")
        if plot_node is not None and plot_node.text:
            meta["plot"] = plot_node.text.strip()

        genre_node = root.find(".//genre")
        if genre_node is not None and genre_node.text:
            meta["genre"] = genre_node.text.strip()

        rating_node = root.find(".//rating")
        if rating_node is not None and rating_node.text:
            try:
                meta["rating"] = float(rating_node.text.strip())
            except ValueError:
                pass

        return meta
    except Exception as e:
        logger.debug(f"Failed to parse NFO file {nfo_path}: {e}")
        return {}

def clean_title(path: Path) -> str:
    nfo_meta = parse_nfo_file(path)
    if "title" in nfo_meta:
        return nfo_meta["title"]
            
    # Remove common technical tags and scene information
    import re
    raw = path.stem
    # Remove resolution (480p, 720p, 1080p, 2160p, 4k)
    raw = re.sub(r'\b\d{3,4}p\b', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\b4k\b', '', raw, flags=re.IGNORECASE)
    # Remove codecs and containers
    raw = re.sub(r'\b(h264|h265|x264|x265|hevc|web-dl|webrip|bluray|brrip)\b', '', raw, flags=re.IGNORECASE)
    # Remove release groups and years in brackets/parens
    raw = re.sub(r'[\(\[].*?[\)\]]', '', raw)
    
    title = raw.replace(".", " ").replace("_", " ").replace("-", " ")
    return " ".join(part for part in title.split() if part).title()


def media_category(path: Path) -> str:
    relative = relative_shared_path(path)
    return relative.split("/", 1)[0] if "/" in relative else "Recently Added"

def thumbnail_path_for(relative_path: str) -> Path:
    # Replace slashes with double underscores for a flat thumbs directory
    safe_name = relative_path.replace("/", "__").replace("\\", "__")
    # Replace URL-sensitive characters that can cause issues in browser requests or truncated URLs
    safe_name = safe_name.replace("#", "_").replace("?", "_").replace("%", "_").replace("&", "_")
    return settings.thumbs_folder / f"{safe_name}.svg"

def hls_output_dir(media_id: int) -> Path:
    return settings.hls_folder / str(media_id)

def detect_stream_mode(path: Path) -> str:
    return "direct" if path.suffix.lower() in DIRECT_STREAM_EXTENSIONS else "hls"

def ffmpeg_available() -> bool:
    return shutil.which(settings.ffmpeg_path) is not None

def ffprobe_available() -> bool:
    return shutil.which(settings.ffprobe_path) is not None

def write_placeholder_thumbnail(destination: Path, title: str) -> None:
    import hashlib
    # Generate a stable color based on title
    h = hashlib.sha256(title.encode()).hexdigest()
    hue = int(h[:2], 16) % 360
    color1 = f"hsl({hue}, 60%, 25%)"
    color2 = f"hsl({(hue + 40) % 360}, 70%, 15%)"
    accent = f"hsl({hue}, 80%, 70%)"
    
    escaped_title = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg_{hue}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{color1}" />
      <stop offset="100%" stop-color="{color2}" />
    </linearGradient>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.05" />
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="640" height="360" fill="url(#bg_{hue})" />
  <rect width="640" height="360" fill="transparent" filter="url(#noise)" opacity="0.4" />
  
  <!-- VHS Tape aesthetic elements -->
  <rect x="0" y="0" width="640" height="40" fill="rgba(0,0,0,0.3)" />
  <rect x="0" y="320" width="640" height="40" fill="rgba(0,0,0,0.3)" />
  
  <rect x="40" y="60" width="4" height="240" fill="{accent}" opacity="0.3" />
  
  <text x="60" y="32" fill="{accent}" font-size="12" font-family="monospace" letter-spacing="2">MEDIAHUB // PREMIUM TAPE</text>
  
  <text x="60" y="160" fill="white" font-size="48" font-family="Impact, sans-serif" style="text-transform:uppercase; letter-spacing: -1px;">{escaped_title[:40]}{'...' if len(escaped_title) > 40 else ''}</text>
  
  <text x="60" y="210" fill="{accent}" font-size="18" font-family="monospace" opacity="0.8">HI-FI STEREO / AUTO-INDEX</text>
  
  <rect x="540" y="280" width="60" height="20" rx="4" fill="transparent" stroke="{accent}" stroke-width="1" />
  <text x="550" y="294" fill="{accent}" font-size="10" font-family="monospace">SP 120</text>
</svg>
"""
    destination.write_text(svg, encoding="utf-8")

def build_thumbnail(source_path: Path, relative_path: str, title: str, duration: float | None = None) -> tuple[str, bool]:
    destination = thumbnail_path_for(relative_path)
    jpg_destination = destination.with_suffix(".jpg")

    if jpg_destination.exists():
        # Real JPG thumbnail already exists
        return f"/thumbs/{jpg_destination.name}", False

    # Cinematic Discovery: Look for local posters/art
    for art_name in ["poster.jpg", "folder.jpg", "cover.jpg", "fanart.jpg"]:
        local_art = source_path.parent / art_name
        if local_art.exists():
            shutil.copy2(local_art, jpg_destination)
            if destination.exists():
                try:
                    destination.unlink(missing_ok=True)
                except Exception:
                    pass
            return f"/thumbs/{jpg_destination.name}", False
            
    was_repaired = False
    if ffmpeg_available():
        seek_seconds = 10.0
        if duration is not None:
            if duration <= 10.0:
                seek_seconds = max(0.0, duration - 1.0)
            elif duration <= 20.0:
                seek_seconds = 5.0
        else:
            seek_seconds = 2.0

        command = [
            settings.ffmpeg_path,
            "-y",
            "-i",
            str(source_path),
            "-ss",
            f"{seek_seconds:.2f}",
            "-an",
            "-sn",
            "-vf",
            "scale=480:-2",
            "-strict",
            "unofficial",
            "-vframes",
            "1",
            "-q:v",
            "4",
            str(jpg_destination),
        ]
        try:
            creation_flags = 0
            if os.name == 'nt':
                creation_flags = 0x08000000  # CREATE_NO_WINDOW
                
            completed = subprocess.run(command, capture_output=True, encoding="utf-8", errors="ignore", timeout=30, creationflags=creation_flags)
            if completed.returncode == 0 and jpg_destination.exists():
                logger.info(f"Generated thumbnail for {relative_path}")
                if destination.exists():
                    try:
                        destination.unlink(missing_ok=True)
                    except Exception:
                        pass
                return f"/thumbs/{jpg_destination.name}", False
                
            # Thumbnail extraction failed. Attempt remux repair once:
            # ffmpeg -fflags +genpts -i input.mp4 -c copy fixed.mp4
            # This rewrites the container with a clean moov atom.
            logger.warning(f"Thumbnail generation failed for {relative_path}. Attempting to remux and repair the container once...")
            temp_fixed = settings.temp_folder / f".fixed_{source_path.name}"
            remux_command = [
                settings.ffmpeg_path,
                "-y",
                "-fflags",
                "+genpts",
                "-i",
                str(source_path),
                "-c",
                "copy",
                str(temp_fixed)
            ]
            try:
                remux_res = subprocess.run(remux_command, capture_output=True, encoding="utf-8", errors="ignore", timeout=60, creationflags=creation_flags)
                if remux_res.returncode == 0 and temp_fixed.exists() and temp_fixed.stat().st_size > 0:
                    # Replace original file with fixed one
                    try:
                        source_path.unlink(missing_ok=True)
                        shutil.move(str(temp_fixed), str(source_path))
                        logger.info(f"Successfully repaired container for {relative_path} via remux.")
                        was_repaired = True
                        
                        # Retry thumbnail generation on the fixed file!
                        completed = subprocess.run(command, capture_output=True, encoding="utf-8", errors="ignore", timeout=30, creationflags=creation_flags)
                        if completed.returncode == 0 and jpg_destination.exists():
                            logger.info(f"Successfully generated thumbnail for {relative_path} after remux repair.")
                            if destination.exists():
                                try:
                                    destination.unlink(missing_ok=True)
                                except Exception:
                                    pass
                            return f"/thumbs/{jpg_destination.name}", True
                    except Exception as e:
                        logger.error(f"Failed to replace original file with repaired file for {relative_path}: {e}")
                else:
                    logger.warning(f"Remux repair failed for {relative_path}: {remux_res.stderr}")
            except Exception as e:
                logger.error(f"Error during remux repair for {relative_path}: {e}")
            finally:
                if temp_fixed.exists():
                    try:
                        temp_fixed.unlink(missing_ok=True)
                    except Exception:
                        pass
        except FileNotFoundError:
            logger.error("FFmpeg executable not found during thumbnail generation.")

    if destination.exists():
        return f"/thumbs/{destination.name}", was_repaired

    write_placeholder_thumbnail(destination, title)
    return f"/thumbs/{destination.name}", was_repaired

# ── Sprite Sheet (Hover Preview Thumbnails) ────────────────────────────────────
SPRITE_THUMB_W = 160
SPRITE_THUMB_H = 90
SPRITE_COLUMNS = 10
SPRITE_INTERVAL = 5   # seconds between frames

def sprite_path_for(media_id: int) -> Path:
    return settings.sprites_folder / f"sprite_{media_id}.jpg"

def build_sprite_sheet(source_path: Path, media_id: int, duration: float | None = None) -> dict | None:
    """
    Generate a tiled JPEG sprite sheet for hover-preview thumbnails.
    One frame every SPRITE_INTERVAL seconds, SPRITE_COLUMNS wide.
    Returns metadata dict on success, None on failure.
    """
    destination = sprite_path_for(media_id)
    if destination.exists():
        return _sprite_meta(destination, media_id)

    if not ffmpeg_available():
        return None

    if duration is None:
        try:
            probe = probe_media(source_path)
            duration = probe.get("duration_seconds")
            if not probe.get("video_codec"):
                logger.info(f"Skipping sprite sheet for {media_id}: No video stream detected.")
                return None
        except Exception:
            pass

    if not duration or duration <= 0:
        duration = 300.0  # Fallback to 5 minutes to avoid massive empty grids

    import math
    if duration < SPRITE_INTERVAL:
        fps_val = 1.0 / max(0.1, duration)
    else:
        fps_val = 1.0 / SPRITE_INTERVAL
        
    total_frames = max(1, int(duration * fps_val))
    rows = math.ceil(total_frames / SPRITE_COLUMNS)

    vf = (
        f"fps={fps_val:.5f},"
        f"scale={SPRITE_THUMB_W}:{SPRITE_THUMB_H},"
        f"tile={SPRITE_COLUMNS}x{rows}"
    )
    command = [
        settings.ffmpeg_path,
        "-y",
        "-i", str(source_path),
        "-vf", vf,
        "-strict", "unofficial",
        "-vframes", "1",
        "-q:v", "5",
        str(destination),
    ]
    
    creation_flags = 0
    if os.name == 'nt':
        creation_flags = 0x00000040 # IDLE_PRIORITY_CLASS

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            encoding="utf-8",
            errors="ignore",
            timeout=300,
            creationflags=creation_flags
        )
        if result.returncode == 0 and destination.exists():
            logger.info(f"Generated sprite sheet for media {media_id}")
            return _sprite_meta(destination, media_id)
        logger.error(f"Sprite generation failed for {media_id}: {result.stderr[-500:]}")
    except subprocess.TimeoutExpired:
        logger.error(f"Sprite generation timed out for media {media_id}")
    except FileNotFoundError:
        logger.error("FFmpeg not found during sprite sheet generation")
    except Exception as e:
        logger.error(f"Unexpected error during sprite sheet generation for media {media_id}: {e}")
    return None

def _sprite_meta(path: Path, media_id: int) -> dict:
    return {
        "url": f"/api/media/sprites-secure/{media_id}",
        "thumb_w": SPRITE_THUMB_W,
        "thumb_h": SPRITE_THUMB_H,
        "columns": SPRITE_COLUMNS,
        "interval": SPRITE_INTERVAL,
    }

async def build_sprite_sheet_queued(source_path: Path, media_id: int, duration: float | None = None) -> dict | None:
    """
    Generate a tiled JPEG sprite sheet for hover-preview thumbnails,
    queued using a Semaphore to limit concurrency.
    """
    async with _sprite_semaphore:
        return await asyncio.to_thread(build_sprite_sheet, source_path, media_id, duration)

def get_sprite_info(media_id: int) -> dict | None:
    """Return sprite metadata if the sheet already exists, else None."""
    path = sprite_path_for(media_id)
    if path.exists():
        return _sprite_meta(path, media_id)
    return None

def probe_media(path: Path) -> dict:
    if not ffprobe_available():
        return {}

    command = [
        settings.ffprobe_path,
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        creation_flags = 0
        if os.name == 'nt':
            creation_flags = 0x08000000  # CREATE_NO_WINDOW
        completed = subprocess.run(command, capture_output=True, encoding="utf-8", errors="ignore", creationflags=creation_flags)
        if completed.returncode != 0:
            return {}
    except Exception:
        return {}

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {}

    format_data = payload.get("format", {})
    streams = payload.get("streams", [])
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    
    duration_val = format_data.get("duration")
    if not duration_val and video_stream:
        duration_val = video_stream.get("duration")
    if not duration_val and "tags" in video_stream and "DURATION" in video_stream["tags"]:
        import re
        m = re.match(r"(\d+):(\d+):(\d+\.?\d*)", video_stream["tags"]["DURATION"])
        if m:
            duration_val = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
            
    try:
        duration_seconds = float(duration_val) if duration_val else None
    except (ValueError, TypeError):
        duration_seconds = None

    return {
        "duration_seconds": duration_seconds,
        "bitrate": int(format_data["bit_rate"]) if format_data.get("bit_rate") else None,
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "video_codec": video_stream.get("codec_name"),
        "audio_codec": audio_stream.get("codec_name"),
    }

def resolve_shortcut(lnk_path: Path) -> Path | None:
    try:
        command = f"""
        $sh = New-Object -ComObject WScript.Shell;
        $target = $sh.CreateShortcut('{lnk_path}').TargetPath;
        Write-Output $target
        """
        completed = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, encoding="utf-8", errors="ignore")
        target = completed.stdout.strip()
        if target and Path(target).exists():
            return Path(target)
    except Exception:
        pass
    return None

def _path_is_inside(path: Path, root: Path | None) -> bool:
    if root is None:
        return False
    try:
        resolved_path = path.resolve(strict=False)
        resolved_root = root.resolve(strict=False)
    except (OSError, RuntimeError):
        return False
    return resolved_path == resolved_root or resolved_root in resolved_path.parents

def _configured_log_dir_candidates() -> list[Path]:
    candidates = [settings.logs_folder]
    raw_log_dir = os.getenv("LOGS_FOLDER")
    if raw_log_dir:
        raw_path = Path(raw_log_dir)
        candidates.append(raw_path if raw_path.is_absolute() else BASE_DIR / raw_path)
    return candidates

def get_all_media_files(root: Path, base_relative: str = "", use_cache: bool = True) -> list[tuple[Path, str]]:
    logger.info(f"Configured scan root: {root}")

    try:
        resolved_root_str = str(root.resolve(strict=False))
    except Exception:
        resolved_root_str = str(root)

    items: list[tuple[Path, str]] = []
    visited_dirs: set[str] = set()
    visited_files: set[str] = set()
    logged_errors: set[str] = set()

    cache_file = settings.temp_folder / "file_scan_cache.json"
    if use_cache and cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                if data.get("version") == "1.1" and data.get("root") == resolved_root_str:
                    cached_items = []
                    resolved_root = os.path.realpath(resolved_root_str)
                    from core.storage import get_shortcut_mappings
                    shortcut_targets = []
                    for lnk, target in get_shortcut_mappings():
                        try:
                            shortcut_targets.append(os.path.realpath(str(target.resolve())))
                        except Exception:
                            continue

                    for p, rel in data.get("items", []):
                        resolved_p = os.path.realpath(p)
                        is_safe = resolved_p == resolved_root or resolved_p.startswith(resolved_root + os.sep)
                        if not is_safe:
                            for target_path in shortcut_targets:
                                if resolved_p == target_path or resolved_p.startswith(target_path + os.sep):
                                    is_safe = True
                                    break
                        if is_safe:
                            cached_items.append((Path(resolved_p), rel))
                        else:
                            logger.warning("Path traversal or outside-root path detected in scan cache: %s", p)
                    return cached_items
                else:
                    logger.info("Scan cache context mismatch (root or version). Rebuilding...")
            else:
                logger.info("Legacy scan cache format detected. Rebuilding...")
        except Exception as e:
            logger.warning(f"Failed to read scan cache: {e}")

    def log_skip_once(path: Path, error: BaseException) -> None:
        key = str(path)
        if key in logged_errors:
            return
        logged_errors.add(key)
        logger.warning("Skipping inaccessible media scan path %s: %s", path, error)

    try:
        if not root.exists(): 
            return []
    except (PermissionError, OSError) as e:
        log_skip_once(root, e)
        return []

    log_dir_roots: list[Path] = []
    for candidate in _configured_log_dir_candidates():
        try:
            log_dir_roots.append(candidate.resolve(strict=False))
        except (OSError, RuntimeError):
            continue

    def is_excluded_scan_path(path: Path) -> bool:
        return any(_path_is_inside(path, excluded_root) for excluded_root in log_dir_roots)

    stack = [(root, base_relative)]

    while stack:
        current_dir, current_rel = stack.pop()
        _scan_state["current_folder"] = current_dir.name or str(current_dir)

        if is_excluded_scan_path(current_dir):
            continue

        try:
            resolved_current = current_dir.resolve(strict=False)
        except (PermissionError, OSError) as e:
            log_skip_once(current_dir, e)
            continue

        current_key = os.path.normcase(str(resolved_current))
        if current_key in visited_dirs:
            continue
        visited_dirs.add(current_key)

        try:
            for p in current_dir.iterdir():
                try:
                    if p.name.startswith("."):
                        continue
                    if is_excluded_scan_path(p):
                        continue

                    if p.is_dir():
                        if p.name.lower() in {"icons", "icon"}:
                            continue
                        stack.append((p, f"{current_rel}{p.name}/"))
                    elif p.suffix.lower() == ".lnk":
                        target = resolve_shortcut(p)
                        if target:
                            if is_excluded_scan_path(target):
                                continue
                            if target.is_dir():
                                stack.append((target, f"{current_rel}{p.stem}/"))
                            elif target.is_file() and is_media_file(target):
                                try:
                                    resolved_target = target.resolve(strict=False)
                                    file_key = os.path.normcase(str(resolved_target))
                                    if file_key in visited_files:
                                        continue
                                    visited_files.add(file_key)
                                except Exception:
                                    pass
                                items.append((target, f"{current_rel}{p.stem}{target.suffix}"))
                    elif is_media_file(p):
                        try:
                            resolved_p = p.resolve(strict=False)
                            file_key = os.path.normcase(str(resolved_p))
                            if file_key in visited_files:
                                continue
                            visited_files.add(file_key)
                        except Exception:
                            pass
                        items.append((p, f"{current_rel}{p.name}"))
                except (PermissionError, OSError) as e:
                    log_skip_once(p, e)
        except (PermissionError, OSError) as e:
            log_skip_once(current_dir, e)

    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_payload = {
            "version": "1.1",
            "timestamp": datetime.now(UTC).isoformat(),
            "root": resolved_root_str,
            "items": [(str(p), rel) for p, rel in items]
        }
        cache_file.write_text(json.dumps(cache_payload), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Could not write scan cache: {e}")

    return items

def validate_media(path: Path) -> bool:
    if not ffprobe_available():
        return False
    command = [
        settings.ffprobe_path,
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        creation_flags = 0
        if os.name == 'nt':
            creation_flags = 0x08000000  # CREATE_NO_WINDOW
        completed = subprocess.run(command, capture_output=True, encoding="utf-8", errors="ignore", timeout=15, creationflags=creation_flags)
        return completed.returncode == 0
    except Exception:
        return False

async def scan_media_library(session: AsyncSession, use_cache: bool = True, force_thumbs: bool = False, build_all: bool = False) -> int:
    logger.info("Starting media library discovery and indexing...")
    _scan_state["scanning"] = True
    _scan_state["files_scanned"] = 0
    _scan_state["files_total"] = 0
    _scan_state["current_folder"] = "Initializing..."
    indexed = 0
    seen_paths: set[str] = set()

    # Pre-fetch all existing media and folder settings to optimize lookup speed
    result = await session.execute(select(MediaMetadata))
    existing_map = {m.relative_path: m for m in result.scalars()}
    
    fs_result = await session.execute(select(FolderSetting))
    folder_settings_map = {s.path.lower(): s for s in fs_result.scalars() if s.path}

    from core.models import DeletedMediaTombstone
    tomb_result = await session.execute(select(DeletedMediaTombstone).where(DeletedMediaTombstone.expires_at > datetime.now(UTC)))
    tombstone_paths = {t.path for t in tomb_result.scalars()}

    media_files = await asyncio.to_thread(get_all_media_files, settings.shared_folder, "", use_cache)
    user_videos_dir = Path.home() / "Videos"
    if user_videos_dir.exists():
        user_media = await asyncio.to_thread(get_all_media_files, user_videos_dir, "User Videos", use_cache)
        media_files.extend(user_media)

    _scan_state["files_total"] = len(media_files)


    for target_path, virtual_rel in media_files:
        _scan_state["current_folder"] = target_path.parent.name or "Root"
        logger.debug(f"Processing file during scan: {target_path.name}")
        
        try:
            resolved_target_str = str(target_path.resolve())
            if resolved_target_str in tombstone_paths:
                logger.warning(f"File {target_path.name} was tombstoned. Deleting physical file.")
                try:
                    target_path.unlink()
                except Exception as e:
                    logger.error(f"Failed to delete tombstoned file {target_path.name}: {e}")
                continue
        except Exception:
            pass
            
        media = existing_map.get(virtual_rel)
        try:
            stat = target_path.stat()
        except FileNotFoundError as e:
            logger.debug(f"Media file {target_path} not found or offline during scan, skipping: {e}")
            continue
        except OSError as e:
            logger.warning(f"Failed to access file {target_path} during scan, skipping: {e}")
            continue
        seen_paths.add(virtual_rel)
        title = clean_title(target_path)

        virtual_parts = [""]
        current = ""
        for part in virtual_rel.split("/"):
            if not part: continue
            current = f"{current}/{part}" if current else part
            virtual_parts.append(current)

        db_settings = [folder_settings_map[p.lower()] for p in virtual_parts if p.lower() in folder_settings_map]
        db_locked = any(s.is_locked for s in db_settings)
        db_adult = any(s.is_adult for s in db_settings)

        keyword_parts = {piece for piece in re.split(r'[\/._\-\s]', virtual_rel.lower()) if piece}
        requires_pin = db_locked or bool(keyword_parts & settings.pin_keyword_set)
        
        adult_only = False
        if db_adult or keyword_parts.intersection(settings.adult_keyword_set):
            adult_only = True
        elif keyword_parts.intersection(settings.sfw_keyword_set):
            adult_only = False

        # Performance optimization: if size is unchanged, duration is indexed, and thumbnail is not a placeholder (SVG), bypass heavy probe/thumbnail operations
        if not force_thumbs and media and media.file_size == stat.st_size and media.duration_seconds and media.thumbnail_path and not media.thumbnail_path.endswith(".svg"):
            thumbnail = media.thumbnail_path
            probe = {
                "width": media.width,
                "height": media.height,
                "bitrate": media.bitrate,
                "video_codec": media.video_codec,
                "audio_codec": media.audio_codec,
                "duration_seconds": media.duration_seconds
            }
        # If size is unchanged, and already marked corrupted, bypass heavy validation/repair
        elif media and media.hls_status == "corrupted" and media.file_size == stat.st_size:
            logger.debug(f"Media '{title}' is already marked as corrupted and unchanged, skipping.")
            thumbnail = f"/thumbs/{thumbnail_path_for(virtual_rel).name}"
            probe = {
                "width": None, "height": None, "bitrate": None,
                "video_codec": None, "audio_codec": None, "duration_seconds": None
            }
            media_values = {
                "relative_path": virtual_rel,
                "path": str(target_path.resolve()),
                "title": title,
                "category": virtual_rel.split("/", 1)[0] if "/" in virtual_rel else "Recently Added",
                "file_size": stat.st_size,
                "container": target_path.suffix.lower().lstrip("."),
                "thumbnail_path": thumbnail,
                "stream_mode": "direct",
                "hls_status": "corrupted",
                "requires_pin": requires_pin,
                "adult_only": adult_only,
                "last_scanned_at": datetime.now(UTC),
                "width": None,
                "height": None,
                "bitrate": None,
                "video_codec": None,
                "audio_codec": None,
                "duration_seconds": None,
                "file_exists": True,
                "last_verified_at": datetime.now(UTC),
            }
            stmt = insert(MediaMetadata).values(**media_values)
            upsert_stmt = stmt.on_conflict_do_update(
                index_elements=["path"],
                set_={k: v for k, v in media_values.items() if k not in ["path"]}
            )
            await session.execute(upsert_stmt)
            indexed += 1
            _scan_state["files_scanned"] = indexed
            if indexed % 50 == 0:
                await session.commit()
                await asyncio.sleep(0.01)
            continue
        else:
            # 1. Validate file with ffprobe
            is_valid = validate_media(target_path)
            
            if not is_valid:
                logger.warning(f"Validation failed for {virtual_rel}. Attempting to remux and repair the container once...")
                temp_fixed = settings.temp_folder / f".fixed_{target_path.name}"
                remux_command = [
                    settings.ffmpeg_path,
                    "-y",
                    "-fflags",
                    "+genpts",
                    "-i",
                    str(target_path),
                    "-c",
                    "copy",
                    str(temp_fixed)
                ]
                try:
                    creation_flags = 0
                    if os.name == 'nt':
                        creation_flags = 0x08000000
                    remux_res = subprocess.run(remux_command, capture_output=True, encoding="utf-8", errors="ignore", timeout=60, creationflags=creation_flags)
                    if remux_res.returncode == 0 and temp_fixed.exists() and temp_fixed.stat().st_size > 0:
                        try:
                            target_path.unlink(missing_ok=True)
                            shutil.move(str(temp_fixed), str(target_path))
                            logger.info(f"Successfully repaired container for {virtual_rel} via remux.")
                            # Re-stat the file
                            stat = target_path.stat()
                            # Re-validate
                            is_valid = validate_media(target_path)
                        except Exception as e:
                            logger.error(f"Failed to replace original file with repaired file for {virtual_rel}: {e}")
                    else:
                        logger.warning(f"Remux repair failed for {virtual_rel}: {remux_res.stderr}")
                except Exception as e:
                    logger.error(f"Error during remux repair for {virtual_rel}: {e}")
                finally:
                    if temp_fixed.exists():
                        try:
                            temp_fixed.unlink(missing_ok=True)
                        except Exception:
                            pass
            
            # 2. If still invalid, mark status as corrupted in DB and skip heavy processing
            if not is_valid:
                logger.error(f"File {virtual_rel} is corrupted and could not be repaired. Marking as corrupted.")
                media_values = {
                    "relative_path": virtual_rel,
                    "path": str(target_path.resolve()),
                    "title": title,
                    "category": virtual_rel.split("/", 1)[0] if "/" in virtual_rel else "Recently Added",
                    "file_size": stat.st_size,
                    "container": target_path.suffix.lower().lstrip("."),
                    "thumbnail_path": f"/thumbs/{thumbnail_path_for(virtual_rel).name}",
                    "stream_mode": "direct",
                    "hls_status": "corrupted",
                    "requires_pin": requires_pin,
                    "adult_only": adult_only,
                    "last_scanned_at": datetime.now(UTC),
                    "width": None,
                    "height": None,
                    "bitrate": None,
                    "video_codec": None,
                    "audio_codec": None,
                    "duration_seconds": None,
                    "file_exists": True,
                    "last_verified_at": datetime.now(UTC),
                }
                stmt = insert(MediaMetadata).values(**media_values)
                upsert_stmt = stmt.on_conflict_do_update(
                    index_elements=["path"],
                    set_={k: v for k, v in media_values.items() if k not in ["path"]}
                )
                await session.execute(upsert_stmt)
                indexed += 1
                _scan_state["files_scanned"] = indexed
                if indexed % 50 == 0:
                    await session.commit()
                    await asyncio.sleep(0.01)
                continue

            # 3. Healthy file: do normal metadata probing and thumbnail generation
            try:
                probe = await asyncio.to_thread(probe_media, target_path)
                duration = probe.get("duration_seconds")
            except Exception as e:
                logger.error(f"Error probing metadata for {virtual_rel}: {e}")
                probe = {}
                duration = None

            try:
                thumbnail, was_repaired = await asyncio.to_thread(build_thumbnail, target_path, virtual_rel, title, duration)
            except Exception as e:
                logger.error(f"Error generating thumbnail for {virtual_rel}: {e}")
                dest = thumbnail_path_for(virtual_rel)
                write_placeholder_thumbnail(dest, title)
                thumbnail = f"/thumbs/{dest.name}"
                was_repaired = False

            if was_repaired:
                logger.info(f"Re-probing repaired file: {target_path}")
                try:
                    probe = await asyncio.to_thread(probe_media, target_path)
                    try:
                        stat = target_path.stat()
                    except OSError:
                        pass
                except Exception:
                    pass
            elif thumbnail.endswith(".svg"):
                logger.error(f"Thumbnail generation failed completely for {virtual_rel}. Marking as corrupted.")
                media_values = {
                    "relative_path": virtual_rel,
                    "path": str(target_path.resolve()),
                    "title": title,
                    "category": virtual_rel.split("/", 1)[0] if "/" in virtual_rel else "Recently Added",
                    "file_size": stat.st_size,
                    "container": target_path.suffix.lower().lstrip("."),
                    "thumbnail_path": thumbnail,
                    "stream_mode": "direct",
                    "hls_status": "corrupted",
                    "requires_pin": requires_pin,
                    "adult_only": adult_only,
                    "last_scanned_at": datetime.now(UTC),
                    "width": None,
                    "height": None,
                    "bitrate": None,
                    "video_codec": None,
                    "audio_codec": None,
                    "duration_seconds": None,
                    "file_exists": True,
                    "last_verified_at": datetime.now(UTC),
                }
                stmt = insert(MediaMetadata).values(**media_values)
                upsert_stmt = stmt.on_conflict_do_update(
                    index_elements=["path"],
                    set_={k: v for k, v in media_values.items() if k not in ["path"]}
                )
                await session.execute(upsert_stmt)
                indexed += 1
                _scan_state["files_scanned"] = indexed
                if indexed % 50 == 0:
                    await session.commit()
                    await asyncio.sleep(0.01)
                continue

        stream_mode = detect_stream_mode(target_path)
        
        # Use an UPSERT instead of a plain INSERT to prevent duplicate path constraint crashes
        media_values = {
            "relative_path": virtual_rel,
            "path": str(target_path.resolve()),
            "title": title,
            "category": virtual_rel.split("/", 1)[0] if "/" in virtual_rel else "Recently Added",
            "file_size": stat.st_size,
            "container": target_path.suffix.lower().lstrip("."),
            "thumbnail_path": thumbnail,
            "stream_mode": stream_mode,
            "hls_status": "ready" if stream_mode == "direct" else "pending",
            "requires_pin": requires_pin,
            "adult_only": adult_only,
            "last_scanned_at": datetime.now(UTC),
            "width": probe.get("width"),
            "height": probe.get("height"),
            "bitrate": probe.get("bitrate"),
            "video_codec": probe.get("video_codec"),
            "audio_codec": probe.get("audio_codec"),
            "duration_seconds": probe.get("duration_seconds"),
            "file_exists": True,
            "last_verified_at": datetime.now(UTC),
        }
        
        stmt = insert(MediaMetadata).values(**media_values)
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=["path"],
            # Intentionally omit hls_status to avoid re-triggering transcodes on previously indexed items
            set_={k: v for k, v in media_values.items() if k not in ["path", "hls_status"]} 
        )
        await session.execute(upsert_stmt)

        indexed += 1
        _scan_state["files_scanned"] = indexed

        # Progressive commit to allow fast loadup of UI and real-time updates during heavy scans
        if indexed % 5 == 0:
            await session.commit()
            from core.events import broadcast_library_updated
            await broadcast_library_updated(indexed)
            await asyncio.sleep(0.01) # Yield to event loop so API can serve items


    result = await session.execute(select(MediaMetadata))
    for media in result.scalars():
        source = media_source_path(media)
        if source.exists() and source.is_file():
            if not media.file_exists:
                media.file_exists = True
                media.last_verified_at = datetime.now(UTC)
                logger.info(f"Scan cleanup: Reactivated existing media '{media.title}' (ID {media.id}).")
        else:
            if media.file_exists:
                media.file_exists = False
                media.last_verified_at = datetime.now(UTC)
                logger.warning(f"Scan cleanup: Media '{media.title}' (ID {media.id}) missing on disk. Marked inactive.")
            else:
                from datetime import timedelta
                stale_days = getattr(settings, "stale_db_days", 7)
                cutoff = datetime.now(UTC) - timedelta(days=stale_days)
                last_verified = media.last_verified_at
                if last_verified:
                    if last_verified.tzinfo is None:
                        last_verified = last_verified.replace(tzinfo=UTC)
                    if last_verified < cutoff:
                        await session.delete(media)
                        logger.info(f"Scan cleanup: Stale missing media '{media.title}' (ID {media.id}) deleted.")

    await session.commit()


    if build_all:
        logger.info("Starting aggressive preparation of thumbnails and sprite sheets...")
        result = await session.execute(
            select(MediaMetadata).where(
                MediaMetadata.file_exists == True,
                MediaMetadata.hls_status != "corrupted"
            )
        )
        active_items = result.scalars().all()
        total_prep = len(active_items)
        _scan_state["files_total"] = total_prep
        _scan_state["files_scanned"] = 0
        _scan_state["current_folder"] = "Preparing assets..."
        
        sem = asyncio.Semaphore(4)
        prep_scanned = 0
        
        async def prep_single(media_item):
            nonlocal prep_scanned
            async with sem:
                target_path = Path(media_item.path)
                if target_path.exists():
                    try:
                        if force_thumbs:
                            thumb_dest = thumbnail_path_for(media_item.relative_path).with_suffix(".jpg")
                            if thumb_dest.exists():
                                try:
                                    thumb_dest.unlink(missing_ok=True)
                                except Exception:
                                    pass
                        await asyncio.to_thread(
                            build_thumbnail,
                            target_path,
                            media_item.relative_path,
                            media_item.title,
                            media_item.duration_seconds
                        )
                    except Exception as e:
                        logger.error(f"Error preparing thumbnail for {media_item.title}: {e}")
                    
                    try:
                        if force_thumbs:
                            sprite_dest = sprite_path_for(media_item.id)
                            if sprite_dest.exists():
                                try:
                                    sprite_dest.unlink(missing_ok=True)
                                except Exception:
                                    pass
                        await asyncio.to_thread(
                            build_sprite_sheet,
                            target_path,
                            media_item.id,
                            media_item.duration_seconds
                        )
                    except Exception as e:
                        logger.error(f"Error preparing sprite sheet for {media_item.title}: {e}")
                
                prep_scanned += 1
                _scan_state["files_scanned"] = prep_scanned
                
        await asyncio.gather(*[prep_single(item) for item in active_items])

    # Run classification & series detection after indexing
    try:
        await run_classification_pipeline(session)
    except Exception:
        logger.exception("Classification pipeline failed (non-fatal).")

    _scan_state["scanning"] = False
    _scan_state["last_scan_at"] = datetime.now(UTC).isoformat()
    logger.info(f"Scan complete. Indexed {indexed} items.")
    from core.events import broadcast_library_updated
    await broadcast_library_updated(indexed)
    from core.webhooks import trigger_webhook
    await trigger_webhook("library.updated", {"indexed_count": indexed})
    return indexed

# ── Classification & Series Detection Pipeline ─────────────────────────────────

# Regex patterns for episode detection
_EPISODE_RE = re.compile(
    r"(?:ep(?:isode)?|s(?:eason)?|e|part|pt)\.?\s*(\d+)",
    re.IGNORECASE,
)
_TRAILING_NUM_RE = re.compile(r"\b(\d+)\s*$")

def _normalize_title(title: str) -> str:
    """Lowercase, strip extensions, replace punctuation with spaces, collapse whitespace."""
    t = title.lower()
    # Strip common video extensions
    t = re.sub(r"\.(mp4|mkv|avi|webm|mov|wmv|flv|m4v|ts)$", "", t)
    # Replace punctuation with spaces
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())

def jaro_winkler(s1: str, s2: str, p: float = 0.1, max_l: int = 4) -> float:
    if s1 == s2:
        return 1.0
    len1, len2 = len(s1), len(s2)
    if len1 == 0 or len2 == 0:
        return 0.0
    
    max_dist = max(len1, len2) // 2 - 1
    match = 0
    hash_s1 = [0] * len1
    hash_s2 = [0] * len2
    
    for i in range(len1):
        for j in range(max(0, i - max_dist), min(len2, i + max_dist + 1)):
            if s1[i] == s2[j] and hash_s2[j] == 0:
                hash_s1[i] = 1
                hash_s2[j] = 1
                match += 1
                break
                
    if match == 0:
        return 0.0
    
    t = 0
    point = 0
    for i in range(len1):
        if hash_s1[i]:
            while hash_s2[point] == 0:
                point += 1
            if s1[i] != s2[point]:
                t += 1
            point += 1
    t /= 2.0
    
    jaro = (match / len1 + match / len2 + (match - t) / match) / 3.0
    
    prefix = 0
    for i in range(min(len1, len2)):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break
        if prefix == max_l:
            break
            
    return jaro + prefix * p * (1 - jaro)

def _extract_episode_info(title: str) -> tuple[str, int | None]:
    """
    Extract the base name and episode number from a title.
    Returns (base_name, episode_number) — episode_number may be None.
    """
    normalized = _normalize_title(title)
    match = _EPISODE_RE.search(normalized)
    if match:
        ep_num = int(match.group(1))
        # Base name is everything before the episode marker
        base = normalized[: match.start()].strip()
        return base if base else normalized, ep_num

    # Fallback: trailing number
    trail = _TRAILING_NUM_RE.search(normalized)
    if trail:
        ep_num = int(trail.group(1))
        base = normalized[: trail.start()].strip()
        return base if base else normalized, ep_num

    return normalized, None

async def run_classification_pipeline(session: AsyncSession) -> None:
    """
    Classify all indexed media into tags and detect series groupings.
    Runs post-scan. All state is DB-only — no filesystem changes.
    """
    logger.info("Running classification pipeline...")

    result = await session.execute(
        select(MediaMetadata).where(MediaMetadata.file_exists == True)  # noqa: E712
    )
    all_media = list(result.scalars())

    if not all_media:
        logger.info("Classification pipeline: No media to classify.")
        return

    # ── Step A: Duration & Aspect Ratio Tagging ────────────────────────────────
    # Clear existing auto-tags to rebuild cleanly
    await session.execute(delete(Tag))
    await session.flush()

    tag_rows: list[dict] = []
    for m in all_media:
        dur = m.duration_seconds or 0.0
        w = m.width or 0
        h = m.height or 1  # avoid div/0
        aspect = w / h if h > 0 else 0.0

        tags_for: list[str] = []

        # Short-form (Vertical H > W and <= 3 mins)
        if aspect > 0 and aspect < 1.0 and dur <= 180:
            tags_for.append("short_form")
        
        # Horizontal (W > H) or fallback when aspect is unknown
        elif aspect == 0.0 or aspect >= 1.0:
            if dur > 2400:
                tags_for.append("feature_length")
            elif dur > 900:
                tags_for.append("long_form_episodes")
            elif dur >= 60 and dur <= 900:
                tags_for.append("standard_video")

        for t in tags_for:
            tag_rows.append({"video_id": m.id, "tag": t})

    if tag_rows:
        await session.execute(insert(Tag).values(tag_rows).on_conflict_do_nothing())
        await session.flush()
        logger.info(f"Classification: Applied {len(tag_rows)} tags across {len(all_media)} media.")

    # ── Step B & C: Series Detection ───────────────────────────────────────────
    # Clear old series data to rebuild
    await session.execute(delete(SeriesMember))
    await session.execute(delete(SeriesGroup))
    await session.flush()

    # Build candidate list: (media, base_name, episode_number)
    candidates: list[tuple[MediaMetadata, str, int | None]] = []
    for m in all_media:
        base, ep = _extract_episode_info(m.title or "")
        if base:
            candidates.append((m, base, ep))

    # Group by exact base name first
    from collections import defaultdict
    base_groups: dict[str, list[tuple[MediaMetadata, int | None]]] = defaultdict(list)
    for m, base, ep in candidates:
        base_groups[base].append((m, ep))

    # Merge similar base names using SequenceMatcher
    merged_keys = list(base_groups.keys())
    union_map: dict[str, str] = {k: k for k in merged_keys}  # union-find root

    def find(x: str) -> str:
        while union_map[x] != x:
            union_map[x] = union_map[union_map[x]]
            x = union_map[x]
        return x

    for i in range(len(merged_keys)):
        for j in range(i + 1, len(merged_keys)):
            a, b = merged_keys[i], merged_keys[j]
            if find(a) == find(b):
                continue
            ratio = jaro_winkler(a, b)
            if ratio >= 0.85:
                union_map[find(b)] = find(a)

    # Collect merged groups
    final_groups: dict[str, list[tuple[MediaMetadata, int | None]]] = defaultdict(list)
    for key, members in base_groups.items():
        root = find(key)
        final_groups[root].extend(members)

    # Create series groups for clusters with >= 2 members
    series_count = 0
    for canonical, members in final_groups.items():
        if len(members) < 2:
            continue

        # Determine display name (title-cased canonical)
        display_name = canonical.title() if canonical else "Unknown Series"

        group = SeriesGroup(name=display_name, canonical_title=canonical)
        session.add(group)
        await session.flush()  # get group.id

        for m, ep in members:
            session.add(SeriesMember(
                video_id=m.id,
                series_id=group.id,
                episode_number=ep,
            ))
            # Tag this video as part of a series
            tag_rows_series = {"video_id": m.id, "tag": "series"}
            await session.execute(
                insert(Tag).values(**tag_rows_series).on_conflict_do_nothing()
            )

        series_count += 1

    await session.commit()
    logger.info(f"Classification pipeline complete. Detected {series_count} series groups.")

async def library_groups(session: AsyncSession, current_user: User, request=None) -> list[dict]:
    query = select(MediaMetadata).order_by(MediaMetadata.category, MediaMetadata.title)
    query = await apply_media_security_filters(session, query, current_user, request)
        
    result = await session.execute(query)
    groups: dict[str, list[MediaMetadata]] = {}
    for media in result.scalars():
        groups.setdefault(media.category, []).append(media)
    return [{"label": label, "items": items} for label, items in groups.items()]

async def get_media(session: AsyncSession, media_id: int, allow_missing: bool = False) -> MediaMetadata:
    result = await session.execute(select(MediaMetadata).where(MediaMetadata.id == media_id))
    media = result.scalar_one_or_none()
    if not media:
        logger.warning(f"Media resource not found: ID {media_id}")
        raise ResourceNotFoundError(f"Media with ID {media_id} not found.")
    if not media.file_exists and not allow_missing:
        logger.warning(f"Media file is marked as missing: ID {media_id}")
        raise ResourceNotFoundError(f"Media with ID {media_id} is missing.")
    return media

def media_source_path(media: MediaMetadata) -> Path:
    from core.storage import resolve_shared_path
    return resolve_shared_path(media.relative_path)

async def detect_intro_for_media(media_path: Path) -> tuple[float, float]:
    """
    Detect intro start and end using FFmpeg scene detection on the first 3 minutes.
    Falls back to a default range (30.0, 90.0) if detection fails or finds no clear intro.
    """
    import re
    
    if not ffmpeg_available():
        logger.warning(f"FFmpeg not available. Skipping intro detection for {media_path}. Using default fallback (30.0, 90.0).")
        return 30.0, 90.0

    settings = get_settings()
    cmd = [
        settings.ffmpeg_path,
        "-ss", "0",
        "-t", "180",
        "-i", str(media_path),
        "-filter_complex", "select='gt(scene,0.4)',metadata=print",
        "-f", "null",
        "-"
    ]
    
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        output = stderr.decode(errors="ignore")
        
        pts_times = []
        for match in re.finditer(r'pts_time:(\d+\.?\d*)', output):
            pts_times.append(float(match.group(1)))
            
        if len(pts_times) >= 2:
            candidate_times = [t for t in pts_times if 10.0 <= t <= 120.0]
            if len(candidate_times) >= 2:
                intro_start = min(candidate_times)
                intro_end = max(candidate_times)
                if 20.0 <= (intro_end - intro_start) <= 100.0:
                    return round(intro_start, 2), round(intro_end, 2)
                    
        return 30.0, 90.0
    except Exception as e:
        logger.warning(f"Intro detection failed for {media_path}: {e}. Using fallback.")
        return 30.0, 90.0

def build_hls_command(source_path: Path, output_dir: Path, profiles: list[dict], media: MediaMetadata) -> list[str]:
    # Check for Hardware Acceleration
    has_nvenc = False
    has_qsv = False
    try:
        check = subprocess.run([settings.ffmpeg_path, "-encoders"], capture_output=True, encoding="utf-8", errors="ignore")
        has_nvenc = "h264_nvenc" in check.stdout
        has_qsv = "h264_qsv" in check.stdout
    except Exception:
        pass

    video_encoder = "h264_nvenc" if has_nvenc else ("h264_qsv" if has_qsv else "libx264")
    preset = "p1" if has_nvenc else ("veryfast" if has_qsv else "ultrafast")

    hw_args = []
    if has_nvenc:
        hw_args = ["-hwaccel", "cuda"]
    elif has_qsv:
        hw_args = ["-hwaccel", "qsv"]

    num_profiles = len(profiles)
    v_splits = "".join(f"[v{i}]" for i in range(num_profiles))
    filter_parts = [f"[0:v:0]split={num_profiles}{v_splits}"]
    
    for i, p in enumerate(profiles):
        filter_parts.append(f"[v{i}]scale=w={p['width']}:h={p['height']}[v{i}out]")
    
    filter_complex = "; ".join(filter_parts)

    cmd = [
        settings.ffmpeg_path,
        "-y",
        *hw_args,
        "-i", str(source_path),
        "-sn",  # Disable subtitles during video transcode to prevent pipeline crashes
        "-filter_complex", filter_complex,
    ]

    # Map each video output
    for i, p in enumerate(profiles):
        cmd.extend([
            "-map", f"[v{i}out]",
            f"-c:v:{i}", video_encoder,
            f"-preset:v:{i}", preset,
        ])
        if video_encoder == "libx264":
            cmd.extend([f"-tune:v:{i}", "zerolatency"])
        cmd.extend([
            f"-b:v:{i}", p["bitrate"],
            f"-maxrate:v:{i}", p.get("maxrate", p["bitrate"]),
            f"-bufsize:v:{i}", p.get("bufsize", "12000k"),
            f"-g:v:{i}", "120",           # Enforce uniform keyframes
            f"-keyint_min:v:{i}", "120",  # Prevent variable length chunk mismatches
            f"-sc_threshold:v:{i}", "0",  # Disable scene change keyframe insertion
        ])

    has_audio = bool(media.audio_codec)
    if has_audio:
        cmd.extend([
            "-map", "0:a:0",
            "-c:a", "aac",
            "-ac", "2",
            "-b:a", "192k",
        ])

    cmd.extend([
        "-f", "hls",
        "-hls_init_time", "2",
        "-hls_time", "5",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments+temp_file",
        "-hls_segment_type", "fmp4",
        "-master_pl_name", "master.m3u8",
    ])

    stream_map_parts = []
    for i in range(num_profiles):
        if has_audio:
            stream_map_parts.append(f"v:{i},a:0")
        else:
            stream_map_parts.append(f"v:{i}")
    var_stream_map = " ".join(stream_map_parts)

    cmd.extend([
        "-var_stream_map", var_stream_map,
        "-hls_segment_filename", str(output_dir / "stream_%v" / "data%03d.m4s"),
        str(output_dir / "stream_%v" / "index.m3u8"),
    ])

    return cmd

async def ensure_hls_manifest(session: AsyncSession, media: MediaMetadata, priority: bool = False) -> Path:
    from core.exceptions import MediaHubError
    output_dir = hls_output_dir(media.id)
    master_manifest = output_dir / "master.m3u8"
    
    if master_manifest.exists():
        return master_manifest

    # Concurrency control: if already transcoding, wait for it
    if media.id in _transcode_events:
        logger.info(f"Waiting for existing transcode for media ID {media.id}")
        await _transcode_events[media.id].wait()
        return master_manifest

    if not ffmpeg_available():
        logger.error("FFmpeg not found in path")
        raise MediaHubError("FFmpeg is required for transcoding but is missing.", status_code=500)

    # Fetch profiles using the session
    from core.system import get_setting
    profiles = await get_setting(session, "transcode_profiles", [])
    if not profiles:
        profiles = [
            {"name": "1080p", "width": 1920, "height": 1080, "bitrate": "6000k", "maxrate": "9000k", "bufsize": "12000k"},
            {"name": "720p", "width": 1280, "height": 720, "bitrate": "3000k", "maxrate": "4500k", "bufsize": "6000k"},
            {"name": "480p", "width": 854, "height": 480, "bitrate": "1000k", "maxrate": "1500k", "bufsize": "2000k"},
        ]

    # Initialize event for others to wait on
    event = asyncio.Event()
    _transcode_events[media.id] = event
    _active_transcodes.add(media.id)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Pre-create profile subdirectories so FFmpeg var_stream_map works smoothly
    for i in range(len(profiles)):
        (output_dir / f"stream_{i}").mkdir(parents=True, exist_ok=True)

    process = None
    try:
        if priority:
            # Kill all other active transcodes to give this one 100% CPU/GPU resources
            other_ids = [mid for mid in list(_active_processes.keys()) if mid != media.id]
            for mid in other_ids:
                proc = _active_processes.get(mid)
                if proc:
                    logger.info(f"Terminating background transcode for media ID {mid} to prioritize media ID {media.id}")
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                    _active_processes.pop(mid, None)
                    _active_transcodes.discard(mid)
                    if mid in _transcode_events:
                        _transcode_events[mid].set()
                        _transcode_events.pop(mid, None)

        logger.info(f"Starting ABR HLS transcoding for media ID {media.id} (priority: {priority})")
        command = build_hls_command(media_source_path(media), output_dir, profiles, media)
        
        # Windows-specific priority setting
        creation_flags = 0
        import os
        if os.name == 'nt':
            if priority:
                # HIGH_PRIORITY_CLASS
                creation_flags = 0x00000080
            else:
                # IDLE_PRIORITY_CLASS
                creation_flags = 0x00000040

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            creationflags=creation_flags if os.name == 'nt' else 0
        )
        _active_processes[media.id] = process
        
        async def broadcast_logs(stream):
            from core.events import socket_manager
            while True:
                line = await stream.readline()
                if not line: break
                log = line.decode().strip()
                if log:
                    await socket_manager.broadcast({
                        "type": "transcoding-log",
                        "media_id": media.id,
                        "line": log
                    })

        log_task = asyncio.create_task(broadcast_logs(process.stderr))
        returncode = await process.wait()
        await log_task

        if returncode != 0:
            logger.error(f"FFmpeg failed with exit code {returncode}")
            media.hls_status = "error"
            await session.commit()
            # Cleanup broken output
            if output_dir.exists():
                import shutil
                shutil.rmtree(output_dir)
            raise FileOperationError(f"HLS generation failed for media ID {media.id}.")

        logger.info(f"Transcoding complete for media ID {media.id}")
        media.hls_status = "ready"
        await session.commit()
        return master_manifest

    except Exception as e:
        logger.error(f"Transcoding exception for media {media.id}: {e}")
        media.hls_status = "error"
        await session.commit()
        raise
    finally:
        # Signal completion to waiters and cleanup
        event.set()
        _transcode_events.pop(media.id, None)
        _active_transcodes.discard(media.id)
        _active_processes.pop(media.id, None)
        if process and process.returncode is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass

async def build_stream_response(session: AsyncSession, media: MediaMetadata, priority: bool = True) -> dict:
    if media.stream_mode == "direct":
        return {
            "url": f"/api/media/{media.id}/file",
            "mode": "direct",
            "media_id": media.id,
            "qualities": None
        }

    # Fetch active transcode profiles
    from core.system import get_setting
    profiles = await get_setting(session, "transcode_profiles", [])
    quality_names = [p["name"] for p in profiles] if profiles else ["1080p", "720p", "480p"]

    output_dir = hls_output_dir(media.id)
    manifest = output_dir / "master.m3u8"
    
    if not manifest.exists():
        # Start the transcode in the background instead of waiting
        asyncio.create_task(ensure_hls_manifest(session, media, priority=priority))
        return {
            "mode": "hls",
            "url": f"/api/media/hls-secure/{media.id}/master.m3u8",
            "status": "preparing",
            "qualities": quality_names
        }

    return {
        "mode": "hls",
        "url": f"/api/media/hls-secure/{media.id}/master.m3u8",
        "status": "ready",
        "qualities": quality_names
    }

async def log_play_event(
    session: AsyncSession,
    user_id: int,
    media_id: int,
    position_seconds: float,
    completed: bool,
    event_type: str,
) -> None:
    session.add(
        PlayEvent(
            user_id=user_id,
            media_id=media_id,
            position_seconds=position_seconds,
            completed=completed,
            event_type=event_type,
        )
    )
    await session.commit()
    from core.webhooks import trigger_webhook
    await trigger_webhook("media.playback", {
        "user_id": user_id,
        "media_id": media_id,
        "position": position_seconds,
        "completed": completed,
        "event_type": event_type
    })

async def log_audit(
    session: AsyncSession,
    user_id: int | None,
    action: str,
    target_path: str | None = None,
    details: dict | None = None,
) -> None:
    session.add(AuditLog(user_id=user_id, action=action, target_path=target_path, details=details or {}))
    await session.commit()

async def start_pre_transcoding(session: AsyncSession, folder_relative_path: str) -> int:
    result = await session.execute(
        select(MediaMetadata).where(
            MediaMetadata.relative_path.like(f"{folder_relative_path}%"),
            MediaMetadata.stream_mode == "hls",
            MediaMetadata.hls_status == "pending",
        )
    )
    media_list = result.scalars().all()
    count = 0
    for media in media_list:
        try:
            await ensure_hls_manifest(session, media)
            count += 1
        except Exception:
            continue
    return count

async def watch_media_library():
    import asyncio
    from core.database import AsyncSessionLocal
    from core.events import broadcast_library_updated
    try:
        from watchfiles import awatch
        
        logger.info(f"Watching {settings.shared_folder} for changes...")
        
        # Define paths to ignore (relative to shared_folder if possible, or absolute)
        ignore_dirs = {
            os.path.abspath(os.path.join(BASE_DIR, "static")),
            os.path.abspath(os.path.join(BASE_DIR, "data")),
            os.path.abspath(os.path.join(BASE_DIR, "venv")),
            os.path.abspath(os.path.join(BASE_DIR, ".git")),
            os.path.abspath(os.path.join(BASE_DIR, "material-design-icons-master")),
        }

        async for changes in awatch(settings.shared_folder):
            # Filter changes
            valid_changes = []
            for change_type, path in changes:
                abs_path = os.path.abspath(path)
                # Check if path is in any ignored directory
                if any(abs_path.startswith(d) for d in ignore_dirs):
                    continue
                # Ignore common DB and temp files
                if any(ext in abs_path for ext in [".db", ".db-wal", ".db-shm", ".log"]):
                    continue
                # Ignore icon folders anywhere in the path
                if any(part.lower() in {"icons", "icon"} for part in Path(path).parts):
                    continue
                # Ignore hidden files
                if Path(path).name.startswith("."):
                    continue
                valid_changes.append((change_type, path))

            if not valid_changes:
                continue
                
            logger.info(f"Detected {len(valid_changes)} valid changes. Triggering rescan...")

            # Wait a bit for file operations to settle
            await asyncio.sleep(2)
            async with AsyncSessionLocal() as session:
                total = await scan_media_library(session, use_cache=False)
                await broadcast_library_updated(total)
    except ImportError:
        logger.warning("watchfiles not installed. Falling back to background polling scanner (runs every 10 minutes).")
        while True:
            await asyncio.sleep(600)  # Wait 10 minutes
            logger.info("Running background polling library scan...")
            try:
                async with AsyncSessionLocal() as session:
                    total = await scan_media_library(session, use_cache=False)
                    if total > 0:
                        await broadcast_library_updated(total)
            except Exception as e:
                logger.error(f"Background polling scan failed: {e}")
    except Exception as e:
        logger.error(f"Media watcher failed: {e}")
async def apply_media_security_filters(
    session: AsyncSession,
    stmt,
    current_user: User,
    request=None,
    strict_ui: bool = True
):
    # Filter out files that do not physically exist on disk
    stmt = stmt.where(MediaMetadata.file_exists == True)

    from sqlalchemy import exists, and_, or_, func
    from core.models import FolderPermission, FolderSetting

    # 1. R18 / Adult Filter
    nsfw_enabled = current_user.preferences and current_user.preferences.get("nsfw") == True if current_user else False
    if request:
        if request.headers.get("X-Disable-R18") == "true":
            nsfw_enabled = False
        elif request.headers.get("X-Enable-R18") == "true":
            nsfw_enabled = True
        elif "nsfw_enabled" in request.cookies:
            nsfw_enabled = request.cookies.get("nsfw_enabled") == "true"
            
    adult_folder_exists = exists().where(
        and_(
            FolderSetting.is_adult == True,
            or_(
                func.lower(MediaMetadata.relative_path) == func.lower(FolderSetting.path),
                func.lower(MediaMetadata.relative_path).like(func.lower(FolderSetting.path) + "/%")
            )
        )
    )

    if not current_user.is_adult:
        stmt = stmt.where(and_(MediaMetadata.adult_only == False, ~adult_folder_exists))
    else:
        if not nsfw_enabled:
            stmt = stmt.where(and_(MediaMetadata.adult_only == False, ~adult_folder_exists))
        else:
            # NSFW Enabled = Show All Content (No filters applied for adult_only)
            pass
        
    # 2. Locked Content Filter
    if current_user.role not in ("admin", "super-admin"):
        locked_folder_exists = exists().where(
            and_(
                FolderSetting.is_locked == True,
                or_(
                    func.lower(MediaMetadata.relative_path) == func.lower(FolderSetting.path),
                    func.lower(MediaMetadata.relative_path).like(func.lower(FolderSetting.path) + "/%")
                )
            )
        )
        
        perm_exists = exists().where(
            and_(
                FolderPermission.user_id == current_user.id,
                FolderPermission.can_view == True,
                or_(
                    func.lower(MediaMetadata.relative_path) == func.lower(FolderPermission.folder_path),
                    func.lower(MediaMetadata.relative_path).like(func.lower(FolderPermission.folder_path) + "/%")
                )
            )
        )
        
        stmt = stmt.where(
            or_(
                and_(
                    MediaMetadata.requires_pin == False,
                    ~locked_folder_exists
                ),
                perm_exists
            )
        )
        
    return stmt

async def is_media_accessible(
    session: AsyncSession,
    media: MediaMetadata,
    current_user: User,
    request=None,
    strict: bool = True
) -> bool:
    """Use the same filters as library/home queries so thumbnails match visible items."""
    stmt = select(MediaMetadata.id).where(MediaMetadata.id == media.id)
    stmt = await apply_media_security_filters(session, stmt, current_user, request, strict_ui=strict)
    return (await session.execute(stmt)).scalar_one_or_none() is not None

async def get_smart_home_data(session: AsyncSession, current_user: User, request=None) -> dict:
    seen_ids = set()

    # 1. Continue Watching (Removed per request)
    continue_watching = []

    # 2. Recently Added (Filtered to normal videos only)
    from sqlalchemy import or_
    ra_query = select(MediaMetadata).where(
        or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
    ).order_by(MediaMetadata.created_at.desc(), MediaMetadata.id.desc()).limit(30)
    ra_query = await apply_media_security_filters(session, ra_query, current_user, request)
    
    ra_res = await session.execute(ra_query)
    recently_added = []
    for m in ra_res.scalars().all():
        if m.id not in seen_ids and len(recently_added) < 24:
            recently_added.append(m)
            seen_ids.add(m.id)

    # 3. Trending (Removed per request)
    trending = []

    # 4. Recommendations (Removed per request)
    recommendations = []

    # Fallback: if recently_added is empty but database has items, 
    # fetch some items without strict ordering to ensure Home is not empty.
    if not recently_added:
        fallback_query = select(MediaMetadata).where(
            or_(MediaMetadata.width >= MediaMetadata.height, MediaMetadata.height.is_(None))
        ).limit(30)
        fallback_query = await apply_media_security_filters(session, fallback_query, current_user, request)
        fallback_res = await session.execute(fallback_query)
        for m in fallback_res.scalars().all():
            if m.id not in seen_ids and len(recently_added) < 24:
                recently_added.append(m)
                seen_ids.add(m.id)

    return {
        "continue_watching": continue_watching,
        "recently_added": recently_added,
        "trending": trending,
        "recommendations": recommendations,
    }

async def cleanup_active_processes():
    """Terminate and clean up all active transcoder/subprocesses to prevent leaks on shutdown."""
    logger.info("Cleaning up active subprocesses...")
    for media_id, proc in list(_active_processes.items()):
        if proc.returncode is None:
            try:
                proc.terminate()
                await proc.wait()
            except Exception as e:
                logger.error(f"Error terminating process {media_id}: {e}")
    _active_processes.clear()

async def run_orphan_cleanup_job() -> None:
    """
    Background job that runs periodically to:
    1. Verify media file physical existence, marking `file_exists` (soft delete flag) and `last_verified_at`.
    2. Safely clean up (hard delete) records that have been missing for more than settings.stale_db_days (default 7 days).
    3. Rebuild missing sprite sheets for existing active files sequentially at idle priority.
    """
    import asyncio
    import shutil
    from pathlib import Path
    from datetime import timedelta
    from core.database import AsyncSessionLocal
    from core.bootstrap import self_heal_data_integrity
    from core.events import broadcast_library_updated

    # Initial delay on startup to let the system fully initialize
    await asyncio.sleep(30)

    while True:
        try:
            logger.info("Starting background orphan cleanup & validation job...")
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(MediaMetadata))
                all_media = result.scalars().all()

                stale_days = getattr(settings, "stale_db_days", 7)
                cutoff_time = datetime.now(UTC) - timedelta(days=stale_days)

                updated_count = 0
                deleted_count = 0
                valid_media = []

                for media in all_media:
                    source = media_source_path(media)
                    exists_on_disk = source.exists() and source.is_file()

                    if exists_on_disk:
                        valid_media.append(media)
                        if not media.file_exists:
                            media.file_exists = True
                            media.last_verified_at = datetime.now(UTC)
                            updated_count += 1
                            logger.info(f"Orphan worker: Media '{media.title}' (ID {media.id}) found on disk again, marked active.")
                    else:
                        # File does not exist on disk
                        if media.file_exists:
                            # Just became missing
                            media.file_exists = False
                            media.last_verified_at = datetime.now(UTC)
                            updated_count += 1
                            logger.warning(f"Orphan worker: Media '{media.title}' (ID {media.id}) is missing on disk. Flagged as missing.")
                        else:
                            # Already missing, check if it's stale (older than cutoff_time)
                            last_verified = media.last_verified_at
                            if last_verified:
                                if last_verified.tzinfo is None:
                                    last_verified = last_verified.replace(tzinfo=UTC)
                                
                                if last_verified < cutoff_time:
                                    # Hard delete!
                                    # 1. Clean up sprite sheet file
                                    sprite_file = sprite_path_for(media.id)
                                    if sprite_file.exists():
                                        try:
                                            sprite_file.unlink()
                                            logger.info(f"Orphan worker: Deleted sprite file for stale media ID {media.id}")
                                        except Exception as e:
                                            logger.warning(f"Orphan worker: Failed to delete sprite file {sprite_file}: {e}")

                                    # 2. Clean up HLS directory
                                    hls_dir = hls_output_dir(media.id)
                                    if hls_dir.exists():
                                        try:
                                            shutil.rmtree(hls_dir, ignore_errors=True)
                                            logger.info(f"Orphan worker: Deleted HLS directory for stale media ID {media.id}")
                                        except Exception as e:
                                            logger.warning(f"Orphan worker: Failed to delete HLS directory {hls_dir}: {e}")

                                    # 3. Clean up thumbnail
                                    if media.thumbnail_path and not media.thumbnail_path.endswith(".svg"):
                                        thumb_file = settings.thumbs_folder / Path(media.thumbnail_path.replace(chr(92), "/")).name
                                        if thumb_file.exists() and thumb_file.is_file():
                                            try:
                                                thumb_file.unlink()
                                                logger.info(f"Orphan worker: Deleted thumbnail file for stale media ID {media.id}")
                                            except Exception as e:
                                                logger.warning(f"Orphan worker: Failed to delete thumbnail {thumb_file}: {e}")

                                    # 4. Delete DB record
                                    await session.delete(media)
                                    deleted_count += 1
                                    logger.info(f"Orphan worker: Hard deleted stale DB entry for '{media.title}' (ID {media.id})")

                if updated_count or deleted_count:
                    await session.commit()
                    # Notify frontend to refresh library
                    await broadcast_library_updated(0)
                    
                    if deleted_count:
                        # Clean up secondary relations
                        await self_heal_data_integrity()
                else:
                    logger.info("Orphan worker: All DB records verified. No stale media found.")

                # Rebuild missing sprites for existing media files sequentially
                missing_sprites = []
                for media in valid_media:
                    sprite_file = sprite_path_for(media.id)
                    if not sprite_file.exists():
                        missing_sprites.append(media)

                if missing_sprites:
                    logger.info(f"Orphan worker: Found {len(missing_sprites)} media items missing sprite sheets. Rebuilding sequentially...")
                    for media in missing_sprites:
                        source = media_source_path(media)
                        logger.info(f"Orphan worker: Generating sprite sheet for '{media.title}' (ID {media.id})")
                        await build_sprite_sheet_queued(source, media.id, media.duration_seconds)
                        await asyncio.sleep(2)  # Pause to yield to event loop and prevent CPU spikes
                else:
                    logger.info("Orphan worker: All active media items have sprite sheets.")

            logger.info("Background orphan cleanup & validation job completed.")
        except Exception as e:
            logger.error(f"Error in background orphan cleanup job: {e}", exc_info=True)

        # Run every 1 hour (3600 seconds)
        await asyncio.sleep(3600)
