import clsx from "clsx";
import type { Card, DueStatus } from "@/lib/kanban";
import { DueDateLabel, dueStatusClasses } from "@/components/DueDateLabel";

type KanbanCardPreviewProps = {
  card: Card;
  dueStatus: DueStatus;
};

export const KanbanCardPreview = ({ card, dueStatus }: KanbanCardPreviewProps) => (
  <article
    className={clsx(
      "rounded-2xl border border-transparent px-4 py-4 shadow-[0_18px_32px_rgba(3,33,71,0.16)]",
      dueStatusClasses[dueStatus]
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
          {card.title}
        </h4>
        {card.details && (
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            {card.details}
          </p>
        )}
        {card.dueDate && <DueDateLabel dueDate={card.dueDate} status={dueStatus} />}
      </div>
    </div>
  </article>
);
