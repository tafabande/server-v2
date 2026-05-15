# StreamDrop

StreamDrop is a premium LAN-first media server scaffold. It features a high-fidelity **Luminescent Glass** UI, FastAPI backend, and FFmpeg-driven HLS streaming.

## What is included

- **Luminescent UI**: Glassmorphic dashboard with dynamic gradients and neon accents.
- **FastAPI Backend**: Routers for auth, media, files, and system endpoints.
- **Async Logic**: SQLAlchemy models and async file operations.
- **Media Engine**: HLS transcoding and recursive scanning for `shared_media/`.
- **Security**: JWT auth, path sandboxing, and admin PIN protection.

## Project layout

- `main.py`: App entrypoint and static routing.
- `config.py`: Environment configuration.
- `core/`: Database, models, and streaming engine.
- `static/`: The "Luminescent Glass" frontend (HTML/CSS/JS).
- `hub.bat`: Master controller for server management.

## Run locally

1. Setup Python environment.
2. Install dependencies: `pip install -r requirements.txt`.
3. Start the hub: Run `hub.bat` and choose option 1.

Default bootstrap credentials:
- Username: `admin`
- Password: `admin123`
- Admin PIN: `1984`
