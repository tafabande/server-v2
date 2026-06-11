@echo off
setlocal enabledelayedexpansion

set "FORCE_THUMBS=False"
set "PYTHON_EXE=python"

echo [93m[INFO] Generating temp_scan.py...[0m
echo import sys, asyncio, logging > temp_scan.py
echo from core.database import init_db, AsyncSessionLocal >> temp_scan.py
echo from core.bootstrap import self_heal_tables, self_heal_columns >> temp_scan.py
echo from core.media import scan_media_library, get_scan_status >> temp_scan.py
echo logging.disable(logging.CRITICAL) >> temp_scan.py
echo async def run(): >> temp_scan.py
echo     await init_db() >> temp_scan.py
echo     await self_heal_tables() >> temp_scan.py
echo     await self_heal_columns() >> temp_scan.py
echo     async with AsyncSessionLocal() as s: >> temp_scan.py
echo         task = asyncio.create_task(scan_media_library(s, use_cache=False, force_thumbs=!FORCE_THUMBS!)) >> temp_scan.py
echo         while not task.done(): >> temp_scan.py
echo             status = get_scan_status() >> temp_scan.py
echo             if status.get("scanning"): >> temp_scan.py
echo                 total = status.get("files_total", 0) >> temp_scan.py
echo                 scanned = status.get("files_scanned", 0) >> temp_scan.py
echo                 pct = status.get("progress_percent", 0) >> temp_scan.py
echo                 if total == 0: >> temp_scan.py
echo                     sys.stdout.write('\r\033[96m    [SCAN]\033[0m Discovering files in library...' + ' '*20) >> temp_scan.py
echo                 else: >> temp_scan.py
echo                     bar_len = 40 >> temp_scan.py
echo                     filled = int(bar_len * pct / 100) >> temp_scan.py
echo                     bar = '=' * filled + '-' * (bar_len - filled) >> temp_scan.py
echo                     sys.stdout.write(f'\r\033[96m    [SCAN]\033[0m [{bar}] \033[93m{pct}%%\033[0m ({scanned}/{total})' + ' '*10) >> temp_scan.py
echo                 sys.stdout.flush() >> temp_scan.py
echo             await asyncio.sleep(0.2) >> temp_scan.py
echo         print() >> temp_scan.py
echo         await task >> temp_scan.py
echo if sys.platform == 'win32': >> temp_scan.py
echo     asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy()) >> temp_scan.py
echo asyncio.run(run()) >> temp_scan.py

echo [93m[INFO] Running generated temp_scan.py...[0m
"!PYTHON_EXE!" temp_scan.py
if %ERRORLEVEL% neq 0 (
    echo [91m[ERROR] temp_scan.py execution failed with exit code %ERRORLEVEL%[0m
) else (
    echo [92m[SUCCESS] temp_scan.py completed successfully.[0m
)
del temp_scan.py
