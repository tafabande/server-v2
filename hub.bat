@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  MediaHub Master Controller — Cyberpunk Neon Edition
::  One Script to Rule Them All. Clean. Fast. Integrated.
::
::  FIX: Never rely on `call activate` — instead resolve the
::  venv python.exe path explicitly so every command (pip,
::  uvicorn, etc.) is guaranteed to target the correct env.
:: ============================================================

:: --- Resolve working directory to the folder containing this script ---
cd /d "%~dp0"

:: --- Resolve Python executable (venv first, then fallbacks) ---
call :resolve_python
if "!PYTHON_EXE!"=="" (
    echo [FATAL] No Python interpreter found. Install Python 3.11+ and re-run.
    pause
    exit /b 1
)

:menu
cls
color 0B
echo.
echo    [95m__  __          _ _   _       _      [0m
echo   [95m^|  \/  ^| ___  __^| (_) _^| ^|     ^| ^|__   [0m
echo   [95m^| ^|\/^| ^|/ _ \/ _` ^| ^| ^|_^| ^|__   ^| '_ \  [0m
echo   [95m^| ^|  ^| ^|  __/ (_^| ^| ^|  _^| '_ \  ^| ^|_) ^| [0m
echo   [95m^|_^|  ^|_^|\___^\__,_^|_^|_^| ^|_.__/  ^|_.__/  [0m
echo.
echo   ================================================
echo   [96m   MEDIAHUB CORE — MASTER ADMINISTRATION DECK   [0m
echo   ================================================
echo   [93m  Python: !PYTHON_EXE![0m
echo   ================================================
echo.
echo   [93m[LOCAL INSTANCE][0m
echo     1. Start Local Server    (Native boot)
echo     2. Pre-Index ^& Thumbs    (Offline library scan)
echo     3. Rebuild venv          (Re-create + reinstall deps)
echo     4. Clean Python Cache    (Remove __pycache__)
echo.
echo   [92m[DOCKER CONTAINER][0m
echo     5. Boot Docker Stack     (Compose up + build)
echo     6. Halt Docker Stack     (Compose down)
echo     7. Docker Status/Logs    (Compose ps + tail logs)
echo.
echo   [91m[SYSTEM TOOLS][0m
echo     8. Nuclear Reset         (Stop all + Wipe DB/Cache)
echo     9. View Server Logs      (Open logs explorer)
echo    10. Exit
echo.
echo   ================================================
echo.
set "choice=1"
set /p choice="Enter your command (1-10) [Default=1]: "

if "%choice%"=="1" goto start_local
if "%choice%"=="2" goto pre_index
if "%choice%"=="3" goto rebuild_venv
if "%choice%"=="4" goto clean_cache
if "%choice%"=="5" goto start_docker
if "%choice%"=="6" goto stop_docker
if "%choice%"=="7" goto docker_status
if "%choice%"=="8" goto nuclear_reset
if "%choice%"=="9" goto view_logs
if "%choice%"=="10" exit /b 0
goto menu

:: ============================================================
::  1. Start Local Server
:: ============================================================
:start_local
cls
echo [96m[INFO] Initiating Local Server Boot Sequence...[0m
call :check_env
call :kill_port
call :sync_deps
call :detect_ip

echo.
echo [92m[INFO] Python  : !PYTHON_EXE![0m
echo [92m[INFO] Address : http://!LOCAL_IP!:!PORT!  ^|  http://localhost:!PORT![0m
echo.

:: Background health-poll — opens browser the instant the API answers 200
start /b powershell -NoProfile -Command ^
    "$url='http://localhost:!PORT!/api/system/health';" ^
    "for($i=0;$i -lt 60;$i++){" ^
    "  try{$r=Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -EA Stop;" ^
    "  if($r.StatusCode -eq 200){Start-Process 'http://localhost:!PORT!';break}}" ^
    "  catch{} Start-Sleep 2}"

echo [95m[INFO] Launching Uvicorn (single-process async)...[0m
echo [90m        (Windows requires single worker; concurrency is handled by async I/O)[0m
echo.

:: Use explicit python path — NEVER bare 'python' or 'uvicorn'
"!PYTHON_EXE!" -m uvicorn main:app --host 0.0.0.0 --port !PORT! --log-level info

echo.
echo [91m[WARN] Server stopped.[0m
pause
goto menu

:: ============================================================
::  2. Pre-Index & Thumbs
:: ============================================================
:pre_index
cls
echo [96m[INFO] Initiating Offline Library Scan ^& Thumbnail Generation...[0m
set /p force_choice="Force regenerate ALL thumbnails? (Overrides existing) [Y/N] (Default=N): "
if /i "!force_choice!"=="Y" (
    set "FORCE_THUMBS=True"
    echo [93m[INFO] Force overwrite ENABLED. This will take a long time.[0m
) else (
    set "FORCE_THUMBS=False"
    echo [92m[INFO] Force overwrite DISABLED [Skipping existing].[0m
)

call :check_env
call :sync_deps

echo [93m[INFO] This may take a while depending on your library size.[0m
echo import sys, asyncio, logging > temp_scan.py
echo from core.database import init_db, AsyncSessionLocal >> temp_scan.py
echo from core.bootstrap import self_heal_tables >> temp_scan.py
echo from core.media import scan_media_library, get_scan_status >> temp_scan.py
echo logging.disable(logging.CRITICAL) >> temp_scan.py
echo async def run(): >> temp_scan.py
echo     await init_db() >> temp_scan.py
echo     await self_heal_tables() >> temp_scan.py
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

"!PYTHON_EXE!" temp_scan.py
del temp_scan.py

echo [92m[DONE] Indexing and thumbnail generation complete.[0m
pause
goto menu

:: ============================================================
::  3. Rebuild venv
:: ============================================================
:rebuild_venv
cls
echo [96m[INFO] Rebuilding virtual environment from scratch...[0m
if exist venv rd /s /q venv
echo [93m[INFO] Creating fresh venv...[0m

:: Use the Python that resolved at startup (could be system py)
"!BASE_PYTHON!" -m venv venv
if %ERRORLEVEL% neq 0 (
    echo [91m[ERROR] venv creation failed.[0m
    pause
    goto menu
)

:: Re-resolve so PYTHON_EXE now points into the new venv
call :resolve_python

echo [93m[INFO] Upgrading pip inside venv...[0m
"!PYTHON_EXE!" -m pip install --upgrade pip -q

echo [93m[INFO] Installing requirements...[0m
"!PYTHON_EXE!" -m pip install --no-cache-dir -r requirements.txt

echo [92m[DONE] Virtual environment rebuilt successfully.[0m
echo [92m       Python: !PYTHON_EXE![0m
pause
goto menu

:: ============================================================
::  3. Clean Python cache
:: ============================================================
:clean_cache
cls
echo [96m[INFO] Purging Python compilation cache files...[0m
powershell -NoProfile -Command ^
    "Get-ChildItem -Path '.' -Filter __pycache__ -Recurse -EA SilentlyContinue" ^
    "| Where-Object { $_.FullName -notmatch 'venv|\.git|material-design-icons' }" ^
    "| Remove-Item -Recurse -Force"
echo [92m[DONE] Pycache purged cleanly.[0m
pause
goto menu

:: ============================================================
::  4. Boot Docker Stack
:: ============================================================
:start_docker
cls
echo [96m[INFO] Booting Containerized MediaHub Stack...[0m
call :check_env
call :kill_port

:: Ensure Docker is running
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [93m[WARN] Docker Desktop not running — attempting to start it...[0m
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo [93m[WARN] Waiting 20 seconds for Docker to initialise...[0m
    ping 127.0.0.1 -n 21 >nul
    docker info >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [91m[ERROR] Docker is still not responding. Launch Docker Desktop manually then retry.[0m
        pause
        goto menu
    )
)

docker compose up --build -d
if %ERRORLEVEL% neq 0 (
    echo [91m[ERROR] Docker Compose failed. Check the output above.[0m
    pause
    goto menu
)

echo [92m[INFO] Docker containers active. Waiting for API to respond...[0m
start /b powershell -NoProfile -Command ^
    "$url='http://localhost:!PORT!/api/system/health';" ^
    "for($i=0;$i -lt 60;$i++){" ^
    "  try{$r=Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -EA Stop;" ^
    "  if($r.StatusCode -eq 200){Start-Process 'http://localhost:!PORT!';break}}" ^
    "  catch{} Start-Sleep 2}"

echo [92m[INFO] Stack is up. Browser will open automatically when ready.[0m
pause
goto menu

:: ============================================================
::  5. Halt Docker Stack
:: ============================================================
:stop_docker
cls
echo [91m[INFO] Halting Docker Compose Services...[0m
docker compose down
echo [92m[DONE] Docker stack halted.[0m
pause
goto menu

:: ============================================================
::  6. Docker Status / Logs
:: ============================================================
:docker_status
cls
echo [96m=== Container Processes ===[0m
docker compose ps
echo.
echo [96m=== Live Log Stream (Tail 40) ===[0m
docker compose logs --tail=40
pause
goto menu

:: ============================================================
::  7. Nuclear Reset
:: ============================================================
:nuclear_reset
cls
echo [91m╔══════════════════════════════════════════════════╗[0m
echo [91m║   ⚠  NUCLEAR RESET — ALL DATA WILL BE WIPED  ⚠  ║[0m
echo [91m╚══════════════════════════════════════════════════╝[0m
echo.
echo   This will:
echo     • Kill all running Python server processes
echo     • Stop and remove Docker volumes
echo     • Delete ALL SQLite databases
echo     • Erase thumbnail, temp, and sprite caches
echo     • Purge Python __pycache__ directories
echo.
set "confirm="
set /p confirm="Type YES (all-caps) to proceed, or anything else to cancel: "
if not "%confirm%"=="YES" (
    echo [93m[CANCELLED] Reset aborted.[0m
    pause
    goto menu
)

echo.
echo [95m[1/5] Halting local server processes...[0m
taskkill /F /IM python.exe /T 2>nul
taskkill /F /IM python3.exe /T 2>nul
taskkill /F /IM ffmpeg.exe /T 2>nul
ping 127.0.0.1 -n 2 >nul

echo [95m[2/5] Halting and cleaning Docker volumes...[0m
docker compose down -v 2>nul

echo [95m[3/5] Erasing database and cache files...[0m
if exist mediahub.db        del /f /q mediahub.db
if exist mediahub.db-shm    del /f /q mediahub.db-shm
if exist mediahub.db-wal    del /f /q mediahub.db-wal
if exist streamdrop.db      del /f /q streamdrop.db
if exist data\mediahub.db   del /f /q data\mediahub.db
if exist data\thumbs        rd /s /q data\thumbs 2>nul
if exist data\temp          rd /s /q data\temp   2>nul
if exist data\sprites       rd /s /q data\sprites 2>nul
if exist data\logs          rd /s /q data\logs    2>nul

echo [95m[4/5] Clearing Python cache...[0m
powershell -NoProfile -Command ^
    "Get-ChildItem -Path '.' -Filter __pycache__ -Recurse -EA SilentlyContinue" ^
    "| Where-Object { $_.FullName -notmatch 'venv|\.git|material-design-icons' }" ^
    "| Remove-Item -Recurse -Force"

echo [92m[5/5] Reset complete — booting fresh server...[0m
ping 127.0.0.1 -n 3 >nul
goto start_local

:: ============================================================
::  8. View Logs
:: ============================================================
:view_logs
if exist data\logs (
    start explorer data\logs
) else if exist logs (
    start explorer logs
) else (
    echo [93m[WARN] No logs folder detected yet — start the server first.[0m
    pause
)
goto menu


:: ============================================================
::  Helper Routines
:: ============================================================

:check_env
:: Ensure runtime directories exist
if not exist data\logs mkdir data\logs
if not exist data\thumbs mkdir data\thumbs
if not exist data\temp mkdir data\temp
if not exist data\sprites mkdir data\sprites
:: Copy .env from template if missing
if not exist .env (
    if exist .env.example (
        echo [93m[WARN] .env not found. Creating from .env.example...[0m
        copy .env.example .env >nul
    ) else (
        echo [91m[WARN] Neither .env nor .env.example found. Some features may not work.[0m
    )
)
call :load_env
exit /b

:sync_deps
echo [96m[INFO] Auditing requirements and syncing Python libraries...[0m
"!PYTHON_EXE!" -m pip install -q --no-cache-dir -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [91m[ERROR] Dependency install failed. Check requirements.txt and your Python environment.[0m
    pause
    goto menu
)
exit /b

:detect_ip
set "LOCAL_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set "LOCAL_IP=%%a"
    set "LOCAL_IP=!LOCAL_IP: =!"
    goto :found_ip
)
:found_ip
exit /b

:resolve_python
:: Priority: venv > .venv > py launcher > python in PATH
:: Also store BASE_PYTHON for venv creation (needs a non-venv Python)
set "PYTHON_EXE="
set "BASE_PYTHON="

:: Try to find a suitable base Python for venv creation
where python >nul 2>&1 && set "BASE_PYTHON=python"
where py >nul 2>&1 && set "BASE_PYTHON=py"

:: Check venv (standard name)
if exist "%~dp0venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0venv\Scripts\python.exe"
    goto :resolve_done
)
:: Check .venv
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
    goto :resolve_done
)
:: No venv found — fall back to system Python, then offer to create venv
where python >nul 2>&1
if %ERRORLEVEL%==0 (
    set "PYTHON_EXE=python"
    echo [93m[WARN] No venv found — using system Python. Run option 2 to create a venv.[0m
    goto :resolve_done
)
where py >nul 2>&1
if %ERRORLEVEL%==0 (
    set "PYTHON_EXE=py"
    echo [93m[WARN] No venv found — using py launcher. Run option 2 to create a venv.[0m
    goto :resolve_done
)
:: Truly no Python found
echo [91m[FATAL] Cannot locate any Python interpreter.[0m
echo        Install Python 3.11+ from https://python.org and ensure it is on PATH.
:resolve_done
exit /b

:: ============================================================
::  Load Environment variables from .env
:: ============================================================
:load_env
if exist .env (
    for /f "usebackq delims=" %%a in (".env") do (
        set "line=%%a"
        :: Strip leading whitespace (if any)
        for /f "tokens=* delims= " %%b in ("!line!") do set "line=%%b"
        if not "!line!"=="" (
            set "firstchar=!line:~0,1!"
            if not "!firstchar!"=="#" (
                for /f "tokens=1* delims==" %%c in ("!line!") do (
                    set "key=%%c"
                    set "val=%%d"
                    :: Strip spaces around key
                    for /f "tokens=* delims= " %%e in ("!key!") do set "key=%%e"
                    :: Strip spaces around val
                    for /f "tokens=* delims= " %%f in ("!val!") do set "val=%%f"
                    :: Strip quotes if any
                    set "val=!val:"=!"
                    set "val=!val:'=!"
                    set "!key!=!val!"
                )
            )
        )
    )
)
if not "!PORT!"=="" set "PORT=!PORT: =!"
if "!PORT!"=="" set "PORT=51733"
exit /b

:: ============================================================
::  Kill any active processes on !PORT!
:: ============================================================
:kill_port
echo [95m[INFO] Checking for active processes on port !PORT!...[0m
set "PORT_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr LISTENING ^| findstr /C:":!PORT! "') do (
    set "PORT_PID=%%a"
    if not "!PORT_PID!"=="" (
        echo [93m[WARN] Found process !PORT_PID! using port !PORT!. Terminating...[0m
        taskkill /F /PID !PORT_PID! >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [92m[SUCCESS] Terminated process !PORT_PID!.[0m
        ) else (
            echo [91m[WARNING] Failed to terminate process !PORT_PID!.[0m
        )
    )
)
if not "!PORT_PID!"=="" (
    :: Give socket a brief moment to release
    ping 127.0.0.1 -n 2 >nul
)
exit /b
