@echo off
setlocal
echo ===================================================
echo   MediaHub NUCLEAR RESET
echo   This will delete the database and restart fresh.
echo ===================================================
echo.

:: 1. Kill any running server processes
echo [1/4] Stopping any running MediaHub processes...
taskkill /F /IM python.exe /T 2>nul
timeout /t 2 /nobreak >nul

:: 2. Delete the database
echo [2/4] Deleting old database (mediahub.db)...
if exist mediahub.db (
    del /f /q mediahub.db
    echo      Database deleted.
) else (
    echo      No database found. Skipping.
)

:: 3. Clean cache
echo [3/4] Cleaning up Python cache...
for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d" 2>nul

:: 4. Restart using the official startup script
echo [4/4] Starting fresh MediaHub instance...
echo.
call run_server.bat

pause
