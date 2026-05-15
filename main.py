from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import get_settings
from core.bootstrap import bootstrap_application
from core.database import init_db
from core.exceptions import MediaHubError
from core.logging import setup_logging, get_logger
from routers import auth, files, media, playlists, system, users


# Initialize logging before settings are even fetched to ensure startup is logged
setup_logging()
logger = get_logger("main")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Application starting up...")
    
    # Start Zeroconf Discovery (Non-blocking)
    try:
        from core.discovery import discovery
        discovery.start()
    except Exception as e:
        logger.error(f"Discovery could not start: {e}")
    
    await init_db()
    await bootstrap_application()
    
    yield
    
    logger.info("Application shutting down...")
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
    logger.warning(f"HTTP exception: {exc.detail} (Status: {exc.status_code})")
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

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(media.router, prefix="/api/media", tags=["media"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(playlists.router, prefix="/api/playlists", tags=["playlists"])

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/thumbs", StaticFiles(directory="thumbs"), name="thumbs")
app.mount("/temp", StaticFiles(directory="temp"), name="temp")


# Catch-all route to support SPA frontend routing
@app.get("/{full_path:path}", include_in_schema=False)
async def catch_all(request: Request, full_path: str):
    # Only serve index.html for paths that don't look like file requests (no dot in the last segment)
    # or specific frontend routes we want to handle.
    # For a pure SPA, we can just return index.html for everything not caught by previous routers/mounts.
    return FileResponse(Path("static/index.html"))
