# SQLite data model proposal

The database stores users, one board per user, five fixed columns per board, and ordered cards. SQLite is the local source of truth; the JSON representation is described by [kanban.schema.json](./kanban.schema.json).

## Tables and constraints

- `users`: `id` text primary key, `username` text not null unique, and `created_at` text not null. The MVP's `user` / `password` credentials remain hardcoded in the authentication code; do not store the demo password. Future real accounts should store a password hash, never a plaintext password.
- `boards`: `id` text primary key, `user_id` text not null unique referencing `users(id)` with delete cascade. `UNIQUE(user_id)` enforces one board per user.
- `columns`: composite primary key `(board_id, id)`, `board_id` text not null referencing `boards(id)` with delete cascade, `title` text not null, and `position` integer not null. `UNIQUE(board_id, position)` preserves column order. The MVP creates five columns; their IDs and count stay fixed while titles can change.
- `cards`: composite primary key `(board_id, id)`, `board_id` and `column_id` text not null, `title` and `details` text not null, `due_date` nullable text (`YYYY-MM-DD`), and `position` integer not null. `(board_id, column_id)` references `(board_id, id)` in `columns`, preventing cards from pointing at another board's column. `UNIQUE(board_id, column_id, position)` preserves card order within a column. Deleting a board cascades to its columns and cards.

`due_date` was added after the initial schema; `initialize_database` adds the column with `ALTER TABLE` to databases created before it, leaving existing cards undated.

Enable SQLite foreign-key enforcement on every connection. Create tables and seed the MVP user's initial board and five columns in a transaction when needed. Use transactions when updating a board so a failed update cannot leave its columns and cards partially saved.

## JSON/API representation

The JSON Schema is a versioned export envelope with a `users` array. Each user has one `board`, each board contains five ordered columns and a card map keyed by card ID, and each column stores its ordered `cardIds`. This keeps the current frontend representation intact.

JSON Schema checks the document structure. The API must additionally verify that user IDs and usernames are unique, column IDs are unique, every `cardIds` reference exists exactly once in the board's card map, and each card is assigned to one column. SQLite constraints remain authoritative for ownership, uniqueness, and referential integrity.

## Approval gate

This is a proposal for the MVP and has not been implemented. Please review the table constraints, fixed five-column rule, and data ownership model before Part 6. Part 6 should begin only after approval.
