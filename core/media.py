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
    escaped_title = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1b1412" />
      <stop offset="100%" stop-color="#5f1f16" />
    </linearGradient>
  </defs>
  <rect width="640" height="360" rx="28" fill="url(#bg)" />
  <rect x="28" y="28" width="584" height="304" rx="22" fill="none" stroke="#ff7750" stroke-width="2" opacity="0.7" />
  <text x="48" y="88" fill="#f3c888" font-size="26" font-family="Trebuchet MS, sans-serif">MEDIAHUB</text>
  <text x="48" y="198" fill="#fff4dd" font-size="42" font-family="Impact, Haettenschweiler, sans-serif">{escaped_title}</text>
  <text x="48" y="250" fill="#ffb07a" font-size="18" font-family="Trebuchet MS, sans-serif">Offline stream ready</text>
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


async def scan_media_library(session: AsyncSession) -> int:
    logger.info("Starting media library discovery and indexing...")
    indexed = 0
    seen_paths: set[str] = set()

    for path in settings.shared_folder.rglob("*"):
        if not is_media_file(path):
            continue

        logger.debug(f"Processing file during scan: {path.name}")
        relative_path = relative_shared_path(path)
        seen_paths.add(relative_path)
        result = await session.execute(select(MediaMetadata).where(MediaMetadata.relative_path == relative_path))
        media = result.scalar_one_or_none()
        stat = path.stat()
        title = clean_title(path)
        thumbnail = build_thumbnail(path, relative_path, title)
        probe = probe_media(path)

        if not media:
            media = MediaMetadata(relative_path=relative_path, path=str(path.resolve()))
            session.add(media)

        media.title = title
        media.category = media_category(path)
        media.file_size = stat.st_size
        media.container = path.suffix.lower().lstrip(".")
        media.thumbnail_path = thumbnail
        media.stream_mode = detect_stream_mode(path)
        media.hls_status = "ready" if media.stream_mode == "direct" else "pending"
        media.requires_pin = is_path_locked(path)
        media.adult_only = is_path_adult(path)
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
    return resolve_shared_path(media.relative_path)


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
    preset = "p4" if has_nvenc else ("balanced" if has_qsv else "veryfast")
    
    # ABR Variants: 800k, 1200k, 2000k
    # For simplicity in this implementation, we'll create a single multi-bitrate stream 
    # or just use a robust single stream with ABR-friendly settings if complex master playlists are too much for now.
    # Actually, the requirement asks for variants.
    
    return [
        settings.ffmpeg_path,
        "-y",
        "-i", str(source_path),
        "-filter_complex", "[0:v]split=3[v1][v2][v3]; [v1]scale=w=640:h=360:force_original_aspect_ratio=decrease[v1out]; [v2]scale=w=1280:h=720:force_original_aspect_ratio=decrease[v2out]; [v3]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v3out]",
        "-map", "[v1out]", "-c:v:0", video_encoder, "-b:v:0", "800k", "-maxrate:v:0", "850k", "-bufsize:v:0", "1200k",
        "-map", "[v2out]", "-c:v:1", video_encoder, "-b:v:1", "1200k", "-maxrate:v:1", "1300k", "-bufsize:v:1", "2000k",
        "-map", "[v3out]", "-c:v:2", video_encoder, "-b:v:2", "2000k", "-maxrate:v:2", "2200k", "-bufsize:v:2", "3000k",
        "-map", "0:a", "-c:a", "aac", "-b:a", "128k",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_type", "fmp4",
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", "v:0,a:0 v:1,a:0 v:2,a:0",
        "-hls_segment_filename", str(output_dir / "stream_%v/data%03d.m4s"),
        str(output_dir / "stream_%v.m3u8"),
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
