from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_hello_route() -> None:
    response = client.get("/api/hello")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello, world!"}


def test_home_serves_example_html() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<h1>Hello, world!</h1>" in response.text
    assert 'fetch("/api/hello")' in response.text
