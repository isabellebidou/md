import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import { KanbanCard } from "@/components/KanbanCard";
import { boardFixture } from "@/test/boardFixture";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];
const renderBoard = () =>
  render(<KanbanBoard initialBoard={structuredClone(boardFixture)} />);

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
    await user.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    await user.clear(screen.getByRole("textbox", { name: "Card title" }));
    await user.type(screen.getByRole("textbox", { name: "Card title" }), "Updated title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Updated title")).toBeInTheDocument();
  });

  it("saves updated board data to the backend", async () => {
    renderBoard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    await user.clear(screen.getByRole("textbox", { name: "Card title" }));
    await user.type(screen.getByRole("textbox", { name: "Card title" }), "Saved title");
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    await user.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    await user.clear(screen.getByRole("textbox", { name: "Card title" }));
    await user.type(screen.getByRole("textbox", { name: "Card title" }), "Unsaved title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your changes could not be saved."
    );
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByText("All changes saved")).toBeVisible();
  });

  it("sends chat history and renders the assistant reply", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ reply: "Your board has eight cards.", board_update: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ reply: "There are five columns.", board_update: null }),
      });
    renderBoard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Message the AI assistant"), "Summarize my board");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Your board has eight cards.")).toBeVisible();

    await user.type(screen.getByLabelText("Message the AI assistant"), "How many columns?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

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
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ reply: "I updated the card.", board_update: updatedBoard }),
      });
    renderBoard();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Message the AI assistant"),
      "Rename the roadmap card"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

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

    await user.type(screen.getByLabelText("Message the AI assistant"), "Hi");
    await user.click(screen.getByRole("button", { name: "Send message" }));

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

    await user.type(screen.getByLabelText("Message the AI assistant"), "Hi");
    await user.click(screen.getByRole("button", { name: "Send message" }));

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

    await user.type(
      screen.getByLabelText("Message the AI assistant"),
      "Summarize my board"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

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

    await user.type(screen.getByLabelText("Message the AI assistant"), "Summarize");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      screen.getByText("The board is read-only while the assistant is working.")
    ).toBeVisible();
    expect(screen.getByTestId("board-columns")).toHaveAttribute("inert");
    await user.click(
      within(getFirstColumn()).getByRole("button", { name: /delete align roadmap themes/i })
    );
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();

    await act(async () => {
      resolveChat({
        ok: true,
        status: 200,
        json: async () => ({ reply: "Done.", board_update: null }),
      });
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
      <KanbanCard card={card} onDelete={vi.fn()} onEdit={vi.fn()} />
    );
    rerender(
      <KanbanCard
        card={{ ...card, title: "AI title", details: "AI details" }}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit AI title" }));

    expect(screen.getByRole("textbox", { name: "Card title" })).toHaveValue("AI title");
    expect(screen.getByRole("textbox", { name: "Card details" })).toHaveValue("AI details");
  });
});
