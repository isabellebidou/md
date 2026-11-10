import json
import sqlite3
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ai import AIProviderError, get_ai_response, get_model
from app.database import (
    DEFAULT_COLUMNS,
    database_connection,
    get_board,
    initialize_database,
    save_board,
)
from app.main import app, build_board_chat_messages


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "kanban.sqlite3"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, database_path: Path) -> TestClient:
    monkeypatch.setenv("DATABASE_PATH", str(database_path))
    with TestClient(app) as test_client:
        yield test_client


def sign_in(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert response.status_code == 200


def fake_ai(monkeypatch: pytest.MonkeyPatch, response: str) -> dict:
    """Make the mocked model return `response`; returns the captured request."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    captured: dict = {}

    def fake_get_ai_response(messages, *, json_mode=False) -> str:
        captured["messages"] = messages
        captured["json_mode"] = json_mode
        return response

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)
    return captured


def test_hello_route(client: TestClient) -> None:
    response = client.get("/api/hello")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello, world!"}


def test_home_serves_static_html(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<h1>Hello, world!</h1>" in response.text
    assert 'fetch("/api/hello")' in response.text


def test_ai_connectivity_check_returns_the_model_answer(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = fake_ai(monkeypatch, "4")
    sign_in(client)
    response = client.post("/api/ai/test")

    assert response.status_code == 200
    assert response.json() == {"answer": "4", "model": "gpt-4o-mini"}
    assert captured["messages"] == [{"role": "user", "content": "2+2"}]
    assert captured["json_mode"] is False


def test_ai_connectivity_check_requires_an_api_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    sign_in(client)

    response = client.post("/api/ai/test")

    assert response.status_code == 503
    assert response.json()["detail"] == "OPENAI_API_KEY is not configured."


def test_ai_connectivity_check_reports_provider_failures(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def fake_get_ai_response(messages, *, json_mode=False) -> str:
        raise AIProviderError("provider blew up")

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)
    sign_in(client)
    response = client.post("/api/ai/test")

    assert response.status_code == 502
    assert response.json()["detail"] == "provider blew up"


def test_ai_connectivity_check_requires_a_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_get_ai_response(messages, *, json_mode=False) -> str:
        raise AssertionError("AI must not be called without a session")

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)

    assert client.post("/api/ai/test").status_code == 401
    assert client.get("/api/ai/test").status_code in (404, 405)
    assert client.get("/api/ai/health").status_code == 404
    assert client.post("/api/ai/connectivity-check").status_code in (404, 405)


def test_ai_chat_includes_board_and_history_in_prompt(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = fake_ai(monkeypatch, '{"reply": "I can help.", "actions": []}')
    sign_in(client)

    response = client.post(
        "/api/ai/chat",
        json={
            "question": "Move the roadmap card to review.",
            "conversation": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there"},
            ],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"reply": "I can help.", "board_update": None}
    assert captured["json_mode"] is True
    system, user = captured["messages"]
    assert system["role"] == "system"
    assert '"action":"create_card"' in system["content"]
    assert "Never return a full board snapshot" in system["content"]
    assert user["role"] == "user"
    assert "Move the roadmap card to review." in user["content"]
    assert "Board JSON" in user["content"]
    assert "Hi there" in user["content"]
    assert "Move the roadmap card to review." not in system["content"]


def test_ai_chat_creates_the_requested_card_in_backlog(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    fake_ai(
        monkeypatch,
        json.dumps(
            {
                "reply": 'Created "blue ring" in Backlog.',
                "actions": [
                    {
                        "action": "create_card",
                        "title": "blue ring",
                        "details": "",
                        "column": "Backlog",
                    }
                ],
            }
        ),
    )

    response = client.post(
        "/api/ai/chat",
        json={
            "question": 'create card "blue ring" and place it into backlog',
            "conversation": [],
        },
    )

    assert response.status_code == 200
    assert response.json()["reply"] == 'Created "blue ring" in Backlog.'
    saved_board = client.get("/api/board").json()
    assert response.json()["board_update"] == saved_board
    created_id = saved_board["columns"][0]["cardIds"][-1]
    assert saved_board["cards"][created_id]["title"] == "blue ring"
    assert created_id.startswith("ai-card-")
    assert all(
        created_id not in column["cardIds"]
        for column in saved_board["columns"][1:]
    )


def test_ai_chat_edits_and_moves_a_card(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    fake_ai(
        monkeypatch,
        json.dumps(
            {
                "reply": "Updated and moved the roadmap card.",
                "actions": [
                    {
                        "action": "edit_card",
                        "card_id": "card-1",
                        "title": "Blue ring",
                        "details": "Updated by the assistant.",
                    },
                    {
                        "action": "move_card",
                        "card_id": "card-1",
                        "column": "col-discovery",
                    },
                ],
            }
        ),
    )

    response = client.post(
        "/api/ai/chat",
        json={"question": "Edit and move the roadmap card.", "conversation": []},
    )

    assert response.status_code == 200
    saved_board = client.get("/api/board").json()
    assert saved_board["cards"]["card-1"] == {
        "id": "card-1",
        "title": "Blue ring",
        "details": "Updated by the assistant.",
        "dueDate": None,
    }
    assert "card-1" in saved_board["columns"][1]["cardIds"]
    assert all(
        "card-1" not in column["cardIds"]
        for column in [saved_board["columns"][0], *saved_board["columns"][2:]]
    )


def test_ai_chat_rejects_malformed_model_output(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    fake_ai(monkeypatch, "not-json")

    response = client.post(
        "/api/ai/chat",
        json={"question": "Move something", "conversation": []},
    )

    assert response.status_code == 502
    assert "not valid JSON" in response.json()["detail"]


def test_ai_chat_rejects_invalid_board_updates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    fake_ai(
        monkeypatch,
        '{"reply": "bad action", "actions": [{"action": "move_card", "card_id": "missing-card", "column": "Backlog"}]}',
    )

    response = client.post(
        "/api/ai/chat",
        json={"question": "Change the board", "conversation": []},
    )

    assert response.status_code == 502
    assert "missing-card" in response.json()["detail"]


def test_ai_chat_requires_a_session(client: TestClient) -> None:
    response = client.post(
        "/api/ai/chat",
        json={"question": "Move a card", "conversation": []},
    )

    assert response.status_code == 401


def test_login_sets_http_only_session_cookie_and_session_is_available(
    client: TestClient,
) -> None:
    login_response = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )

    assert login_response.status_code == 200
    assert login_response.json() == {"username": "user"}
    assert login_response.cookies.get("session")
    set_cookie = login_response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "max-age" not in set_cookie
    assert "expires" not in set_cookie

    session_response = client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"username": "user"}


def test_login_rejects_invalid_credentials(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "wrong"}
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid username or password"
    assert "session" not in client.cookies


def test_login_rejects_non_ascii_credentials(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login", json={"username": "us\u00e9r", "password": "p\u00e4ssword"}
    )

    assert response.status_code == 401


def test_session_rejects_non_ascii_signature(client: TestClient) -> None:
    response = client.get(
        "/api/auth/session", headers={"cookie": "session=user.\u00e9".encode()}
    )

    assert response.status_code == 401


def test_session_rejects_missing_or_invalid_cookie(client: TestClient) -> None:
    assert client.get("/api/auth/session").status_code == 401

    client.cookies.set("session", "user.invalid")
    assert client.get("/api/auth/session").status_code == 401


def test_logout_clears_session_cookie(client: TestClient) -> None:
    sign_in(client)

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    assert client.get("/api/auth/session").status_code == 401


def test_database_initializes_and_seeds_one_board(
    client: TestClient, database_path: Path
) -> None:
    assert database_path.exists()
    board = get_board("user", database_path)

    assert board is not None
    assert [column["id"] for column in board["columns"]] == [
        column_id for column_id, _ in DEFAULT_COLUMNS
    ]
    assert len(board["cards"]) == 8
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 1


def test_database_enforces_one_board_per_user(database_path: Path) -> None:
    initialize_database(database_path)

    with pytest.raises(sqlite3.IntegrityError):
        with database_connection(database_path) as connection:
            connection.execute(
                "INSERT INTO boards (id, user_id) VALUES ('duplicate-board', 'user')"
            )


def test_database_initialization_is_idempotent(database_path: Path) -> None:
    initialize_database(database_path)
    board = get_board("user", database_path)
    assert board is not None
    board["columns"][0]["title"] = "Renamed"
    save_board("user", board, database_path)

    initialize_database(database_path)

    saved_board = get_board("user", database_path)
    assert saved_board is not None
    assert saved_board["columns"][0]["title"] == "Renamed"


def test_board_endpoints_require_a_session(
    client: TestClient, database_path: Path
) -> None:
    assert client.get("/api/board").status_code == 401
    board = get_board("user", database_path)
    assert board is not None
    assert client.put("/api/board", json=board).status_code == 401


def test_authenticated_board_read_and_update_persist(
    client: TestClient,
) -> None:
    sign_in(client)
    response = client.get("/api/board")
    assert response.status_code == 200
    board = response.json()

    board["columns"][0]["title"] = "Ideas"
    board["columns"][0]["cardIds"].remove("card-1")
    board["columns"][1]["cardIds"].append("card-1")
    update_response = client.put("/api/board", json=board)

    assert update_response.status_code == 200
    assert update_response.json() == board
    assert client.get("/api/board").json() == board


def test_board_update_rejects_invalid_references_and_changed_columns(
    client: TestClient,
) -> None:
    sign_in(client)
    board = client.get("/api/board").json()
    board["columns"][1]["cardIds"].append("card-1")
    assert client.put("/api/board", json=board).status_code == 422

    board = client.get("/api/board").json()
    board["columns"][0]["id"] = "col-renamed"
    assert client.put("/api/board", json=board).status_code == 422
    assert client.get("/api/board").json()["columns"][0]["id"] == "col-backlog"


def test_board_storage_is_scoped_to_username(database_path: Path) -> None:
    initialize_database(database_path)
    with database_connection(database_path) as connection:
        connection.execute(
            "INSERT INTO users (id, username) VALUES ('other-user', 'other')"
        )
        connection.execute(
            "INSERT INTO boards (id, user_id) VALUES ('other-board', 'other-user')"
        )
        connection.executemany(
            """
            INSERT INTO columns (board_id, id, title, position)
            VALUES ('other-board', ?, ?, ?)
            """,
            [
                (column_id, title, position)
                for position, (column_id, title) in enumerate(DEFAULT_COLUMNS)
            ],
        )

    user_board = get_board("user", database_path)
    other_board = get_board("other", database_path)
    assert user_board is not None
    assert other_board is not None
    user_board["columns"][0]["title"] = "User's column"
    save_board("user", user_board, database_path)

    assert get_board("other", database_path) == other_board


def test_get_ai_response_sends_json_mode_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    class FakeOpenAI:
        def __init__(self) -> None:
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            captured.update(kwargs)
            message = SimpleNamespace(content=' {"reply": "ok", "actions": []} ')
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setattr("app.ai.OpenAI", FakeOpenAI)
    messages = [
        {"role": "system", "content": "Respond in JSON."},
        {"role": "user", "content": "Hi"},
    ]

    result = get_ai_response(messages, json_mode=True)

    assert result == '{"reply": "ok", "actions": []}'
    assert captured["model"] == "gpt-4o-mini"
    assert captured["messages"] == messages
    assert captured["response_format"] == {"type": "json_object"}


def test_ai_chat_strips_reply_whitespace(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_ai(monkeypatch, '{"reply": "  Hi.  ", "actions": []}')
    sign_in(client)

    response = client.post("/api/ai/chat", json={"question": "Hello"})

    assert response.json() == {"reply": "Hi.", "board_update": None}


def test_ai_chat_rejects_blank_reply(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_ai(monkeypatch, '{"reply": "   ", "actions": []}')
    sign_in(client)

    response = client.post("/api/ai/chat", json={"question": "Hello"})

    assert response.status_code == 502
    assert "invalid structure" in response.json()["detail"]


def test_blank_openai_model_uses_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_MODEL", "")
    assert get_model() == "gpt-4o-mini"
    monkeypatch.setenv("OPENAI_MODEL", "gpt-other")
    assert get_model() == "gpt-other"


def test_board_due_dates_persist_and_can_be_cleared(client: TestClient) -> None:
    sign_in(client)
    board = client.get("/api/board").json()
    assert board["cards"]["card-1"]["dueDate"] is None

    board["cards"]["card-1"]["dueDate"] = "2026-11-12"
    del board["cards"]["card-2"]["dueDate"]
    response = client.put("/api/board", json=board)

    assert response.status_code == 200
    saved = client.get("/api/board").json()
    assert saved["cards"]["card-1"]["dueDate"] == "2026-11-12"
    assert saved["cards"]["card-2"]["dueDate"] is None

    saved["cards"]["card-1"]["dueDate"] = None
    assert client.put("/api/board", json=saved).status_code == 200
    assert client.get("/api/board").json()["cards"]["card-1"]["dueDate"] is None


@pytest.mark.parametrize("due_date", ["2026-02-30", "tomorrow", "12/11/2026"])
def test_board_rejects_invalid_due_dates(client: TestClient, due_date: str) -> None:
    sign_in(client)
    board = client.get("/api/board").json()
    board["cards"]["card-1"]["dueDate"] = due_date

    assert client.put("/api/board", json=board).status_code == 422
    assert client.get("/api/board").json()["cards"]["card-1"]["dueDate"] is None


def test_initialize_database_adds_due_date_to_an_old_schema(database_path: Path) -> None:
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT 'now');
            CREATE TABLE boards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE);
            CREATE TABLE columns (board_id TEXT NOT NULL, id TEXT NOT NULL,
                title TEXT NOT NULL, position INTEGER NOT NULL,
                PRIMARY KEY (board_id, id));
            CREATE TABLE cards (board_id TEXT NOT NULL, id TEXT NOT NULL,
                column_id TEXT NOT NULL, position INTEGER NOT NULL,
                title TEXT NOT NULL, details TEXT NOT NULL,
                PRIMARY KEY (board_id, id));
            INSERT INTO users (id, username) VALUES ('user', 'user');
            INSERT INTO boards VALUES ('board-user', 'user');
            INSERT INTO columns VALUES
                ('board-user', 'col-backlog', 'Backlog', 0),
                ('board-user', 'col-discovery', 'Discovery', 1),
                ('board-user', 'col-progress', 'In Progress', 2),
                ('board-user', 'col-review', 'Review', 3),
                ('board-user', 'col-done', 'Done', 4);
            INSERT INTO cards VALUES
                ('board-user', 'old-card', 'col-backlog', 0, 'Old card', 'Kept');
            """
        )

    initialize_database(database_path)

    board = get_board("user", database_path)
    assert board is not None
    assert board["cards"] == {
        "old-card": {"id": "old-card", "title": "Old card", "details": "Kept", "dueDate": None}
    }
    initialize_database(database_path)


def test_ai_chat_sets_and_clears_due_dates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    fake_ai(monkeypatch, json.dumps({
        "reply": "Done.",
        "actions": [
            {"action": "create_card", "title": "Workout", "details": "", "due_date": "2026-11-20", "column": "Backlog"},
            {"action": "edit_card", "card_id": "card-2", "due_date": "2026-11-15"},
        ],
    }))
    response = client.post("/api/ai/chat", json={"question": "Add dates"})

    assert response.status_code == 200
    board = client.get("/api/board").json()
    created_id = board["columns"][0]["cardIds"][-1]
    assert board["cards"][created_id]["dueDate"] == "2026-11-20"
    assert board["cards"]["card-2"]["dueDate"] == "2026-11-15"
    assert board["cards"]["card-2"]["title"] == "Gather customer signals"

    fake_ai(monkeypatch, json.dumps({
        "reply": "Cleared.",
        "actions": [{"action": "edit_card", "card_id": "card-2", "due_date": None}],
    }))
    response = client.post("/api/ai/chat", json={"question": "Remove the date"})

    assert response.status_code == 200
    assert response.json()["board_update"]["cards"]["card-2"]["dueDate"] is None
    assert client.get("/api/board").json()["cards"]["card-2"]["dueDate"] is None


def test_ai_chat_edit_without_due_date_keeps_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    board = client.get("/api/board").json()
    board["cards"]["card-1"]["dueDate"] = "2026-11-12"
    client.put("/api/board", json=board)
    fake_ai(monkeypatch, json.dumps({
        "reply": "Renamed.",
        "actions": [{"action": "edit_card", "card_id": "card-1", "title": "Renamed"}],
    }))

    client.post("/api/ai/chat", json={"question": "Rename"})

    assert client.get("/api/board").json()["cards"]["card-1"] == {
        "id": "card-1",
        "title": "Renamed",
        "details": "Draft quarterly themes with impact statements and metrics.",
        "dueDate": "2026-11-12",
    }


@pytest.mark.parametrize(
    "action",
    [
        {"action": "edit_card", "card_id": "card-1", "due_date": "next week"},
        {"action": "move_card", "card_id": "card-1", "column": "Done", "due_date": "2026-11-12"},
    ],
)
def test_ai_chat_rejects_invalid_due_date_actions(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, action: dict
) -> None:
    sign_in(client)
    fake_ai(monkeypatch, json.dumps({"reply": "Ok.", "actions": [action]}))

    response = client.post("/api/ai/chat", json={"question": "Date"})

    assert response.status_code == 502
    assert client.get("/api/board").json()["cards"]["card-1"]["dueDate"] is None


def test_ai_chat_prompt_includes_today_and_due_date_shape(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    captured = fake_ai(monkeypatch, '{"reply": "Hi.", "actions": []}')

    client.post("/api/ai/chat", json={"question": "Due Friday"})

    system, user = captured["messages"]
    assert '"due_date":"YYYY-MM-DD"' in system["content"]
    assert "use null in edit_card to remove a due date" in system["content"]
    assert "never work out weekdays yourself" in system["content"]
    today = date.today()
    assert f"Today is {today:%A} {today.isoformat()}." in user["content"]


def test_board_chat_calendar_lists_the_next_two_weeks() -> None:
    _, user = build_board_chat_messages(
        "Due Friday", {"columns": [], "cards": {}}, [], date(2026, 11, 7)
    )

    assert "Today is Saturday 2026-11-07." in user["content"]
    calendar = user["content"].split("Calendar (next 14 days):\n")[1].split("\nUser question")[0]
    lines = calendar.splitlines()
    assert lines[0] == "Sunday 2026-11-08"
    assert "Friday 2026-11-13" in lines
    assert lines[-1] == "Saturday 2026-11-21"
    assert len(lines) == 14
