@echo off
setlocal
cd /d "%~dp0.."
if errorlevel 1 exit /b 1
docker compose up --build -d
if errorlevel 1 exit /b 1
echo App is running at http://localhost:8000
