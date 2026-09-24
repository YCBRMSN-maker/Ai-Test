@echo off
setlocal EnableExtensions
title Adaptive Tutor System - Launcher
cd /d "%~dp0"

echo ============================================================
echo    Adaptive Tutor System  -  One-click Start
echo ============================================================
echo.

rem ================= Step 1: ensure Docker engine is up =================
echo [1/4] Checking Docker engine ...
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok

echo       Docker is not running. Launching Docker Desktop ...

set "DD=D:\DockerDesktop\Docker Desktop.exe"
if not exist "%DD%" set "DD=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "%DD%" (
  echo.
  echo   ERROR: Docker Desktop was not found on this machine.
  echo   Please start Docker Desktop manually, then run this file again.
  echo.
  pause
  exit /b 1
)
start "" "%DD%"

echo       Waiting for Docker engine to become ready (30-120 seconds) ...
set /a _tries=0

:wait_loop
ping -n 6 127.0.0.1 >nul 2>&1
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
set /a _tries+=1
if %_tries% GEQ 60 goto docker_timeout
goto wait_loop

:docker_timeout
echo.
echo   ERROR: Docker did not become ready within 5 minutes.
echo   Please check Docker Desktop, then run this file again.
echo.
pause
exit /b 1

:docker_ok
echo       Docker engine is ready.
echo.

rem ================= Step 2: start the containers =================
echo [2/4] Starting containers ...
docker-compose --env-file .env -f docker-compose.submission.yml up -d
if errorlevel 1 (
  echo.
  echo   ERROR: failed to start containers. Please read the messages above.
  echo.
  pause
  exit /b 1
)
echo.

rem ================= Step 3: wait for services =================
echo [3/4] Waiting for services to boot ...
ping -n 13 127.0.0.1 >nul 2>&1
echo.

rem ================= Step 4: open the pages =================
echo [4/4] Opening pages in your browser ...
start "" http://localhost:8325
start "" http://localhost:8326

echo.
echo ============================================================
echo    Started successfully
echo ------------------------------------------------------------
echo    Student portal : http://localhost:8325
echo    Teacher portal : http://localhost:8326
echo    API docs       : http://localhost:8000/api/v1/docs
echo ------------------------------------------------------------
echo    Teacher login  : admin  (password: see chat)
echo    Student side   : no login required
echo ------------------------------------------------------------
echo    To stop the system, run:  stop.bat
echo ============================================================
echo.
pause
