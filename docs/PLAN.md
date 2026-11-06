# Project plan

Work through the parts in order. Check off implementation items as they are completed; do not begin a later part until the current part's success criteria pass. Any user sign-off is a gate, not an implementation task to skip.

For tests, prioritize correctness, user-visible acceptance criteria, and security boundaries. When broader test matrices add little value, target roughly 80% of sensible test scenarios and record any omitted coverage; do not skip critical flows or required success criteria.

## Part 1: Plan and frontend orientation

- [x] Expand this plan into ordered implementation checklists, tests, and success criteria.
- [x] Document the existing frontend structure and conventions in `frontend/AGENTS.md`.
- [x] User reviews and approves this plan before Part 2 begins.

**Validation**
- [x] Confirm the frontend guidance reflects the existing source tree and package scripts.
- [x] Confirm the user approves the plan.

**Success criteria:** The plan is approved, and future contributors can understand the existing frontend without changing its behavior.

## Part 2: Scaffolding

- [x] Add a Docker image that installs the Python backend dependencies with `uv` and runs the FastAPI application.
- [x] Add the minimal FastAPI application and an initial hello-world API route.
- [x] Serve a temporary example HTML page at `/` and the hello-world API response from the container.
- [x] Add start and stop scripts for macOS, Windows, and Linux under `scripts/`, following the existing scripts guidance.
- [x] Document required local setup and commands without exposing environment secrets.

**Tests**
- [x] Build and start the container from a clean checkout with the documented command.
- [x] Request `/` and verify the example HTML is served.
- [x] Request the hello-world API route and verify its documented response.
- [x] Check script syntax where supported; verify the macOS start/stop scripts operate correctly.

**Validation note:** Linux shell scripts passed `sh -n`. Windows batch scripts were inspected but could not be executed on this macOS host; the user accepts these Windows and Linux execution tests as unneeded.

**Success criteria:** A developer can start and stop the container using the appropriate script, load the temporary page, and receive a successful API response.

## Part 3: Add the frontend

- [x] Configure the existing Next.js app for a static production build compatible with FastAPI static serving.
- [x] Replace the temporary example page at `/` in the production image with the existing Kanban demo.
- [x] Preserve the current board interactions and visual design.
- [x] Serve the static build from FastAPI at `/` while keeping API routes available.

**Tests**
- [x] Run frontend lint and unit tests.
- [x] Run the frontend production build using the static export configuration.
- [x] Run Playwright against the container and verify the board loads at `/`, its five columns render, card creation works, and a card can be dragged between columns.
- [x] Verify API routes remain reachable alongside the static frontend.

**Success criteria:** The production container serves the existing interactive Kanban demo at `/` and its API without requiring a Next.js runtime server.

## Part 4: Add a demo sign-in experience

- [x] Add a sign-in screen that accepts the MVP credentials `user` / `password`.
- [x] Keep the board hidden until sign-in succeeds; show a clear error for invalid credentials.
- [x] Add logout and verify that it returns the user to the sign-in screen.
- [x] Use a backend-validated demo sign-in and a browser session cookie so the later board API can identify the signed-in user. This is demo authentication only, not production-grade security.

**Tests**
- [x] Add focused frontend tests for signed-out state, successful and rejected sign-in, and logout.
- [x] Add backend tests for accepted/rejected credentials, session cookie behavior, and logout.
- [x] Add an end-to-end test covering sign-in, board access, session persistence on reload, and logout.

**Validation:** Backend (6 tests), frontend unit (9 tests), lint, static production build, and all 5 Playwright tests passed against the Docker app.

**Success criteria:** Only the demo credentials grant access to the board, invalid credentials do not, and logout removes access.

## Part 5: Database modeling

- [x] Propose a JSON schema for users, each user's single board, the board's fixed-but-renamable columns, and cards with their ordering and content.
- [x] Document the SQLite persistence approach, relationships, and important constraints in `docs/`.
- [x] Keep the schema suitable for multiple users while limiting each user to one board.
- [x] Ask the user to review and approve the schema and database approach before Part 6.

**Tests**
- [x] Validate the schema JSON parses and follows the documented structure.
- [x] Review that the schema represents board ownership, ordered columns/cards, and the one-board-per-user constraint.

**Approval:** The user approved the schema and database approach before Part 6.

**Success criteria:** A machine-readable schema and concise database design document exist, and the user has approved them.

## Part 6: Backend board API

- [x] Initialize SQLite and create the schema automatically when the database file is absent.
- [x] Implement authenticated API routes to read and update the signed-in user's board.
- [x] Validate incoming board data and return clear HTTP errors for invalid or unauthorized requests.
- [x] Ensure a user's board operations cannot read or modify another user's board.

**Tests**
- [x] Add backend unit tests for database initialization and repeat initialization.
- [x] Test reading and updating a board, persistence across database connections/restarts, and creation of a board when needed.
- [x] Test invalid payloads, unauthenticated access, and cross-user isolation.

**Validation:** All 13 backend tests passed. A production container build passed; authenticated board reads and updates succeeded, and an update survived container recreation with the same Docker volume.

**Success criteria:** The API persists valid board changes in SQLite, initializes a fresh database automatically, and enforces user ownership.

## Part 7: Connect frontend and backend

- [x] Load the signed-in user's board from the API instead of relying on in-memory sample state.
- [x] Persist column renames and card creation, editing, deletion, and drag-and-drop moves through the API.
- [x] Add clear loading and error feedback without hiding failed saves.
- [x] Retain the demo board only as an intentional initial/default state when creating the user's first board.

**Tests**
- [x] Add frontend tests for API loading, successful mutations, and visible API failures.
- [x] Run backend tests and frontend lint/unit tests.
- [x] Add end-to-end coverage for board changes surviving a reload; backend tests verify authenticated, user-scoped board access.

**Validation:** Frontend lint and production build passed; all 12 frontend unit tests, 13 backend tests, and 6 Playwright end-to-end tests passed. Browser coverage verifies card creation, editing, deletion, movement, and column rename persistence across reloads.

**Design decisions and implementation notes**
- After session validation or successful sign-in, the frontend fetches the authenticated user's board and renders it instead of the in-memory sample.
- Board changes use a debounced, serialized `PUT /api/board`; the UI reports pending, saving, saved, or failed state and offers a retry after a failed save.
- The database's seeded board is the initial state for a user with no saved board; the frontend does not use it as a fallback when a board request fails.
- Card editing is inline. End-to-end persistence coverage verifies rename, create, edit, move, and delete across reloads; test-created data is restored or removed.

**Success criteria:** Board operations persist across reloads, errors are visible, and the UI reflects the server's saved board.

## Part 8: AI connectivity

- [x] Add a backend OpenAI client configured from `OPENAI_API_KEY` in the project environment; never put the key in source control or client-side code.
- [x] Use a valid hosted model compatible with the configured provider (default live environment: `gpt-4o-mini`), verifying its identifier and API compatibility before implementation.
- [x] Add a minimal backend AI call that can answer a simple `2+2` prompt.
- [x] Keep the connectivity check separate from the final board-aware chat contract.

**Tests**
- [x] Test request construction and error handling with a mocked OpenAI client; tests must not require a real key.
- [x] Provide an opt-in live connectivity check using a locally configured key and verify the answer to `2+2`.
- [x] Verify missing configuration and provider failures are reported explicitly.

**Success criteria:** The backend can make the requested model call when configured, automated tests work offline, and provider/configuration errors are not disguised as successful responses.

## Part 9: Board-aware AI API

- [x] Extend the AI request to include the current board JSON, the user's question, and conversation history.
- [x] Define a structured response containing a user-facing reply and an optional validated board update.
- [x] Apply updates only to the authenticated user's board and persist them through the board data layer.
- [x] Handle invalid structured output and provider errors explicitly.

**Tests**
- [x] Test prompt/request inputs include the current board, question, and relevant conversation history.
- [x] Test structured responses with no board update and with valid create/edit/move updates.
- [x] Test malformed output, invalid board mutations, provider errors, and user isolation.
- [x] Keep automated tests deterministic with a mocked model response.

**Success criteria:** The API returns a validated structured reply and, when requested, persists only valid changes to the signed-in user's board.

## Part 10: AI chat sidebar

- [x] Add a sidebar chat interface to the board with message history, input, submit, and pending/error states.
- [x] Send each user question and relevant conversation history to the board-aware AI API.
- [x] Render the assistant reply and refresh the board from the saved server state whenever the AI changes it.
- [x] Keep chat and board interactions usable at supported viewport sizes and preserve the existing visual system.

**Tests**
- [x] Add frontend tests for message submission, reply rendering, errors, and board refresh after an AI update.
- [x] Add end-to-end coverage for a chat response without a change and a response that updates the board.
- [x] Run the full frontend and backend suites and build the production container.

**Validation:** Frontend lint, 15 frontend unit tests, 10 Playwright tests, 22 backend tests, static production build, and Docker Compose production image build all passed. The live model was also verified creating a card, editing a card, and moving a card in one request using a temporary database. Drag-and-drop coverage moves a card from In Progress to Discovery and then Backlog.

**Success criteria:** A signed-in user can chat in the sidebar; AI-created, edited, or moved cards appear in the UI and remain persisted after reload.
