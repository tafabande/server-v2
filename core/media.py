from __future__ import annotations

import json
import os
import shutil
import subprocess
import asyncio
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import BASE_DIR, get_settings
from core.exceptions import FileOperationError, ResourceNotFoundError
from core.logging import get_logger
from core.models import AuditLog, FolderSetting, MediaMetadata, PlayEvent, User
from core.storage import is_media_file, is_path_adult, is_path_locked, relative_shared_path, resolve_shared_path


settings = get_settings()
logger = get_logger("media")
DIRECT_STREAM_EXTENSIONS = {".mp4", ".m4v", ".webm"}
# Global locks to prevent redundant FFmpeg processes
_active_transcodes: set[int] = set()
_transcode_events: dict[int, asyncio.Event] = {}
# Active FFmpeg processes registry for leak safeguards
_active_processes: dict[int, asyncio.subprocess.Process] = {}

# Scan progress tracking
_scan_state = {
    "scanning": False,
    "files_scanned": 0,
    "files_total": 0,
    "last_scan_at": None,
}


def get_scan_status() -> dict:
    """Return current scan progress."""
    total = _scan_state["files_total"]
    scanned = _scan_state["files_scanned"]
    progress = (scanned / total * 100) if total > 0 else 0.0
    return {
        "scanning": _scan_state["scanning"],
        "files_scanned": scanned,
        "files_total": total,
        "progress_percent": round(progress, 1),
        "last_scan_at": _scan_state["last_scan_at"],
    }


def clean_title(path: Path) -> str:
    # Check for local NFO first
    nfo_path = path.with_suffix(".nfo")
    if nfo_path.exists():
        try:
            import xml.etree.ElementTree as ET
            tree = ET.parse(nfo_path)
            title_node = tree.find(".//title")
            if title_node is not None and title_node.text:
                return title_node.text.strip()
        except Exception:
            pass
            
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
    h = hashlib.md5(title.encode()).hexdigest()
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


def build_thumbnail(source_path: Path, relative_path: str, title: str) -> str:
    destination = thumbnail_path_for(relative_path)
    jpg_destination = destination.with_suffix(".jpg")

    if destination.exists():
        return f"/thumbs/{destination.name}"
    if jpg_destination.exists():
        return f"/thumbs/{jpg_destination.name}"

    # Cinematic Discovery: Look for local posters/art
    for art_name in ["poster.jpg", "folder.jpg", "cover.jpg", "fanart.jpg"]:
        local_art = source_path.parent / art_name
        if local_art.exists():
            shutil.copy2(local_art, jpg_destination)
            return f"/thumbs/{jpg_destination.name}"
            
    if ffmpeg_available():
        command = [
            settings.ffmpeg_path,
            "-y",
            "-ss",
            "00:00:10",
            "-i",
            str(source_path),
            "-vf",
            "scale=480:-1",
            "-frames:v",
            "1",
            "-q:v",
            "4",
            str(jpg_destination),
        ]
        try:
            completed = subprocess.run(command, capture_output=True, text=True)
            if completed.returncode == 0 and jpg_destination.exists():
                logger.info(f"Generated thumbnail for {relative_path}")
                return f"/thumbs/{jpg_destination.name}"
            logger.error(f"Failed to generate thumbnail for {relative_path}: {completed.stderr}")
        except FileNotFoundError:
            logger.error("FFmpeg executable not found during thumbnail generation.")

    write_placeholder_thumbnail(destination, title)
    return f"/thumbs/{destination.name}"


# ── Sprite Sheet (Hover Preview Thumbnails) ────────────────────────────────────
SPRITE_THUMB_W = 160
SPRITE_THUMB_H = 90
SPRITE_COLUMNS = 10
SPRITE_INTERVAL = 5   # seconds between frames


def sprite_path_for(media_id: int) -> Path:
    return settings.sprites_folder / f"sprite_{media_id}.jpg"


def build_sprite_sheet(source_path: Path, media_id: int) -> dict | None:
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

    vf = (
        f"fps=1/{SPRITE_INTERVAL},"
        f"scale={SPRITE_THUMB_W}:{SPRITE_THUMB_H},"
        f"tile={SPRITE_COLUMNS}x"
    )
    command = [
        settings.ffmpeg_path,
        "-y",
        "-i", str(source_path),
        "-vf", vf,
        "-q:v", "5",
        str(destination),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and destination.exists():
            logger.info(f"Generated sprite sheet for media {media_id}")
            return _sprite_meta(destination, media_id)
        logger.error(f"Sprite generation failed for {media_id}: {result.stderr[-500:]}")
    except subprocess.TimeoutExpired:
        logger.error(f"Sprite generation timed out for media {media_id}")
    except FileNotFoundError:
        logger.error("FFmpeg not found during sprite sheet generation")
    return None


def _sprite_meta(path: Path, media_id: int) -> dict:
    return {
        "url": f"/api/media/sprites-secure/{media_id}",
        "thumb_w": SPRITE_THUMB_W,
        "thumb_h": SPRITE_THUMB_H,
        "columns": SPRITE_COLUMNS,
        "interval": SPRITE_INTERVAL,
    }


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
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        return {}

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {}

    format_data = payload.get("format", {})
    streams = payload.get("streams", [])
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    return {
        "duration_seconds": float(format_data["duration"]) if format_data.get("duration") else None,
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
        completed = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True)
        target = completed.stdout.strip()
        if target and Path(target).exists():
            return Path(target)
    except Exception:
        pass
    return None


def get_all_media_files(root: Path, base_relative: str = "") -> list[tuple[Path, str]]:
    items = []
    try:
        if not root.exists(): return []
        for p in root.iterdir():
            if p.name.startswith("."): continue
            try:
                if p.is_dir():
                    if p.name.lower() in {"icons", "icon"}:
                        continue
                    items.extend(get_all_media_files(p, f"{base_relative}{p.name}/"))
                elif p.suffix.lower() == ".lnk":
                    target = resolve_shortcut(p)
                    if target:
                        if target.is_dir():
                            items.extend(get_all_media_files(target, f"{base_relative}{p.stem}/"))
                        elif target.is_file() and is_media_file(target):
                            items.append((target, f"{base_relative}{p.stem}{target.suffix}"))
                elif is_media_file(p):
                    items.append((p, f"{base_relative}{p.name}"))
            except (PermissionError, OSError) as e:
                logger.warning(f"Skipping {p}: {e}")
    except (PermissionError, OSError) as e:
        logger.error(f"Could not access directory {root}: {e}")
    return items


async def scan_media_library(session: AsyncSession) -> int:
    logger.info("Starting media library discovery and indexing...")
    _scan_state["scanning"] = True
    _scan_state["files_scanned"] = 0
    _scan_state["files_total"] = 0
    indexed = 0
    seen_paths: set[str] = set()

    # Pre-fetch all existing media and folder settings to optimize lookup speed
    result = await session.execute(select(MediaMetadata))
    existing_map = {m.relative_path: m for m in result.scalars()}
    
    fs_result = await session.execute(select(FolderSetting))
    folder_settings_map = {s.path.lower(): s for s in fs_result.scalars() if s.path}

    media_files = await asyncio.to_thread(get_all_media_files, settings.shared_folder)
    _scan_state["files_total"] = len(media_files)

    for target_path, virtual_rel in media_files:
        logger.debug(f"Processing file during scan: {target_path.name}")
        seen_paths.add(virtual_rel)
        media = existing_map.get(virtual_rel)
        stat = target_path.stat()
        title = clean_title(target_path)
        
        # Performance optimization: if size is unchanged and duration is indexed, bypass heavy probe/thumbnail operations
        if media and media.file_size == stat.st_size and media.duration_seconds:
            thumbnail = media.thumbnail_path
            probe = {
                "width": media.width,
                "height": media.height,
                "bitrate": media.bitrate,
                "video_codec": media.video_codec,
                "audio_codec": media.audio_codec,
                "duration_seconds": media.duration_seconds
            }
        else:
            thumbnail = await asyncio.to_thread(build_thumbnail, target_path, virtual_rel, title)
            probe = await asyncio.to_thread(probe_media, target_path)

        if not media:
            media = MediaMetadata(relative_path=virtual_rel, path=str(target_path.resolve()))
            session.add(media)

        media.title = title
        media.category = virtual_rel.split("/", 1)[0] if "/" in virtual_rel else "Recently Added"
        media.file_size = stat.st_size
        media.container = target_path.suffix.lower().lstrip(".")
        media.thumbnail_path = thumbnail
        media.stream_mode = detect_stream_mode(target_path)
        media.hls_status = "ready" if media.stream_mode == "direct" else "pending"
        # We manually compute adult/pin for virtual relative paths


        virtual_parts = [""]
        current = ""
        for part in virtual_rel.split("/"):
            if not part: continue
            current = f"{current}/{part}" if current else part
            virtual_parts.append(current)

        # Check cached settings for this file's folder(s)
        db_settings = [folder_settings_map[p.lower()] for p in virtual_parts if p.lower() in folder_settings_map]
        
        db_locked = any(s.is_locked for s in db_settings)
        db_adult = any(s.is_adult for s in db_settings)

        keyword_parts = {piece for piece in virtual_rel.lower().split("/") if piece}
        media.requires_pin = db_locked or bool(keyword_parts & settings.pin_keyword_set)
        media.adult_only = db_adult or bool(keyword_parts & settings.adult_keyword_set)
        
        media.last_scanned_at = datetime.now(UTC)
        media.width = probe.get("width")
        media.height = probe.get("height")
        media.bitrate = probe.get("bitrate")
        media.video_codec = probe.get("video_codec")
        media.audio_codec = probe.get("audio_codec")
        media.duration_seconds = probe.get("duration_seconds")
        indexed += 1
        _scan_state["files_scanned"] = indexed

    result = await session.execute(select(MediaMetadata))
    for media in result.scalars():
        if media.relative_path not in seen_paths:
            await session.delete(media)

    await session.commit()
    _scan_state["scanning"] = False
    _scan_state["last_scan_at"] = datetime.now(UTC).isoformat()
    logger.info(f"Scan complete. Indexed {indexed} items.")
    from core.webhooks import trigger_webhook
    await trigger_webhook("library.updated", {"indexed_count": indexed})
    return indexed


async def library_groups(session: AsyncSession, current_user: User) -> list[dict]:
    query = select(MediaMetadata).order_by(MediaMetadata.category, MediaMetadata.title)
    query = await apply_media_security_filters(session, query, current_user)
        
    result = await session.execute(query)
    groups: dict[str, list[MediaMetadata]] = {}
    for media in result.scalars():
        groups.setdefault(media.category, []).append(media)
    return [{"label": label, "items": items} for label, items in groups.items()]


async def get_media(session: AsyncSession, media_id: int) -> MediaMetadata:
    result = await session.execute(select(MediaMetadata).where(MediaMetadata.id == media_id))
    media = result.scalar_one_or_none()
    if not media:
        logger.warning(f"Media resource not found: ID {media_id}")
        raise ResourceNotFoundError(f"Media with ID {media_id} not found.")
    return media


def media_source_path(media: MediaMetadata) -> Path:
    from core.storage import resolve_shared_path
    return resolve_shared_path(media.relative_path)


async def detect_intro_for_media(media_path: Path) -> tuple[float, float]:
    """
    Detect intro start and end using FFmpeg scene detection on the first 3 minutes.
    Falls back to a default range (30.0, 90.0) if detection fails or finds no clear intro.
    """
    import subprocess
    import re
    
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
        check = subprocess.run([settings.ffmpeg_path, "-encoders"], capture_output=True, text=True)
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
    filter_parts = [f"[0:v]split={num_profiles}{v_splits}"]
    
    for i, p in enumerate(profiles):
        filter_parts.append(f"[v{i}]scale=w={p['width']}:h={p['height']}[v{i}out]")
    
    filter_complex = "; ".join(filter_parts)

    cmd = [
        settings.ffmpeg_path,
        "-y",
        *hw_args,
        "-i", str(source_path),
        "-filter_complex", filter_complex,
    ]

    # Map each video output
    for i, p in enumerate(profiles):
        cmd.extend([
            "-map", f"[v{i}out]",
            f"-c:v:{i}", video_encoder,
            f"-preset:v:{i}", preset,
            f"-b:v:{i}", p["bitrate"],
            f"-maxrate:v:{i}", p.get("maxrate", p["bitrate"]),
            f"-bufsize:v:{i}", p.get("bufsize", "12000k"),
        ])

    has_audio = bool(media.audio_codec)
    if has_audio:
        cmd.extend([
            "-map", "0:a",
            "-c:a", "aac",
            "-b:a", "192k",
        ])

    cmd.extend([
        "-f", "hls",
        "-hls_time", "6",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
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
        logger.info(f"Starting ABR HLS transcoding for media ID {media.id} (priority: {priority})")
        command = build_hls_command(media_source_path(media), output_dir, profiles, media)
        
        # Windows-specific priority setting
        creation_flags = 0
        if priority:
            import os
            if os.name == 'nt':
                # ABOVE_NORMAL_PRIORITY_CLASS
                creation_flags = 0x00008000 

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
    try:
        from watchfiles import awatch
        from core.database import AsyncSessionLocal
        from core.events import broadcast_library_updated
        
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
                total = await scan_media_library(session)
                await broadcast_library_updated(total)
    except ImportError:
        logger.warning("watchfiles not installed. Auto-rescan disabled.")
    except Exception as e:
        logger.error(f"Media watcher failed: {e}")
async def apply_media_security_filters(
    session: AsyncSession,
    stmt,
    current_user: User,
):
    # 1. R18 / Adult Filter
    if not current_user.is_adult:
        stmt = stmt.where(MediaMetadata.adult_only == False)
        
    # 2. Locked Content Filter
    if current_user.role not in ("admin", "super-admin"):
        from sqlalchemy import exists, and_, or_
        from core.models import FolderPermission
        
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
                MediaMetadata.requires_pin == False,
                perm_exists
            )
        )
        
    return stmt


async def is_media_accessible(
    session: AsyncSession,
    media: MediaMetadata,
    current_user: User,
) -> bool:
    # 1. R18 / Adult check
    if media.adult_only and not current_user.is_adult:
        return False
        
    # 2. Locked Content check
    if media.requires_pin and current_user.role not in ("admin", "super-admin"):
        from sqlalchemy import exists, and_, or_
        from core.models import FolderPermission
        
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
        stmt = select(1).where(MediaMetadata.id == media.id).where(perm_exists)
        has_perm = (await session.execute(stmt)).scalar() is not None
        if not has_perm:
            return False
            
    return True


async def get_smart_home_data(session: AsyncSession, current_user: User) -> dict:
    # 1. Continue Watching
    subq = (
        select(PlayEvent.media_id, func.max(PlayEvent.created_at).label("latest"))
        .where(PlayEvent.user_id == current_user.id, PlayEvent.completed == False)
        .group_by(PlayEvent.media_id)
        .subquery()
    )
    
    cw_query = (
        select(MediaMetadata, PlayEvent.position_seconds, PlayEvent.created_at)
        .join(PlayEvent, MediaMetadata.id == PlayEvent.media_id)
        .join(subq, (PlayEvent.media_id == subq.c.media_id) & (PlayEvent.created_at == subq.c.latest))
        .order_by(PlayEvent.created_at.desc())
        .limit(12)
    )
    cw_query = await apply_media_security_filters(session, cw_query, current_user)

    cw_res = await session.execute(cw_query)
    continue_watching = [
        {
            "media": m,
            "last_position_seconds": pos,
            "updated_at": ts
        } for m, pos, ts in cw_res.all()
    ]

    # 2. Recently Added
    ra_query = select(MediaMetadata).order_by(MediaMetadata.created_at.desc(), MediaMetadata.id.desc()).limit(12)
    ra_query = await apply_media_security_filters(session, ra_query, current_user)
    
    ra_res = await session.execute(ra_query)
    recently_added = list(ra_res.scalars().all())

    # 3. Trending (Most played in total)
    t_subq = (
        select(PlayEvent.media_id, func.count(PlayEvent.id).label("play_count"))
        .group_by(PlayEvent.media_id)
        .order_by(text("play_count DESC"))
        .limit(12)
        .subquery()
    )
    t_query = select(MediaMetadata).join(t_subq, MediaMetadata.id == t_subq.c.media_id)
    t_query = await apply_media_security_filters(session, t_query, current_user)
        
    t_res = await session.execute(t_query)
    trending = list(t_res.scalars().all())

    # 4. Recommendations (Random unwatched/unseen)
    rec_query = select(MediaMetadata).order_by(func.random()).limit(12)
    rec_query = await apply_media_security_filters(session, rec_query, current_user)
        
    rec_res = await session.execute(rec_query)
    recommendations = list(rec_res.scalars().all())

    # Fallback: if recently_added is empty but database has items, 
    # fetch some items without strict ordering to ensure Home is not empty.
    if not recently_added:
        fallback_query = select(MediaMetadata).limit(24)
        fallback_query = await apply_media_security_filters(session, fallback_query, current_user)
        fallback_res = await session.execute(fallback_query)
        recently_added = list(fallback_res.scalars().all())

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
