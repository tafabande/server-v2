@echo off
setlocal enabledelayedexpansion

:: ===================================================
::  MediaHub Master Controller
:: ===================================================

:menu
cls
echo ===================================================
echo   MediaHub - MINIMALIST LAN MEDIA SERVER
echo ===================================================
echo.
echo   1. Start Server         (Standard boot)
echo   2. Nuclear Reset        (Wipe DB + Start fresh)
echo   3. Clean Cache Only     (Delete __pycache__)
echo   4. View Logs            (Open logs folder)
echo   5. Exit
echo.
set "choice=1"
set /p choice="Choose an option (1-5) [Default=1]: "

if "%choice%"=="1" goto start_server
if "%choice%"=="2" goto nuclear_reset
if "%choice%"=="3" goto clean_cache
if "%choice%"=="4" goto view_logs
if "%choice%"=="5" exit
goto menu

:start_server
cls
echo [INFO] Preparing boot sequence...
call :check_env
call :activate_venv
call :sync_deps
call :detect_ip
echo [INFO] Launching MediaHub...
start /b cmd /c "timeout /t 12 /nobreak >nul && start http://%LOCAL_IP%:8000"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude "venv" --reload-exclude "shared_media" --reload-exclude "logs" --reload-exclude "temp" --reload-exclude "thumbs"
pause
goto menu

:nuclear_reset
cls
echo [WARNING] NUCLEAR RESET INITIATED
echo This will delete your database and all account settings.
set /p confirm="Are you sure? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo [1/3] Killing existing processes...
taskkill /F /IM python.exe /T 2>nul
timeout /t 2 /nobreak >nul

echo [2/3] Deleting mediahub.db...
if exist mediahub.db del /f /q mediahub.db

echo [3/3] Clearing cache...
for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d" 2>nul

echo [DONE] System wiped.
timeout /t 2 /nobreak >nul
goto start_server

:clean_cache
cls
echo [INFO] Cleaning Python cache...
for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d" 2>nul
echo [DONE] Cache cleared.
pause
goto menu

:view_logs
start explorer logs
goto menu

:: --- Helper Functions ---

:check_env
if not exist logs mkdir logs
if not exist .env (
    echo [!] .env not found. Creating from example...
    copy .env.example .env >nul
)
exit /b

:activate_venv
if exist venv\Scripts\activate (
    call venv\Scripts\activate
) else if exist .venv\Scripts\activate (
    call .venv\Scripts\activate
) else (
    echo [!] No virtual environment found. Running on system Python.
)
exit /b

:sync_deps
echo [INFO] Checking dependencies...
pip install -q -r requirements.txt
exit /b

:detect_ip
set "LOCAL_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set "LOCAL_IP=%%a"
    set "LOCAL_IP=!LOCAL_IP: =!"
    goto :found_ip
)
:found_ip
echo [INFO] LAN IP: !LOCAL_IP!
exit /b
