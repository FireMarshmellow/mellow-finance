@echo off
echo ========================================
echo   Mellow Labs Financial Dashboard
echo ========================================
echo.
echo Starting server at http://localhost:8000
echo Press Ctrl+C to stop.
echo.
cd /d "%~dp0backend"
py -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
