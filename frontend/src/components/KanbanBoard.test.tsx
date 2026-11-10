import { act, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import { KanbanCard } from "@/components/KanbanCard";
import { boardFixture } from "@/test/boardFixture";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];
const renderBoard = () =>
  render(<KanbanBoard initialBoard={structuredClone(boardFixture)} />);

const editCardTitle = async (user: UserEvent, title: string) => {
  await user.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
  await user.clear(screen.getByRole("textbox", { name: "Card title" }));
  await user.type(screen.getByRole("textbox", { name: "Card title" }), title);
  await user.click(screen.getByRole("button", { name: "Save" }));
};

const sendChat = async (user: UserEvent, question: string) => {
  await user.type(screen.getByLabelText("Message the AI assistant"), question);
  await user.click(screen.getByRole("button", { name: "Send message" }));
};

const chatReply = (reply: string, board_update: unknown = null) => ({
  ok: true,
  status: 200,
  json: async () => ({ reply, board_update }),
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KanbanBoard", () => {
  it("renders five columns", () => {
    renderBoard();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column", async () => {
    renderBoard();
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  it("adds and removes a card", async () => {
    renderBoard();
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("edits a card", async () => {
    renderBoard();
    const user = userEvent.setup();
    await editCardTitle(user, "Updated title");

    expect(screen.getByText("Updated title")).toBeInTheDocument();
  });

  it("saves updated board data to the backend", async () => {
    renderBoard();
    const user = userEvent.setup();
    await editCardTitle(user, "Saved title");

    expect(await screen.findByText("All changes saved")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"title":"Saved title"'),
      })
    );
  });

  it("shows a visible error and offers a retry when saving fails", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    renderBoard();
    const user = userEvent.setup();
    await editCardTitle(user, "Unsaved title");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your changes could not be saved."
    );
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByText("All changes saved")).toBeVisible();
  });

  it("sends chat history and renders the assistant reply", async () => {
    fetchMock
      .mockResolvedValueOnce(chatReply("Your board has eight cards."))
      .mockResolvedValueOnce(chatReply("There are five columns."));
    renderBoard();
    const user = userEvent.setup();

    await sendChat(user, "Summarize my board");
    expect(await screen.findByText("Your board has eight cards.")).toBeVisible();

    await sendChat(user, "How many columns?");

    expect(await screen.findByText("There are five columns.")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          question: "How many columns?",
          conversation: [
            { role: "user", content: "Summarize my board" },
            { role: "assistant", content: "Your board has eight cards." },
          ],
        }),
      })
    );
  });

  it("applies the saved board when the AI returns a board update", async () => {
    const updatedBoard = structuredClone(boardFixture);
    updatedBoard.cards["card-1"].title = "AI-updated roadmap";
    fetchMock.mockResolvedValueOnce(chatReply("I updated the card.", updatedBoard));
    renderBoard();
    const user = userEvent.setup();

    await sendChat(user, "Rename the roadmap card");

    expect(await screen.findByText("AI-updated roadmap")).toBeVisible();
    expect(await screen.findByText("I updated the card.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("All changes saved")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a readable error when the AI error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    renderBoard();
    const user = userEvent.setup();

    await sendChat(user, "Hi");

    expect(await screen.findByRole("alert")).toHaveTextContent("AI request failed (500).");
  });

  it("reports an expired session from the chat API", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const onSessionExpired = vi.fn();
    render(
      <KanbanBoard
        initialBoard={structuredClone(boardFixture)}
        onSessionExpired={onSessionExpired}
      />
    );
    const user = userEvent.setup();

    await sendChat(user, "Hi");

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("reports an expired session from a board save", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const onSessionExpired = vi.fn();
    render(
      <KanbanBoard
        initialBoard={structuredClone(boardFixture)}
        onSessionExpired={onSessionExpired}
      />
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Delete Align roadmap themes" }));

    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stores empty details for a new card", async () => {
    renderBoard();
    const user = userEvent.setup();
    const column = getFirstColumn();
    await user.click(within(column).getByRole("button", { name: /add a card/i }));
    await user.type(within(column).getByPlaceholderText(/card title/i), "No details");
    await user.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await screen.findByText("All changes saved")).toBeVisible();
    const saved = JSON.parse(fetchMock.mock.calls[0][1].body);
    const card = Object.values(saved.cards).find(
      (item) => (item as { title: string }).title === "No details"
    );
    expect(card).toMatchObject({ details: "" });
  });

  it("picks up a card with the keyboard", async () => {
    renderBoard();
    const user = userEvent.setup();

    screen.getByTestId("card-card-1").focus();
    await user.keyboard("[Space]");

    expect(
      await screen.findByText(/^(Picked up|Draggable) (draggable )?item card-1/)
    ).toBeInTheDocument();
    await user.keyboard("[Escape]");
    expect(await screen.findByText(/Dragging was cancelled/)).toBeInTheDocument();
  });

  it("does not start a keyboard drag from the Edit button", async () => {
    renderBoard();
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Edit Align roadmap themes" });

    button.focus();
    await user.keyboard("[Enter]");

    expect(screen.getByRole("textbox", { name: "Card title" })).toHaveValue(
      "Align roadmap themes"
    );
  });

  it("shows an error when the AI request fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ detail: "AI returned an invalid board action." }),
    });
    renderBoard();
    const user = userEvent.setup();

    await sendChat(user, "Summarize my board");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AI returned an invalid board action."
    );
  });

  it("does not save an empty column title and restores the saved title", async () => {
    renderBoard();
    const user = userEvent.setup();
    const input = within(getFirstColumn()).getByLabelText("Column title");
    const original = (input as HTMLInputElement).value;

    await user.clear(input);
    await user.tab();

    expect(input).toHaveValue(original);
    expect(screen.getByText("All changes saved")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves a column rename once when the title is committed", async () => {
    renderBoard();
    const user = userEvent.setup();
    const input = within(getFirstColumn()).getByLabelText("Column title");

    await user.clear(input);
    await user.type(input, "Ideas{Enter}");

    expect(await screen.findByText("All changes saved")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({ body: expect.stringContaining('"title":"Ideas"') })
    );
  });

  it("blocks board edits while an AI request is pending", async () => {
    let resolveChat: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveChat = resolve;
      })
    );
    renderBoard();
    const user = userEvent.setup();

    await sendChat(user, "Summarize");

    expect(
      screen.getByText("The board is read-only while the assistant is working.")
    ).toBeVisible();
    expect(screen.getByTestId("board-columns")).toHaveAttribute("inert");
    await user.click(
      within(getFirstColumn()).getByRole("button", { name: /delete align roadmap themes/i })
    );
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();

    await act(async () => {
      resolveChat(chatReply("Done."));
    });
    expect(await screen.findByText("Done.")).toBeVisible();
    expect(screen.getByTestId("board-columns")).not.toHaveAttribute("inert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("KanbanCard", () => {
  it("shows the current card data when editing after a prop change", async () => {
    const card = { id: "card-x", title: "Old title", details: "Old details" };
    const { rerender } = render(
      <KanbanCard card={card} dueStatus="none" onDelete={vi.fn()} onEdit={vi.fn()} />
    );
    rerender(
      <KanbanCard
        card={{ ...card, title: "AI title", details: "AI details" }}
        dueStatus="none"
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit AI title" }));

    expect(screen.getByRole("textbox", { name: "Card title" })).toHaveValue("AI title");
    expect(screen.getByRole("textbox", { name: "Card details" })).toHaveValue("AI details");
  });
});

describe("KanbanBoard due dates", () => {
  const boardWithDue = (cardId: string, dueDate: string) => {
    const board = structuredClone(boardFixture);
    board.cards[cardId].dueDate = dueDate;
    return board;
  };
  const lastSavedBoard = () =>
    JSON.parse(fetchMock.mock.calls.at(-1)![1].body) as typeof boardFixture;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 10, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a card with a due date", async () => {
    renderBoard();
    const user = userEvent.setup();
    const column = getFirstColumn();
    await user.click(within(column).getByRole("button", { name: /add a card/i }));
    await user.type(within(column).getByPlaceholderText(/card title/i), "Workout");
    await user.type(within(column).getByLabelText("Due date (optional)"), "2026-11-11");
    await user.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await screen.findByText("All changes saved")).toBeVisible();
    const saved = Object.values(lastSavedBoard().cards).find(
      (card) => card.title === "Workout"
    );
    expect(saved?.dueDate).toBe("2026-11-11");
    expect(within(column).getByText(/Due 11 Nov - Due soon/)).toBeVisible();
  });

  it("creates a card without a due date", async () => {
    renderBoard();
    const user = userEvent.setup();
    const column = getFirstColumn();
    await user.click(within(column).getByRole("button", { name: /add a card/i }));
    await user.type(within(column).getByPlaceholderText(/card title/i), "Undated");
    await user.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await screen.findByText("All changes saved")).toBeVisible();
    const saved = Object.values(lastSavedBoard().cards).find(
      (card) => card.title === "Undated"
    );
    expect(saved?.dueDate).toBeNull();
  });

  it("adds, changes, and clears a due date through the editor", async () => {
    renderBoard();
    const user = userEvent.setup();
    const card = screen.getByTestId("card-card-1");
    const editDate = async (value: string) => {
      await user.click(within(card).getByRole("button", { name: /^Edit / }));
      const input = within(card).getByLabelText("Due date (optional)");
      await user.clear(input);
      if (value) {
        await user.type(input, value);
      }
      await user.click(within(card).getByRole("button", { name: "Save" }));
    };

    await editDate("2026-11-12");
    expect(card).toHaveAttribute("data-due-status", "soon");
    await editDate("2026-11-09");
    expect(card).toHaveAttribute("data-due-status", "overdue");
    expect(within(card).getByText("Due 9 Nov - Overdue")).toBeVisible();
    await editDate("2026-11-20");
    expect(card).toHaveAttribute("data-due-status", "none");
    expect(within(card).getByText("Due 20 Nov")).toBeVisible();
    await editDate("");
    expect(card).toHaveAttribute("data-due-status", "none");
    expect(within(card).queryByText(/Due /)).not.toBeInTheDocument();

    expect(await screen.findByText("All changes saved")).toBeVisible();
    expect(lastSavedBoard().cards["card-1"].dueDate).toBeNull();
  });

  it("shows status by column", () => {
    const board = structuredClone(boardFixture);
    board.cards["card-1"].dueDate = "2026-11-11";
    board.cards["card-6"].dueDate = "2026-11-11";
    board.cards["card-7"].dueDate = "2026-11-01";
    board.cards["card-2"].dueDate = "2026-11-20";
    render(<KanbanBoard initialBoard={board} />);

    expect(screen.getByTestId("card-card-1")).toHaveAttribute("data-due-status", "soon");
    expect(screen.getByTestId("card-card-6")).toHaveAttribute("data-due-status", "none");
    expect(screen.getByTestId("card-card-7")).toHaveAttribute("data-due-status", "none");
    expect(screen.getByTestId("card-card-2")).toHaveAttribute("data-due-status", "none");
    expect(screen.getByTestId("card-card-2")).toHaveTextContent("Due 20 Nov");
    expect(screen.getByTestId("card-card-3")).not.toHaveTextContent("Due");
  });

  it("turns red after midnight without a reload", async () => {
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 0));
    render(<KanbanBoard initialBoard={boardWithDue("card-1", "2026-11-10")} />);
    const card = screen.getByTestId("card-card-1");
    expect(card).toHaveAttribute("data-due-status", "soon");

    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    expect(card).toHaveAttribute("data-due-status", "overdue");
  });

  it("updates when the tab becomes visible after the clock jumps", async () => {
    render(<KanbanBoard initialBoard={boardWithDue("card-1", "2026-11-12")} />);
    const card = screen.getByTestId("card-card-1");
    expect(card).toHaveAttribute("data-due-status", "soon");

    vi.setSystemTime(new Date(2026, 10, 14, 8, 0));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(card).toHaveAttribute("data-due-status", "overdue");
  });

  it("clears the colour when the assistant postpones the date", async () => {
    const postponed = boardWithDue("card-1", "2026-11-30");
    fetchMock.mockResolvedValueOnce(chatReply("Postponed.", postponed));
    render(<KanbanBoard initialBoard={boardWithDue("card-1", "2026-11-01")} />);
    const user = userEvent.setup();
    expect(screen.getByTestId("card-card-1")).toHaveAttribute("data-due-status", "overdue");

    await sendChat(user, "Postpone");

    expect(await screen.findByText("Postponed.")).toBeVisible();
    expect(screen.getByTestId("card-card-1")).toHaveAttribute("data-due-status", "none");
    expect(screen.getByTestId("card-card-1")).toHaveTextContent("Due 30 Nov");
  });
});
