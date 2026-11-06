import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


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
