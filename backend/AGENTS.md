# Backend guide

## Existing app

- `app/main.py` defines the FastAPI application and routes.
- `app/static/index.html` is a temporary hello-world page served at `/`; it calls `/api/hello`.
- `tests/` contains pytest coverage for the API and example page.
- `pyproject.toml` and `uv.lock` manage Python dependencies with `uv`.

## Conventions

- Add API routes to the FastAPI app and keep static assets under `app/static/`.
- Use pytest and FastAPI's `TestClient` for backend tests.
- Keep secrets out of the image and source control. The root `.env` is excluded from Docker build context.
- Follow `docs/PLAN.md` and do not implement later plan parts ahead of their approval gates.

## Validation commands

Run from `backend/`:

- `uv run pytest`
- `uv run uvicorn app.main:app --reload`