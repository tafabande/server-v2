# MediaHub

MediaHub is a LAN-first private media server scaffold based on the supplied design schema. It combines a FastAPI backend, async SQLAlchemy models, an offline-friendly media scanner, FFmpeg-backed HLS transcoding, and a retro streaming SPA.

## What is included

- FastAPI app entrypoint with routers for auth, media, files, and system endpoints.
- Async SQLAlchemy models for `users`, `media_metadata`, `play_events`, `audit_logs`, and `system_settings`.
- Recursive scanner for `shared_media/` with filename cleanup, thumbnail generation, stream mode selection, and basic ffprobe metadata.
- Path sandboxing, JWT auth, role checks, admin PIN protection for locked folders, and audit logging for file mutations.
- A static frontend with hero banner, carousel rows, file explorer, upload flow, and built-in playback modal.
- A worker script to clear stale HLS cache directories.

## Project layout

- `main.py`: FastAPI app and static mounts.
- `config.py`: environment-backed settings.
- `core/`: database, models, auth, system settings, media engine, storage helpers.
- `routers/`: API endpoints and WebSocket route.
- `static/`: HTML, CSS, and browser-side JS managers.
- `workers/cleanup_hls.py`: HLS cache cleanup utility.
- `shared_media/`: sandboxed content root.

## Run locally

1. Create and activate a Python 3.12 or 3.13 virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and adjust values if needed.
4. Start the app:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

5. Open `http://localhost:8000`.

Default bootstrap credentials:

- Username: `admin`
- Password: `admin123`
- Admin PIN: `1984`

## Notes

- Direct playback is used for `.mp4`, `.m4v`, and `.webm`.
- Other supported video containers are routed through HLS and require FFmpeg to be installed and reachable on `PATH`.
- If `ffprobe` is unavailable, metadata fields still index but stay partially empty.
- The frontend will work without Hls.js for direct streams; HLS playback uses native browser support unless you later vendor Hls.js locally.
- The preinstalled Python 3.14 async SQLite stack in this workspace stalled during database startup checks, so use a fresh virtual environment from `requirements.txt` for actual runtime verification.
