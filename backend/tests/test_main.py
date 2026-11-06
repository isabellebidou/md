import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import (
    DEFAULT_COLUMNS,
    database_connection,
    get_board,
    initialize_database,
    save_board,
)
from app.main import app


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
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        assert prompt == "2+2"
        assert model is None
        return "4"

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)
    response = client.get("/api/ai/test")

    assert response.status_code == 200
    assert response.json() == {"answer": "4", "model": "gpt-4o-mini"}


def test_ai_connectivity_check_requires_an_api_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.get("/api/ai/test")

    assert response.status_code == 503
    assert response.json()["detail"] == "OPENAI_API_KEY is not configured."


def test_ai_connectivity_check_reports_provider_failures(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        raise RuntimeError("provider blew up")

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)
    response = client.get("/api/ai/test")

    assert response.status_code == 502
    assert response.json()["detail"] == "provider blew up"


def test_ai_chat_includes_board_and_history_in_prompt(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    captured: dict[str, str] = {}

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        captured["prompt"] = prompt
        return '{"reply": "I can help.", "actions": []}'

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)
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
    assert "Move the roadmap card to review." in captured["prompt"]
    assert "Board JSON" in captured["prompt"]
    assert "Hi there" in captured["prompt"]
    assert '"action":"create_card"' in captured["prompt"]
    assert "Never return a full board snapshot" in captured["prompt"]


def test_ai_chat_creates_the_requested_card_in_backlog(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    sign_in(client)

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        return json.dumps(
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
        )

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)

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
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    sign_in(client)

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        return json.dumps(
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
        )

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)

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
    }
    assert "card-1" in saved_board["columns"][1]["cardIds"]
    assert all(
        "card-1" not in column["cardIds"]
        for column in [saved_board["columns"][0], *saved_board["columns"][2:]]
    )


def test_ai_chat_rejects_malformed_model_output(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    sign_in(client)

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        return "not-json"

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)

    response = client.post(
        "/api/ai/chat",
        json={"question": "Move something", "conversation": []},
    )

    assert response.status_code == 502
    assert "not valid JSON" in response.json()["detail"]


def test_ai_chat_rejects_invalid_board_updates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    sign_in(client)

    def fake_get_ai_response(prompt: str, *, model: str | None = None) -> str:
        return '{"reply": "bad action", "actions": [{"action": "move_card", "card_id": "missing-card", "column": "Backlog"}]}'

    monkeypatch.setattr("app.main.get_ai_response", fake_get_ai_response)

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


def test_session_rejects_missing_or_invalid_cookie(client: TestClient) -> None:
    assert client.get("/api/auth/session").status_code == 401

    client.cookies.set("session", "user.invalid")
    assert client.get("/api/auth/session").status_code == 401


def test_logout_clears_session_cookie(client: TestClient) -> None:
    client.post("/api/auth/login", json={"username": "user", "password": "password"})

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
