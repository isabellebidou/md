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
