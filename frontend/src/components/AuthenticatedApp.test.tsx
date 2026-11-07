import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedApp } from "@/components/AuthenticatedApp";
import { boardFixture } from "@/test/boardFixture";

const response = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("AuthenticatedApp", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows sign-in when there is no session", async () => {
    fetchMock.mockResolvedValueOnce(response(401));

    render(<AuthenticatedApp />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByTestId(/column-/i)).toBeNull();
  });

  it("rejects invalid credentials without showing the board", async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401));

    render(<AuthenticatedApp />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password."
    );
    expect(screen.queryByTestId(/column-/i)).toBeNull();
  });

  it("signs in, shows the board, and logs out", async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200, boardFixture))
      .mockResolvedValueOnce(response(204));

    render(<AuthenticatedApp />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Kanban Studio" })).toBeVisible();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns to sign-in when the session expires during board use", async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { username: "user" }))
      .mockResolvedValueOnce(response(200, boardFixture))
      .mockResolvedValueOnce(response(401));
    render(<AuthenticatedApp />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete Align roadmap themes" })
    );

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired.");
  });
});
