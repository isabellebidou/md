import clsx from "clsx";
import { formatDueDate, type DueStatus } from "@/lib/kanban";

export const dueStatusClasses: Record<DueStatus, string> = {
  none: "",
  soon: "border-l-4 border-l-[var(--due-soon)] bg-[var(--due-soon-tint)]",
  overdue: "border-l-4 border-l-[var(--due-overdue)] bg-[var(--due-overdue-tint)]",
};

const labelClasses: Record<DueStatus, string> = {
  none: "text-[var(--gray-text)]",
  soon: "text-[var(--due-soon-text)]",
  overdue: "text-[var(--due-overdue-text)]",
};

const statusText: Record<DueStatus, string> = {
  none: "",
  soon: " - Due soon",
  overdue: " - Overdue",
};

type DueDateLabelProps = {
  dueDate: string;
  status: DueStatus;
};

export const DueDateLabel = ({ dueDate, status }: DueDateLabelProps) => (
  <p
    className={clsx(
      "mt-2 text-xs font-semibold uppercase tracking-wide",
      labelClasses[status]
    )}
  >
    Due {formatDueDate(dueDate)}
    {statusText[status]}
  </p>
);
