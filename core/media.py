from __future__ import annotations

import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import FileOperationError, ResourceNotFoundError
from core.logging import get_logger
from core.models import AuditLog, MediaMetadata, PlayEvent
from core.storage import is_media_file, is_path_adult, is_path_locked, relative_shared_path, resolve_shared_path


settings = get_settings()
logger = get_logger("media")
DIRECT_STREAM_EXTENSIONS = {".mp4", ".m4v", ".webm"}


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
            
    title = path.stem.replace(".", " ").replace("_", " ").replace("-", " ")
    return " ".join(part for part in title.split() if part).title()


def media_category(path: Path) -> str:
    relative = relative_shared_path(path)
    return relative.split("/", 1)[0] if "/" in relative else "Recently Added"


def thumbnail_path_for(relative_path: str) -> Path:
    safe_name = relative_path.replace("/", "__").replace("\\", "__")
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
            "-frames:v",
            "1",
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


async def scan_media_library(session: AsyncSession) -> int:
    logger.info("Starting media library discovery and indexing...")
    indexed = 0
    seen_paths: set[str] = set()

    def get_all_media_files(root: Path, base_relative: str = "") -> list[tuple[Path, str]]:
        items = []
        try:
            for p in root.iterdir():
                # Ignore hidden files and folders
                if p.name.startswith("."):
                    continue
                    
                try:
                    if p.is_dir():
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
                    continue
        except (PermissionError, OSError) as e:
            logger.error(f"Could not access directory {root}: {e}")
        return items

    for target_path, virtual_rel in get_all_media_files(settings.shared_folder):
        logger.debug(f"Processing file during scan: {target_path.name}")
        seen_paths.add(virtual_rel)
        result = await session.execute(select(MediaMetadata).where(MediaMetadata.relative_path == virtual_rel))
        media = result.scalar_one_or_none()
        stat = target_path.stat()
        title = clean_title(target_path)
        thumbnail = build_thumbnail(target_path, virtual_rel, title)
        probe = probe_media(target_path)

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
        virtual_parts = {piece for piece in virtual_rel.lower().split("/") if piece}
        media.requires_pin = bool(virtual_parts & settings.pin_keyword_set)
        media.adult_only = bool(virtual_parts & settings.adult_keyword_set)
        
        media.last_scanned_at = datetime.now(UTC)
        media.width = probe.get("width")
        media.height = probe.get("height")
        media.bitrate = probe.get("bitrate")
        media.video_codec = probe.get("video_codec")
        media.audio_codec = probe.get("audio_codec")
        media.duration_seconds = probe.get("duration_seconds")
        indexed += 1

    result = await session.execute(select(MediaMetadata))
    for media in result.scalars():
        if media.relative_path not in seen_paths:
            await session.delete(media)

    await session.commit()
    logger.info(f"Scan complete. Indexed {indexed} items.")
    return indexed


async def library_groups(session: AsyncSession) -> list[dict]:
    result = await session.execute(select(MediaMetadata).order_by(MediaMetadata.category, MediaMetadata.title))
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
    return Path(media.path)


def build_hls_command(source_path: Path, output_dir: Path) -> list[str]:
    manifest = output_dir / "index.m3u8"
    
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
    
    # To eliminate stuttering and reduce latency on the fly, we encode a single native-resolution 
    # stream with a high bitrate cap, rather than killing the CPU with 3 simultaneous scaling operations.
    return [
        settings.ffmpeg_path,
        "-y",
        "-i", str(source_path),
        "-c:v", video_encoder,
        "-preset", preset,
        "-tune", "zerolatency",
        "-b:v", "5000k",
        "-maxrate", "5000k",
        "-bufsize", "10000k",
        "-c:a", "aac", 
        "-b:a", "192k",
        "-f", "hls",
        "-hls_time", "3",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_type", "fmp4",
        "-hls_segment_filename", str(output_dir / "data%03d.m4s"),
        str(output_dir / "master.m3u8"),
    ]


async def ensure_hls_manifest(session: AsyncSession, media: MediaMetadata) -> Path:
    import asyncio
    from core.events import socket_manager
    
    output_dir = hls_output_dir(media.id)
    master_manifest = output_dir / "master.m3u8"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if master_manifest.exists():
        return master_manifest

    if not ffmpeg_available():
        logger.error("FFmpeg not found in path")
        raise FileOperationError("FFmpeg is required for HLS transcoding but is not installed.")

    logger.info(f"Starting ABR HLS transcoding for media ID {media.id}")
    
    command = build_hls_command(media_source_path(media), output_dir)
    
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    # Task to capture stderr (where FFmpeg logs progress) and broadcast it
    async def log_reader(stream):
        while True:
            line = await stream.readline()
            if not line:
                break
            log_line = line.decode().strip()
            if log_line:
                await socket_manager.broadcast({
                    "type": "transcoding-log",
                    "media_id": media.id,
                    "line": log_line
                })

    asyncio.create_task(log_reader(process.stderr))
    
    returncode = await process.wait()
    
    if returncode != 0:
        logger.error(f"FFmpeg failed with return code {returncode}")
        media.hls_status = "error"
        await session.commit()
        raise FileOperationError(f"HLS generation failed for media ID {media.id}.")

    media.hls_status = "ready"
    await session.commit()
    return master_manifest


async def build_stream_response(session: AsyncSession, media: MediaMetadata) -> dict:
    if media.stream_mode == "direct":
        return {"mode": "direct", "url": f"/api/media/{media.id}/file"}

    # Non-blocking HLS launch
    import asyncio
    output_dir = hls_output_dir(media.id)
    manifest = output_dir / "master.m3u8"
    
    if not manifest.exists():
        # Start the transcode in the background instead of waiting
        asyncio.create_task(ensure_hls_manifest(session, media))
        return {"mode": "hls", "url": f"/temp/hls/{media.id}/master.m3u8", "status": "preparing"}

    return {"mode": "hls", "url": f"/temp/hls/{media.id}/master.m3u8", "status": "ready"}


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
        async for changes in awatch(settings.shared_folder):
            # Filter out changes to hidden files
            valid_changes = [c for c in changes if not Path(c[1]).name.startswith(".")]
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
