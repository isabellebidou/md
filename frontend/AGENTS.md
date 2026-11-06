# Frontend guide

## Existing app

- This is a Next.js App Router app using React and TypeScript. The home route is `src/app/page.tsx`; shared layout and global styles are in `src/app/layout.tsx` and `src/app/globals.css`.
- `src/components/` contains the Kanban board, columns, cards, preview, and new-card form. `KanbanBoard` currently owns in-memory board state and drag-and-drop behavior.
- `src/lib/kanban.ts` defines the board, column, and card types, sample board data, card-move logic, and ID creation.
- The current demo is frontend-only: it has no sign-in, API persistence, or AI chat yet.

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

`npm run test:all` runs the unit and end-to-end suites together. Follow the project plan before changing the frontend build or connecting it to the backend.
