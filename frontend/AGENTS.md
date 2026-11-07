# Frontend guide

## Existing app

- This is a Next.js App Router app using React and TypeScript. The home route is `src/app/page.tsx`; shared layout and global styles are in `src/app/layout.tsx` and `src/app/globals.css`.
- `src/components/AuthenticatedApp.tsx` checks the backend session and gates the board behind sign-in; it handles login and logout through FastAPI.
- `src/components/` also contains the Kanban board, columns, cards, preview, new-card form, and AI chat sidebar. `KanbanBoard` owns the current board state, drag-and-drop interactions, and persistence through the backend board API.
- `src/lib/kanban.ts` defines the board, column, and card types, card-move logic, ID creation, and due-date status (`getDueStatus`). `src/lib/useToday.ts` keeps today's local date current. `DueDateLabel` renders the due label and amber/red card styles (CSS variables in `globals.css`).
- `AIChatSidebar` sends questions and conversation history to the board-aware backend AI API and applies the saved `board_update` from the response; board edits are disabled while a request is pending. Test board data lives in `src/test/boardFixture.ts`.

## Conventions

- Keep UI components in `src/components/` and board data/types or reusable board logic in `src/lib/`.
- Use the existing `@/` TypeScript path alias, Tailwind utility classes, and CSS variables from `src/app/globals.css`.
- Preserve the existing five-column board behavior and color palette unless the task explicitly changes them.
- Add or update Vitest/React Testing Library tests for component and board-logic changes; add Playwright coverage for user-visible flows.

## Validation commands

Run from `frontend/`:

- `npm run lint`
- `npm run test:unit`
- `npm run test:e2e`
- `npm run build`

`npm run test:all` runs the unit and end-to-end suites together. The Playwright suite expects the Docker app to be running at port 8000, or `PLAYWRIGHT_BASE_URL` to point at another running app. Follow the project plan before changing the frontend build or backend integration.
