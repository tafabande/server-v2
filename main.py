import sys
import asyncio

# Fix for WinError 10038 and asyncio race conditions on Windows (esp. Python 3.12+)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    # Suppress noisy WinError 10054 (browser closed tab mid-stream) from asyncio logs
    from asyncio.proactor_events import _ProactorBasePipeTransport
    
    def silence_winerror_10054(func):
        def wrapper(self, *args, **kwargs):
            try:
                return func(self, *args, **kwargs)
            except ConnectionResetError as e:
                if getattr(e, 'winerror', 0) == 10054:
                    pass
                else:
                    raise
        return wrapper
        
    _ProactorBasePipeTransport._call_connection_lost = silence_winerror_10054(_ProactorBasePipeTransport._call_connection_lost)

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status, Response
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import get_settings
from core.bootstrap import bootstrap_application
from core.database import init_db
from core.exceptions import MediaHubError
from core.logging import setup_logging, get_logger
from routers import auth, files, media, playlists, requests, system, users, webhooks, admin, collections


# Initialize logging before settings are even fetched to ensure startup is logged
setup_logging()
logger = get_logger("main")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    import socket
    def get_lan_ip():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    lan_ip = get_lan_ip()
    logger.info("Application starting up...")
    logger.info(f"--- MediaHub Access Points ---")
    logger.info(f"LOCAL: http://localhost:{settings.port}")
    logger.info(f"LAN:   http://{lan_ip}:{settings.port}")
    logger.info(f"------------------------------")
    
    # Start Zeroconf Discovery (Non-blocking)
    try:
        from core.discovery import discovery
        discovery.start()
    except Exception as e:
        logger.error(f"Discovery could not start: {e}")
    
    await init_db()
    await bootstrap_application()
    
    # Start Background Media Watcher
    from core.media import watch_media_library
    asyncio.create_task(watch_media_library())

    # Start Background Orphan Cleanup Job
    from core.media import run_orphan_cleanup_job
    asyncio.create_task(run_orphan_cleanup_job())
    
    yield
    
    logger.info("Application shutting down...")
    from core.media import cleanup_active_processes
    await cleanup_active_processes()
    discovery.stop()


app = FastAPI(
    title=settings.app_name,
    description="Minimalist LAN media server.",
    version="1.0.0",
    lifespan=lifespan,
)

# Exception Handlers
@app.exception_handler(MediaHubError)
async def mediahub_exception_handler(request: Request, exc: MediaHubError):
    logger.error(f"Application error: {exc.message}", exc_info=True)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "error_code": exc.__class__.__name__},
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    # 404/405 are expected client-side misses (missing previews, wrong paths, etc.)
    # Log them at DEBUG so they don't pollute the error stream.
    if exc.status_code in (404, 405):
        logger.debug(f"HTTP {exc.status_code}: {exc.detail} [{request.method} {request.url.path}]")
    else:
        logger.warning(f"HTTP {exc.status_code}: {exc.detail} [{request.method} {request.url.path}]")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.critical(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal server error occurred. Please contact the administrator."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=500)


@app.middleware("http")
async def global_recovery_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:
        logger.critical(f"Global recovery net caught unhandled exception: {str(exc)}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "A critical system error occurred. Our engineers have been notified."},
        )


@app.middleware("http")
async def idempotency_middleware(request: Request, call_next):
    # Only check mutating methods
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        id_key = request.headers.get("idempotency-key") or request.headers.get("x-idempotency-key")
        if id_key:
            from core.database import AsyncSessionLocal
            from core.models import IdempotentRequest
            from sqlalchemy import select
            import json

            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(IdempotentRequest).where(IdempotentRequest.key == id_key)
                )
                cached = result.scalar_one_or_none()
                if cached:
                    try:
                        body_data = json.loads(cached.response_body)
                        return JSONResponse(
                            status_code=cached.response_code,
                            content=body_data
                        )
                    except Exception:
                        return JSONResponse(
                            status_code=cached.response_code,
                            content={"detail": cached.response_body}
                        )

            response = await call_next(request)

            if response.status_code < 500:
                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    body_bytes = b""
                    if hasattr(response, "body_iterator"):
                        body_bytes = b""
                        async for chunk in response.body_iterator:
                            body_bytes += chunk
                    else:
                        body_bytes = getattr(response, "body", b"")
                    
                    body_str = body_bytes.decode("utf-8", errors="ignore")

                    async with AsyncSessionLocal() as session:
                        check_result = await session.execute(
                            select(IdempotentRequest).where(IdempotentRequest.key == id_key)
                        )
                        if not check_result.scalar_one_or_none():
                            session.add(
                                IdempotentRequest(
                                    key=id_key,
                                    response_code=response.status_code,
                                    response_body=body_str
                                )
                            )
                            await session.commit()

                    return Response(
                        content=body_bytes,
                        status_code=response.status_code,
                        headers=dict(response.headers),
                        media_type=content_type
                    )
            return response

    return await call_next(request)


@app.middleware("http")
async def add_cache_control_header(request: Request, call_next):
    response = await call_next(request)
    # Cache static assets and HLS segments for better multi-device performance
    if request.url.path.startswith(("/static", "/thumbs", "/temp/hls", "/sprites")):
        if request.url.path.endswith((".js", ".html", ".m3u8")):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        else:
            response.headers["Cache-Control"] = "public, max-age=3600"
    return response

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(media.router, prefix="/api/media", tags=["media"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(playlists.router, prefix="/api/playlists", tags=["playlists"])
app.include_router(requests.router, prefix="/api/requests", tags=["requests"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(collections.router, prefix="/api/collections", tags=["collections"])

@app.get("/sw.js", include_in_schema=False)
async def serve_sw():
    return FileResponse(Path("static/sw.js"), media_type="application/javascript")


@app.get("/manifest.json", include_in_schema=False)
async def serve_manifest():
    return FileResponse(Path("static/manifest.json"), media_type="application/json")


app.mount("/static", StaticFiles(directory="static"), name="static")


# Catch-all route to support SPA frontend routing
@app.get("/{full_path:path}", include_in_schema=False)
async def catch_all(request: Request, full_path: str):
    # Only serve index.html for paths that don't look like file requests (no dot in the last segment)
    # or specific frontend routes we want to handle.
    # For a pure SPA, we can just return index.html for everything not caught by previous routers/mounts.
    return FileResponse(Path("static/index.html"))
