# MediaHub — Project Design Document

## Identity
- **Name**: MediaHub
- **Type**: Minimalist LAN media server
- **Aesthetic**: Clean dark monochrome UI, single accent color (indigo), VHS/synthwave video player
- **Stack**: FastAPI + SQLAlchemy (async) + SQLite + React 19 + TypeScript + Vite 8 + Tailwind CSS v4
---

## Design Principles
1. **Function over form** — every element serves a purpose
2. **Data-dense** — show information, not decoration
3. **Offline-first** — zero external CDN dependencies, fully air-gapped capable with PWA Service Worker
4. **Keyboard-accessible** — Space/arrows player, ESC modals
5. **VHS player as signature** — the one place the app breaks from minimalism
6. **Real-time Progressive Sync** — instant WebSocket updates as files are uploaded or scanned

---

## Design Tokens
```
Background:   #0b0b0e (near-black)
Surface:      #131318 (cards, panels)
Border:       #21212e
Text:         #e0e0ea
Text Muted:   #74748a
Accent:       #6366f1 (indigo)
Success:      #22c55e
Warning:      #eab308
Error:        #ef4444
Font:         system-ui, -apple-system, sans-serif
```

---

## Data Fetching Guidelines & Architecture

### API Client (`src/api.ts`)
All frontend data fetching is centralized in `src/api.ts` through the `api` singleton (`ApiClient`):
- **Token Management**: Automatically retrieves JWT token from `localStorage` (`mediahub_token`) and injects `Authorization: Bearer <token>` into all API requests.
- **Graceful Unauthenticated Fallback**: Endpoint failures (401/403) fall back to clean empty states (`[]`) or public LAN read access without crashing the UI.
- **Thumbnail URL Resolution**: Automatically formats poster URLs to `/api/media/{id}/thumbnail` with zero-dependency inline SVG fallbacks if thumbnails are generating.

### Core API Methods
| Method | Endpoint | Description |
|:---|:---|:---|
| `api.getPublicUsers()` | `GET /api/auth/public-users` | Public user profile selector for login screen |
| `api.login(user, pin)` | `POST /api/auth/token` | Obtains JWT access token and user info |
| `api.getLibrary(params)` | `GET /api/media/library` | Paginated/filtered media list with title search (`q`) |
| `api.getContinueWatching()` | `GET /api/media/continue` | User continue watching row with progress % |
| `api.getRecentlyAdded()` | `GET /api/media/recent` | Recently added media files |
| `api.getHistory()` | `GET /api/media/history` | User watch history |
| `api.getPlaylists()` | `GET /api/playlists` | User playlists |
| `api.getSystemFolders()` | `GET /api/system/metrics` | System storage sizes and media item counts |
| `api.subscribeToUpdates(cb)`| `WS /api/system/ws` | Real-time WebSocket event listener for progressive library updates |

### Real-Time Live Sync Strategy
1. React views (`HomeView`, `LibraryView`, `AdminView`) subscribe to real-time events via `api.subscribeToUpdates(data => ...)` on mount.
2. When `data.type === 'library-updated'` or `data.type === 'media-added'` arrives over WebSocket, views re-fetch active dataset.
3. As media files are uploaded or scanned, new cards render **immediately in real time** without requiring page reloads or waiting for batch completion.

### Media Streaming Strategy
- **Direct Video Stream**: Served via `GET /api/media/{media_id}/file` with HTTP `Accept-Ranges: bytes` headers for smooth scrubbing in HTML5 `<video>` tags.
- **HLS Stream Info**: Available via `GET /api/media/{media_id}/stream`.

---

## Project Structure

```
├── main.py                # FastAPI app entrypoint, SPA routing & static mounts
├── config.py              # System configuration & path resolution
├── launch.bat             # One-click launcher script for Windows
├── core/                  # Engine core (database, models, security, media processing)
│   ├── bootstrap.py       # Table self-healing, default users & startup scan
│   ├── discovery.py       # mDNS LAN discovery
│   ├── events.py          # WebSocket ConnectionManager and event broadcast
│   ├── media.py          # FFmpeg metadata probing, thumbnail & HLS generation
│   ├── schemas.py        # Pydantic schemas (MediaRead, User, etc.)
│   └── storage.py        # Path sandboxing, upload handling & user Videos access
├── routers/               # API endpoint routers (auth, media, files, playlists, system)
├── public/                # Static PWA assets (sw.js, manifest.json)
└── src/                   # React TypeScript frontend
    ├── App.tsx            # Main application UI, routing & views
    ├── api.ts             # Production API client & WebSocket sync
    └── index.css          # Design system, glitch tokens & responsive layout
```
