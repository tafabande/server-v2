# MediaHub — Project Design Document

## Identity
- **Name**: MediaHub
- **Type**: Minimalist LAN media server
- **Aesthetic**: Clean dark monochrome UI, single accent color (indigo), VHS/synthwave video player
- **Stack**: FastAPI + SQLAlchemy (async) + SQLite + Vanilla JS/CSS
---

## Design Principles
1. **Function over form** — every element serves a purpose
2. **Data-dense** — show information, not decoration
3. **Offline-first** — zero external CDN dependencies, fully air-gapped capable
4. **Keyboard-accessible** — Ctrl+K search, Space/arrows player, F fullscreen
5. **VHS player as signature** — the one place the app breaks from minimalism

---

## Design Tokens
```
Background:   #111113 (near-black)
Surface:      #1a1a1f (cards, panels)
Hover:        #252529
Border:       #2a2a30
Text:         #e4e4e7
Text Muted:   #71717a
Accent:       #6366f1 (indigo)
Success:      #22c55e
Warning:      #eab308
Error:        #ef4444
Font:         system-ui, -apple-system, sans-serif
Radius:       6px
```

---

## Architecture

### Backend (Python / FastAPI)
- `main.py` — FastAPI app with lifespan, CORS, static mounts
- `config.py` — Settings from env/dotenv, path management
- `core/database.py` — Async SQLAlchemy engine + session factory
- `core/models.py` — 9 tables: users, media_metadata, play_events, audit_logs, system_settings, playlists, playlist_items, permissions, server_status
- `core/security.py` — JWT auth, bcrypt hashing, RBAC (admin/family/guest)
- `core/media.py` — FFmpeg HLS transcoding, ABR variants, metadata probing, thumbnail generation
- `core/storage.py` — Path sandboxing, PIN locks, adult content filtering
- `core/bootstrap.py` — DB self-healing, admin/guest user provisioning, background media scan
- `core/discovery.py` — mDNS/Zeroconf LAN broadcast

### API Routers
- `/api/auth` — Login, logout, /me
- `/api/media` — Library, streaming, play events, history, continue watching, rescan
- `/api/files` — Browse, upload, rename, delete (admin/family)
- `/api/users` — CRUD user management (admin), self-service profile/password
- `/api/playlists` — CRUD playlists, add/remove items
- `/api/system` — Health, metrics, sessions, settings, audit logs, WebSocket

### Frontend (Vanilla JS / CSS)
- `static/css/styles.css` — Minimalist design system
- `static/css/player.css` — VHS/synthwave player theme
- `static/index.html` — SPA shell with sidebar, player modal, dialogs
- `static/js/app.js` — Entry point, router, auth guard
- `static/js/api.js` — HTTP client for all endpoints
- `static/js/router.js` — Client-side routing with history API
- `static/js/player-manager.js` — VHS player with HLS.js, keyboard/touch controls
- `static/js/utils.js` — Toast, formatting, confirm dialog

### Views
| Route | File | Purpose |
|:---|:---|:---|
| `/` | `views/home.js` | Continue watching, category rows, search |
| `/library` | `views/library.js` | Full grid/table, sort, filter, category tabs |
| `/explorer` | `views/explorer.js` | File browser, upload, rename, delete |
| `/playlists` | `views/playlists.js` | Playlist management, play all |
| `/history` | `views/history.js` | Watch history table, progress, clear all |
| `/admin` | `views/admin.js` | Metrics, user CRUD, audit log |
| `/profile` | `views/profile.js` | Bio, password change, preferences |
| `/login` | `views/login.js` | Auth form, guest login |

---

## Video Player (VHS/Synthwave Theme)
The player is a fullscreen dialog that transforms the clean UI into an immersive retro experience:
- **Mechanical VHS buttons**: EJECT, REW, PLAY, FF, STOP, PAUSE — raised 3D CSS buttons
- **Tape info sidebar**: Title, format, resolution, duration, position, quality badge
- **8-LED volume bar**: Green (1-5), yellow (6-7), red (8) with glow effects
- **Scanlines overlay**: `repeating-linear-gradient` at 2px intervals, low opacity
- **CRT glow**: Amber `box-shadow` on the video container
- **Transport bar**: Progress track, monospace timestamps
- **Keyboard**: Space, ←→, ↑↓, F, M, Esc
- **Touch**: Double-tap seek, vertical swipe volume

---

## Security
- JWT tokens with role claims
- Roles: admin, family, guest
- `require_roles()` decorator for endpoint protection
- Path sandboxing in `resolve_shared_path()`
- PIN-based folder locks
- Adult content keyword filtering
- Audit logging for file operations

---

## Responsive Breakpoints
| Width | Layout |
|:---|:---|
| `< 768px` | Bottom tab bar, stacked forms, smaller cards |
| `768-1199px` | Icon-only sidebar |
| `≥ 1200px` | Full sidebar with labels |
