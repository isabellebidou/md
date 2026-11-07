# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rules

`AGENTS.md` (root) holds the business requirements, color scheme, and coding standards; `backend/AGENTS.md` and `frontend/AGENTS.md` hold per-package conventions. Read them. Key points:

- Keep it simple: no over-engineering, no extra features, no unnecessary defensive programming. No emojis anywhere.
- When hitting issues, prove the root cause with evidence before fixing.
- Work follows `docs/PLAN.md` part by part. Check off items as completed, and do not start a later part before the current part's success criteria pass and any user sign-off gate is met.
- Planning docs live in `docs/` (`DATABASE.md` data model, `kanban.schema.json` board JSON shape).

## Commands

Full app (Docker, serves everything at http://localhost:8000, login `user` / `password`):
- Start: `scripts/start-mac.sh` (runs `docker compose up --build -d`); stop: `scripts/stop-mac.sh`. Linux/Windows equivalents are in `scripts/`.

Backend (run from `backend/`, uses `uv`):
- Tests: `uv run pytest`; single test: `uv run pytest tests/test_main.py::test_hello_route`
- Dev server: `uv run uvicorn app.main:app --reload`

Frontend (run from `frontend/`):
- `npm run lint`, `npm run build`
- Unit tests (Vitest + RTL): `npm run test:unit`; single file: `npx vitest run src/lib/kanban.test.ts`
- E2E (Playwright): `npm run test:e2e` -- requires the Docker app running on port 8000 (override with `PLAYWRIGHT_BASE_URL`); single test: `npx playwright test -g "<name>"`

## Architecture

- Single container: the Dockerfile builds the Next.js app as a static export (`output: "export"` -> `frontend/out`), copies it into `backend/app/static`, and FastAPI serves it at `/` via a static mount registered after the API routes. The checked-in `backend/app/static/index.html` is only a hello-world fallback for backend tests.
- The frontend calls the backend with same-origin relative URLs (`/api/...`) and has no dev proxy, so `next dev` alone cannot reach the API; test integrated behavior through the Docker app.
- Backend is essentially two modules: `app/main.py` (Pydantic models, signed-cookie session auth, all routes, AI chat logic) and `app/database.py` (SQLite schema, seeding, `get_board`/`save_board`). `app/ai.py` wraps the OpenAI client.
- Board data: the API exchanges the whole board as JSON (`GET`/`PUT /api/board`, validated by `BoardData` including card-reference integrity). SQLite stores it normalized (users, boards, five fixed columns, ordered cards); `save_board` replaces the board in a transaction. DB path comes from `DATABASE_PATH` (Docker volume `kanban-data`; tests point it at a tmp file).
- Frontend: `AuthenticatedApp` gates on `/api/auth/session`; `KanbanBoard` owns board state and persists via a debounced, serialized `PUT /api/board` with visible save/error state; `src/lib/kanban.ts` holds types and move logic.
- AI chat (`POST /api/ai/chat`): the backend builds a prompt with the current board, the question, and the last 6 messages, and asks the model for JSON `{reply, actions}`, where actions are `create_card` / `edit_card` / `move_card` (`BoardAction`). The backend applies the actions itself (`apply_board_actions`), validates, saves, and returns `{reply, board_update}`; the model never returns a full board. Instructions go in a system message and the request uses JSON mode. The frontend `AIChatSidebar` applies `board_update` directly, and the board is read-only while a chat request is pending. Config errors map to 503, provider/invalid-output errors to 502.
- AI config: `OPENAI_API_KEY` and `OPENAI_MODEL` from the root `.env` via docker-compose. The model defaults to `gpt-4o-mini` in `app/ai.py` (`get_model`). `.env` is excluded from the Docker build context. `SESSION_SECRET` keeps sessions valid across restarts; if it is unset, a random per-process key is used.
- Backend tests mock the AI by monkeypatching `app.main.get_ai_response`; automated tests never need a real key.
