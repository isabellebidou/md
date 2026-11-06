# Backend guide

## Existing app

- `app/main.py` defines the FastAPI application and routes.
- `/api/auth/login`, `/api/auth/session`, and `/api/auth/logout` provide the MVP signed-cookie session.
- `/api/board` reads and replaces the signed-in user's board in SQLite.
- `app/database.py` creates the SQLite tables and initial user board at startup.
- `app/static/` contains the checked-in hello-world fallback page for local backend tests. The Docker build replaces it with the static Next.js export.
- FastAPI serves the static frontend at `/`; API routes are registered before the static mount.
- `tests/` contains pytest coverage for the API, authentication, and example page.
- `pyproject.toml` and `uv.lock` manage Python dependencies with `uv`.

## Conventions

- Add API routes to the FastAPI app and keep static assets under `app/static/`.
- Use pytest and FastAPI's `TestClient` for backend tests.
- Keep secrets out of the image and source control. The root `.env` is excluded from Docker build context.
- Demo sessions use an HttpOnly, SameSite=Lax cookie signed with `SESSION_SECRET`; when unset, a process-local random key invalidates sessions on restart.
- Follow `docs/PLAN.md` and do not implement later plan parts ahead of their approval gates.

## Validation commands

Run from `backend/`:

- `uv run pytest`
- `uv run uvicorn app.main:app --reload`