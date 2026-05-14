# MediaHub — Comprehensive Design & Charter

## PART I: THE ESSENTIALS (Quick Reference)

### 1. The Essence
**MediaHub** is a private LAN media server that mirrors the **Netflix UX** with a **Retro-Classic** (VHS/80s cinematic) aesthetic. Built for speed, privacy, and 100% offline LAN operation.

### 2. Core Features
- **Netflix-Style UI**: Horizontal carousels and cinematic hero banners.
- **Smart Discovery**: Auto-cleans filenames and generates thumbnails.
- **Universal Streaming**: FFmpeg-driven HLS transcoding for any device.
- **Full Explorer**: Manage files (upload/delete/rename) directly.
- **LAN-Only**: No active internet connection required. All assets served locally.

### 3. Tech Stack
- **Backend**: FastAPI, SQLAlchemy (Async).
- **Frontend**: Vanilla JS, Pure CSS (Material 3 tokens).
- **Media**: FFmpeg (Transcoding).
- **DB/Cache**: SQLite (or PostgreSQL) + Redis (with memory fallback).

---

## PART II: TECHNICAL DEEP DIVE

### 4. Implementation Detail: Media Engine
To deliver the "Netflix experience" without internet:
- **Streaming Strategy**: Direct stream for MP4/H264; HLS segmenting for MKV/AVI/others.
- **HLS Logic**: FFmpeg is invoked in a sub-process to generate `.m3u8` manifests and `.ts` segments.
- **Caching**: Segments are stored in a temp directory and cleared after 7 days of inactivity.
- **Optimization**: Admin can enable "Pre-transcoding" for specific folders to ensure zero-lag playback.

### 5. Technical Specification: Database Schema
- **`users`**: Credentials, roles (`admin`, `family`, `guest`), and preferences (JSON).
- **`media_metadata`**: Extensive file info (resolution, bitrate, codecs, HLS status).
- **`play_events`**: High-frequency telemetry for "Resume Playback" and history tracking.
- **`audit_logs`**: Immutable security records for sensitive actions (e.g., file deletions).
- **`system_settings`**: Key-value store for global branding and maintenance modes.

### 6. Frontend Logic: Component Architecture
- **`GalleryManager`**: Handles horizontal carousels, grid views, and the "Retro" scroll behavior.
- **`PlayerManager`**: Integrates HLS.js with custom skins matching the **VHS-Red** aesthetic.
- **`ExplorerManager`**: Manages nested navigation and file CRUD operations.
- **`SocketClient`**: Listens for system signals to trigger targeted UI refreshes.

### 7. Security & Content Control
- **RBAC**: Every API request is verified against JWT and User Role.
- **18+ Content Lock**: Folders can be flagged to require session-specific PIN/confirmation.
- **Admin PIN Access**: Sensitive directories can be locked behind a 4-digit PIN.
- **Path Protection**: All paths are resolved against the `SHARED_FOLDER` sandbox to prevent traversal.

---

## PART III: DEVELOPER ROADMAP

### 8. Building from Scratch (Order of Ops)
1. **Environment**: Set up `.env` and `config.py`.
2. **File Manager**: Build the recursive scanner and indexer.
3. **Database**: Implement schemas for Media, Users, and Logs.
4. **Security**: Establish JWT and role-based middleware.
5. **Media Engine**: Integrate FFmpeg for HLS/Streaming.
6. **Real-time**: Add WebSocket broadcasting logic.
7. **Frontend**: Assemble the "Retro-Netflix" SPA in `/static`.

### 9. Key Directory Map
- `/core`: The Brain (Database, Streaming, Security, Watcher).
- `/routers`: The API (Auth, Files, Media, System).
- `/static`: The Face (HTML/CSS/JS/Fonts).
- `/thumbs`: Local generated thumbnails.
- `/workers`: Background task scripts.

### 10. Troubleshooting
- **FFmpeg**: Check `/logs` for codec or path errors.
- **WebSockets**: Ensure port 8000 allows inbound TCP (Firewall).
- **Thumbnails**: Verify write permissions for the `/thumbs` directory.
- **Sessions**: If sessions reset, ensure `SECRET_KEY` is fixed in `.env`.
