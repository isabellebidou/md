import { describe, expect, it } from "vitest";
import { formatDueDate, getDueStatus, moveCard, toLocalDateString, type Column } from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });
});

describe("getDueStatus", () => {
  const today = "2026-11-10";
  const cases: [string | null, string, string][] = [
    // dueDate, column, expected
    [null, "col-backlog", "none"],
    ["2026-11-13", "col-backlog", "none"],
    ["2026-11-12", "col-backlog", "soon"],
    ["2026-11-11", "col-discovery", "soon"],
    ["2026-11-10", "col-progress", "soon"],
    ["2026-11-09", "col-progress", "overdue"],
    [null, "col-review", "none"],
    ["2026-11-13", "col-review", "none"],
    ["2026-11-12", "col-review", "none"],
    ["2026-11-11", "col-review", "none"],
    ["2026-11-10", "col-review", "none"],
    ["2026-11-09", "col-review", "overdue"],
    [null, "col-done", "none"],
    ["2026-11-12", "col-done", "none"],
    ["2026-11-10", "col-done", "none"],
    ["2026-11-09", "col-done", "none"],
  ];

  it.each(cases)("due %s in %s is %s", (dueDate, columnId, expected) => {
    expect(getDueStatus(dueDate, columnId, today)).toBe(expected);
  });

  it("handles month and year boundaries", () => {
    expect(getDueStatus("2026-12-01", "col-backlog", "2026-11-29")).toBe("soon");
    expect(getDueStatus("2026-12-02", "col-backlog", "2026-11-29")).toBe("none");
    expect(getDueStatus("2027-01-01", "col-backlog", "2026-12-30")).toBe("soon");
    expect(getDueStatus("2026-12-31", "col-backlog", "2027-01-01")).toBe("overdue");
    expect(getDueStatus("2028-03-01", "col-backlog", "2028-02-28")).toBe("soon");
  });

  it("formats dates and local days", () => {
    expect(formatDueDate("2026-11-12")).toBe("12 Nov");
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
