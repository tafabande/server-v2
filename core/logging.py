import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler

from config import get_settings

settings = get_settings()

def setup_logging():
    """Configures the logging system for the application."""
    log_dir = settings.logs_folder
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
    
    # Suppress noisy library logs if needed
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

def get_logger(name: str):
    """Returns a logger with the specified name."""
    return logging.getLogger(name)
