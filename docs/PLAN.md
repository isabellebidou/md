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

## Part 11: Card colour

- [x] User reviews and approves this part before implementation begins.
- [x] Add an optional card `dueDate` (`"YYYY-MM-DD"` or `null`) to the board JSON: `BoardCard.due_date: date | None` with alias `dueDate`, so impossible or malformed dates are rejected with 422.
- [x] Persist the date in a nullable `cards.due_date TEXT` column; `initialize_database` adds the column to existing databases with `ALTER TABLE` when it is missing, keeping existing cards undated. `get_board` and `save_board` read and write it.
- [x] Update `docs/kanban.schema.json` and `docs/DATABASE.md` for the new field.
- [x] Add a native `<input type="date">` labelled "Due date (optional)" to the new-card form and the card edit form; clearing the input removes the date.
- [x] Add a pure `getDueStatus(dueDate, columnId, today)` to `src/lib/kanban.ts` returning `"none" | "soon" | "overdue"`, comparing local calendar dates only:
  - no date, or the card is in Done: `none`;
  - after the due date: `overdue` (red), including in Review;
  - up to two days before, or on, the due date, and the card is not in Review: `soon` (amber);
  - otherwise `none`.
  Review and Done are identified by column ID (`col-review`, `col-done`), not by renamable title.
- [x] Show dated cards with a label ("Due 12 Nov"), plus "Due soon" or "Overdue" text so status is not conveyed by colour alone. Amber is a dedicated shade distinct from the accent yellow `#ecad0a` (which already marks column bars and the drop-target ring): an amber tint (`#fef3c7`) with an amber-600 (`#d97706`) left border and amber-800 (`#92400e`) label text. Red uses a red tint (`#fef2f2`) with a red-600 (`#dc2626`) left border and red-700 (`#b91c1c`) label text. Colours are CSS variables in `globals.css`. Apply the same styling to the drag preview.
- [x] Keep colours current without a reload: a `useToday()` hook holds today's date as state, schedules one timeout for the next local midnight, and re-checks the date on `visibilitychange` so a laptop waking after midnight updates immediately.
- [x] Derive status at render time from the card's date and column, so any change (manual edit, card move, or an AI `board_update` that postpones or clears the date) recolours the card immediately.
- [x] Let the AI set and clear due dates: add an optional `due_date` (`"YYYY-MM-DD"` or `null` to clear) to `create_card` and `edit_card` actions, describe it in the system instructions, and include today's weekday and date plus a 14-day calendar (weekday and ISO date) in the user message, so relative dates such as "Friday" are looked up rather than calculated by the model.

**Tests**
- [x] Backend: board save and reload with a date, with `null`, and with the field omitted; 422 for impossible (`2026-02-30`) and malformed (`tomorrow`) dates.
- [x] Backend: an old-schema database without `due_date` is migrated by `initialize_database` and keeps its cards.
- [x] Backend: AI `create_card` and `edit_card` set a due date, `due_date: null` clears it, an invalid AI date returns 502, and today's date appears in the prompt.
- [x] Frontend unit: table tests for `getDueStatus` covering every column group (active, Review, Done) against no date, three days before, two days before, one day before, the due date, and after, including month and year boundaries.
- [x] Frontend unit, with a fixed clock (`vi.setSystemTime`): creating a card with a date sends `dueDate` in the save; editing adds, changes, and clears the date; cards show the correct label and style.
- [x] Frontend unit: advancing past midnight turns an amber card red without a reload; a `visibilitychange` after a clock jump updates the colour; postponing an overdue card through the editor clears its colour; an AI `board_update` that postpones the date clears the colour.
- [x] End-to-end: create a card with a date through the picker and confirm it persists after reload; a card due yesterday in Backlog shows "Overdue" and loses its colour after dragging to Done; a card due in two days shows "Due soon"; editing an overdue card to a later date removes the colour. Tests restore the board afterwards.
- [x] Run the full backend, frontend unit, lint, build, and Playwright suites and rebuild the Docker image.

**Validation:** 39 backend tests, 51 frontend unit tests, 13 Playwright tests, lint, static production build, and Docker image build passed. The live model was verified against a temporary database: it created a card due "next Friday" with the correct date, postponed it by a week, and cleared it. After a live report that "Friday" resolved to a Tuesday, the prompt gained a 14-day calendar; repeated live runs then resolved "Friday", "Monday", "tomorrow", and "Wednesday next week" correctly. The overdue end-to-end test uses its own temporary cards so an interrupted run cannot alter existing cards.

**Approval:** The user approved this part with a two-day amber window, a dedicated amber shade, and the "Due soon" label.

**Success criteria:** A user can optionally set, change, or clear a card's due date manually or through the AI chat; the date persists across reloads and restarts, including for databases created before this part; cards turn amber and red according to the rules above, update when the date, column, or current day changes without a reload, and undated cards never change colour.

## Part 12: User registration and password hashing

- [ ] User reviews and approves this part before implementation begins.
- [ ] Add `argon2-cffi` to the backend and hash passwords with its `PasswordHasher` (Argon2id, random per-password salt, parameters encoded in the hash string). Plaintext passwords are never stored or logged.
- [ ] Add a nullable `users.password_hash TEXT` column; `initialize_database` adds it with `ALTER TABLE` to existing databases. The seeded demo account `user` gets the hash of `password` when its hash is `NULL`, so existing data and the demo login keep working.
- [ ] Move board creation into a `create_user(username, password_hash)` database function that inserts the user and their board with the five fixed columns in one transaction. New users get an empty board; only the seeded demo user gets the sample cards. A duplicate username raises an error that the API maps to 409.
- [ ] Add `POST /api/auth/register` taking `{username, password}`:
  - usernames are lowercased, 3-32 characters, and may contain only `a-z`, `0-9`, `_`, and `-` (no `.`, which separates the session token from its signature);
  - passwords are 8-128 characters (the upper bound limits hashing cost);
  - invalid input returns 422, a taken username returns 409, and success returns 201 `{username}` and sets the session cookie, so the user is signed in.
- [ ] Change `POST /api/auth/login` to look the user up and verify the password against the stored hash. Unknown usernames are verified against a fixed dummy hash, so response times do not reveal which usernames exist. Both cases return the same 401 "Invalid username or password". Usernames are lowercased before lookup.
- [ ] Change `get_session_username` to accept any signed username that exists in the database, replacing the hardcoded `user` check. Boards, saves, and AI chat already use the session username, so each user only sees and changes their own board.
- [ ] Frontend: add a "Create an account" link to the sign-in screen that switches to a register form (username, password, and confirm password with `autocomplete="new-password"`), plus a link back to sign in. The form checks locally that the passwords match. A 409 shows "That username is already taken." and a 422 shows the username and password rules. Success opens the new user's board.
- [ ] Update `AGENTS.md` (business requirements and limitations), `docs/DATABASE.md`, `docs/kanban.schema.json` (the export never includes `password_hash`), `CLAUDE.md`, `backend/AGENTS.md`, and the accepted limitations below.

**Out of scope:** password change or reset, account deletion, login rate limiting, and email verification.

**Tests**
- [ ] Backend: registration creates the user and an empty five-column board and signs them in; the stored hash starts with `$argon2id$`, verifies the password, and does not contain it.
- [ ] Backend: a duplicate username (including different case) returns 409; a short, long, or invalid username and a short or long password return 422.
- [ ] Backend: a registered user can log in; a wrong password and an unknown username both return the same 401; the demo `user` / `password` login still works.
- [ ] Backend: a validly signed cookie for a username that does not exist returns 401. Two users' boards are isolated: saving one board does not change the other, and the AI chat edits only the caller's board.
- [ ] Backend: a database created before this part gets the `password_hash` column and a demo user hash, and keeps its cards.
- [ ] Frontend unit: switching between sign-in and register; a successful registration opens the board; mismatched passwords block submission; 409 and 422 errors are shown.
- [ ] End-to-end: register a new unique user, see an empty board, add a card, log out, log back in, and find the card; the demo user's board does not contain it. The test uses a unique `e2e-<timestamp>` username. Its `finally` block deletes that user from the database inside the container (`docker compose exec app uv run --no-sync python -c ...`, with foreign keys on so the board, columns, and cards cascade), so no test user remains. Only a run killed before `finally` can leave one behind. This cleanup is test-only; the app gets no account-deletion route.
- [ ] Add a small backend helper, `delete_user(username)` in `app/database.py`, used only by the e2e cleanup command and covered by a backend test that checks the user's board, columns, and cards are removed.
- [ ] Run the full backend, frontend unit, lint, build, and Playwright suites and rebuild the Docker image.

**Success criteria:** A visitor can register with a username and password and is signed in to their own empty board; they can log out and back in; passwords are stored only as Argon2id hashes; the demo `user` / `password` account and its existing board still work; users cannot see or change each other's boards.

## Accepted MVP limitations

Recorded from the 2026-11-06 code review; revisit before multi-user work.
- Session tokens are stateless HMACs of the username: they never expire and logout cannot revoke them.
- `get_session_username` only accepts the hardcoded `user`.
- The session cookie has no `secure` flag, which is acceptable for plain-HTTP localhost.
- Board saves replace the whole board (last write wins), so concurrent tabs overwrite each other.
- The Playwright suite runs against the real `kanban-data` volume; tests restore their changes in `finally` blocks, but an aborted run can leave stray data.
