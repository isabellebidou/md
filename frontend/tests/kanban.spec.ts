import { expect, test, type Page } from "@playwright/test";

const signIn = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

test("loads the kanban board", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
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
  const dragInto = async (target: typeof targetColumn) => {
    const cardBox = await page.getByTestId(cardTestId).boundingBox();
    const columnBox = await target.boundingBox();
    if (!cardBox || !columnBox) {
      throw new Error("Unable to resolve drag coordinates.");
    }

    await page.mouse.move(
      cardBox.x + cardBox.width / 2,
      cardBox.y + cardBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      columnBox.x + columnBox.width / 2,
      columnBox.y + 120,
      { steps: 12 }
    );
    await page.mouse.up();
    await expect(target.getByTestId(cardTestId)).toBeVisible();
    await expect(page.getByText("All changes saved")).toBeVisible();
  };

  await dragInto(targetColumn);
  await dragInto(sourceColumn);
});

test("moves a card from In Progress to Discovery and Backlog", async ({ page }) => {
  await signIn(page);
  const originalBoard = await page.evaluate(async () => {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("Unable to read board for test cleanup.");
    return response.json();
  });
  const arrangedBoard = structuredClone(originalBoard);
  for (const column of arrangedBoard.columns) {
    column.cardIds = column.cardIds.filter((id: string) => id !== "card-4");
  }
  arrangedBoard.columns.find(
    (column: { id: string }) => column.id === "col-progress"
  )!.cardIds.push("card-4");

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

  try {
    const setupStatus = await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      return response.status;
    }, arrangedBoard);
    if (setupStatus !== 200) {
      throw new Error("Unable to arrange a card in In Progress.");
    }
    await page.reload();
    await expect(page.getByTestId("column-col-progress").getByTestId("card-card-4")).toBeVisible();
    await dragCardToColumn("card-4", "col-discovery");
    await dragCardToColumn("card-4", "col-backlog");
  } finally {
    await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      if (!response.ok) throw new Error("Unable to restore board after test.");
    }, originalBoard);
  }
});

test("persists card and column changes across reload", async ({ page }) => {
  await signIn(page);
  const originalBoard = await page.evaluate(async () => {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("Unable to read board for test cleanup.");
    return response.json();
  });

  try {
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
    const cardBox = await editedCard.boundingBox();
    const targetBox = await targetColumn.boundingBox();
    if (!cardBox || !targetBox) {
      throw new Error("Unable to resolve card movement coordinates.");
    }
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, { steps: 12 });
    await page.mouse.up();
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
  } finally {
    await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      if (!response.ok) throw new Error("Unable to restore board after test.");
    }, originalBoard);
  }
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
  const originalBoard = await page.evaluate(async () => {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("Unable to read board for test cleanup.");
    return response.json();
  });
  const updatedBoard = structuredClone(originalBoard);
  updatedBoard.cards["card-1"].title = "AI-updated roadmap";

  await page.route("**/api/ai/chat", async (route) => {
    const saveResponse = await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      return response.status;
    }, updatedBoard);
    if (saveResponse !== 200) {
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

  try {
    await page.getByLabel("Message the AI assistant").fill("Rename the roadmap card");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "AI-updated roadmap" })).toBeVisible();
    await expect(page.getByText("I renamed the roadmap card.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "AI-updated roadmap" })).toBeVisible();
  } finally {
    await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      if (!response.ok) throw new Error("Unable to restore board after test.");
    }, originalBoard);
  }
});

test("AI chat creates, edits, and moves cards in one request", async ({ page }) => {
  await signIn(page);
  const originalBoard = await page.evaluate(async () => {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("Unable to read board for test cleanup.");
    return response.json();
  });
  const updatedBoard = structuredClone(originalBoard);
  const newCardId = `ai-e2e-${Date.now()}`;
  updatedBoard.cards[newCardId] = {
    id: newCardId,
    title: "blue ring",
    details: "",
  };
  updatedBoard.columns[0].cardIds.push(newCardId);
  updatedBoard.cards["card-1"].title = "AI-edited roadmap";
  for (const column of updatedBoard.columns) {
    column.cardIds = column.cardIds.filter((id: string) => id !== "card-4");
  }
  updatedBoard.columns.find(
    (column: { id: string }) => column.id === "col-discovery"
  )!.cardIds.push("card-4");
  const roadmapColumn = originalBoard.columns.find(
    (column: { cardIds: string[] }) => column.cardIds.includes("card-1")
  );
  if (!roadmapColumn) {
    throw new Error("Unable to find the roadmap card.");
  }

  await page.route("**/api/ai/chat", async (route) => {
    const saveStatus = await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      return response.status;
    }, updatedBoard);
    if (saveStatus !== 200) {
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

  try {
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
  } finally {
    await page.evaluate(async (board) => {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      if (!response.ok) throw new Error("Unable to restore board after test.");
    }, originalBoard);
  }
});
