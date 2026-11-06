# Project Management App

## Run locally

Install Docker with Compose, then run `scripts/start-mac.sh` or `scripts/start-linux.sh`; on Windows, run `scripts\start-windows.bat`. Open http://localhost:8000. Stop the app with the matching `stop` script.

The root `.env` is not included in the Docker build context. No environment variables are required for this scaffolding stage.

## Backend tests

From `backend/`, run `uv run pytest`.
