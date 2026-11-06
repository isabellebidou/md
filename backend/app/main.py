import hashlib
import hmac
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from fastapi.staticfiles import StaticFiles

from app.ai import AIConfigurationError, AIProviderError, DEFAULT_OPENAI_MODEL, get_ai_response
from app.database import (
    FixedColumnsError,
    get_board,
    get_database_path,
    initialize_database,
    save_board,
)

static_dir = Path(__file__).parent / "static"
session_secret = os.environ.get("SESSION_SECRET")
session_key = (
    session_secret.encode("utf-8") if session_secret else secrets.token_bytes(32)
)
session_cookie = "session"


class LoginRequest(BaseModel):
    username: str
    password: str


class AIProbeRequest(BaseModel):
    prompt: str = Field(default="2+2", min_length=1)


class BoardCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str


class BoardColumn(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    card_ids: list[str] = Field(alias="cardIds")


class BoardData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[BoardColumn] = Field(min_length=5, max_length=5)
    cards: dict[str, BoardCard]

    @model_validator(mode="after")
    def validate_card_references(self) -> "BoardData":
        column_ids = [column.id for column in self.columns]
        if len(set(column_ids)) != len(column_ids):
            raise ValueError("Column IDs must be unique.")

        card_ids = [
            card_id for column in self.columns for card_id in column.card_ids
        ]
        if len(set(card_ids)) != len(card_ids):
            raise ValueError("Each card must appear in only one column.")
        if set(card_ids) != set(self.cards):
            raise ValueError("Column card IDs must match the board's cards.")
        if any(card.id != card_id for card_id, card in self.cards.items()):
            raise ValueError("Each card ID must match its key in the cards map.")
        return self


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_database(get_database_path())
    yield


app = FastAPI(title="Project Management API", lifespan=lifespan)


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


def require_session_username(request: Request) -> str:
    return get_session_username(request)


def run_ai_probe(prompt: str) -> dict[str, str]:
    try:
        answer = get_ai_response(prompt)
    except AIConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except AIProviderError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    except Exception as error:  # pragma: no cover - provider-level runtime errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    return {"answer": answer, "model": os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)}


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello, world!"}


@app.get("/api/ai/test")
@app.get("/api/ai/connectivity-check")
@app.get("/api/ai/health")
def ai_connectivity_check_get(prompt: str = "2+2") -> dict[str, str]:
    return run_ai_probe(prompt)


@app.post("/api/ai/test")
@app.post("/api/ai/connectivity-check")
@app.post("/api/ai/health")
def ai_connectivity_check(payload: AIProbeRequest | None = None) -> dict[str, str]:
    prompt = payload.prompt if payload else "2+2"
    return run_ai_probe(prompt)


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


@app.get("/api/board", response_model=BoardData)
def read_board(request: Request) -> BoardData:
    username = require_session_username(request)
    board = get_board(username)
    if board is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Board not found",
        )
    return BoardData.model_validate(board)


@app.put("/api/board", response_model=BoardData)
def update_board(board: BoardData, request: Request) -> BoardData:
    username = require_session_username(request)
    try:
        save_board(username, board.model_dump(by_alias=True))
    except FixedColumnsError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except LookupError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    return board


app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
