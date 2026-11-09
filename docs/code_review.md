# Code review

Date: 2026-11-09. Scope: the whole repository at commit `c989cd9` (backend, frontend, Docker, scripts, tests, docs), after the fixes from the 2026-11-06 review and the Part 11 due-date feature.

Checks run: 40 backend tests pass, frontend lint is clean, 51 unit tests pass, and `npm run build` succeeds. Playwright was not run because the Docker app was not running.

Every item from the previous review has been addressed: the AI probe is now a single authenticated route, the port is bound to `127.0.0.1`, the card editor resyncs from props, the board is read-only during a chat request, logins compare bytes, column titles commit on blur, the chat uses JSON mode with a system message, and the keyboard sensor is in place. The code is small, readable, and validated at the API boundary. The remaining findings are mostly edge cases, ordered by priority.

## Summary of actions

| # | Priority | Area | Action |
|---|----------|------|--------|
| 1 | Medium | Bug | Use the browser's date, not the container's UTC date, for AI relative dates |
| 2 | Medium | Bug | Do not lose pending board changes on logout |
| 3 | Medium | Bug | Close or block an open card editor when the AI updates the board |
| 4 | Low | AI | Accept `null` for fields the model does not intend to set |
| 5 | Low | Validation | Reject whitespace-only titles and bound input sizes on the API |
| 6 | Low | Bug | Drop the unanswered question from the chat history after a failed request |
| 7 | Low | Simplify | Remove small redundancies in `database.py` |
| 8 | Low | Hygiene | Stop tracking `frontend/test-results/.last-run.json` |
| 9 | Low | Accessibility | Do not keep `role="button"` on a card while it shows the edit form |
| 10 | Info | Plan | Record limitations that Part 12 will change |

## Findings

### 1. AI uses the server's date, not the user's (Medium)

`run_board_chat` passes `date.today()` (`backend/app/main.py:340`) to `build_board_chat_messages`, which builds the "Today is" line and the 14-day calendar from it. The container (`python:3.13-slim`) runs in UTC, while the board colours use the browser's local date (`useToday`). For a user in Sydney before 11:00, or in New York after 19:00, "tomorrow" and weekday names resolve one day off, so the AI sets the wrong due date. The card colours and the AI then disagree about what "today" is.

Action: send the browser's local date with the chat request (`today: toLocalDateString(new Date())` in `AIChatSidebar`), add `today: date` to `AIChatRequest`, and pass it through to `build_board_chat_messages`. This is simpler and more correct than setting `TZ` in the container, because the browser is what decides "today" for the colours. Add a backend test asserting the calendar is built from the supplied date.

### 2. Logging out can drop the last change (Medium)

Board saves are debounced by 250 ms (`KanbanBoard.tsx:79-112`). Clicking "Log out" unmounts `KanbanBoard`, and the effect cleanup clears the pending timeout, so a change made in the last 250 ms is never sent. The common case is renaming a column and then clicking "Log out": the rename commits on blur, which fires just before the click, so it is always inside the debounce window. Even if the request went out, it would race the logout and could get a 401. This is from code reading and has not been reproduced in the browser.

Action: disable the "Log out" button unless `saveStatus === "saved"` (the same rule the chat already uses), with a short title explaining why. Add a unit test: rename a column, blur, and assert that Log out is disabled until the save completes.

### 3. An open card editor can revert an AI edit (Medium)

`KanbanCard` copies the card into local state when Edit is clicked (`KanbanCard.tsx:126-131`). Opening an editor does not change `saveStatus`, so the user can still send a chat message. If the AI edits that card, the board shows the new values but the open form keeps the old ones. Clicking Save then writes the old title, details, and due date back over the AI's change without any warning. The same thing happens with a due date the AI just set or cleared.

Action: the simplest fix is to close open editors when a `board_update` is applied. For example, key each `KanbanCard` by `card.id` plus a board revision that `applySavedBoard` increments, or pass the revision down and reset `isEditing` when it changes. Alternatively, block sending while any editor is open. Add a unit test for whichever option is chosen.

### 4. Strict action validation rejects harmless `null` fields (Low)

`BoardAction.validate_action_fields` treats any `due_date` key as "sets the due date", including `null` (`main.py:64`, `82`). This was verified: `{"action":"move_card","card_id":"card-1","column":"col-done","due_date":null}` fails validation, and the whole chat request returns 502. Models often emit every key with `null` values. The same habit on `edit_card` (`"title":"x","due_date":null`) silently clears the due date, because `null` is the documented way to clear it.

Action: for `move_card`, treat `due_date: null` as not set (check `self.due_date is not None`, as is already done for `title` and `details`). For `edit_card`, keep `null` as "clear", since it is in the prompt, but add a backend test that pins this behaviour so that a change is deliberate. If clearing by accident shows up in practice, switch to an explicit `"clear_due_date": true` field.

### 5. API accepts whitespace-only titles and unbounded text (Low)

- `BoardCard.title` and `BoardColumn.title` use `min_length=1`, so `"   "` is accepted by `PUT /api/board` (verified). The frontend trims, so this only matters for direct API calls, but the backend is meant to be the source of truth.
- `AIChatRequest.question`, `AIChatMessage.content`, card `title`, and card `details` have no maximum length. A very long question or card is sent to OpenAI on every chat request and costs tokens. The app is local and single-user, so this is a cost issue, not a security issue.

Action: add `str_strip_whitespace=True` to the `BoardCard` and `BoardColumn` model configs, and add a generous `max_length` to `question` (for example 2000) and card fields (for example 200 for titles and 5000 for details). Return 422 as usual.

### 6. Failed chat requests leave an unanswered question in the history (Low)

`AIChatSidebar` appends the user's message before the request (`AIChatSidebar.tsx:45-48`) and keeps it when the request fails. The next request sends it as part of `conversation`, so the model sees two user messages in a row and may act on the failed one as well. For example, after a 502 for "move card X to Done", the next question can cause the move to happen anyway.

Action: on failure, remove the last user message, or put the question back in the textarea so the user can retry. Restoring the text is the more helpful option and is a two-line change.

### 7. Small redundancies in `database.py` (Low)

- `get_board` and `save_board` repeat the same board lookup query. Extract a `find_board_id(connection, username)` helper.
- In `save_board`, the column `UPDATE` filters on `position` (`database.py:273`), but the column IDs and their order were already checked against the stored order just above. Filter on `board_id` and `id` only.
- `initialize_database` raises `RuntimeError` if the `user` row is missing immediately after `INSERT OR IGNORE` inserted it (`database.py:146-147`). This cannot happen and can be removed. Part 12 will rewrite this code with `create_user`, so this could be done as part of that work instead.

### 8. Playwright output is still tracked (Low)

`frontend/.gitignore` now ignores `/test-results/`, and the root `.gitignore` lists `frontend/test-results/.last-run.json`, but the file is still tracked, so ignore rules do not apply to it.

Action: run `git rm --cached frontend/test-results/.last-run.json` and remove the now-redundant line from the root `.gitignore`.

### 9. Card keeps its drag-handle role while editing (Low)

`KanbanCard` drops the drag `listeners` while editing, which is correct, but still spreads `attributes` (`KanbanCard.tsx:62`). The `<article>` that contains the form therefore keeps `role="button"`, `tabIndex=0`, and `aria-roledescription="sortable"`. Screen readers announce the form as part of a button, and Tab stops on the card before reaching the inputs.

Action: spread `attributes` only when not editing, the same way as `listeners`.

### 10. Limitations Part 12 will change (Info)

These are already recorded in `docs/PLAN.md` and need no action now. They are listed here so that the Part 12 review can check them:

- `get_session_username` hardcodes `username != "user"` (`main.py:159`). Part 12 replaces this with a database lookup.
- Session tokens never expire and cannot be revoked. With registration, a token is valid until `SESSION_SECRET` changes. Consider adding an issued-at timestamp to the signed value when Part 12 is implemented.
- Board saves are whole-board, last-write-wins, so two tabs overwrite each other.
- `DEFAULT_CARDS` is seeded only for the demo user. The Part 12 plan already says new users get an empty board.
- The container runs as root. This is acceptable for a local MVP.

## Suggested order

1. Items 1, 2 and 3: user-visible bugs that lose or corrupt data, each with a test.
2. Items 4 and 6: AI chat robustness.
3. Items 5, 7, 8 and 9: cleanups, in any order. Item 7 can be done as part of Part 12.
