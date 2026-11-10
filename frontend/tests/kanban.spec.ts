import { expect, test, type Locator, type Page } from "@playwright/test";

type Board = {
  columns: { id: string; title: string; cardIds: string[] }[];
  cards: Record<string, { id: string; title: string; details: string; dueDate?: string | null }>;
};

const signIn = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

const getBoard = (page: Page): Promise<Board> =>
  page.evaluate(async () => {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("Unable to read board for test cleanup.");
    return response.json();
  });

const putBoard = (page: Page, board: Board): Promise<number> =>
  page.evaluate(async (body) => {
    const response = await fetch("/api/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.status;
  }, board);

// Runs a test with a copy of the current board and restores the original afterwards.
const withRestoredBoard = async (page: Page, run: (board: Board) => Promise<void>) => {
  const originalBoard = await getBoard(page);
  try {
    await run(structuredClone(originalBoard));
  } finally {
    if ((await putBoard(page, originalBoard)) !== 200) {
      throw new Error("Unable to restore board after test.");
    }
  }
};

const dragTo = async (page: Page, card: Locator, target: Locator) => {
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, { steps: 12 });
  await page.mouse.up();
};

const localDate = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

test("loads the kanban board", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await firstColumn
    .locator("article")
    .filter({ hasText: "Playwright card" })
    .getByRole("button", { name: "Delete Playwright card" })
    .click();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await signIn(page);
  const columns = page.locator('[data-testid^="column-"]');
  const columnCount = await columns.count();
  let sourceColumn = columns.first();
  let targetColumn = columns.nth(1);
  let sourceFound = false;
  for (let index = 0; index < columnCount; index += 1) {
    const candidate = columns.nth(index);
    if ((await candidate.locator("article").count()) > 0) {
      sourceColumn = candidate;
      targetColumn = columns.nth((index + 1) % columnCount);
      sourceFound = true;
      break;
    }
  }
  if (!sourceFound) {
    throw new Error("Unable to find a card to move.");
  }

  const card = sourceColumn.locator("article").first();
  const cardTestId = await card.getAttribute("data-testid");
  if (!cardTestId) {
    throw new Error("Unable to resolve card test id.");
  }
  const dragInto = async (target: Locator) => {
    await dragTo(page, page.getByTestId(cardTestId), target);
    await expect(target.getByTestId(cardTestId)).toBeVisible();
    await expect(page.getByText("All changes saved")).toBeVisible();
  };

  await dragInto(targetColumn);
  await dragInto(sourceColumn);
});

test("moves a card from In Progress to Discovery and Backlog", async ({ page }) => {
  await signIn(page);
  const dragCardToColumn = async (cardId: string, columnId: string) => {
    const card = page.getByTestId(`card-${cardId}`);
    const target = page.getByTestId(`column-${columnId}`);
    await card.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const cardBox = await card.boundingBox();
    const targetBox = await target.boundingBox();
    if (!cardBox || !targetBox) {
      throw new Error("Unable to resolve drag coordinates.");
    }
    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error("Unable to resolve viewport dimensions.");
    }
    const targetVisibleTop = Math.max(0, targetBox.y);
    const targetVisibleBottom = Math.min(
      viewport.height,
      targetBox.y + targetBox.height
    );
    if (targetVisibleTop >= targetVisibleBottom) {
      throw new Error("Destination column is outside the viewport.");
    }
    const dropY = (targetVisibleTop + targetVisibleBottom) / 2;

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      dropY,
      { steps: 20 }
    );
    await page.mouse.up();
    await expect(target.getByTestId(`card-${cardId}`)).toBeVisible();
    await expect(page.getByText("All changes saved")).toBeVisible();
  };

  await withRestoredBoard(page, async (board) => {
    for (const column of board.columns) {
      column.cardIds = column.cardIds.filter((id) => id !== "card-4");
    }
    board.columns.find((column) => column.id === "col-progress")!.cardIds.push("card-4");
    if ((await putBoard(page, board)) !== 200) {
      throw new Error("Unable to arrange a card in In Progress.");
    }
    await page.reload();
    await expect(page.getByTestId("column-col-progress").getByTestId("card-card-4")).toBeVisible();
    await dragCardToColumn("card-4", "col-discovery");
    await dragCardToColumn("card-4", "col-backlog");
  });
});

test("persists card and column changes across reload", async ({ page }) => {
  await signIn(page);
  await withRestoredBoard(page, async (originalBoard) => {
    const sourceColumn = page.getByTestId(
      `column-${originalBoard.columns[0].id}`
    );
    const targetColumn = page.getByTestId(
      `column-${originalBoard.columns[4].id}`
    );
    const updatedColumnTitle = `Persistence ${Date.now()}`;
    const newCardTitle = `Temporary card ${Date.now()}`;
    const editedCardTitle = `Edited ${newCardTitle}`;

    await sourceColumn
      .getByRole("textbox", { name: "Column title" })
      .fill(updatedColumnTitle);
    await sourceColumn.getByRole("button", { name: /add a card/i }).click();
    await sourceColumn.getByPlaceholder("Card title").fill(newCardTitle);
    await sourceColumn.getByPlaceholder("Details").fill("Temporary details");
    await sourceColumn.getByRole("button", { name: /add card/i }).click();

    await sourceColumn
      .locator("article")
      .filter({ hasText: newCardTitle })
      .getByRole("button", { name: `Edit ${newCardTitle}` })
      .click();
    await sourceColumn.getByRole("textbox", { name: "Card title" }).fill(editedCardTitle);
    await sourceColumn
      .getByRole("textbox", { name: "Card details" })
      .fill("Edited details");
    await sourceColumn
      .locator('article:has(input[aria-label="Card title"]) button[type="submit"]')
      .click();
    await expect(sourceColumn.getByRole("heading", { name: editedCardTitle })).toBeVisible();

    const editedCard = sourceColumn.locator("article").filter({
      has: page.getByRole("heading", { name: editedCardTitle }),
    });
    await dragTo(page, editedCard, targetColumn);
    await expect(targetColumn.getByText(editedCardTitle)).toBeVisible();
    await expect(page.getByText("All changes saved")).toBeVisible();

    await page.reload();
    await expect(
      page
        .getByTestId(`column-${originalBoard.columns[0].id}`)
        .getByRole("textbox", { name: "Column title" })
    ).toHaveValue(updatedColumnTitle);
    await expect(
      page
        .getByTestId(`column-${originalBoard.columns[4].id}`)
        .getByText(editedCardTitle)
    ).toBeVisible();
    await targetColumn
      .locator("article")
      .filter({ hasText: editedCardTitle })
      .locator(`button[aria-label="Delete ${editedCardTitle}"]`)
      .click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByTestId(`column-${originalBoard.columns[4].id}`)
        .getByText(editedCardTitle)
    ).toHaveCount(0);
  });
});

test("rejects incorrect credentials", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "Invalid username or password."
  );
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(0);
});

test("keeps the session after reload and logs out", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("AI chat displays a reply when the board is unchanged", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Your board has five columns.",
        board_update: null,
      }),
    });
  });

  await page.getByLabel("Message the AI assistant").fill("Summarize my board");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Your board has five columns.")).toBeVisible();
});

test("AI chat refreshes and persists a board update", async ({ page }) => {
  await signIn(page);
  await withRestoredBoard(page, async (updatedBoard) => {
    updatedBoard.cards["card-1"].title = "AI-updated roadmap";
    await page.route("**/api/ai/chat", async (route) => {
      if ((await putBoard(page, updatedBoard)) !== 200) {
        await route.fulfill({ status: 500, body: "Unable to save the mock AI update." });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "I renamed the roadmap card.",
          board_update: updatedBoard,
        }),
      });
    });

    await page.getByLabel("Message the AI assistant").fill("Rename the roadmap card");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "AI-updated roadmap" })).toBeVisible();
    await expect(page.getByText("I renamed the roadmap card.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "AI-updated roadmap" })).toBeVisible();
  });
});

test("AI chat creates, edits, and moves cards in one request", async ({ page }) => {
  await signIn(page);
  await withRestoredBoard(page, async (updatedBoard) => {
    const roadmapColumn = updatedBoard.columns.find((column) =>
      column.cardIds.includes("card-1")
    );
    if (!roadmapColumn) {
      throw new Error("Unable to find the roadmap card.");
    }
    const newCardId = `ai-e2e-${Date.now()}`;
    updatedBoard.cards[newCardId] = { id: newCardId, title: "blue ring", details: "" };
    updatedBoard.columns[0].cardIds.push(newCardId);
    updatedBoard.cards["card-1"].title = "AI-edited roadmap";
    for (const column of updatedBoard.columns) {
      column.cardIds = column.cardIds.filter((id) => id !== "card-4");
    }
    updatedBoard.columns.find((column) => column.id === "col-discovery")!.cardIds.push("card-4");

    await page.route("**/api/ai/chat", async (route) => {
      if ((await putBoard(page, updatedBoard)) !== 200) {
        await route.fulfill({ status: 500, body: "Unable to save the mock AI update." });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "Created blue ring, edited the roadmap card, and moved a card.",
          board_update: updatedBoard,
        }),
      });
    });

    await page
      .getByLabel("Message the AI assistant")
      .fill('Create "blue ring" in Backlog, edit the roadmap, and move card-4 to Discovery.');
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByTestId("column-col-backlog").getByText("blue ring")
    ).toBeVisible();
    await expect(
      page
        .getByTestId(`column-${roadmapColumn.id}`)
        .getByRole("heading", { name: "AI-edited roadmap" })
    ).toBeVisible();
    await expect(
      page.getByTestId("column-col-discovery").getByTestId("card-card-4")
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByTestId("column-col-backlog").getByText("blue ring")
    ).toBeVisible();
    await expect(
      page.getByTestId("column-col-discovery").getByTestId("card-card-4")
    ).toBeVisible();
  });
});

test("moves a card with the keyboard", async ({ page }) => {
  await signIn(page);
  await withRestoredBoard(page, async (originalBoard) => {
    const sourceIndex = originalBoard.columns.findIndex(
      (column, index) => index < 4 && column.cardIds.length > 0
    );
    const cardId = originalBoard.columns[sourceIndex].cardIds[0];
    const sourceColumn = page.getByTestId(
      `column-${originalBoard.columns[sourceIndex].id}`
    );

    const announcement = page.locator('[id^="DndLiveRegion"]');
    await page.getByTestId(`card-${cardId}`).focus();
    await page.keyboard.press("Space");
    await expect(announcement).toHaveText(
      `Draggable item ${cardId} was moved over droppable area ${cardId}.`
    );
    // dnd-kit attaches its keydown listener in a setTimeout after pickup.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await page.keyboard.press("ArrowRight");
    await expect(announcement).not.toHaveText(new RegExp(`area ${cardId}\\.$`));
    await page.keyboard.press("Space");
    await expect(sourceColumn.getByTestId(`card-${cardId}`)).toHaveCount(0);
    await expect(page.getByText("All changes saved")).toBeVisible();
    const savedBoard = await getBoard(page);
    const savedIndex = savedBoard.columns.findIndex((column) =>
      column.cardIds.includes(cardId)
    );
    expect(savedIndex).toBeGreaterThan(sourceIndex);
  });
});

test("creates a card with a due date that persists", async ({ page }) => {
  await signIn(page);
  await withRestoredBoard(page, async () => {
    const column = page.getByTestId("column-col-backlog");
    const title = `Dated card ${Date.now()}`;
    await column.getByRole("button", { name: /add a card/i }).click();
    await column.getByPlaceholder("Card title").fill(title);
    await column.getByLabel("Due date (optional)").fill(localDate(2));
    await column.getByRole("button", { name: /add card/i }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();

    await page.reload();
    const card = page.locator("article").filter({ hasText: title });
    await expect(card).toHaveAttribute("data-due-status", "soon");
    await expect(card).toContainText("Due soon");
    const styles = await card.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.backgroundColor, style.borderLeftColor];
    });
    expect(styles).toEqual(["rgb(254, 243, 199)", "rgb(217, 119, 6)"]);
  });
});

test("overdue cards lose their colour when done or postponed", async ({ page }) => {
  await signIn(page);
  await withRestoredBoard(page, async (board) => {
    const backlog = board.columns.find((column) => column.id === "col-backlog")!;
    const stamp = Date.now();
    const firstId = `e2e-overdue-${stamp}-a`;
    const secondId = `e2e-overdue-${stamp}-b`;
    for (const id of [firstId, secondId]) {
      board.cards[id] = { id, title: `E2E ${id}`, details: "", dueDate: localDate(-1) };
    }
    backlog.cardIds.unshift(firstId, secondId);
    if ((await putBoard(page, board)) !== 200) {
      throw new Error("Unable to set up board.");
    }
    await page.reload();

    const first = page.getByTestId(`card-${firstId}`);
    const second = page.getByTestId(`card-${secondId}`);
    await expect(first).toHaveAttribute("data-due-status", "overdue");
    await expect(first).toContainText("Overdue");
    const styles = await first.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.backgroundColor, style.borderLeftColor];
    });
    expect(styles).toEqual(["rgb(254, 242, 242)", "rgb(220, 38, 38)"]);

    const doneColumn = page.getByTestId("column-col-done");
    await dragTo(page, first, doneColumn);
    await expect(doneColumn.getByTestId(`card-${firstId}`)).toHaveAttribute(
      "data-due-status",
      "none"
    );
    // dnd-kit swallows clicks for 50ms after a drop; the debounced save takes longer.
    await expect(page.getByText("All changes saved")).toBeVisible();

    await second.getByRole("button", { name: /^Edit / }).click();
    await second.getByLabel("Due date (optional)").fill(localDate(10));
    await second.getByRole("button", { name: "Save" }).click();
    await expect(second).toHaveAttribute("data-due-status", "none");
    await expect(page.getByText("All changes saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`card-${secondId}`)).toHaveAttribute(
      "data-due-status",
      "none"
    );
  });
});
