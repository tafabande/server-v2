@echo off
setlocal

:: Ensure log directory exists
if not exist logs mkdir logs
set "SETUP_LOG=logs\setup.log"
echo [%date% %time%] --- Starting Setup --- > "%SETUP_LOG%"

:: Check if .env exists, if not copy from .env.example
if not exist .env (
    echo [%date% %time%] .env not found. Copying from .env.example... >> "%SETUP_LOG%"
    echo [.env] not found. Copying from .env.example...
    copy .env.example .env >> "%SETUP_LOG%" 2>&1
)

:: Check for virtual environment and activate if found
if exist venv\Scripts\activate (
    echo [%date% %time%] Activating virtual environment [venv]... >> "%SETUP_LOG%"
    echo Activating virtual environment [venv]...
    call venv\Scripts\activate
) else if exist .venv\Scripts\activate (
    echo [%date% %time%] Activating virtual environment [.venv]... >> "%SETUP_LOG%"
    echo Activating virtual environment [.venv]...
    call .venv\Scripts\activate
) else (
    echo [%date% %time%] No virtual environment found. >> "%SETUP_LOG%"
    echo No virtual environment found. Using system Python...
)

:: Sync dependencies
echo Syncing dependencies...
pip install -r requirements.txt >> "%SETUP_LOG%" 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies. Check logs\setup.log
    pause
    exit /b %ERRORLEVEL%
)

:: Detect Local IP Address
set "LOCAL_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set "LOCAL_IP=%%a"
    goto :found_ip
)
:found_ip
set "LOCAL_IP=%LOCAL_IP: =%"
echo [%date% %time%] Local IP detected: %LOCAL_IP% >> "%SETUP_LOG%"

:: Start the FastAPI server using uvicorn
echo.
echo ===================================================
echo   MediaHub is starting!
echo.
echo   LOCAL ACCESS: http://localhost:8000
echo   LAN ACCESS:   http://%LOCAL_IP%:8000
echo.
echo   Application Logs: logs\mediahub.log
echo   Setup Logs:       logs\setup.log
echo ===================================================
echo.

echo [%date% %time%] --- Launching Uvicorn --- >> "%SETUP_LOG%"

:: Auto-open the browser
start "" "http://%LOCAL_IP%:8000"

:: Start Uvicorn (it will automatically ignore venv/ due to our updated .gitignore)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause

pause
