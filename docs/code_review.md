# Code review

Date: 2026-11-06. Scope: the whole repository at commit `0616747` (backend, frontend, Docker, scripts, tests, docs).

All suites pass: 22 backend tests, frontend lint, 15 unit tests, and 10 Playwright tests. The codebase is small and well organized. Validation is thorough at the API boundary, and AI output is applied as constrained actions rather than trusted board snapshots. The findings below are ordered by priority.

## Summary of actions

| # | Priority | Area | Action |
|---|----------|------|--------|
| 1 | High | Security | Require a session on the AI probe endpoints (or remove them) and keep a single route |
| 2 | High | Security | Bind the container port to `127.0.0.1` |
| 3 | High | Bug | Reset the card edit form from current card data when editing starts |
| 4 | Medium | Bug | Prevent board edits from racing with an in-flight AI chat request |
| 5 | Medium | Bug | Compare login credentials as bytes to avoid a 500 on non-ASCII input |
| 6 | Medium | Bug | Stop an empty column title from producing a persistent save error |
| 7 | Medium | AI | Use JSON mode and a system message for the board chat prompt |
| 8 | Low | Simplify | Remove duplicated error mapping and validation in `main.py` |
| 9 | Low | Simplify | Use `board_update` from the chat response instead of refetching |
| 10 | Low | Simplify | Simplify the OpenAI client setup and narrow its exception handling |
| 11 | Low | Hygiene | Ignore `frontend/test-results/` and stop tracking it |
| 12 | Low | Hygiene | Keep the dev SQLite file out of the Docker image |
| 13 | Low | Frontend | Remove dead code and minor issues in `KanbanBoard` / `kanban.ts` |
| 14 | Low | Accessibility | Add a keyboard sensor for drag and drop |
| 15 | Info | MVP limits | Record accepted session limitations |
| 16 | Low | Tests | Add tests for the bugs fixed above |

## Findings

### 1. AI probe endpoints are unauthenticated (High)

`backend/app/main.py:302-314` registers six routes (`GET` and `POST` on `/api/ai/test`, `/api/ai/connectivity-check`, `/api/ai/health`). None requires a session, and each accepts an arbitrary `prompt`. Anyone who can reach the server can use the configured OpenAI key as a free proxy. This was verified: `GET /api/ai/test` returns 200 with no cookie.

Action: the Part 8 connectivity check is complete, so delete these routes, `run_ai_probe`, `AIProbeRequest`, and their tests. If a check is still wanted, keep one `POST /api/ai/test` route with a fixed `2+2` prompt that calls `require_session_username`.

### 2. Server listens on all network interfaces (High)

`docker-compose.yml` publishes `"8000:8000"`, which binds to `0.0.0.0`. With hardcoded `user` / `password` credentials, anyone on the same network can sign in and use the AI chat, which spends the API key.

Action: change the mapping to `"127.0.0.1:8000:8000"`. This matches the "runs locally" requirement.

### 3. Card edit form shows stale data after an AI update (High)

`frontend/src/components/KanbanCard.tsx:14-16` seeds `title` and `details` state from props once and never resyncs. After the AI edits a card (or the board is refreshed), clicking Edit shows the old values. Saving the form then silently reverts the AI's change.

Action: set the fields from `card` when entering edit mode, for example `onClick={() => { setTitle(card.title); setDetails(card.details); setIsEditing(true); }}`. Add a unit test that rerenders with a changed card and opens the editor.

### 4. Board edits can race with an AI chat request (Medium)

`canSend` only blocks *starting* a chat while there are unsaved changes (`KanbanBoard.tsx:279`). While the request is pending, the user can still drag or edit cards. The debounced `PUT /api/board` and the AI's server-side save then overwrite each other (whole-board replace, last write wins), and `refreshBoard` may replace local edits. One of the two changes is lost without an error.

Action: lift the AI pending state into `KanbanBoard`, or pass an `onPendingChange` callback. Disable board mutations while a chat request is in flight, for example by ignoring `updateBoard` calls and showing the board as read-only.

### 5. Non-ASCII login input causes a 500 (Medium)

`secrets.compare_digest` raises `TypeError` for `str` arguments that contain non-ASCII characters (`main.py:387-388`). This was verified: `POST /api/auth/login` with username `usér` returns 500. The same applies to the cookie signature comparison at `main.py:161`.

Action: compare encoded bytes, e.g. `secrets.compare_digest(credentials.username.encode(), b"user")`, and `hmac.compare_digest(signature.encode(), expected_signature.encode())`. Add a backend test.

### 6. Clearing a column title shows a save error (Medium)

`KanbanColumn.tsx` calls `onRename` on every keystroke. An empty title fails `BoardColumn.title` `min_length=1`, so the API returns 422 and the UI shows "Your changes could not be saved." The error stays until the user types a title. It also blocks AI chat, because `canSend` requires the board to be saved.

Action: keep a local draft in the column input and commit on blur or Enter only when the trimmed value is non-empty. Otherwise revert to the saved title.

### 7. Board chat prompt is fragile (Medium)

`build_board_chat_prompt` and `get_ai_response` send the instructions, the user question, and the board as a single `user` message. `parse_board_chat_response` hand-strips Markdown code fences (`main.py:196-204`).

Action:
- Send the instructions as a `system` message, with the question, history, and board in the user message. This makes the model less likely to follow instructions that a user types or that sit in card text.
- Pass `response_format={"type": "json_object"}` (supported by `gpt-4o-mini`) and delete the fence-stripping code.
- Change `get_ai_response` to accept a `messages` list, or `system` and `user` strings, so this stays a small change.

### 8. Duplicated logic in `main.py` (Low)

- The AI error-to-HTTP mapping (503 / 502) is repeated in `run_ai_probe` and `run_board_chat`. The `except Exception` in `run_ai_probe` is unnecessary because `get_ai_response` already wraps provider errors.
- The `FixedColumnsError` / `LookupError` mapping is repeated in `run_board_chat` and `update_board`.
- `apply_board_actions` validates with `BoardData`, and `run_board_chat` validates the same board again (`main.py:271-272` and `358`).
- `require_session_username` is a pass-through alias of `get_session_username`.
- `parse_board_chat_response` re-checks `reply.strip()` after Pydantic has validated it, and returns a dict instead of the validated `AIModelResponse`.

Action: have `apply_board_actions` return a `BoardData`. Add one helper that saves a board and maps errors to HTTP responses, used by both routes. Remove the alias. Return `AIModelResponse` from the parser (strip whitespace with `Field` or `str_strip_whitespace`). Removing the probe (item 1) eliminates the rest of the duplication.

### 9. Redundant board refetch after an AI update (Low)

`AIChatSidebar` ignores the `board_update` payload and calls `refreshBoard`, which issues another `GET /api/board`. The payload is already the saved server state.

Action: pass `board_update` to a `KanbanBoard` callback that sets the board and the persisted snapshot directly. Type `board_update` as `BoardData | null`. Also guard `response.json()` on error responses: a non-JSON 500 body currently surfaces as a JSON parse error message.

### 10. OpenAI client setup (Low)

`ai.py:17-27` manually reads `OPENAI_BASE_URL`, which the OpenAI SDK already reads from the environment and which `docker-compose.yml` never passes. The `except (AttributeError, OpenAIError, TypeError, ValueError)` also turns programming errors into "provider" 502s. The default model is defined both in `ai.py` and in `docker-compose.yml`.

Action: check `OPENAI_API_KEY`, then call `OpenAI()`. Catch only `OpenAIError`. Remove `OPENAI_MODEL`'s default from compose, or from code, so the default lives in one place.

### 11. Playwright output is committed (Low)

`frontend/test-results/.last-run.json` is tracked, and `frontend/.gitignore` does not ignore Playwright output.

Action: add `/test-results/` and `/playwright-report/` to `frontend/.gitignore`, then run `git rm --cached frontend/test-results/.last-run.json`.

### 12. Dev database can be copied into the image (Low)

Without `DATABASE_PATH`, the backend writes `backend/app/kanban.sqlite3`. `.dockerignore` excludes `backend/*.sqlite*` but not `backend/app/`, and the Dockerfile copies `backend/app`. Running `uv run uvicorn` locally and then building the image would bake local data into the image.

Action: change the `.dockerignore` patterns to `**/*.sqlite*` and `**/*.db`.

### 13. Minor frontend cleanups (Low)

- `KanbanBoard.tsx:48`: the `cardsById` `useMemo` only aliases `board.cards`; use `board.cards` directly.
- `lib/kanban.ts`: `initialData` duplicates the backend seed (`DEFAULT_CARDS`) and is used only by tests. Move it to a test fixture.
- `KanbanCard.tsx`: drag listeners are spread on the whole `<article>`, including the edit form. Dragging inside an input to select text starts a card drag. Apply `listeners` only when not editing.
- `handleAddCard` substitutes "No details yet." for empty details, but `handleEditCard` saves empty details. Pick one behavior; storing empty details is simpler.
- `package.json` uses `@types/node` `^20` while the Docker build uses Node 24. Align them.
- An expired session (for example after a restart without `SESSION_SECRET`) shows only "could not be saved". Treat a 401 from the board or chat APIs as signed out.

### 14. Drag and drop is mouse-only (Low)

Only `PointerSensor` is registered. Keyboard users cannot move cards.

Action: add `KeyboardSensor` with `sortableKeyboardCoordinates` from `@dnd-kit/sortable`. This is a two-line change.

### 15. Accepted MVP session limitations (Info)

These need no action for the MVP, but they should be recorded before multi-user work:

- Session tokens never expire, and logout cannot revoke them, because they are stateless HMACs of the username.
- `get_session_username` hardcodes `username != "user"`.
- The cookie has no `secure` flag, which is fine for plain-HTTP localhost.
- Board saves replace the whole board with last-write-wins, so concurrent tabs overwrite each other.

### 16. Test coverage gaps (Low)

Add tests alongside the fixes above:
- Backend: non-ASCII login (item 5); AI routes reject requests without a session (item 1); the JSON-mode request shape (item 7).
- Frontend unit tests: the editor shows current card data after a prop change (item 3); board edits are blocked during a pending chat request (item 4); an empty column title does not trigger a save (item 6).
- End-to-end: the Playwright suite writes to the real `kanban-data` volume. A failure partway through a test can leave stray data. Consider starting the e2e stack with a throwaway `DATABASE_PATH`.

## Suggested order

1. Items 1, 2 and 5: small security and robustness fixes.
2. Items 3, 4 and 6: user-visible data-loss and error bugs, with tests (item 16).
3. Item 7: prompt robustness.
4. Items 8 to 14: cleanups, in any order.
