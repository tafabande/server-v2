# MediaHub

MediaHub is a high-performance, minimalist LAN-first media server. It features a modern React + TypeScript + Tailwind CSS UI, retrowave VHS video player, FastAPI backend, PWA offline capabilities, and real-time progressive media syncing.

## Features

- **Modern Redesign UI**: Responsive React interface with dark theme and indigo accents.
- **Real-Time Live Sync**: WebSocket event streaming so newly uploaded or scanned media items appear instantly on screen.
- **VHS Media Player**: Immersive VHS/Synthwave themed player with scanlines and controls.
- **1k Batch File Upload**: High-performance batch uploader with drag-and-drop & progress bar.
- **Offline PWA Support**: Service Worker (`public/sw.js`), Web App Manifest, and zero-dependency SVG poster fallbacks for air-gapped playback.
- **User Videos Integration**: Automatically scans and streams media from `%USERPROFILE%\Videos` (User Videos).
- **FastAPI Backend**: Routers for auth, media, files, playlists, users, and system endpoints with SQLite self-healing.

## Data Fetching Guidelines

All frontend data fetching is managed via **`src/api.ts`**:
- **Centralized Client**: Use `api.getLibrary()`, `api.getContinueWatching()`, `api.getHistory()`, etc.
- **Authentication**: Injects `Authorization: Bearer <token>` automatically when logged in.
- **Real-Time Subscription**: Use `api.subscribeToUpdates(callback)` to receive instant WebSocket updates (`library-updated`).
- **Streaming**: Video and audio files stream directly via `GET /api/media/{id}/file` with HTTP Range headers.

## Run Locally

### Quick Launch (Windows)
Double-click [`launch.bat`](file:///c:/Users/User/Documents/new%20-%20Copy/launch.bat) or run in terminal:
```cmd
launch.bat
```

### Manual Launch
1. Install Python dependencies:
   ```cmd
   pip install -r requirements.txt
   ```
2. Build frontend production assets:
   ```cmd
   npx vite build
   ```
3. Start the FastAPI server:
   ```cmd
   python main.py
   ```
   Access points will be printed in the terminal (e.g. `http://localhost:51733` or LAN IP).
