# MediaHub

MediaHub is a premium, minimalist LAN-first media server. It features a high-fidelity **Minimalist Design System** UI (with a special VHS/Synthwave video player), FastAPI backend, and FFmpeg-driven HLS streaming.

## What is included

- **Minimalist UI**: Clean, data-dense interface with a stark dark theme and indigo accents.
- **VHS Player**: An immersive VHS/Synthwave themed media player with mechanical buttons and scanlines.
- **FastAPI Backend**: Routers for auth, media, files, playlists, users, and system endpoints.
- **Async Logic**: SQLAlchemy models and async file operations.
- **Media Engine**: HLS transcoding and recursive scanning for `shared_media/`.
- **Security**: JWT auth, path sandboxing, and admin PIN protection.

## Project layout

- `main.py`: App entrypoint and static routing.
- `config.py`: Environment configuration.
- `core/`: Database, models, and streaming engine.
- `routers/`: API endpoints for auth, media, playlists, system, files, users.
- `static/`: The Minimalist frontend (HTML/CSS/JS) and VHS player.
- `hub.bat`: Master controller for server management.

## Run locally

1. Setup Python environment.
2. Install dependencies: `pip install -r requirements.txt`.
3. Start the hub: Run `hub.bat` and choose option 1.

Default bootstrap credentials:
- Username: `admin`
- Password: `admin123`
- Admin PIN: `1984`
