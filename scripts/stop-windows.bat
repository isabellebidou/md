@echo off
setlocal
cd /d "%~dp0.."
if errorlevel 1 exit /b 1
docker compose down
if errorlevel 1 exit /b 1
