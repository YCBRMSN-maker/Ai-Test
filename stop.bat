@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   Adaptive Tutor System  -  STOP
echo ==================================================
echo.

docker-compose --env-file .env -f docker-compose.submission.yml down

echo.
echo   Stopped. Data volumes are kept (courses and users are safe).
echo   Next time just run start.bat
echo.
pause
