import hashlib
import hmac
import os
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Project Management API")
static_dir = Path(__file__).parent / "static"
session_secret = os.environ.get("SESSION_SECRET")
session_key = (
    session_secret.encode("utf-8") if session_secret else secrets.token_bytes(32)
)
session_cookie = "session"


class LoginRequest(BaseModel):
    username: str
    password: str


def create_session_token(username: str) -> str:
    signature = hmac.new(session_key, username.encode(), hashlib.sha256).hexdigest()
    return f"{username}.{signature}"


def get_session_username(request: Request) -> str:
    token = request.cookies.get(session_cookie, "")
    username, separator, signature = token.partition(".")
    if not separator or username != "user":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    expected_signature = hmac.new(
        session_key, username.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return username


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello, world!"}


@app.post("/api/auth/login")
def login(credentials: LoginRequest, response: Response) -> dict[str, str]:
    valid_username = secrets.compare_digest(credentials.username, "user")
    valid_password = secrets.compare_digest(credentials.password, "password")
    if not (valid_username and valid_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    response.set_cookie(
        key=session_cookie,
        value=create_session_token(credentials.username),
        httponly=True,
        samesite="lax",
        path="/",
    )
    return {"username": credentials.username}


@app.get("/api/auth/session")
def get_session(request: Request) -> dict[str, str]:
    return {"username": get_session_username(request)}


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout() -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(key=session_cookie, httponly=True, samesite="lax", path="/")
    return response


app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
