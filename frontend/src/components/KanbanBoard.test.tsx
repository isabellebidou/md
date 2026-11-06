import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import { initialData } from "@/lib/kanban";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];
const renderBoard = () =>
  render(<KanbanBoard initialBoard={structuredClone(initialData)} />);

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
});
