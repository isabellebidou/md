"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import clsx from "clsx";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { createId, getDueStatus, moveCard, type BoardData } from "@/lib/kanban";
import { useToday } from "@/lib/useToday";

type KanbanBoardProps = {
  initialBoard: BoardData;
  onLogout?: () => void;
  onSessionExpired?: () => void;
};

export const KanbanBoard = ({
  initialBoard,
  onLogout,
  onSessionExpired = () => {},
}: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData>(() => initialBoard);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [isAIPending, setIsAIPending] = useState(false);
  const today = useToday();
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const boardVersion = useRef(0);
  const persistedSnapshot = useRef(JSON.stringify(initialBoard));
  const handleSaveUnauthorized = useEffectEvent(() => onSessionExpired());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0
      ? pointerCollisions
      : closestCorners(args);
  };

  const updateBoard = (nextBoard: BoardData) => {
    if (isAIPending) {
      return;
    }
    boardVersion.current += 1;
    setBoard(nextBoard);
    setSaveError("");
    setSaveStatus("pending");
    setRetryCount(0);
  };

  useEffect(() => {
    const snapshot = JSON.stringify(board);
    if (snapshot === persistedSnapshot.current && retryCount === 0) {
      return;
    }

    const version = boardVersion.current;
    const timeout = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (version !== boardVersion.current) {
          return;
        }

        setSaveStatus("saving");
        try {
          const response = await fetch("/api/board", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: snapshot,
          });
          if (response.status === 401) {
            handleSaveUnauthorized();
            return;
          }
          if (!response.ok) {
            throw new Error(`Board save failed (${response.status}).`);
          }
          persistedSnapshot.current = snapshot;
          if (version === boardVersion.current) {
            setSaveStatus("saved");
            setSaveError("");
          }
        } catch {
          if (version === boardVersion.current) {
            setSaveStatus("error");
            setSaveError("Your changes could not be saved.");
          }
        }
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [board, retryCount]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    updateBoard({
      ...board,
      columns: moveCard(board.columns, active.id as string, over.id as string),
    });
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    updateBoard({
      ...board,
      columns: board.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    });
  };

  const handleAddCard = (
    columnId: string,
    title: string,
    details: string,
    dueDate: string | null
  ) => {
    const id = createId("card");
    updateBoard({
      ...board,
      cards: {
        ...board.cards,
        [id]: { id, title, details, dueDate },
      },
      columns: board.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    });
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    updateBoard({
      ...board,
      cards: Object.fromEntries(
        Object.entries(board.cards).filter(([id]) => id !== cardId)
      ),
      columns: board.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              cardIds: column.cardIds.filter((id) => id !== cardId),
            }
          : column
      ),
    });
  };

  const handleEditCard = (
    cardId: string,
    title: string,
    details: string,
    dueDate: string | null
  ) => {
    updateBoard({
      ...board,
      cards: {
        ...board.cards,
        [cardId]: { ...board.cards[cardId], title, details, dueDate },
      },
    });
  };

  const applySavedBoard = (savedBoard: BoardData) => {
    boardVersion.current += 1;
    persistedSnapshot.current = JSON.stringify(savedBoard);
    setBoard(savedBoard);
    setSaveError("");
    setSaveStatus("saved");
    setRetryCount(0);
  };

  const activeCard = activeCardId ? board.cards[activeCardId] : null;
  const activeColumnId = board.columns.find((column) =>
    column.cardIds.includes(activeCardId ?? "")
  )?.id;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="rounded-full border border-[var(--stroke)] px-5 py-3 text-sm font-semibold text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)]"
              >
                Log out
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <p role={saveStatus === "error" ? "alert" : "status"} className={saveStatus === "error" ? "text-red-700" : "text-[var(--gray-text)]"}>
              {saveStatus === "error"
                ? saveError
                : saveStatus === "saving"
                  ? "Saving changes..."
                  : saveStatus === "pending"
                    ? "Unsaved changes"
                    : "All changes saved"}
            </p>
            {saveStatus === "error" && (
              <button
                type="button"
                onClick={() => setRetryCount((count) => count + 1)}
                className="font-semibold text-[var(--primary-blue)] underline"
              >
                Retry save
              </button>
            )}
            {isAIPending && (
              <p className="text-[var(--gray-text)]">
                The board is read-only while the assistant is working.
              </p>
            )}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid min-w-0 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <div
              className={clsx(
                "min-w-0 overflow-x-auto pb-2",
                isAIPending && "opacity-60"
              )}
              inert={isAIPending}
              aria-busy={isAIPending}
              data-testid="board-columns"
            >
              <section className="grid min-w-[1050px] grid-cols-5 gap-6">
                {board.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    cards={column.cardIds.map((cardId) => board.cards[cardId])}
                    today={today}
                    onRename={handleRenameColumn}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                    onEditCard={handleEditCard}
                  />
                ))}
              </section>
            </div>
            <AIChatSidebar
              canSend={saveStatus === "saved"}
              onBoardUpdated={applySavedBoard}
              onPendingChange={setIsAIPending}
              onSessionExpired={onSessionExpired}
            />
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview
                  card={activeCard}
                  dueStatus={getDueStatus(activeCard.dueDate, activeColumnId ?? "", today)}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
};
