import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_COLUMNS = [
    ("col-backlog", "Backlog"),
    ("col-discovery", "Discovery"),
    ("col-progress", "In Progress"),
    ("col-review", "Review"),
    ("col-done", "Done"),
]

DEFAULT_CARDS = [
    (
        "card-1",
        "Align roadmap themes",
        "Draft quarterly themes with impact statements and metrics.",
        "col-backlog",
    ),
    (
        "card-2",
        "Gather customer signals",
        "Review support tags, sales notes, and churn feedback.",
        "col-backlog",
    ),
    (
        "card-3",
        "Prototype analytics view",
        "Sketch initial dashboard layout and key drill-downs.",
        "col-discovery",
    ),
    (
        "card-4",
        "Refine status language",
        "Standardize column labels and tone across the board.",
        "col-progress",
    ),
    (
        "card-5",
        "Design card layout",
        "Add hierarchy and spacing for scanning dense lists.",
        "col-progress",
    ),
    (
        "card-6",
        "QA micro-interactions",
        "Verify hover, focus, and loading states.",
        "col-review",
    ),
    (
        "card-7",
        "Ship marketing page",
        "Final copy approved and asset pack delivered.",
        "col-done",
    ),
    (
        "card-8",
        "Close onboarding sprint",
        "Document release notes and share internally.",
        "col-done",
    ),
]


class FixedColumnsError(ValueError):
    pass


def get_database_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", Path(__file__).parent / "kanban.sqlite3"))


def connect_database(database_path: Path | None = None) -> sqlite3.Connection:
    path = database_path or get_database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection(
    database_path: Path | None = None,
) -> Iterator[sqlite3.Connection]:
    connection = connect_database(database_path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(database_path: Path | None = None) -> None:
    with database_connection(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE TABLE IF NOT EXISTS boards (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS columns (
                board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                title TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (board_id, id),
                UNIQUE (board_id, position)
            );

            CREATE TABLE IF NOT EXISTS cards (
                board_id TEXT NOT NULL,
                id TEXT NOT NULL,
                column_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                title TEXT NOT NULL,
                details TEXT NOT NULL,
                due_date TEXT,
                PRIMARY KEY (board_id, id),
                UNIQUE (board_id, column_id, position),
                FOREIGN KEY (board_id, column_id)
                    REFERENCES columns(board_id, id) ON DELETE CASCADE
            );
            """
        )
        card_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(cards)")
        }
        if "due_date" not in card_columns:
            connection.execute("ALTER TABLE cards ADD COLUMN due_date TEXT")
        connection.execute(
            "INSERT OR IGNORE INTO users (id, username) VALUES ('user', 'user')"
        )
        user_row = connection.execute(
            "SELECT id FROM users WHERE username = 'user'"
        ).fetchone()
        if user_row is None:
            raise RuntimeError("The MVP user could not be initialized.")

        user_id = user_row["id"]
        board_row = connection.execute(
            "SELECT id FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()
        if board_row is None:
            board_id = "board-user"
            connection.execute(
                "INSERT INTO boards (id, user_id) VALUES (?, ?)", (board_id, user_id)
            )
            connection.executemany(
                """
                INSERT INTO columns (board_id, id, title, position)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (board_id, column_id, title, position)
                    for position, (column_id, title) in enumerate(DEFAULT_COLUMNS)
                ],
            )
            positions = {column_id: 0 for column_id, _ in DEFAULT_COLUMNS}
            for card_id, title, details, column_id in DEFAULT_CARDS:
                connection.execute(
                    """
                    INSERT INTO cards (board_id, id, column_id, position, title, details)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        board_id,
                        card_id,
                        column_id,
                        positions[column_id],
                        title,
                        details,
                    ),
                )
                positions[column_id] += 1


def get_board(username: str, database_path: Path | None = None) -> dict | None:
    with database_connection(database_path) as connection:
        row = connection.execute(
            """
            SELECT boards.id AS board_id, users.id AS user_id
            FROM boards
            JOIN users ON users.id = boards.user_id
            WHERE users.username = ?
            """,
            (username,),
        ).fetchone()
        if row is None:
            return None

        board_id = row["board_id"]
        columns = [
            {"id": column["id"], "title": column["title"], "cardIds": []}
            for column in connection.execute(
                """
                SELECT id, title FROM columns
                WHERE board_id = ? ORDER BY position
                """,
                (board_id,),
            )
        ]
        columns_by_id = {column["id"]: column for column in columns}
        cards = {}
        rows = connection.execute(
            """
            SELECT cards.id, cards.title, cards.details, cards.due_date, cards.column_id
            FROM cards
            JOIN columns
              ON columns.board_id = cards.board_id
             AND columns.id = cards.column_id
            WHERE cards.board_id = ?
            ORDER BY columns.position, cards.position
            """,
            (board_id,),
        )
        for card in rows:
            cards[card["id"]] = {
                "id": card["id"],
                "title": card["title"],
                "details": card["details"],
                "dueDate": card["due_date"],
            }
            columns_by_id[card["column_id"]]["cardIds"].append(card["id"])

        return {"columns": columns, "cards": cards}


def save_board(
    username: str,
    board: dict,
    database_path: Path | None = None,
) -> None:
    with database_connection(database_path) as connection:
        row = connection.execute(
            """
            SELECT boards.id AS board_id
            FROM boards
            JOIN users ON users.id = boards.user_id
            WHERE users.username = ?
            """,
            (username,),
        ).fetchone()
        if row is None:
            raise LookupError("The signed-in user does not have a board.")

        board_id = row["board_id"]
        stored_column_ids = [
            column["id"]
            for column in connection.execute(
                "SELECT id FROM columns WHERE board_id = ? ORDER BY position",
                (board_id,),
            )
        ]
        requested_column_ids = [column["id"] for column in board["columns"]]
        if requested_column_ids != stored_column_ids:
            raise FixedColumnsError("The board's fixed columns cannot be added, removed, or reordered.")

        connection.execute("DELETE FROM cards WHERE board_id = ?", (board_id,))
        for column_position, column in enumerate(board["columns"]):
            connection.execute(
                """
                UPDATE columns SET title = ?
                WHERE board_id = ? AND id = ? AND position = ?
                """,
                (column["title"], board_id, column["id"], column_position),
            )
            connection.executemany(
                """
                INSERT INTO cards
                    (board_id, id, column_id, position, title, details, due_date)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        board_id,
                        card_id,
                        column["id"],
                        position,
                        board["cards"][card_id]["title"],
                        board["cards"][card_id]["details"],
                        board["cards"][card_id].get("dueDate"),
                    )
                    for position, card_id in enumerate(column["cardIds"])
                ],
            )
