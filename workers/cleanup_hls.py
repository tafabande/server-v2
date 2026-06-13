from datetime import datetime, timedelta

from config import get_settings

def cleanup() -> int:
    settings = get_settings()
    cutoff = datetime.now() - timedelta(days=settings.stale_hls_days)
    removed = 0

    for path in settings.hls_folder.iterdir():
        if not path.is_dir():
            continue
        modified_at = datetime.fromtimestamp(path.stat().st_mtime)
        if modified_at < cutoff:
            for child in sorted(path.rglob("*"), reverse=True):
                if child.is_file():
                    child.unlink()
                elif child.is_dir():
                    child.rmdir()
            path.rmdir()
            removed += 1
    return removed

if __name__ == "__main__":
    print(f"Removed {cleanup()} stale HLS cache directorie(s).")
