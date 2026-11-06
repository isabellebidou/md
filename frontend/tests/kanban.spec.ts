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
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const card = firstColumn.locator("article").first();
  const cardTestId = await card.getAttribute("data-testid");
  if (!cardTestId) {
    throw new Error("Unable to resolve card test id.");
  }
  const targetColumn = page.getByTestId("column-col-review");
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
  await dragInto(firstColumn);
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
