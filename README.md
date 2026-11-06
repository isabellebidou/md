# Project Management App

## Run locally

Install Docker with Compose, then run `scripts/start-mac.sh` or `scripts/start-linux.sh`; on Windows, run `scripts\start-windows.bat`. Open http://localhost:8000. Stop the app with the matching `stop` script.

Sign in with the MVP credentials `user` / `password`. The board database is stored in the Docker `kanban-data` volume. The root `.env` is not included in the Docker build context. Configure `OPENAI_API_KEY` in the root `.env` to enable AI chat; the default hosted model is `gpt-4o-mini`. Set `SESSION_SECRET` in the environment or root `.env` to keep sessions valid across app restarts; otherwise, restarting the backend signs users out.

## curl test
curl http://localhost:8000/api/hello
Expected response: {"message":"Hello, world!"}

## demo login manual test 
- Start the app with ./scripts/start-mac.sh.
- Open http://localhost:8000.
- Sign in with user / password. Try a wrong password to verify the error message, then use Log out to test logout.
- Stop the app with ./scripts/stop-mac.sh

## Backend tests

From `backend/`, run `uv run pytest`.

## Frontend tests

From `frontend/`, run `npm run test:unit`. For end-to-end tests, start the app with Docker first, then run `npm run test:e2e`; the suite targets http://127.0.0.1:8000 by default. Set `PLAYWRIGHT_BASE_URL` to use another address.
