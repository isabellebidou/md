import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => void;
  onEdit: (cardId: string, title: string, details: string) => void;
};

export const KanbanCard = ({ card, onDelete, onEdit }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onEdit(card.id, title.trim(), details.trim());
    setIsEditing(false);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...attributes}
      {...listeners}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            aria-label="Card title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="w-full rounded-lg border border-[var(--stroke)] px-3 py-2 text-sm"
          />
          <textarea
            aria-label="Card details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[var(--stroke)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-[var(--secondary-purple)] px-3 py-2 text-xs font-semibold text-white"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(false);
              }}
              className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold text-[var(--gray-text)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details}
            </p>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="mt-3 rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold text-[var(--primary-blue)]"
              aria-label={`Edit ${card.title}`}
            >
              Edit
            </button>
          </div>
          <button
            type="button"
            onClick={() => onDelete(card.id)}
            className="rounded-lg p-2 text-red-600 transition hover:bg-red-50 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            aria-label={`Delete ${card.title}`}
            title={`Delete ${card.title}`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="m5 7 1 13h12l1-13" />
              <path d="M9 7V4h6v3" />
            </svg>
          </button>
        </div>
      )}
    </article>
  );
};
