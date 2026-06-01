import logging
import sys
from logging.handlers import RotatingFileHandler

from config import BASE_DIR, get_settings

settings = get_settings()


def _is_inside_path(path, root) -> bool:
    try:
        resolved_path = path.resolve()
        resolved_root = root.resolve()
        return resolved_path == resolved_root or resolved_root in resolved_path.parents
    except (OSError, RuntimeError):
        return False


def _safe_log_dir():
    log_dir = settings.logs_folder
    shared_root = settings.shared_folder
    if not _is_inside_path(log_dir, shared_root):
        return log_dir

    fallback = BASE_DIR / "data" / "logs"
    if _is_inside_path(fallback, shared_root):
        fallback = shared_root.parent / "mediahub_logs"

    return fallback


def setup_logging():
    """Configures the logging system for the application."""
    log_dir = _safe_log_dir()
    settings.logs_folder = log_dir

    log_dir.mkdir(parents=True, exist_ok=True)
    
    log_file = log_dir / "mediahub.log"
    
    # Define formatting
    log_format = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s"
    )
    
    # Console Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(log_format)
    console_handler.setLevel(logging.INFO)
    
    # File Handler (Rotating)
    file_handler = RotatingFileHandler(
        log_file, maxBytes=10*1024*1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(log_format)
    file_handler.setLevel(logging.DEBUG)
    
    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    
    # Clear existing handlers
    if root_logger.hasHandlers():
        root_logger.handlers.clear()
        
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)
    
    # Add file handler to uvicorn loggers to ensure they rotate automatically too!
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(uvicorn_logger_name)
        uv_logger.handlers = [file_handler, console_handler]
        uv_logger.propagate = False

    # Suppress noisy library logs if needed
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)

def get_logger(name: str):
    """Returns a logger with the specified name."""
    return logging.getLogger(name)
