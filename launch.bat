@echo off
title MediaHub — LAN Media Server
cls
echo ===================================================
echo               MediaHub Server Launcher             
echo ===================================================
echo.

:: 1. Check Python installation
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not added to PATH.
    echo Please install Python 3.10+ and add it to system PATH.
    pause
    exit /b 1
)

:: 2. Check if frontend build exists, build if missing
if not exist "dist\index.html" (
    echo [INFO] Production frontend bundle not found. Building with Vite...
    call npx vite build
    if %errorlevel% neq 0 (
        echo [WARNING] Frontend build failed or npx is missing.
    )
)

:: 3. Launch MediaHub server
echo.
echo [INFO] Starting MediaHub FastAPI Server...
echo [INFO] Press Ctrl+C at any time to shut down the server.
echo.

python main.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] MediaHub exited with error code %errorlevel%.
    pause
)
