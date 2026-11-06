import hashlib
import hmac
import json
import os
import secrets
from copy import deepcopy
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

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


class AIChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1)


class AIChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    conversation: list[AIChatMessage] = Field(default_factory=list)


class AIBoardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str = Field(min_length=1)
    board_update: dict[str, Any] | None = None


class BoardAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(pattern="^(create_card|edit_card|move_card)$")
    card_id: str | None = None
    title: str | None = None
    details: str | None = None
    column: str | None = None

    @model_validator(mode="after")
    def validate_action_fields(self) -> "BoardAction":
        if self.action == "create_card":
            if not self.title or not self.title.strip() or not self.column:
                raise ValueError("create_card requires a title and destination column.")
            if self.card_id is not None:
                raise ValueError("create_card must not specify a card_id.")
        elif self.action == "edit_card":
            if not self.card_id or (self.title is None and self.details is None):
                raise ValueError("edit_card requires card_id and a title or details.")
            if self.column is not None:
                raise ValueError("edit_card cannot specify a destination column.")
        elif self.action == "move_card":
            if not self.card_id or not self.column:
                raise ValueError("move_card requires card_id and destination column.")
            if self.title is not None or self.details is not None:
                raise ValueError("move_card cannot change card content.")
        return self


class AIModelResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str = Field(min_length=1)
    actions: list[BoardAction] = Field(default_factory=list)


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


def build_board_chat_prompt(
    question: str, board: dict[str, Any], conversation: list[AIChatMessage]
) -> str:
    history = "\n".join(
        f"{message.role}: {message.content}"
        for message in conversation[-6:]
    )
    return (
        "You are a project board assistant. Respond with one JSON object only, with "
        "a non-empty 'reply' string and an 'actions' array (use [] when no board "
        "change is needed). Never return a full board snapshot. Use only these "
        "action shapes:\n"
        '{"action":"create_card","title":"...","details":"...","column":"column ID or exact current column title"}\n'
        '{"action":"edit_card","card_id":"existing card ID","title":"new title","details":"new details"}\n'
        '{"action":"move_card","card_id":"existing card ID","column":"column ID or exact current column title"}\n'
        "For edit_card, include only fields that should change; title and details "
        "are optional but at least one is required. Each action is applied to the "
        "current board in order. Never invent card or column IDs. Resolve natural "
        "language column names using the board below. You may include multiple "
        "actions in one response.\n"
        f"User question: {question}\n"
        f"Recent conversation:\n{history or 'No previous messages.'}\n"
        f"Board JSON:\n{json.dumps(board, sort_keys=True)}\n"
    )


def parse_board_chat_response(raw_response: str) -> dict[str, Any]:
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if "\n" in cleaned:
            lines = cleaned.splitlines()
            if lines and lines[0].lower() == "json":
                lines = lines[1:]
            cleaned = "\n".join(lines)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise ValueError(f"AI response is not valid JSON: {error}") from error
    try:
        response = AIModelResponse.model_validate(payload)
    except ValueError as error:
        raise ValueError(f"AI response has an invalid structure: {error}") from error
    if not response.reply.strip():
        raise ValueError("AI response reply cannot be empty.")
    return {
        "reply": response.reply.strip(),
        "actions": response.actions,
    }


def apply_board_actions(
    board: dict[str, Any], actions: list[BoardAction]
) -> dict[str, Any]:
    updated_board = deepcopy(board)

    def find_column(locator: str) -> dict[str, Any]:
        exact_id = next(
            (column for column in updated_board["columns"] if column["id"] == locator),
            None,
        )
        if exact_id is not None:
            return exact_id
        matching_columns = [
            column
            for column in updated_board["columns"]
            if column["title"].strip().casefold() == locator.strip().casefold()
        ]
        if len(matching_columns) != 1:
            raise ValueError(f"Destination column '{locator}' was not found uniquely.")
        return matching_columns[0]

    for action in actions:
        if action.action == "create_card":
            destination = find_column(action.column or "")
            card_id = f"ai-card-{secrets.token_hex(8)}"
            updated_board["cards"][card_id] = {
                "id": card_id,
                "title": action.title.strip() if action.title else "",
                "details": action.details or "",
            }
            destination["cardIds"].append(card_id)
        elif action.action == "edit_card":
            card = updated_board["cards"].get(action.card_id or "")
            if card is None:
                raise ValueError(f"Card '{action.card_id}' was not found.")
            if action.title is not None:
                card["title"] = action.title.strip()
            if action.details is not None:
                card["details"] = action.details
        else:
            card_id = action.card_id or ""
            if card_id not in updated_board["cards"]:
                raise ValueError(f"Card '{card_id}' was not found.")
            destination = find_column(action.column or "")
            for column in updated_board["columns"]:
                if card_id in column["cardIds"]:
                    column["cardIds"].remove(card_id)
                    break
            destination["cardIds"].append(card_id)

    if actions:
        BoardData.model_validate(updated_board)
    return updated_board


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


def run_board_chat(
    username: str, question: str, conversation: list[AIChatMessage]
) -> AIBoardResponse:
    board = get_board(username)
    if board is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Board not found",
        )

    prompt = build_board_chat_prompt(question, board, conversation)
    try:
        raw_response = get_ai_response(prompt)
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

    try:
        parsed = parse_board_chat_response(raw_response)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error

    try:
        updated_board = apply_board_actions(board, parsed["actions"])
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI returned an invalid board action: {error}",
        ) from error

    if parsed["actions"]:
        validated_update = BoardData.model_validate(updated_board)
        try:
            save_board(username, validated_update.model_dump(by_alias=True))
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
        return AIBoardResponse(
            reply=parsed["reply"],
            board_update=validated_update.model_dump(by_alias=True),
        )

    return AIBoardResponse(reply=parsed["reply"], board_update=None)


@app.post("/api/ai/chat", response_model=AIBoardResponse)
def ai_chat(payload: AIChatRequest, request: Request) -> AIBoardResponse:
    username = require_session_username(request)
    return run_board_chat(username, payload.question, payload.conversation)


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
